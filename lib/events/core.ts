// AskGogo Events (Addendum 4): pure rules. No I/O. The database (supabase/migrations/20261110150000_gogo_events.sql)
// is the source of truth for RSVPs and headcount; this file holds what the app decides before and after it.
import { createHash, randomBytes } from 'node:crypto'

type Env = Record<string, string | undefined>
const envOf = (): Env => ((globalThis as any).process?.env || {}) as Env

/** Off by default. On for everyone with GOGO_EVENTS=1, or for exact owner ids listed in GOGO_EVENTS_OWNERS. */
export function eventsEnabledFor(owner: string, env: Env = envOf()): boolean {
  if (!/^-?[0-9]{1,20}$/.test(String(owner))) return false
  if (env.GOGO_EVENTS === '1') return true
  return String(env.GOGO_EVENTS_OWNERS || '').split(',').map(s => s.trim()).filter(Boolean).includes(String(owner))
}

// ---- invitation tokens -------------------------------------------------------------------------------------------
export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/
/** 256 random bits, URL-safe. Shown once to its holder; only the hash is stored. */
export const newEventToken = (): string => randomBytes(32).toString('base64url')
export function eventTokenHash(token: unknown): string | null {
  return typeof token === 'string' && TOKEN_RE.test(token) ? createHash('sha256').update(token, 'utf8').digest('hex') : null
}
export function rsvpUrl(token: string, env: Env = envOf()): string {
  if (!TOKEN_RE.test(token)) throw new Error('invalid_event_token')
  return `${(env.NEXT_PUBLIC_APP_URL || 'https://app.askgogo.in').replace(/\/$/, '')}/rsvp/${token}`
}

// ---- event drafts -------------------------------------------------------------------------------------------------
export const EVENT_KINDS = ['birthday', 'anniversary', 'dinner', 'outing', 'meeting', 'other'] as const
export type EventKind = (typeof EVENT_KINDS)[number]
export type EventDraft = {
  title?: string | null; kind?: EventKind | null; startsAt?: string | null; endsAt?: string | null; timezone?: string | null
  venueName?: string | null; venueAddress?: string | null; onlineUrl?: string | null; hostName?: string | null
  description?: string | null; dressCode?: string | null; capacity?: number | null; maxPlusOnes?: number | null; rsvpClosesAt?: string | null
}
const clean = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n)

/** What must still be asked before an event can be published. Never guessed: a missing date or place stays missing. */
export function missingForPublish(d: EventDraft, now = Date.now()): ('title' | 'date_time' | 'place')[] {
  const missing: ('title' | 'date_time' | 'place')[] = []
  if (!clean(d.title, 120)) missing.push('title')
  const start = d.startsAt ? Date.parse(d.startsAt) : NaN
  if (!Number.isFinite(start) || start <= now) missing.push('date_time')
  if (!clean(d.venueName, 160) && !clean(d.onlineUrl, 500)) missing.push('place')
  return missing
}

export function draftProblems(d: EventDraft): string[] {
  const problems: string[] = []
  if (d.kind != null && !EVENT_KINDS.includes(d.kind)) problems.push('kind')
  if (d.startsAt != null && !Number.isFinite(Date.parse(d.startsAt))) problems.push('startsAt')
  if (d.endsAt != null && (!Number.isFinite(Date.parse(d.endsAt)) || (d.startsAt != null && Date.parse(d.endsAt) <= Date.parse(d.startsAt)))) problems.push('endsAt')
  if (d.rsvpClosesAt != null && !Number.isFinite(Date.parse(d.rsvpClosesAt))) problems.push('rsvpClosesAt')
  if (d.capacity != null && (!Number.isInteger(d.capacity) || d.capacity < 1 || d.capacity > 5000)) problems.push('capacity')
  if (d.maxPlusOnes != null && (!Number.isInteger(d.maxPlusOnes) || d.maxPlusOnes < 0 || d.maxPlusOnes > 10)) problems.push('maxPlusOnes')
  if (d.onlineUrl != null && d.onlineUrl !== '' && !/^https:\/\/[^\s]{3,490}$/.test(d.onlineUrl)) problems.push('onlineUrl')
  if (d.timezone != null) { try { new Intl.DateTimeFormat('en', { timeZone: d.timezone }) } catch { problems.push('timezone') } }
  return problems
}

// ---- guests -------------------------------------------------------------------------------------------------------
/** Guest-supplied text: control characters and direction overrides removed, whitespace collapsed, cut by code point
 *  (never through the middle of a character). Still untrusted data wherever it is shown or given to a model. */
export function cleanGuestText(v: unknown, max: number): string {
  if (typeof v !== 'string') return ''
  return [...v.replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim()].slice(0, max).join('')
}
export const guestName = (v: unknown): string => cleanGuestText(v, 80)
/** A phone number as an exact digit string (8 to 15 digits), or null. A bare 10-digit Indian mobile gets 91. Never a number. */
export function guestPhone(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const raw = v.replace(/^whatsapp:/i, '').trim()
  if (!/^\+?[0-9][0-9 ()-]{6,22}$/.test(raw)) return null
  let digits = raw.replace(/\D/g, '')
  if (!raw.startsWith('+') && digits.length === 10 && /^[6-9]/.test(digits)) digits = '91' + digits
  return digits.length >= 8 && digits.length <= 15 ? digits : null
}
/** Guests the organizer typed, with duplicates (same phone, or same name with no phone) reported instead of added twice. */
export function dedupeGuests(input: { name: string; phone?: string | null }[], existing: { name: string; phone: string | null }[] = []) {
  const seenPhone = new Set(existing.map(g => g.phone).filter(Boolean) as string[])
  const seenName = new Set(existing.filter(g => !g.phone).map(g => g.name.toLowerCase()))
  const add: { name: string; phone: string | null }[] = [], duplicates: string[] = [], invalid: string[] = []
  for (const g of input) {
    const name = guestName(g.name), phone = g.phone == null || g.phone === '' ? null : guestPhone(g.phone)
    if (!name || (g.phone && !phone)) { invalid.push(clean(g.name || g.phone, 80)); continue }
    if (phone ? seenPhone.has(phone) : seenName.has(name.toLowerCase())) { duplicates.push(name); continue }
    if (phone) seenPhone.add(phone); else seenName.add(name.toLowerCase())
    add.push({ name, phone })
  }
  return { add, duplicates, invalid }
}

// ---- headcount ----------------------------------------------------------------------------------------------------
export type Headcount = { invited: number; going: number; plus_ones: number; attendees: number; maybe: number; declined: number; no_reply: number }
const int = (v: unknown) => (Number.isSafeInteger(Number(v)) && Number(v) >= 0 ? Number(v) : 0)
export function asHeadcount(raw: any): Headcount {
  const h = { invited: int(raw?.invited), going: int(raw?.going), plus_ones: int(raw?.plus_ones), attendees: int(raw?.attendees), maybe: int(raw?.maybe), declined: int(raw?.declined), no_reply: int(raw?.no_reply) }
  // People, not invitations. If the stored total ever disagrees with its parts, the parts win.
  return { ...h, attendees: h.going + h.plus_ones }
}
const people = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`
/** The organizer's answer to "how many are coming?". Only what the database counted; nothing estimated. */
export function headcountLine(h: Headcount): string {
  if (!h.invited) return 'No guests have been added yet.'
  const coming = h.plus_ones ? `${h.going} going + ${h.plus_ones} plus-one${h.plus_ones === 1 ? '' : 's'} = ${people(h.attendees)}` : `${people(h.attendees)} going`
  const rest = [h.maybe ? `${h.maybe} maybe` : '', h.declined ? `${h.declined} declined` : '', h.no_reply ? `${h.no_reply} not replied yet` : ''].filter(Boolean).join(', ')
  return rest ? `${coming}. ${rest}.` : `${coming}.`
}

// ---- what a guest may see ------------------------------------------------------------------------------------------
export type EventRow = {
  id: string; owner_telegram_id: string; title: string; kind: string; status: string; starts_at: string | null; ends_at: string | null; timezone: string
  venue_name: string | null; venue_address: string | null; address_visibility: string; online_url: string | null; host_name: string | null
  description: string | null; dress_code: string | null; capacity: number | null; max_plus_ones: number; rsvp_closes_at: string | null; template: number; revision: number
}
export type GuestRow = { id: string; name: string; rsvp_status: string; plus_ones: number; dietary: string | null; comment: string | null; token_revoked_at: string | null }
/** The invitation as one guest sees it. No ids, no owner, no other guests, no phone numbers. The exact address and the
 *  online link appear only if the organizer made them visible to everyone, or this guest is going. */
export function publicInvitation(e: EventRow, g: GuestRow | null, now = Date.now()) {
  const going = g?.rsvp_status === 'going'
  const showPlace = e.address_visibility === 'everyone' || going
  const closesAt = e.rsvp_closes_at || e.starts_at
  const open = e.status === 'published' && closesAt != null && now < Date.parse(closesAt)
  return {
    title: e.title, kind: e.kind, status: e.status === 'cancelled' ? 'cancelled' as const : open ? 'open' as const : 'closed' as const,
    startsAt: e.starts_at, endsAt: e.ends_at, timezone: e.timezone, hostName: e.host_name, description: e.description, dressCode: e.dress_code,
    venueName: e.venue_name, venueAddress: showPlace ? e.venue_address : null, onlineUrl: showPlace ? e.online_url : null,
    placeHidden: !showPlace && Boolean(e.venue_address || e.online_url),
    maxPlusOnes: e.max_plus_ones, template: e.template,
    guest: g ? { name: g.name, rsvp: g.rsvp_status, plusOnes: g.plus_ones, dietary: g.dietary, comment: g.comment } : null,
  }
}

export const RSVP_ERRORS: Record<string, string> = {
  not_found: 'This invitation link is not valid.', revoked: 'This invitation is no longer active. Please ask the host for a new link.',
  cancelled: 'This event has been cancelled.', not_open: 'This invitation is not open for replies yet.',
  closed: 'Replies for this event are closed. Please contact the host directly.', full: 'This event is full.',
  too_many_changes: 'This reply has been changed too many times. Please contact the host directly.',
  invalid_status: 'Please choose Going, Maybe or Not going.', name_required: 'Please enter your name.', guest_limit: 'This invitation cannot take more replies. Please contact the host.',
}
export const rsvpErrorText = (code: unknown) => RSVP_ERRORS[String(code)] || 'That did not work. Please try again.'

// ---- add to calendar ------------------------------------------------------------------------------------------------
const icsEscape = (v: string) => v.replace(/\\/g, '\\\\').replace(/\r\n?|\n/g, '\\n').replace(/([,;])/g, '\\$1')
const icsTime = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
function fold(line: string): string {
  // Fold at 73 bytes, by whole characters, so a multi-byte character or an emoji is never split.
  const out: string[] = []
  let current = '', bytes = 0
  for (const ch of line) {
    const size = Buffer.byteLength(ch, 'utf8')
    if (bytes + size > 73) { out.push(current); current = ' '; bytes = 1 }
    current += ch; bytes += size
  }
  out.push(current)
  return out.join('\r\n')
}
/** An .ics file for the guest's own calendar. Holds only what that guest is allowed to see. */
export function invitationIcs(view: ReturnType<typeof publicInvitation>, uid: string, now = new Date(), sequence = 0): string | null {
  if (!view.startsAt || view.status === 'cancelled') return null
  const end = view.endsAt || new Date(Date.parse(view.startsAt) + 2 * 3600_000).toISOString()
  const place = [view.venueName, view.venueAddress].filter(Boolean).join(', ') || view.onlineUrl || ''
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//AskGogo//Events//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
    `UID:${icsEscape(uid)}@askgogo.in`, `SEQUENCE:${Number.isInteger(sequence) && sequence >= 0 ? sequence : 0}`, `DTSTAMP:${icsTime(now.toISOString())}`, `DTSTART:${icsTime(view.startsAt)}`, `DTEND:${icsTime(end)}`,
    `SUMMARY:${icsEscape(view.title)}`, place ? `LOCATION:${icsEscape(place)}` : '', view.description ? `DESCRIPTION:${icsEscape(view.description)}` : '', 'END:VEVENT', 'END:VCALENDAR']
  return lines.filter(Boolean).map(fold).join('\r\n') + '\r\n'
}
