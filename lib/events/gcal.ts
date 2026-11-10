// AskGogo Events: put the organizer's own event in the organizer's own Google Calendar, after the organizer tapped
// "Add to Google Calendar" and confirmed it on the page. Only the organizer's primary calendar is written. No attendees
// are added and Google is told to send no notifications, so nobody else is contacted. One stable calendar id per event
// means a second tap updates the same entry, never a second one. The result is read back from Google before it is
// reported as done; anything less is reported as "not sure", never as success.
import { createHash } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { refreshAccessToken } from '@/lib/services/google-calendar'
import { getEvent, recordOwnerAudit, EventsError } from './store'
import type { EventRow } from './core'

type Fetch = typeof fetch
export type GcalResult =
  | { ok: true; result: 'created' | 'updated'; verified: true; link: string | null }
  | { ok: false; result: 'not_connected' | 'no_date' | 'cancelled' | 'changed_meanwhile' | 'failed' | 'unknown' }

const API = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'

/** Google custom ids allow only a–v and 0–9; a hex digest fits. Prefixed so it can never clash with other Gogo ids. */
export function organizerCalendarId(eventId: string): string {
  return `gogoev${createHash('sha256').update(`organizer:${eventId}`).digest('hex').slice(0, 32)}`
}

const clip = (v: unknown, n: number) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, n)

/** The calendar entry: the organizer's own view, so the full place is included. No attendees, ever. */
export function calendarBody(e: EventRow, calendarId: string) {
  const start = e.starts_at as string
  const end = e.ends_at && Date.parse(e.ends_at) > Date.parse(start) ? e.ends_at : new Date(Date.parse(start) + 2 * 3600_000).toISOString()
  const location = clip([e.venue_name, e.venue_address].filter(Boolean).join(', ') || e.online_url || '', 900)
  const description = clip(e.description || '', 3000)
  return {
    id: calendarId, status: 'confirmed', summary: clip(e.title, 300) || 'Event',
    start: { dateTime: new Date(start).toISOString(), timeZone: e.timezone || 'Asia/Kolkata' },
    end: { dateTime: new Date(end).toISOString(), timeZone: e.timezone || 'Asia/Kolkata' },
    ...(location ? { location } : {}), ...(description ? { description } : {}),
    attendees: [] as never[], guestsCanInviteOthers: false, guestsCanSeeOtherGuests: false,
    source: { title: 'AskGogo', url: 'https://askgogo.in/dashboard/events' },
  }
}

/** True only when what Google holds is exactly this entry. */
export function matchesCalendar(actual: any, body: ReturnType<typeof calendarBody>): boolean {
  return actual?.id === body.id && actual?.status === 'confirmed' && actual?.summary === body.summary
    && Date.parse(actual?.start?.dateTime) === Date.parse(body.start.dateTime) && Date.parse(actual?.end?.dateTime) === Date.parse(body.end.dateTime)
    && (actual?.location || '') === (body.location || '') && !(Array.isArray(actual?.attendees) && actual.attendees.length)
}

async function primaryRefreshToken(owner: string): Promise<string | null> {
  // The owner id stays a string all the way to the query: never through Number.
  const { data, error } = await (supabaseAdmin as any).from('users').select('google_calendar_connected,google_refresh_token').eq('telegram_id', owner).maybeSingle()
  if (error) throw new EventsError('events_store_failed')
  return data?.google_calendar_connected && data?.google_refresh_token ? String(data.google_refresh_token) : null
}

export type GcalDeps = { getEventImpl?: typeof getEvent; refreshToken?: (owner: string) => Promise<string | null>; accessToken?: (refresh: string) => Promise<string | null>; fetchImpl?: Fetch; audit?: typeof recordOwnerAudit }

/** Add or update the organizer's calendar entry. `revision` is the version the organizer saw and confirmed; if the
 *  event changed since, nothing is written and the page asks again. */
export async function addEventToGoogleCalendar(owner: string, id: string, revision: number, deps: GcalDeps = {}): Promise<GcalResult> {
  const e = await (deps.getEventImpl || getEvent)(owner, id)
  if (e.status === 'cancelled') return { ok: false, result: 'cancelled' }
  if (!e.starts_at) return { ok: false, result: 'no_date' }
  if (!Number.isInteger(revision) || revision !== e.revision) return { ok: false, result: 'changed_meanwhile' }
  const refresh = await (deps.refreshToken || primaryRefreshToken)(owner)
  if (!refresh) return { ok: false, result: 'not_connected' }
  const token = await (deps.accessToken || refreshAccessToken)(refresh)
  if (!token) return { ok: false, result: 'not_connected' }
  const f = deps.fetchImpl || fetch
  const body = calendarBody(e, organizerCalendarId(e.id))
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  const one = `${API}/${encodeURIComponent(body.id)}`
  const auditOf = deps.audit || recordOwnerAudit
  const log = (code: string, status: number) => console.error('EVENTS_GCAL_FAILED:', JSON.stringify({ code, status }))

  let existed = false
  try {
    const cur = await f(one, { headers, cache: 'no-store' })
    if (cur.ok) existed = true
    else if (cur.status !== 404 && cur.status !== 410) { log('read', cur.status); return { ok: false, result: cur.status === 401 || cur.status === 403 ? 'not_connected' : 'failed' } }
    const w = existed
      ? await f(`${one}?sendUpdates=none`, { method: 'PUT', headers, body: JSON.stringify(body), cache: 'no-store' })
      : await f(`${API}?sendUpdates=none`, { method: 'POST', headers, body: JSON.stringify(body), cache: 'no-store' })
    // 409 on insert: the id exists (e.g. deleted by the organizer and still in Google's bin). Restore it in place.
    const written = !existed && w.status === 409 ? await f(`${one}?sendUpdates=none`, { method: 'PUT', headers, body: JSON.stringify(body), cache: 'no-store' }) : w
    if (!written.ok) {
      log('write', written.status)
      // A 5xx or a dropped answer may still have been applied: say "not sure", the read-back on the next tap settles it.
      return { ok: false, result: written.status >= 500 ? 'unknown' : written.status === 401 || written.status === 403 ? 'not_connected' : 'failed' }
    }
    const back = await f(one, { headers, cache: 'no-store' })
    const actual = back.ok ? await back.json().catch(() => null) : null
    if (!matchesCalendar(actual, body)) { log('verify', back.status); return { ok: false, result: 'unknown' } }
    const result = existed || w.status === 409 ? 'updated' as const : 'created' as const
    await auditOf(owner, e.id, 'event.calendar_synced', { result, revision: e.revision })
    const link = typeof actual?.htmlLink === 'string' && /^https:\/\/www\.google\.com\/calendar\//.test(actual.htmlLink) ? actual.htmlLink : null
    return { ok: true, result, verified: true, link }
  } catch (err: any) {
    log(String(err?.name || 'error').slice(0, 20), 0)
    return { ok: false, result: 'unknown' }
  }
}
