// Same Brain 3.0, Addendum 5 (P1, proactive recommendations), Events part: what an organizer might want to do next,
// worked out from their own events and RSVPs.
//
// A suggestion is something to look at, never something done: nothing is sent to any guest, no task is created and no
// message goes to the organizer. It appears on Tasks › Overview only. Each one says what it is based on (the event,
// the date, the count) and can be dismissed; a dismissal is recorded on the event's audit trail and holds until the
// event itself changes (its revision: an edit, or a new or switched-off invitation link), so the same suggestion does
// not keep coming back and a changed plan is looked at afresh. At most one suggestion per event and four in all.
import { eventsEnabledFor, type EventRow } from './core'
import * as store from './store'

export type Suggestion = { key: string; eventId: string; kind: 'draft_unpublished' | 'no_replies' | 'nobody_invited'; title: string; why: string; action: string; href: string }
type GuestLite = { rsvp: string; revoked: boolean; optedOut: boolean; name: string }

const DAY = 86_400_000
export const MAX_SUGGESTIONS = 4
const clean = (v: unknown, n: number) => String(v ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n)
// Calendar days between now and the event, in the event's own time zone: an event three hours away is "today".
const dayNumber = (ms: number, tz: string) => { const p: Record<string, string> = {}; for (const x of new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms))) p[x.type] = x.value; return Math.round(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)) / DAY) }
const whenWords = (starts: number, now: number, tz: string) => { let d: number; try { d = dayNumber(starts, tz) - dayNumber(now, tz) } catch { d = dayNumber(starts, 'Asia/Kolkata') - dayNumber(now, 'Asia/Kolkata') } return d <= 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d} days` }
/** The key a dismissal is stored under: the kind and the event's revision, so it lapses when the event changes. */
export const suggestionKey = (kind: Suggestion['kind'], e: Pick<EventRow, 'revision'>) => `${kind}:r${Number(e.revision) || 0}`
const KEY = /^(?:draft_unpublished|no_replies|nobody_invited):r\d{1,6}$/
export const validSuggestionKey = (k: unknown): k is string => typeof k === 'string' && KEY.test(k)

/** Pure: the one suggestion for an event, or null. `guests` only matters for a published event. */
export function suggestionFor(e: EventRow, guests: GuestLite[], now: number): Suggestion | null {
  const starts = Date.parse(String(e.starts_at || ''))
  if (!Number.isFinite(starts) || starts <= now) return null
  const title = clean(e.title, 80) || 'Your event', href = `/dashboard/events/${encodeURIComponent(e.id)}`, away = starts - now
  const inDays = (_ms: number) => whenWords(starts, now, String(e.timezone || 'Asia/Kolkata'))
  if (e.status === 'draft') {
    // A dated draft two weeks or less away: the invitation link does not exist until it is published.
    if (away > 14 * DAY) return null
    return { key: suggestionKey('draft_unpublished', e), eventId: e.id, kind: 'draft_unpublished', title, action: 'Open draft', href,
      why: `It is ${inDays(away)} and still a draft, so there is no invitation link yet. Publish it when the details are right.` }
  }
  if (e.status !== 'published' || away > 14 * DAY) return null
  const invited = guests.filter(g => !g.revoked && !g.optedOut)
  if (!invited.length) {
    return { key: suggestionKey('nobody_invited', e), eventId: e.id, kind: 'nobody_invited', title, action: 'Open event', href,
      why: `It is ${inDays(away)} and there are no guests and no replies yet. Open the event to share its invitation link.` }
  }
  // "Has not replied" is a guest still at the starting status; anything they chose (going, maybe, declined) is a reply.
  const silent = invited.filter(g => !['going', 'maybe', 'declined', 'not_going', 'waitlist'].includes(String(g.rsvp)))
  // Once replies have closed there is nothing to nudge for.
  const closes = Date.parse(String(e.rsvp_closes_at || ''))
  if (!silent.length || away > 7 * DAY || (Number.isFinite(closes) && closes <= now)) return null
  const names = silent.slice(0, 3).map(g => clean(g.name, 30)).filter(Boolean)
  const more = silent.length - names.length
  return { key: suggestionKey('no_replies', e), eventId: e.id, kind: 'no_replies', title, action: 'See who', href,
    why: `It is ${inDays(away)} and ${silent.length} of ${invited.length} ${invited.length === 1 ? 'guest has' : 'guests have'} not replied${names.length ? ` (${names.join(', ')}${more > 0 ? ` and ${more} more` : ''})` : ''}. Nudging them is yours to do; I have not messaged anyone.` }
}

export type SuggestionDeps = { db?: Parameters<typeof store.listEvents>[1]; now?: number; env?: Record<string, string | undefined> }
/** The organizer's current suggestions, soonest event first. Never throws; anything unreadable yields fewer, not wrong. */
export async function getEventSuggestions(owner: string, deps: SuggestionDeps = {}): Promise<Suggestion[]> {
  try {
    if (!owner || !eventsEnabledFor(owner, deps.env)) return []
    const now = deps.now ?? Date.now()
    const upcoming = (await store.listEvents(owner, deps.db))
      .filter(e => (e.status === 'draft' || e.status === 'published') && Date.parse(String(e.starts_at || '')) > now)
      .sort((a, b) => Date.parse(String(a.starts_at)) - Date.parse(String(b.starts_at))).slice(0, 8)
    const out: Suggestion[] = []
    for (const e of upcoming) {
      if (out.length >= MAX_SUGGESTIONS) break
      try {
        const guests = e.status === 'published' ? await store.listGuests(owner, e.id, deps.db) : []
        const s = suggestionFor(e, guests, now)
        if (!s) continue
        const dismissed = await store.ownerAuditDetails(owner, e.id, 'event.suggestion_dismissed', deps.db)
        if (dismissed.some(d => d.key === s.key)) continue
        out.push(s)
      } catch { /* this event's suggestion is skipped */ }
    }
    return out
  } catch (err: any) {
    console.error('EVENT_SUGGESTIONS_FAILED:', JSON.stringify({ code: String(err?.code || err?.name || 'error').replace(/[^a-z0-9_]/gi, '').slice(0, 40) }))
    return []
  }
}

/** Records that the organizer dismissed a suggestion for their own event. The key must be one this code makes, for the
 *  event's current revision. */
export async function dismissSuggestion(owner: string, eventId: string, key: unknown, db?: Parameters<typeof store.getEvent>[2]): Promise<boolean> {
  if (!validSuggestionKey(key)) return false
  const e = await store.getEvent(owner, eventId, db)
  if (!key.endsWith(`:r${Number(e.revision) || 0}`)) return false
  // Dismissing twice records once, so the trail holds at most one line per kind and revision.
  if ((await store.ownerAuditDetails(owner, e.id, 'event.suggestion_dismissed', db)).some(d => d.key === key)) return true
  // True only when the line was written; otherwise the card says it could not be dismissed.
  return store.recordOwnerAudit(owner, e.id, 'event.suggestion_dismissed', { key }, db)
}
