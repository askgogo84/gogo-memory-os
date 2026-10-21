// Admin console mutations. Every one is role-checked by the caller and written to the audit log here.
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendWhatsApp } from '@/lib/whatsapp'
import { audit, canDo, e164, hashPassword, setPasswordHash, type AdminIdentity, type AdminRole } from './console-auth'

export const INVITE_TEXT = `You're in! Your AskGogo access is open.\n\nSay hi here on WhatsApp to start, or sign in at app.askgogo.in with this number.`

type Result = { ok: true; message?: string; detail?: any } | { ok: false; error: string }
const ROLE_FOR: Record<string, AdminRole> = {
  'waitlist.approve': 'operator', 'waitlist.block': 'operator', 'waitlist.unblock': 'operator', 'waitlist.note': 'operator',
  'user.block': 'operator', 'user.unblock': 'operator', 'user.plan': 'operator',
  'task.cancel': 'operator', 'job.run': 'operator',
  'tool.cost': 'owner', 'rate.update': 'owner', 'tool.status': 'owner',
  'admin.add': 'owner', 'admin.remove': 'owner', 'admin.restore': 'owner', 'password.change': 'owner', 'sessions.revoke': 'owner',
}
export const roleFor = (action: string): AdminRole | null => ROLE_FOR[action] || null
const VALID_TIERS = ['free', 'starter', 'pro', 'founder_pro']

/** Send the invite. Free text works inside WhatsApp's 24-hour window; outside it Meta requires an approved template. */
export async function sendInvite(phone: string): Promise<string> {
  const sid = (process.env.TWILIO_INVITE_CONTENT_SID || '').trim()
  try {
    if (sid) {
      // Template path: reuse the generic sender with a content SID through the Twilio REST client.
      const twilio = (await import('twilio')).default
      const client = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!)
      const from = String(process.env.TWILIO_WHATSAPP_NUMBER || '')
      await client.messages.create({ from: from.startsWith('whatsapp:') ? from : `whatsapp:${from}`, to: `whatsapp:${phone}`, contentSid: sid } as any)
      return 'sent (template)'
    }
    await sendWhatsApp(phone, INVITE_TEXT)
    // Twilio accepts free text at once; WhatsApp only delivers it if this number messaged us in the last 24 hours.
    return 'queued (free text, needs the 24-hour window)'
  } catch (err: any) {
    const code = String(err?.code || '')
    if (code === '63016' || /24.?hour|outside.*window/i.test(String(err?.message || ''))) return 'not sent: needs an approved WhatsApp template'
    return `not sent: ${String(err?.message || 'error').slice(0, 80)}`
  }
}

export async function runAdminAction(admin: AdminIdentity, action: string, body: any): Promise<Result> {
  const min = roleFor(action)
  if (!min) return { ok: false, error: 'unknown_action' }
  if (!canDo(admin.role, min)) return { ok: false, error: 'not_allowed_for_your_role' }
  const now = new Date().toISOString()
  const ids: string[] = Array.isArray(body?.ids) ? body.ids.map(String).slice(0, 500) : body?.id ? [String(body.id)] : []

  switch (action) {
    case 'waitlist.approve': {
      if (!ids.length) return { ok: false, error: 'nothing_selected' }
      const { data: list } = await supabaseAdmin.from('waitlist').select('id, phone_e164, status').in('id', ids)
      const results: Record<string, string> = {}
      for (const row of (list || []) as any[]) {
        const invite = await sendInvite(row.phone_e164)
        results[row.phone_e164] = invite
        await supabaseAdmin.from('waitlist').update({ status: row.status === 'joined' ? 'joined' : 'invited', approved_at: now, approved_by: admin.phone, invited_at: now, invite_status: invite, blocked_at: null }).eq('id', row.id)
        // A number blocked earlier as a user is unblocked by approval.
        await supabaseAdmin.from('users').update({ access_status: 'active', access_changed_at: now, access_changed_by: admin.phone }).in('whatsapp_id', [row.phone_e164, `whatsapp:${row.phone_e164}`])
      }
      await audit(admin, 'Approved', `${ids.length} waitlist`, { results })
      const failed = Object.values(results).filter(v => v.startsWith('not sent')).length
      const freeText = Object.values(results).filter(v => v.startsWith('queued')).length
      return { ok: true, message: `Approved ${ids.length}.` + (failed ? ` ${failed} invite(s) could not be sent.` : '') + (freeText ? ` ${freeText} invite(s) went as free text, which WhatsApp only delivers to numbers that messaged us in the last 24 hours. Either way they get in as soon as they message AskGogo.` : ' Invite sent.'), detail: results }
    }
    case 'waitlist.block':
    case 'waitlist.unblock': {
      if (!ids.length) return { ok: false, error: 'nothing_selected' }
      const block = action === 'waitlist.block'
      await supabaseAdmin.from('waitlist').update(block ? { status: 'blocked', blocked_at: now } : { status: 'waiting', blocked_at: null }).in('id', ids)
      await audit(admin, block ? 'Blocked' : 'Unblocked', `${ids.length} waitlist`, { ids })
      return { ok: true, message: `${block ? 'Blocked' : 'Unblocked'} ${ids.length}.` }
    }
    case 'waitlist.note': {
      await supabaseAdmin.from('waitlist').update({ admin_note: String(body?.note || '').slice(0, 500) }).eq('id', ids[0])
      return { ok: true }
    }
    case 'user.block':
    case 'user.unblock': {
      const tid = String(body?.telegramId || '')
      if (!tid) return { ok: false, error: 'no_user' }
      const block = action === 'user.block'
      const { data: u } = await supabaseAdmin.from('users').select('whatsapp_id, name').eq('telegram_id', Number(tid)).maybeSingle()
      if (block && u && e164((u as any).whatsapp_id) === admin.phone) return { ok: false, error: 'cannot_block_yourself' }
      const { error } = await supabaseAdmin.from('users').update({ access_status: block ? 'blocked' : 'active', access_changed_at: now, access_changed_by: admin.phone }).eq('telegram_id', Number(tid))
      if (error) return { ok: false, error: 'update_failed' }
      if (block) await supabaseAdmin.from('dashboard_sessions').delete().eq('telegram_id', tid)
      await audit(admin, block ? 'Blocked user' : 'Unblocked user', `${(u as any)?.name || ''} ${e164((u as any)?.whatsapp_id || '')}`.trim(), { telegramId: tid })
      return { ok: true, message: block ? 'Blocked. Their dashboard sessions were signed out.' : 'Unblocked.' }
    }
    case 'user.plan': {
      const tid = String(body?.telegramId || ''), tier = String(body?.tier || '')
      if (!VALID_TIERS.includes(tier)) return { ok: false, error: 'invalid_plan' }
      const { error } = await supabaseAdmin.from('users').update({ tier }).eq('telegram_id', Number(tid))
      if (error) return { ok: false, error: 'update_failed' }
      await audit(admin, 'Changed plan', tid, { tier })
      return { ok: true, message: `Plan set to ${tier}.` }
    }
    case 'task.cancel': {
      const { error } = await supabaseAdmin.from('agent_runs').update({ status: 'failed', error: 'Cancelled by admin', completed_at: now, updated_at: now }).eq('id', ids[0]).in('status', ['queued', 'running', 'watching', 'waiting_approval', 'paused'])
      if (error) return { ok: false, error: 'update_failed' }
      await audit(admin, 'Cancelled task', ids[0])
      return { ok: true, message: 'Cancelled.' }
    }
    case 'job.run': {
      const path = String(body?.path || '')
      if (!/^\/api\/(cron\/[a-z0-9-]+|followups)$/.test(path)) return { ok: false, error: 'unknown_job' }
      const base = process.env.NEXT_PUBLIC_APP_URL || 'https://app.askgogo.in'
      const res = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET || ''}` } }).catch(() => null)
      await audit(admin, 'Ran job', path, { status: res?.status ?? null })
      return res && res.ok ? { ok: true, message: 'Job ran.' } : { ok: false, error: `job_returned_${res?.status ?? 'error'}` }
    }
    case 'tool.cost': {
      const toolId = String(body?.toolId || ''), month = String(body?.month || ''), amount = Number(body?.amountInr)
      if (!toolId || !/^\d{4}-\d{2}-01$/.test(month) || !Number.isFinite(amount) || amount < 0) return { ok: false, error: 'invalid_cost' }
      const { error } = await supabaseAdmin.from('admin_tool_costs').upsert({ tool_id: toolId, month, amount_inr: amount, amount_usd: body?.amountUsd ? Number(body.amountUsd) : null, source: 'manual', note: String(body?.note || '').slice(0, 200) || null, created_by: admin.phone }, { onConflict: 'tool_id,month,source' })
      if (error) return { ok: false, error: 'save_failed' }
      await audit(admin, 'Recorded invoice', toolId, { month, amount })
      return { ok: true, message: 'Saved.' }
    }
    case 'tool.status': {
      await supabaseAdmin.from('admin_tools').update({ status: String(body?.status || '').slice(0, 40), updated_at: now }).eq('id', String(body?.toolId || ''))
      await audit(admin, 'Changed tool status', String(body?.toolId || ''), { status: body?.status })
      return { ok: true }
    }
    case 'rate.update': {
      const key = String(body?.key || ''), usd = body?.usd === '' || body?.usd == null ? null : Number(body.usd), inrV = body?.inr === '' || body?.inr == null ? null : Number(body.inr)
      if (!key || (usd != null && !Number.isFinite(usd)) || (inrV != null && !Number.isFinite(inrV))) return { ok: false, error: 'invalid_rate' }
      await supabaseAdmin.from('admin_rate_card').update({ usd_per_unit: usd, inr_per_unit: inrV, updated_by: admin.phone, updated_at: now }).eq('key', key)
      await audit(admin, 'Changed rate', key, { usd, inr: inrV })
      return { ok: true, message: 'Rate saved. New calls use it.' }
    }
    case 'admin.add': {
      const phone = e164(String(body?.phone || '')), name = String(body?.name || '').trim().slice(0, 60), role = String(body?.role || 'viewer')
      if (!phone || !name || !['owner', 'operator', 'viewer'].includes(role)) return { ok: false, error: 'invalid_admin' }
      await supabaseAdmin.from('admin_members').upsert({ phone_e164: phone, name, role, active: true, added_by: admin.phone })
      await audit(admin, 'Added admin', `${name} ${phone}`, { role })
      return { ok: true, message: `${name} added as ${role}. They sign in with their number, then the admin password.` }
    }
    case 'admin.remove':
    case 'admin.restore': {
      const phone = e164(String(body?.phone || ''))
      await supabaseAdmin.from('admin_members').update({ active: action === 'admin.restore' }).eq('phone_e164', phone)
      await audit(admin, action === 'admin.remove' ? 'Removed admin' : 'Restored admin', phone)
      return { ok: true }
    }
    case 'password.change': {
      const pw = String(body?.password || '')
      if (pw.length < 10) return { ok: false, error: 'password_too_short' }
      if (process.env.ADMIN_CONSOLE_PASSWORD_HASH) return { ok: false, error: 'password_set_in_vercel_env' }
      await setPasswordHash(hashPassword(pw), admin.phone)
      await audit(admin, 'Changed password', 'Console')
      return { ok: true, message: 'Password changed. Everyone, including you, signs in again with the new one.' }
    }
    case 'sessions.revoke': {
      // Ends every admin's dashboard session, so each must sign in with their number (and the password) again.
      // Changing the password also ends every console session, because the console cookie is bound to the password hash.
      const owners = (process.env.ADMIN_WHATSAPP_NUMBERS || process.env.ADMIN_WHATSAPP_NUMBER || '').split(',').map(e164).filter(Boolean)
      const { data: members } = await supabaseAdmin.from('admin_members').select('phone_e164')
      const phones = [...owners, ...((members || []) as any[]).map(m => m.phone_e164)]
      const { data: users } = await supabaseAdmin.from('users').select('telegram_id').in('whatsapp_id', phones.flatMap(p => [p, `whatsapp:${p}`]))
      const tids = ((users || []) as any[]).map(u => String(u.telegram_id))
      if (tids.length) await supabaseAdmin.from('dashboard_sessions').delete().in('telegram_id', tids)
      await audit(admin, 'Signed out every admin session', 'Console', { sessions: tids.length })
      return { ok: true, message: 'Every admin was signed out.' }
    }
  }
  return { ok: false, error: 'unknown_action' }
}
