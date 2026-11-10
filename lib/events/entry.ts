// AskGogo Events in conversation (WhatsApp and dashboard chat), for owners in GOGO_EVENTS_OWNERS.
// A cheap gate decides whether to look at a message at all. A small model then turns the message into ONE typed
// action; it never writes the reply and never touches the database. Everything that happens is done by the
// deterministic code below through lib/events/store.ts, and every number in a reply is read back from the store.
// No message is sent to any guest from here: the organizer forwards links themselves.
import type { AgentActor } from '@/lib/agent/actor'
import { zonedLocalTimeToUtc, normalizeTimezone, getLocalParts } from '@/lib/timezone'
import { eventsEnabledFor, headcountLine, EVENT_KINDS, type EventDraft, type EventKind, type EventRow } from './core'
import * as store from './store'

export type EventAction = {
  action: 'none' | 'create' | 'update' | 'publish' | 'cancel' | 'add_guests' | 'headcount' | 'pending' | 'link' | 'list'
  title?: string; kind?: string; date?: string; time?: string; shift_minutes?: number
  venue_name?: string; venue_address?: string; online_url?: string; host_name?: string; dress_code?: string; description?: string
  capacity?: number; max_plus_ones?: number; guests?: { name?: string; phone?: string }[]
}
export type EventSurface = 'whatsapp' | 'dashboard'
type Db = Parameters<typeof store.listEvents>[1]
export type Extractor = (input: { text: string; today: string; weekday: string; timezone: string; active: string | null }) => Promise<EventAction | null>

/** Words that make a message worth a look. Deliberately not a router: the typed action decides, and "none" falls through. */
export const EVENT_GATE = /\b(?:event|party|birthday|b'?day|anniversary|get[\s-]?together|house\s?warming|reunion|outing|celebrat\w*|invit\w*|rsvp|guests?|head\s?count|plus[\s-]?ones?)\b|\bhow many\b[^?]{0,40}\b(?:coming|confirmed|going|attending|replied)\b|\bwho\b[^?]{0,30}\b(?:replied|responded|confirmed|coming)\b/i
/** Short follow-ups that only make sense while an event is being planned ("publish", "Toit Indiranagar", "move it to Sunday"). */
const ACTIVE_WINDOW_MS = 30 * 60_000

const pad = (n: number) => String(n).padStart(2, '0')
/** A local calendar date and clock time in the organizer's timezone, as a UTC instant. Null unless both are well formed. */
export function localWhen(date: unknown, time: unknown, timezone: string): string | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date ?? '')), t = /^(\d{1,2}):(\d{2})$/.exec(String(time ?? ''))
  if (!d || !t) return null
  const [year, month, day, hour, minute] = [d[1], d[2], d[3], t[1], t[2]].map(Number)
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null
  const utc = zonedLocalTimeToUtc({ year, month, day, hour, minute, timezone })
  const back = getLocalParts(utc, timezone) as any
  // A date that does not exist (31 Feb) rolls over when converted; refuse it rather than move the event silently.
  if (Number(back.year) !== year || Number(back.month) !== month || Number(back.day) !== day) return null
  return utc.toISOString()
}
export function whenText(iso: string | null, timezone: string): string {
  if (!iso) return 'date not set'
  const d = new Date(iso)
  return `${new Intl.DateTimeFormat('en-IN', { timeZone: timezone, weekday: 'short', day: 'numeric', month: 'short' }).format(d)}, ${new Intl.DateTimeFormat('en-IN', { timeZone: timezone, hour: 'numeric', minute: '2-digit', hour12: true }).format(d)}`
}

/** The stated fields of an action as an event patch. Only what the action carries; nothing is filled in. */
export function patchFromAction(a: EventAction, timezone: string, current?: EventRow | null): { patch: EventDraft; problems: string[] } {
  const patch: EventDraft = {}, problems: string[] = []
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
  if (text(a.title)) patch.title = text(a.title)
  if (text(a.kind) && (EVENT_KINDS as readonly string[]).includes(String(a.kind))) patch.kind = a.kind as EventKind
  if (text(a.venue_name)) patch.venueName = text(a.venue_name)
  if (text(a.venue_address)) patch.venueAddress = text(a.venue_address)
  if (text(a.online_url)) { if (/^https:\/\/\S+$/.test(String(a.online_url).trim())) patch.onlineUrl = text(a.online_url); else problems.push('The online link must start with https://.') }
  if (text(a.host_name)) patch.hostName = text(a.host_name)
  if (text(a.dress_code)) patch.dressCode = text(a.dress_code)
  if (text(a.description)) patch.description = text(a.description)
  if (Number.isInteger(a.capacity) && (a.capacity as number) >= 1 && (a.capacity as number) <= 5000) patch.capacity = a.capacity
  if (Number.isInteger(a.max_plus_ones) && (a.max_plus_ones as number) >= 0 && (a.max_plus_ones as number) <= 10) patch.maxPlusOnes = a.max_plus_ones
  const hasDate = text(a.date), hasTime = text(a.time)
  if (hasDate || hasTime) {
    // Half a date is combined with the other half already on the event; it is never completed by a guess.
    const local = current?.starts_at ? (getLocalParts(current.starts_at, timezone) as any) : null
    const date = hasDate || (local ? `${local.year}-${pad(Number(local.month))}-${pad(Number(local.day))}` : null)
    const time = hasTime || (local ? `${pad(Number(local.hour))}:${pad(Number(local.minute))}` : null)
    const iso = date && time ? localWhen(date, time, timezone) : null
    if (iso) patch.startsAt = iso
    else if (date && time) problems.push('I could not read that date and time.')
    else problems.push(hasDate ? 'What time does it start?' : 'Which date is it on?')
  } else if (Number.isInteger(a.shift_minutes) && a.shift_minutes !== 0 && Math.abs(a.shift_minutes as number) <= 14 * 24 * 60) {
    if (current?.starts_at) patch.startsAt = new Date(Date.parse(current.starts_at) + (a.shift_minutes as number) * 60_000).toISOString()
    else problems.push('The event has no time yet, so there is nothing to move.')
  }
  return { patch, problems }
}

const ASK: Record<string, string> = { title: 'What should I call it?', date_time: 'What date and time is it?', place: 'Where is it happening? A venue name or "at home" is enough.' }
export function draftSummary(e: EventRow): string {
  const place = e.venue_name || (e.online_url ? 'Online' : 'place not set')
  const extras = [e.capacity ? `Up to ${e.capacity} people` : '', e.max_plus_ones ? `plus-ones allowed (${e.max_plus_ones})` : ''].filter(Boolean).join(' · ')
  return [`*${e.title}*`, `${whenText(e.starts_at, e.timezone)} · ${place}`, extras].filter(Boolean).join('\n')
}
const errorText = (code: string) => ({
  events_not_enabled: 'Events are not set up yet.', event_closed: 'That event is already cancelled or over, so it cannot be changed.',
  would_unpublish: 'That change would leave the invitation without a future date or a place, so I have not made it.',
  changed_meanwhile: 'The event changed while I was updating it. Please say that again.', title_required: 'The event needs a name.',
  invalid_event_fields: 'One of those details is not valid, so nothing was changed.', guest_limit: 'That is more guests than one event can hold.',
} as Record<string, string>)[code] || 'That did not work, so nothing was changed. Please try again.'

/** The event a short follow-up refers to: the organizer's most recently touched event that is still open. */
export function activeEvent(events: EventRow[], now = Date.now()): { event: EventRow | null; recent: boolean } {
  const open = events.filter(e => e.status === 'draft' || e.status === 'published').sort((a: any, b: any) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
  const event = open[0] || null
  return { event, recent: Boolean(event && now - Date.parse((event as any).updated_at) < ACTIVE_WINDOW_MS) }
}

const KNOWN_ACTIONS: string[] = ['none', 'create', 'update', 'publish', 'cancel', 'add_guests', 'headcount', 'pending', 'link', 'list']
export type EventReply = { text: string; action: EventAction['action'] }
/** Carries out one typed action. Returns null for "none" so the message goes on to the ordinary assistant. */
export async function runEventAction(owner: string, a: EventAction, ctx: { timezone: string; active: EventRow | null; hostName?: string | null }, db?: Db): Promise<EventReply | null> {
  const tz = normalizeTimezone(ctx.timezone)
  const reply = (text: string): EventReply => ({ text, action: a.action })
  const needEvent = () => reply('You have no open event. Tell me what you are planning, for example "plan a birthday on 22 November at 5 pm".')
  try {
    if (!KNOWN_ACTIONS.includes(a.action) || a.action === 'none') return null
    if (a.action === 'list') {
      const events = (await store.listEvents(owner, db)).filter(e => e.status !== 'cancelled').slice(0, 8)
      return reply(events.length ? events.map(e => `• ${e.title} · ${whenText(e.starts_at, e.timezone)} · ${e.status === 'published' ? 'open' : e.status}`).join('\n') : 'You have no events yet.')
    }
    if (a.action === 'create') {
      const { patch, problems } = patchFromAction(a, tz, null)
      if (!patch.title) return reply('What should I call the event?')
      const created = await store.createEvent(owner, { ...patch, timezone: tz, hostName: patch.hostName || ctx.hostName || null, maxPlusOnes: patch.maxPlusOnes ?? 0 }, db)
      // A complete draft is never published by itself: the organizer says "publish".
      return reply(await afterDraftChange(owner, created.id, problems, db, true))
    }
    const current = ctx.active
    if (!current) return needEvent()
    if (a.action === 'update') {
      const { patch, problems } = patchFromAction(a, tz, current)
      if (!Object.keys(patch).length) return reply(problems[0] || 'Tell me what to change: the date, time, place, name or number of people.')
      const moved = patch.startsAt && current.starts_at && patch.startsAt !== current.starts_at
      await store.updateEvent(owner, current.id, patch, db)
      const text = await afterDraftChange(owner, current.id, problems, db, false)
      return reply(current.status === 'published' && moved ? `${text}\n\nGuests see the new time on their invitation link. I have not messaged anyone.` : text)
    }
    if (a.action === 'publish') {
      const r = await store.publishEvent(owner, current.id, db)
      if (!r.event) return reply(`Before I can publish: ${ASK[r.missing[0]] || 'a few details are missing.'}`)
      return reply(`Published. Forward this link to your guests:\n${r.shareUrl}\n\nI have not messaged anyone. Ask me "how many are coming?" any time.`)
    }
    if (a.action === 'cancel') {
      const e = await store.cancelEvent(owner, current.id, db)
      return reply(`${e.title} is cancelled. Anyone who opens the invitation link now sees that it is cancelled. I have not messaged any guests.`)
    }
    if (a.action === 'add_guests') {
      const input = (a.guests || []).filter(g => g && typeof g.name === 'string' && g.name.trim()).map(g => ({ name: String(g.name), phone: typeof g.phone === 'string' && g.phone.trim() ? g.phone : null }))
      if (!input.length) return reply('Who should I add? Give me their names.')
      const r = await store.addGuests(owner, current.id, input, db)
      const lines = [r.added.length ? `Added ${r.added.length}: ${r.added.map(g => g.name).join(', ')}.` : 'Nobody new was added.',
        r.duplicates.length ? `Already on the list: ${r.duplicates.join(', ')}.` : '', r.invalid.length ? `I could not read: ${r.invalid.join(', ')}.` : '',
        r.added.length && r.added.length <= 5 ? `Personal links (each is for one person):\n${r.added.map(g => `${g.name}: ${g.link}`).join('\n')}` : r.added.length ? 'Their personal links are on the event page in your dashboard.' : '',
        'I have not messaged anyone.']
      return reply(lines.filter(Boolean).join('\n'))
    }
    if (a.action === 'headcount') return reply(`${current.title}: ${headcountLine(await store.headcount(owner, current.id, db))}`)
    if (a.action === 'pending') {
      const waiting = (await store.listGuests(owner, current.id, db)).filter(g => g.rsvp === 'none' && !g.revoked)
      return reply(waiting.length ? `Not replied yet (${waiting.length}): ${waiting.slice(0, 30).map(g => g.name).join(', ')}${waiting.length > 30 ? ' and more' : ''}.` : 'Everyone on the list has replied.')
    }
    if (a.action === 'link') {
      const link = await store.shareLink(owner, current.id, db)
      return reply(link ? `Invitation link for ${current.title}:\n${link}` : 'There is no link yet. Say "publish" when the event is ready.')
    }
    return null
  } catch (error: any) {
    return reply(errorText(error instanceof store.EventsError ? error.code : ''))
  }
}

/** After creating or editing: show the event and either ask for the next missing detail or offer to publish. */
async function afterDraftChange(owner: string, id: string, problems: string[], db: Db | undefined, created: boolean): Promise<string> {
  const e = await store.getEvent(owner, id, db)
  const { missingForPublish } = await import('./core')
  const missing = missingForPublish({ title: e.title, startsAt: e.starts_at, venueName: e.venue_name, onlineUrl: e.online_url })
  const head = e.status === 'published' ? 'Updated.' : created ? 'Draft started.' : 'Draft updated.'
  const next = problems[0] || (missing.length ? ASK[missing[0]] : e.status === 'published' ? '' : 'Reply *publish* to get the invitation link, or tell me what to change.')
  return [head, draftSummary(e), next].filter(Boolean).join('\n\n')
}

/** Entry point for both surfaces. Null means "not an events message": carry on as usual. */
export async function tryEventAsk(actor: AgentActor, text: string, surface: EventSurface, deps: { extract?: Extractor; db?: Db; now?: number } = {}): Promise<string | null> {
  const owner = String(actor.legacyTelegramId)
  if (!eventsEnabledFor(owner)) return null
  const message = String(text || '').trim()
  if (!message || message.length > 1200) return null
  try {
    const now = deps.now ?? Date.now()
    const tz = normalizeTimezone(actor.timezone)
    const gated = EVENT_GATE.test(message)
    const { event, recent } = activeEvent(await store.listEvents(owner, deps.db), now)
    if (!gated && !recent) return null
    const local = getLocalParts(new Date(now), tz) as any
    const today = `${local.year}-${pad(Number(local.month))}-${pad(Number(local.day))}`
    const weekday = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long' }).format(new Date(now))
    const extract = deps.extract || (await import('./extract')).extractEventAction
    const action = await extract({ text: message, today, weekday, timezone: tz, active: event ? `${event.title} (${event.status}); ${whenText(event.starts_at, event.timezone)}; ${event.venue_name || 'no place yet'}` : null })
    if (!action || action.action === 'none') return null
    const result = await runEventAction(owner, action, { timezone: tz, active: event, hostName: actor.name || null }, deps.db)
    if (!result) return null
    console.log('EVENT_ASK:', JSON.stringify({ action: result.action, surface }))
    return result.text
  } catch (error: any) {
    console.error('EVENT_ASK_FAILED:', String(error?.code || error?.name || 'error').slice(0, 60))
    return null
  }
}
