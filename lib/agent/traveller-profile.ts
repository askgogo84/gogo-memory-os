// A person's own one-traveller booking details, kept so Gogo does not ask for them every time (owner, 11 Nov 2026:
// "it should remember everything about me, should not ask every time").
//
// Rules: off unless GOGO_TRAVELLER_PROFILE lists the owner's telegram id. Exact owner only (a rounded,
// padded or malformed id never reads or writes). Only details the person typed for a booking are saved; using them
// still needs their YES and the booking still needs APPROVE. A missing table (migration not run) behaves as "nothing
// saved". "forget my travel details" deletes the row.
import { supabaseAdmin } from '@/lib/supabase-admin'
import type { AgentActor } from './actor'

export type TravellerProfile = { title: string; name: string; email: string; mobile: string; seat: 'free' | 'window' | 'aisle' | 'paid' }
type Env = Record<string, string | undefined>

/** The exact owner id, or null for anything that is not a safe canonical integer. */
export function exactOwner(actor: AgentActor): number | null {
  const raw: unknown = actor?.legacyTelegramId
  if (typeof raw === 'number' && !Number.isSafeInteger(raw)) return null
  const owner = String(raw ?? '').trim(), tg = Number(owner)
  return /^-?[1-9]\d{0,18}$/.test(owner) && Number.isSafeInteger(tg) && String(tg) === owner ? tg : null
}

export function travellerProfileEnabled(actor: AgentActor, env: Env = process.env): boolean {
  const v = String(env.GOGO_TRAVELLER_PROFILE || '').trim(), tg = exactOwner(actor)
  // Explicit owner ids only (no "on"): saving is consent-based, one person at a time.
  return tg !== null && v.split(',').map(s => s.trim()).includes(String(tg))
}

const TITLES = new Set(['Mr', 'Ms', 'Mrs', 'Miss', 'Master'])
/** Pure. A profile row is used only if every field is still valid. */
export function validProfile(row: any): TravellerProfile | null {
  const title = String(row?.title || ''), name = String(row?.full_name || '').replace(/\s+/g, ' ').trim()
  const email = String(row?.email || '').trim(), mobile = String(row?.mobile || ''), seat = String(row?.seat || '')
  if (!TITLES.has(title) || name.length < 3 || name.length > 80 || !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email) || !/^[6-9]\d{9}$/.test(mobile) || !['free', 'window', 'aisle', 'paid'].includes(seat)) return null
  return { title, name, email, mobile, seat: seat as TravellerProfile['seat'] }
}

export async function loadTravellerProfile(actor: AgentActor): Promise<TravellerProfile | null> {
  if (!travellerProfileEnabled(actor)) return null
  const tg = exactOwner(actor)!
  const { data, error } = await supabaseAdmin.from('gogo_traveller_profiles').select('telegram_id,user_id,title,full_name,email,mobile,seat').eq('telegram_id', tg).maybeSingle()
  if (error || !data || String((data as any).telegram_id) !== String(tg)) return null
  if (actor.userId && (data as any).user_id && String((data as any).user_id) !== String(actor.userId)) return null
  return validProfile(data)
}

export async function saveTravellerProfile(actor: AgentActor, p: TravellerProfile): Promise<boolean> {
  if (!travellerProfileEnabled(actor) || !validProfile({ ...p, full_name: p.name })) return false
  const tg = exactOwner(actor)!
  const { error } = await supabaseAdmin.from('gogo_traveller_profiles').upsert({ telegram_id: tg, user_id: actor.userId || null, title: p.title, full_name: p.name.replace(/\s+/g, ' ').trim(), email: p.email.trim(), mobile: p.mobile, seat: p.seat, updated_at: new Date().toISOString() }, { onConflict: 'telegram_id' })
  return !error
}

export const FORGET_TRAVEL_DETAILS = /^(?:please\s+)?(?:forget|delete|remove|clear)\s+my\s+(?:saved\s+)?(?:(?:travel(?:ler)?|booking|ticket|flight)\s+)?details(?:\s+please)?[.!]*$/i
export async function forgetTravellerProfile(actor: AgentActor): Promise<boolean> {
  const tg = exactOwner(actor)
  if (tg === null) return false
  const { error } = await supabaseAdmin.from('gogo_traveller_profiles').delete().eq('telegram_id', tg)
  return !error
}
