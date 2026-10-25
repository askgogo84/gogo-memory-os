// Invite links: database side. Tables + redeem_invite() live in supabase/migrations/20261023120000_invite_links.sql.
import { randomInt } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendWhatsApp } from '@/lib/whatsapp'
import { deliverNotification } from '@/lib/services/notification-delivery'
import { INVITE_LIMIT, firstName, inviterJoinedText, makeInviteCode, normalizeInviteCode, type JoinedFriend } from './core'

export type RedeemResult = { ok: boolean; reason: 'joined' | 'already_joined' | 'used_other_invite' | 'used_up' | 'invalid' | 'error'; redemptionId: string | null; inviterTelegramId: number | null; remaining: number; code: string }

async function usedCount(code: string): Promise<number> {
  const { count, error } = await supabaseAdmin.from('invite_redemptions').select('id', { count: 'exact', head: true }).eq('code', code)
  if (error) throw new Error(`invite_count_failed:${error.code || error.message}`)
  return count || 0
}

/** The user's one invite code, created on first ask. */
export async function getOrCreateInviteCode(telegramId: number, name?: string | null): Promise<{ code: string; remaining: number }> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data, error } = await supabaseAdmin.from('invite_codes').select('code,max_uses,active').eq('inviter_telegram_id', telegramId).maybeSingle()
    if (error) throw new Error(`invite_code_read_failed:${error.code || error.message}`)
    if (data?.code) {
      const max = data.active === false ? 0 : Number(data.max_uses ?? INVITE_LIMIT)
      return { code: data.code, remaining: Math.max(max - await usedCount(data.code), 0) }
    }
    const { error: insertError } = await supabaseAdmin.from('invite_codes').insert({ code: makeInviteCode(name, randomInt), inviter_telegram_id: telegramId, max_uses: INVITE_LIMIT })
    // 23505: another request created this user's code first, or (rarely) the random code is taken; read/try again.
    if (insertError && insertError.code !== '23505') throw new Error(`invite_code_create_failed:${insertError.code || insertError.message}`)
  }
  throw new Error('invite_code_create_failed:retries')
}

/** For the invite page: who invited, and whether the link still works. Never returns phone numbers. */
export async function getInvitePreview(rawCode: string): Promise<{ code: string; inviterFirstName: string | null; remaining: number; active: boolean } | null> {
  const code = normalizeInviteCode(rawCode)
  if (!code) return null
  const { data, error } = await supabaseAdmin.from('invite_codes').select('code,inviter_telegram_id,max_uses,active').eq('code', code).maybeSingle()
  if (error || !data) return null
  const { data: inviter } = await supabaseAdmin.from('users').select('name').eq('telegram_id', data.inviter_telegram_id).maybeSingle()
  const remaining = Math.max(Number(data.max_uses ?? INVITE_LIMIT) - await usedCount(code), 0)
  return { code, inviterFirstName: firstName(inviter?.name), remaining, active: data.active !== false }
}

export async function redeemInvite(code: string, phoneE164: string, name?: string | null): Promise<RedeemResult> {
  const { data, error } = await supabaseAdmin.rpc('redeem_invite', { p_code: code, p_phone: phoneE164, p_name: name && !/^friend$/i.test(name) ? String(name).slice(0, 80) : null })
  if (error) { console.error('INVITE_REDEEM_FAILED', error.code || error.message); return { ok: false, reason: 'error', redemptionId: null, inviterTelegramId: null, remaining: 0, code } }
  const row = Array.isArray(data) ? data[0] : data
  return {
    ok: !!row?.ok, reason: (row?.reason || 'invalid') as RedeemResult['reason'], redemptionId: row?.redemption_id || null,
    inviterTelegramId: row?.inviter_telegram_id == null ? null : Number(row.inviter_telegram_id), remaining: Number(row?.remaining || 0), code,
  }
}

export async function listJoinedFriends(telegramId: number): Promise<JoinedFriend[]> {
  const { data, error } = await supabaseAdmin.from('invite_redemptions').select('invitee_name,invitee_phone_e164,created_at')
    .eq('inviter_telegram_id', telegramId).order('created_at', { ascending: true }).limit(50)
  if (error) throw new Error(`invite_list_failed:${error.code || error.message}`)
  return (data || []).map((r: any) => ({ name: r.invitee_name || null, phone: String(r.invitee_phone_e164 || ''), joinedAt: String(r.created_at) }))
}

/** After the new number's users row exists: link it, and tell the inviter once (delivery ledger key). */
export async function completeInviteJoin(p: { redemptionId: string; inviterTelegramId: number; inviteeTelegramId: number; inviteePhone: string; inviteeName?: string | null; remaining: number }) {
  await supabaseAdmin.from('invite_redemptions').update({ invitee_telegram_id: p.inviteeTelegramId }).eq('id', p.redemptionId)
  const { data: inviter } = await supabaseAdmin.from('users').select('name,whatsapp_id').eq('telegram_id', p.inviterTelegramId).maybeSingle()
  if (inviter?.whatsapp_id) {
    const message = inviterJoinedText({ friendName: p.inviteeName || null, friendPhone: p.inviteePhone, remaining: p.remaining })
    await deliverNotification({
      key: `invite-joined/${p.redemptionId}`, source: 'watch_alert', owner: p.inviterTelegramId, channel: 'whatsapp', due: new Date().toISOString(), deadline: Date.now() + 15_000,
      prepare: async () => {}, ready: async () => true,
      send: async token => String((await sendWhatsApp(String(inviter.whatsapp_id), message, null, token))?.sid || ''),
    }).catch(err => console.error('INVITE_NOTIFY_FAILED', err?.message || err))
  }
  return { inviterName: (inviter?.name as string | null) || null }
}
