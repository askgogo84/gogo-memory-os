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
  action: 'none' | 'create' | 'update' | 'publish' | 'cancel' | 'add_guests' | 'remove_guest' | 'headcount' | 'pending' | 'link' | 'new_link' | 'link_off' | 'list'
  /** Which existing event the person means, in their words. Only a selector; never a rename. */
  event?: string
  /** create: the new event's name. update: a new name for the event (a rename). */
  title?: string; kind?: string; date?: string; time?: string; shift_minutes?: number
  venue_name?: string; venue_address?: string; online_url?: string; host_name?: string; dress_code?: string; description?: string
  capacity?: number; max_plus_ones?: number; guests?: { name?: string; phone?: string }[]
}
export type EventSurface = 'whatsapp' | 'dashboard'
type Db = Parameters<typeof store.listEvents>[1]
export type Extractor = (input: { text: string; today: string; weekday: string; timezone: string; active: string | null }) => Promise<EventAction | null>

/** Words that make a message worth a look. Deliberately not a router: the typed action decides, and "none" falls through. */
export const EVENT_GATE = /\b(?:events?|part(?:y|ies)|birthday|b'?day|anniversary|get[\s-]?together|house\s?warming|reunion|outing|celebrat\w*|invit\w*|rsvp|guests?|head\s?count|plus[\s-]?ones?)\b|\b(?:plan|organi[sz]e|host|hosting|arrange|throw)\b[^?]{0,60}\b(?:dinner|lunch|brunch|picnic|meet[\s-]?up|gathering|function|ceremony|puja|pooja|wedding|shower|farewell|town\s?hall)\b|\bhow many\b[^?]{0,40}\b(?:coming|confirmed|going|attending|replied)\b|\bwho\b[^?]{0,30}\b(?:replied|responded|confirmed|coming)\b/i
/** Short follow-ups that only make sense while a DRAFT is being planned ("Toit Indiranagar", "5 pm", "publish").
 *  The window never applies to a published event: anything that changes what guests see must name the subject. */
const ACTIVE_WINDOW_MS = 30 * 60_000
/** The organizer's explicit yes to a parked cancel or time change. Decided here, not by the model. */
export const CONFIRM_RE = /^\s*(?:yes|yes please|confirm|confirmed|go ahead|do it)\b[\s,.!]*(?:cancel(?: it)?|move(?: it)?)?[\s.!]*$/i

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
  events_not_enabled: 'Events are not set up yet.', events_token_key_missing: 'Events are not fully set up yet: the invitation link key is missing.', duplicate: 'That guest is already on the list.', too_many_at_once: 'Please add at most 200 guests at a time.', event_closed: 'That event is already cancelled or over, so it cannot be changed.',
  would_unpublish: 'That change would leave the invitation without a future date or a place, so I have not made it.',
  changed_meanwhile: 'The event changed while I was updating it. Please say that again.', title_required: 'The event needs a name.',
  invalid_event_fields: 'One of those details is not valid, so nothing was changed.', guest_limit: 'That is more guests than one event can hold.',
} as Record<string, string>)[code] || 'That did not work, so nothing was changed. Please try again.'

const KNOWN_ACTIONS: string[] = ['none', 'create', 'update', 'publish', 'cancel', 'add_guests', 'remove_guest', 'headcount', 'pending', 'link', 'new_link', 'link_off', 'list']
const openEvents = (events: EventRow[]) => events.filter(e => e.status === 'draft' || e.status === 'published').sort((a: any, b: any) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
/** The draft a short follow-up refers to: the organizer's only draft touched in the last half hour, if any. */
export function activeDraft(events: EventRow[], now = Date.now()): EventRow | null {
  const recent = openEvents(events).filter(e => e.status === 'draft' && now - Date.parse((e as any).updated_at) < ACTIVE_WINDOW_MS)
  return recent.length === 1 ? recent[0] : null
}
const norm = (v: unknown) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
/** Which event an action is about. One open event: that one. Several: the one the person named (exact name, or the
 *  only one containing it), else the draft being planned right now, else nobody: the caller asks. Never a guess. */
export function targetEvent(events: EventRow[], named: unknown, now = Date.now()): { event: EventRow | null; ask: EventRow[] } {
  const open = openEvents(events)
  if (open.length <= 1) return { event: open[0] || null, ask: [] }
  const want = norm(named)
  if (want) {
    const exact = open.filter(e => norm(e.title) === want)
    if (exact.length === 1) return { event: exact[0], ask: [] }
    const partial = open.filter(e => norm(e.title).includes(want) || want.includes(norm(e.title)))
    if (!exact.length && partial.length === 1) return { event: partial[0], ask: [] }
    return { event: null, ask: (exact.length ? exact : partial.length ? partial : open).slice(0, 6) }
  }
  const draft = activeDraft(events, now)
  return draft ? { event: draft, ask: [] } : { event: null, ask: open.slice(0, 6) }
}

export type EventReply = { text: string; action: EventAction['action'] | 'confirm' }
const CHANGES_FOR_GUESTS = 'Guests see this on their invitation link. I have not messaged anyone.'

/** Carries out one typed action. Returns null for "none" so the message goes on to the ordinary assistant. */
export async function runEventAction(owner: string, a: EventAction, ctx: { timezone: string; events: EventRow[]; hostName?: string | null; now?: number }, db?: Db): Promise<EventReply | null> {
  const tz = normalizeTimezone(ctx.timezone), now = ctx.now ?? Date.now()
  const reply = (text: string): EventReply => ({ text, action: a.action })
  try {
    if (!KNOWN_ACTIONS.includes(a.action) || a.action === 'none') return null
    if (a.action === 'list') {
      const events = ctx.events.filter(e => e.status !== 'cancelled').slice(0, 8)
      return reply(events.length ? events.map(e => `• ${e.title} · ${whenText(e.starts_at, e.timezone)} · ${e.status === 'published' ? 'open' : e.status}`).join('\n') : 'You have no events yet.')
    }
    if (a.action === 'create') {
      const { patch, problems } = patchFromAction(a, tz, null)
      if (!patch.title) return reply('What should I call the event?')
      // A complete draft is never published by itself: the organizer says "publish".
      const created = await store.createEvent(owner, { ...patch, timezone: tz, hostName: patch.hostName || ctx.hostName || null, maxPlusOnes: patch.maxPlusOnes ?? 0 }, db)
      return reply(await afterDraftChange(owner, created.id, problems, db, true))
    }
    const { event: current, ask } = targetEvent(ctx.events, a.event, now)
    if (!current) {
      return reply(ask.length ? `Which event do you mean?\n${ask.map(e => `• ${e.title} (${whenText(e.starts_at, e.timezone)})`).join('\n')}` : 'You have no open event. Tell me what you are planning, for example "plan a birthday on 22 November at 5 pm".')
    }
    const live = current.status === 'published'
    if (a.action === 'update') {
      const { patch, problems } = patchFromAction(a, tz, current)
      if (!Object.keys(patch).length) return reply(problems[0] || 'Tell me what to change: the date, time, place, name or number of people.')
      const moved = Boolean(patch.startsAt && current.starts_at && patch.startsAt !== current.starts_at)
      if (live && moved) {
        // What guests have been told is not changed on one reading of one message: it waits for an explicit yes.
        const { startsAt, ...rest } = patch
        if (Date.parse(startsAt as string) <= now) return reply('That time is in the past, so I have not changed anything.')
        if (Object.keys(rest).length) await store.updateEvent(owner, current.id, rest, db)
        await store.setPendingAction(owner, current.id, { type: 'move', startsAt: startsAt as string }, db, now)
        return reply(`Move *${current.title}* from ${whenText(current.starts_at, current.timezone)} to ${whenText(startsAt as string, current.timezone)}? Guests will see the new time on their invitation link. Reply *yes* to confirm.`)
      }
      await store.updateEvent(owner, current.id, patch, db)
      const text = await afterDraftChange(owner, current.id, problems, db, false)
      return reply(live ? `${text}\n\n${CHANGES_FOR_GUESTS}` : text)
    }
    if (a.action === 'publish') {
      const r = await store.publishEvent(owner, current.id, db)
      if (!r.event) return reply(`Before I can publish *${current.title}*: ${ASK[r.missing[0]] || 'a few details are missing.'}`)
      return reply(`Published *${current.title}*. Forward this link to your guests:\n${r.shareUrl}\n\nI have not messaged anyone. Ask me "how many are coming?" any time.`)
    }
    if (a.action === 'cancel') {
      if (!live) { await store.cancelEvent(owner, current.id, db); return reply(`The draft *${current.title}* is discarded. It was never published, so no guest saw it.`) }
      await store.setPendingAction(owner, current.id, { type: 'cancel' }, db, now)
      return reply(`Cancel *${current.title}* (${whenText(current.starts_at, current.timezone)})? Guests who open their invitation link will see it is cancelled, and this cannot be undone. Reply *yes* to confirm.`)
    }
    if (a.action === 'add_guests') {
      const input = (a.guests || []).filter(g => g && typeof g.name === 'string' && g.name.trim()).map(g => ({ name: String(g.name), phone: typeof g.phone === 'string' && g.phone.trim() ? g.phone : null }))
      if (!input.length) return reply('Who should I add? Give me their names.')
      const r = await store.addGuests(owner, current.id, input, db)
      const shown = r.added.slice(0, 20)
      const lines = [r.added.length ? `Added ${r.added.length} to *${current.title}*: ${r.added.map(g => g.name).join(', ')}.` : 'Nobody new was added.',
        r.duplicates.length ? `Already on the list: ${r.duplicates.join(', ')}.` : '', r.invalid.length ? `I could not read: ${r.invalid.join(', ')}.` : '',
        shown.length ? `Personal links (each is for one person):\n${shown.map(g => `${g.name}: ${g.link}`).join('\n')}` : '',
        r.added.length > shown.length ? `For the other ${r.added.length - shown.length}, ask me "link for" and the name.` : '',
        'I have not messaged anyone.']
      return reply(lines.filter(Boolean).join('\n'))
    }
    if (a.action === 'remove_guest' || (a.action === 'link' && a.guests?.[0]?.name)) {
      const want = norm(a.guests?.[0]?.name)
      if (!want) return reply('Who do you mean? Give me the name as it is on the guest list.')
      const guests = (await store.listGuests(owner, current.id, db)).filter(g => !g.revoked)
      const exact = guests.filter(g => norm(g.name) === want), match = exact.length ? exact : guests.filter(g => norm(g.name).includes(want))
      if (match.length !== 1) return reply(match.length ? `More than one guest matches: ${match.slice(0, 8).map(g => g.name).join(', ')}. Which one?` : `I could not find that name on the guest list for *${current.title}*.`)
      if (a.action === 'link') {
        const link = await store.guestLink(owner, current.id, match[0].id, db)
        return reply(link ? `Personal link for ${match[0].name}:\n${link}` : `${match[0].name} joined through the shared link and holds their own personal link. I cannot issue it again.`)
      }
      await store.revokeGuest(owner, current.id, match[0].id, db)
      return reply(`${match[0].name} is removed from *${current.title}* and their link no longer works.${match[0].source === 'share_link' ? ' They joined through the shared link, so they could join again with it. Say "new invitation link" to replace the shared link.' : ''}`)
    }
    if (a.action === 'headcount') return reply(`${current.title}: ${headcountLine(await store.headcount(owner, current.id, db))}`)
    if (a.action === 'pending') {
      const waiting = (await store.listGuests(owner, current.id, db)).filter(g => g.rsvp === 'none' && !g.revoked)
      return reply(waiting.length ? `Not replied yet for ${current.title} (${waiting.length}): ${waiting.slice(0, 30).map(g => g.name).join(', ')}${waiting.length > 30 ? ' and more' : ''}.` : `Everyone on the list for ${current.title} has replied.`)
    }
    if (a.action === 'link') {
      const link = await store.shareLink(owner, current.id, db)
      return reply(link ? `Invitation link for ${current.title}:\n${link}` : live ? 'The shared link is switched off. Say "new invitation link" to make one.' : 'There is no link yet. Say "publish" when the event is ready.')
    }
    if (a.action === 'new_link') {
      const link = await store.rotateShareLink(owner, current.id, db)
      return reply(link ? `New invitation link for ${current.title}:\n${link}\n\nThe old shared link no longer works. Guests who already replied keep their own links.` : 'There is no link to replace yet. Say "publish" when the event is ready.')
    }
    if (a.action === 'link_off') {
      if (!live) return reply('That event is not published, so there is no shared link to switch off.')
      await store.disableShareLink(owner, current.id, db)
      return reply(`The shared link for ${current.title} is switched off. Guests who already replied keep their own links.`)
    }
    return null
  } catch (error: any) {
    return reply(errorText(error instanceof store.EventsError ? error.code : ''))
  }
}

/** The organizer's "yes" to a parked cancel or time change. Only for one event with a fresh pending action. */
export async function confirmPending(owner: string, events: EventRow[], now: number, db?: Db): Promise<EventReply | null> {
  const waiting = openEvents(events).map(e => ({ e, p: store.pendingActionOf(e, now) })).filter(x => x.p && x.e.status === 'published')
  if (waiting.length !== 1) return null
  const { e, p } = waiting[0]
  try {
    await store.setPendingAction(owner, e.id, null, db)
    if (p!.type === 'cancel') {
      await store.cancelEvent(owner, e.id, db)
      return { action: 'confirm', text: `*${e.title}* is cancelled. Anyone who opens their invitation link now sees that it is cancelled. I have not messaged any guests.` }
    }
    const moved = await store.updateEvent(owner, e.id, { startsAt: (p as any).startsAt }, db)
    return { action: 'confirm', text: `*${moved.title}* is now ${whenText(moved.starts_at, moved.timezone)}. ${CHANGES_FOR_GUESTS}` }
  } catch (error: any) {
    return { action: 'confirm', text: errorText(error instanceof store.EventsError ? error.code : '') }
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
    const events = await store.listEvents(owner, deps.db)
    // An explicit yes to a question this module asked. Deterministic; the model is not consulted.
    if (CONFIRM_RE.test(message)) {
      const confirmed = await confirmPending(owner, events, now, deps.db)
      if (confirmed) { console.log('EVENT_ASK:', JSON.stringify({ action: confirmed.action, surface })); return confirmed.text }
    }
    const draft = activeDraft(events, now)
    if (!EVENT_GATE.test(message) && !draft) return null
    const local = getLocalParts(new Date(now), tz) as any
    const today = `${local.year}-${pad(Number(local.month))}-${pad(Number(local.day))}`
    const weekday = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long' }).format(new Date(now))
    const extract = deps.extract || (await import('./extract')).extractEventAction
    // Only the organizer's own event names and times go to the model. Guest-supplied text never does.
    const open = openEvents(events).slice(0, 6)
    const active = open.length ? open.map(e => `"${e.title}" (${e.status === 'published' ? 'published' : 'draft'}; ${whenText(e.starts_at, e.timezone)}; ${e.venue_name || 'no place yet'})`).join(' | ') : null
    const action = await extract({ text: message, today, weekday, timezone: tz, active })
    if (!action || action.action === 'none') return null
    // Outside a gate match, the only thing a bare follow-up may do is fill in or publish the draft being planned.
    if (!EVENT_GATE.test(message) && !(['update', 'publish', 'add_guests'].includes(action.action) && draft)) return null
    const result = await runEventAction(owner, action, { timezone: tz, events, hostName: actor.name || null, now }, deps.db)
    if (!result) return null
    console.log('EVENT_ASK:', JSON.stringify({ action: result.action, surface }))
    return result.text
  } catch (error: any) {
    console.error('EVENT_ASK_FAILED:', String(error?.code || error?.name || 'error').slice(0, 60))
    return null
  }
}
