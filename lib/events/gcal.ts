// AskGogo Events: put the organizer's own event in the organizer's own Google Calendar, or take it out again, after the
// organizer tapped the button and confirmed it on the page. Only the organizer's primary calendar is touched. Gogo never
// adds attendees and tells Google to notify nobody. If the organizer added guests to the entry in Google, Gogo does not
// touch it (changing it silently would leave those guests with a stale copy) and says so.
// One stable id per event, plus the same iCalUID as the calendar file, so a second tap, or a tap after importing the
// file, updates the same entry instead of adding another. Only Gogo's fields (title, time, place, notes) are written to
// an existing entry; reminders, colour or a Meet link set in Google stay. Every result is read back from Google before it
// is reported; anything less is "not sure", never success.
import { createHash } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { refreshAccessToken } from '@/lib/services/google-calendar'
import { getEvent, recordOwnerAudit, EventsError } from './store'
import type { EventRow } from './core'

type Fetch = typeof fetch
export type GcalOutcome = 'created' | 'updated' | 'removed'
export type GcalResult =
  | { ok: true; result: GcalOutcome; verified: true; link: string | null; changedSince?: boolean }
  | { ok: false; result: 'not_connected' | 'no_date' | 'cancelled' | 'not_cancelled' | 'not_there' | 'has_guests' | 'changed_meanwhile' | 'failed' | 'unknown' }

const API = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'
const hash = (eventId: string) => createHash('sha256').update(`organizer:${eventId}`).digest('hex').slice(0, 32)

/** Google custom ids allow only a–v and 0–9; a hex digest fits. Prefixed so it can never clash with other Gogo ids. */
export function organizerCalendarId(eventId: string): string { return `gogoev${hash(eventId)}` }
/** The same UID the organizer's .ics file carries (app/api/dashboard/events/[id]/route.ts GET). */
export function organizerIcalUid(eventId: string): string { return `${hash(eventId)}@askgogo.in` }

const clip = (v: unknown, n: number) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, n)

/** Gogo's fields of the entry: the organizer's own view, so the full place is included. Never attendees. */
export function calendarFields(e: EventRow) {
  const start = e.starts_at as string
  const end = e.ends_at && Date.parse(e.ends_at) > Date.parse(start) ? e.ends_at : new Date(Date.parse(start) + 2 * 3600_000).toISOString()
  const tz = e.timezone || 'Asia/Kolkata'
  return {
    status: 'confirmed', summary: clip(e.title, 300) || 'Event',
    start: { dateTime: new Date(start).toISOString(), timeZone: tz }, end: { dateTime: new Date(end).toISOString(), timeZone: tz },
    location: clip([e.venue_name, e.venue_address].filter(Boolean).join(', ') || e.online_url || '', 900),
    description: clip(e.description || '', 3000),
  }
}
type Fields = ReturnType<typeof calendarFields>

const hasGuests = (x: any) => Array.isArray(x?.attendees) && x.attendees.some((a: any) => !a?.self)
/** True only when Google holds exactly Gogo's fields on that entry, with no guests. */
export function matchesCalendar(actual: any, id: string, f: Fields): boolean {
  return actual?.id === id && actual?.status === 'confirmed' && actual?.summary === f.summary
    && Date.parse(actual?.start?.dateTime) === Date.parse(f.start.dateTime) && Date.parse(actual?.end?.dateTime) === Date.parse(f.end.dateTime)
    && (actual?.location || '') === f.location && (actual?.description || '') === f.description && !hasGuests(actual)
}

async function primaryRefreshToken(owner: string): Promise<string | null> {
  // The owner id stays a string all the way to the query: never through Number.
  const { data, error } = await (supabaseAdmin as any).from('users').select('google_calendar_connected,google_refresh_token').eq('telegram_id', owner).maybeSingle()
  if (error) throw new EventsError('events_store_failed')
  return data?.google_calendar_connected && data?.google_refresh_token ? String(data.google_refresh_token) : null
}

export type GcalDeps = { getEventImpl?: typeof getEvent; refreshToken?: (owner: string) => Promise<string | null>; accessToken?: (refresh: string) => Promise<string | null>; fetchImpl?: Fetch; audit?: typeof recordOwnerAudit }
const log = (code: string, status: number) => console.error('EVENTS_GCAL_FAILED:', JSON.stringify({ code, status }))
const denied = (s: number) => s === 401 || s === 403

type Ctx = { f: Fetch; headers: Record<string, string> }
async function session(owner: string, deps: GcalDeps): Promise<Ctx | null> {
  const refresh = await (deps.refreshToken || primaryRefreshToken)(owner)
  const token = refresh ? await (deps.accessToken || refreshAccessToken)(refresh) : null
  return token ? { f: deps.fetchImpl || fetch, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } } : null
}

/** Finds Gogo's entry for this event: by Gogo's own id, else one imported from the calendar file (same iCalUID). */
async function findEntry(c: Ctx, eventId: string): Promise<{ status: number; entry: any | null }> {
  const own = await c.f(`${API}/${encodeURIComponent(organizerCalendarId(eventId))}`, { headers: c.headers, cache: 'no-store' })
  // Gogo's own id, even if deleted in Google (status cancelled): adding again restores it, removing reports it gone.
  if (own.ok) { const j = await own.json().catch(() => null); if (j?.id) return { status: 200, entry: j } }
  else if (own.status !== 404 && own.status !== 410) return { status: own.status, entry: null }
  const list = await c.f(`${API}?iCalUID=${encodeURIComponent(organizerIcalUid(eventId))}&showDeleted=false&maxResults=2`, { headers: c.headers, cache: 'no-store' })
  if (!list.ok) return { status: list.status, entry: null }
  const items = ((await list.json().catch(() => null))?.items || []).filter((x: any) => x?.id && x.status !== 'cancelled')
  return { status: items.length ? 200 : 404, entry: items[0] || null }
}

async function readBack(c: Ctx, id: string) {
  const r = await c.f(`${API}/${encodeURIComponent(id)}`, { headers: c.headers, cache: 'no-store' })
  return { status: r.status, body: r.ok ? await r.json().catch(() => null) : null }
}
const safeLink = (x: any) => typeof x?.htmlLink === 'string' && /^https:\/\/www\.google\.com\/calendar\//.test(x.htmlLink) ? x.htmlLink : null
async function auditQuietly(deps: GcalDeps, owner: string, id: string, detail: Record<string, unknown>) {
  try { await (deps.audit || recordOwnerAudit)(owner, id, 'event.calendar_synced', detail) } catch { console.error('EVENTS_GCAL_AUDIT_FAILED') }
}

/** Add or update the organizer's calendar entry. `revision` is the version the organizer saw and confirmed; if the
 *  event changed since, nothing is written and the page asks again. */
export async function addEventToGoogleCalendar(owner: string, id: string, revision: number, deps: GcalDeps = {}): Promise<GcalResult> {
  const read = deps.getEventImpl || getEvent
  const e = await read(owner, id)
  if (e.status === 'cancelled') return { ok: false, result: 'cancelled' }
  if (!e.starts_at) return { ok: false, result: 'no_date' }
  if (!Number.isInteger(revision) || revision !== e.revision) return { ok: false, result: 'changed_meanwhile' }
  const c = await session(owner, deps)
  if (!c) return { ok: false, result: 'not_connected' }
  const f = calendarFields(e)
  try {
    const found = await findEntry(c, e.id)
    if (found.status !== 200 && found.status !== 404) { log('read', found.status); return { ok: false, result: denied(found.status) ? 'not_connected' : 'failed' } }
    if (found.entry && hasGuests(found.entry)) return { ok: false, result: 'has_guests' }
    let targetId: string, created = false
    if (found.entry) {
      targetId = String(found.entry.id)
      // Only Gogo's fields: reminders, colour, conferencing or attachments set in Google are left as they are.
      const w = await c.f(`${API}/${encodeURIComponent(targetId)}?sendUpdates=none`, { method: 'PATCH', headers: c.headers, body: JSON.stringify(f), cache: 'no-store' })
      if (!w.ok) { log('patch', w.status); return { ok: false, result: w.status >= 500 ? 'unknown' : denied(w.status) ? 'not_connected' : 'failed' } }
    } else {
      targetId = organizerCalendarId(e.id)
      const body = { ...f, id: targetId, iCalUID: organizerIcalUid(e.id), guestsCanInviteOthers: false, guestsCanSeeOtherGuests: false, source: { title: 'AskGogo', url: 'https://askgogo.in/dashboard/events' } }
      let w = await c.f(`${API}?sendUpdates=none`, { method: 'POST', headers: c.headers, body: JSON.stringify(body), cache: 'no-store' })
      // 409: Google still holds this id (the entry was deleted and sits in Google's bin). Restore it in place.
      if (w.status === 409) w = await c.f(`${API}/${encodeURIComponent(targetId)}?sendUpdates=none`, { method: 'PATCH', headers: c.headers, body: JSON.stringify(f), cache: 'no-store' })
      else created = w.ok
      if (!w.ok) { log('write', w.status); return { ok: false, result: w.status >= 500 ? 'unknown' : denied(w.status) ? 'not_connected' : 'failed' } }
    }
    const back = await readBack(c, targetId)
    if (!matchesCalendar(back.body, targetId, f)) { log('verify', back.status); return { ok: false, result: 'unknown' } }
    const result: GcalOutcome = created ? 'created' : 'updated'
    await auditQuietly(deps, owner, e.id, { result, revision: e.revision })
    // An edit that landed while this ran: what is in Google is the version the organizer confirmed, not the newest.
    const now = await read(owner, id).catch(() => null)
    return { ok: true, result, verified: true, link: safeLink(back.body), ...(now && now.revision !== e.revision ? { changedSince: true } : {}) }
  } catch (err: any) {
    log(String(err?.name || 'error').slice(0, 20), 0)
    return { ok: false, result: 'unknown' }
  }
}

/** Take a cancelled event's entry out of the organizer's own calendar (the entry Gogo or the calendar file made). */
export async function removeEventFromGoogleCalendar(owner: string, id: string, deps: GcalDeps = {}): Promise<GcalResult> {
  const e = await (deps.getEventImpl || getEvent)(owner, id)
  if (e.status !== 'cancelled') return { ok: false, result: 'not_cancelled' }
  const c = await session(owner, deps)
  if (!c) return { ok: false, result: 'not_connected' }
  try {
    const found = await findEntry(c, e.id)
    if (found.status === 404 || (found.entry && found.entry.status === 'cancelled')) return { ok: false, result: 'not_there' }
    if (found.status !== 200 || !found.entry) { log('read', found.status); return { ok: false, result: denied(found.status) ? 'not_connected' : 'failed' } }
    if (hasGuests(found.entry)) return { ok: false, result: 'has_guests' }
    const targetId = String(found.entry.id)
    const d = await c.f(`${API}/${encodeURIComponent(targetId)}?sendUpdates=none`, { method: 'DELETE', headers: c.headers, cache: 'no-store' })
    if (!d.ok && d.status !== 410) { log('delete', d.status); return { ok: false, result: d.status >= 500 ? 'unknown' : denied(d.status) ? 'not_connected' : 'failed' } }
    const back = await readBack(c, targetId)
    if (!(back.status === 404 || back.status === 410 || back.body?.status === 'cancelled')) { log('verify', back.status); return { ok: false, result: 'unknown' } }
    await auditQuietly(deps, owner, e.id, { result: 'removed', revision: e.revision })
    return { ok: true, result: 'removed', verified: true, link: null }
  } catch (err: any) {
    log(String(err?.name || 'error').slice(0, 20), 0)
    return { ok: false, result: 'unknown' }
  }
}
