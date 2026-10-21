// Access gate (admin console v1, 21 Oct 2026). Spec: docs/admin-console/README.md §Access.
//  - Everyone who already has a users row keeps access, unless an admin blocks them.
//  - A new number gets access only once an admin approves it on the waitlist. Until then every
//    message adds/keeps it on the waitlist and gets a short holding reply (at most once a day).
//  - Admin numbers always pass.
//  - If the access columns are not there yet (migration not applied) or the lookup fails, the gate
//    lets the message through: a database hiccup must never lock real users out.
import { supabaseAdmin } from '@/lib/supabase-admin'
import { isAdminPhone } from '@/lib/bot/handlers/admin-analytics'

export type AccessDecision = { allow: boolean; reason: 'admin' | 'user' | 'approved' | 'gate_off' | 'gate_error' | 'waitlist' | 'blocked'; reply?: string | null }

export const WAITLIST_REPLY = `Hi! AskGogo is opening up in batches, and you're on the waitlist now. We'll message you here as soon as your access is ready.`
export const BLOCKED_REPLY = `Sorry, AskGogo isn't available on this number.`
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
export async function checkWhatsAppAccess(phone: string, profileName?: string): Promise<AccessDecision> {
  if (!accessGateEnabled()) return { allow: true, reason: 'gate_off' }
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
    if (!row) {
      const { error: insertError } = await supabaseAdmin.from('waitlist').insert({
        phone_e164: p, status: 'waiting', source: 'whatsapp', country: countryOf(p), whatsapp_opt_in: true,
        profile_name: profileName ? String(profileName).slice(0, 80) : null, last_notified_at: now,
      })
      if (insertError && insertError.code !== '23505') {
        console.error('ACCESS_GATE_WAITLIST_INSERT_FAILED', insertError.code)
        return { allow: true, reason: 'gate_error' }
      }
      return { allow: false, reason: 'waitlist', reply: WAITLIST_REPLY }
    }
    if (shouldNotify(row.last_notified_at)) { await markNotified(row.id); return { allow: false, reason: 'waitlist', reply: WAITLIST_REPLY } }
    return { allow: false, reason: 'waitlist', reply: null }
  } catch (err: any) {
    console.error('ACCESS_GATE_FAILED', err?.message || err)
    return { allow: true, reason: 'gate_error' }
  }
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
