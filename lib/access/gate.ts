// Access gate (admin console v1, 21 Oct 2026). Spec: docs/admin-console/README.md §Access.
//  - Everyone who already has a users row keeps access, unless an admin blocks them.
//  - A new number gets access only once an admin approves it on the waitlist. Until then every
//    message adds/keeps it on the waitlist and gets a short holding reply (at most once a day).
//  - Admin numbers always pass.
//  - If the access columns are not there yet (migration not applied) or the lookup fails, the gate
//    lets the message through: a database hiccup must never lock real users out.
import { supabaseAdmin } from '@/lib/supabase-admin'
import { isAdminPhone } from '@/lib/bot/handlers/admin-analytics'
import { extractInviteCode } from '@/lib/invites/core'
import { redeemInvite, type RedeemResult } from '@/lib/invites/store'

export type AccessDecision = { allow: boolean; reason: 'admin' | 'user' | 'approved' | 'invited' | 'gate_off' | 'gate_error' | 'waitlist' | 'blocked'; reply?: string | null; invite?: RedeemResult }

export const WAITLIST_REPLY = `Hi! AskGogo is opening up in batches, and you're on the waitlist now. We'll message you here as soon as your access is ready.`
export const BLOCKED_REPLY = `Sorry, AskGogo isn't available on this number.`
export const INVITE_USED_UP_REPLY = `That invite link has been used up, so you're on the waitlist for now. We'll message you here as soon as your access is ready.`
export const INVITE_INVALID_REPLY = `That invite code didn't work, so you're on the waitlist for now. We'll message you here as soon as your access is ready.`
const NOTIFY_EVERY_MS = 24 * 60 * 60 * 1000

export function accessGateEnabled() {
  return process.env.ACCESS_GATE_ENABLED !== 'false'
}

export function e164(phone: string): string {
  const raw = String(phone || '').replace(/^whatsapp:/, '').trim()
  const digits = raw.replace(/\D/g, '')
  if (!digits) return ''
  if (raw.startsWith('+')) return `+${digits}`
  return digits.length === 10 ? `+91${digits}` : `+${digits}`
}
export function phoneCandidates(phone: string): string[] {
  const p = e164(phone)
  if (!p) return []
  return Array.from(new Set([p, `whatsapp:${p}`, p.slice(1)]))
}
export function countryOf(phone: string): string | null {
  const p = e164(phone)
  if (p.startsWith('+91')) return 'IN'
  if (p.startsWith('+971')) return 'AE'
  return null
}

/** Decide whether an inbound WhatsApp message may reach AskGogo. Writes the waitlist row for new numbers. */
// Invite links (23 Oct): a NEW number whose message carries an invite code ("Hi Gogo, I'm joining with invite
// goverdhan-7k2m9x") joins straight away when the code still has invites left; the waitlist row is marked joined.
// Existing users, admins and blocked numbers are never affected by a code.
export async function checkWhatsAppAccess(phone: string, profileName?: string, text?: string): Promise<AccessDecision> {
  const inviteCode = extractInviteCode(text)
  if (!accessGateEnabled()) {
    if (!inviteCode) return { allow: true, reason: 'gate_off' }
    const p = e164(phone)
    const invite = p && !isAdminPhone(p) && !(await hasUserRow(p)) ? await redeemInvite(inviteCode, p, profileName) : null
    return invite?.ok ? { allow: true, reason: 'gate_off', invite } : { allow: true, reason: 'gate_off' }
  }
  const p = e164(phone)
  if (!p) return { allow: true, reason: 'gate_error' }
  if (isAdminPhone(p)) return { allow: true, reason: 'admin' }
  try {
    const { data: users, error: userError } = await supabaseAdmin
      .from('users').select('telegram_id, access_status').in('whatsapp_id', phoneCandidates(p)).limit(5)
    if (userError) { console.error('ACCESS_GATE_USER_LOOKUP_FAILED', userError.code); return { allow: true, reason: 'gate_error' } }
    if (users && users.length) {
      if (users.some((u: any) => u.access_status === 'blocked')) return { allow: false, reason: 'blocked', reply: BLOCKED_REPLY }
      return { allow: true, reason: 'user' }
    }

    const { data: row, error: wlError } = await supabaseAdmin
      .from('waitlist').select('id, status, last_notified_at').eq('phone_e164', p).maybeSingle()
    if (wlError) { console.error('ACCESS_GATE_WAITLIST_LOOKUP_FAILED', wlError.code); return { allow: true, reason: 'gate_error' } }

    if (row?.status === 'invited' || row?.status === 'joined') {
      if (row.status === 'invited') {
        await supabaseAdmin.from('waitlist').update({ status: 'joined', joined_at: new Date().toISOString() }).eq('id', row.id)
      }
      return { allow: true, reason: 'approved' }
    }
    if (row?.status === 'blocked') return { allow: false, reason: 'blocked', reply: shouldNotify(row.last_notified_at) ? (await markNotified(row.id), BLOCKED_REPLY) : null }

    const now = new Date().toISOString()
    let inviteReply: string | null = null
    if (inviteCode) {
      const invite = await redeemInvite(inviteCode, p, profileName)
      if (invite.ok) {
        const joined = { status: 'joined', joined_at: now, approved_at: now, approved_by: `invite:${invite.code}`, last_notified_at: now }
        const write = row
          ? await supabaseAdmin.from('waitlist').update(joined).eq('id', row.id)
          : await supabaseAdmin.from('waitlist').insert({ phone_e164: p, source: 'whatsapp', country: countryOf(p), whatsapp_opt_in: true,
              profile_name: profileName ? String(profileName).slice(0, 80) : null, admin_note: `Joined with invite ${invite.code}`, ...joined })
        if (write.error && write.error.code !== '23505') console.error('ACCESS_GATE_INVITE_WAITLIST_WRITE_FAILED', write.error.code)
        return { allow: true, reason: 'invited', invite }
      }
      if (invite.reason === 'used_up') inviteReply = INVITE_USED_UP_REPLY
      else if (invite.reason === 'invalid') inviteReply = INVITE_INVALID_REPLY
    }
    if (!row) {
      const { error: insertError } = await supabaseAdmin.from('waitlist').insert({
        phone_e164: p, status: 'waiting', source: 'whatsapp', country: countryOf(p), whatsapp_opt_in: true,
        profile_name: profileName ? String(profileName).slice(0, 80) : null, last_notified_at: now,
      })
      if (insertError && insertError.code !== '23505') {
        console.error('ACCESS_GATE_WAITLIST_INSERT_FAILED', insertError.code)
        return { allow: true, reason: 'gate_error' }
      }
      return { allow: false, reason: 'waitlist', reply: inviteReply || WAITLIST_REPLY }
    }
    if (inviteReply || shouldNotify(row.last_notified_at)) { await markNotified(row.id); return { allow: false, reason: 'waitlist', reply: inviteReply || WAITLIST_REPLY } }
    return { allow: false, reason: 'waitlist', reply: null }
  } catch (err: any) {
    console.error('ACCESS_GATE_FAILED', err?.message || err)
    return { allow: true, reason: 'gate_error' }
  }
}

async function hasUserRow(p: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin.from('users').select('telegram_id').in('whatsapp_id', phoneCandidates(p)).limit(1)
  return !!error || !!data?.length
}

function shouldNotify(last: string | null | undefined) {
  return !last || Date.now() - new Date(last).getTime() > NOTIFY_EVERY_MS
}
async function markNotified(id: string) {
  await supabaseAdmin.from('waitlist').update({ last_notified_at: new Date().toISOString() }).eq('id', id)
}

/** True when this dashboard account (by telegram_id) is blocked. Fails open. */
export async function isTelegramIdBlocked(telegramId: string | number): Promise<boolean> {
  try {
    const { data, error } = await supabaseAdmin.from('users').select('access_status').eq('telegram_id', Number(telegramId)).maybeSingle()
    if (error) return false
    return (data as any)?.access_status === 'blocked'
  } catch { return false }
}
