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
/** Whether the WhatsApp webhook offers a message to Events early, before the brain and understand-first. Only a message
 *  that is itself about an event (the gate), from an owner with Events on, typed by them (not forwarded), and not an
 *  approval reply, a table or venue booking (those keep their own handlers) or a bare number. A reply to the draft being planned ("Toit Indiranagar") and a yes to Events' own
 *  question stay with the later hook in processIncomingMessage, after approvals and the pending-question registry, so
 *  "5 pm" or "2" meant for another question is never read as an event change. */
export function offerEventsEarly(p: { owner: string; text: string; forwarded: boolean; approval: boolean; reservation?: boolean }): boolean {
  const t = String(p.text || '').trim()
  if (!t || p.forwarded || p.approval || p.reservation || /^\s*#?\d{1,3}[.)]?\s*$/.test(t) || CONFIRM_RE.test(t)) return false
  return eventsEnabledFor(String(p.owner)) && EVENT_GATE.test(t)
}

/** The organizer's explicit yes to a parked cancel or time change. Decided here, not by the model. */
export const CONFIRM_RE = /^\s*(?:yes|yes please|confirm|confirmed|go ahead|do it)\b[\s,.!]*(?:(cancel|move)(?: it)?)?[\s.!]*$/i
/** The verb a confirmation names, if any ("yes, cancel it" -> cancel). A yes that names the other action is refused. */
export const confirmVerb = (text: string): 'cancel' | 'move' | null => { const m = CONFIRM_RE.exec(text); return m && m[1] ? (m[1].toLowerCase() as 'cancel' | 'move') : null }

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
/** Drafts and published events that have not happened yet (a published event more than a day in the past no longer
 *  takes part in choosing which event a message is about). Most recently touched first. */
const openEvents = (events: EventRow[], now = Date.now()) => events
  .filter(e => e.status === 'draft' || (e.status === 'published' && !(e.starts_at && Date.parse(e.starts_at) < now - 24 * 3600_000)))
  .sort((a: any, b: any) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
/** The draft a short follow-up refers to: the organizer's only draft touched in the last half hour, if any. */
export function activeDraft(events: EventRow[], now = Date.now()): EventRow | null {
  const recent = openEvents(events, now).filter(e => e.status === 'draft' && now - Date.parse((e as any).updated_at) < ACTIVE_WINDOW_MS)
  return recent.length === 1 ? recent[0] : null
}
/** Letters, combining marks and digits in any script (Kannada, Hindi and so on), lower-cased, single-spaced. */
export const norm = (v: unknown) => String(v ?? '').normalize('NFKC').toLocaleLowerCase('en').replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim()
/** Which event an action is about. A name, when given, must match: exactly, or as the only event whose name contains
 *  it (at least 3 characters). A name that matches nothing is asked about, even with one open event. With no name:
 *  the only open event, else the draft being planned right now, else nobody: the caller asks. Never a guess. */
export function targetEvent(events: EventRow[], named: unknown, now = Date.now()): { event: EventRow | null; ask: EventRow[]; unknownName?: boolean } {
  const open = openEvents(events, now)
  const want = norm(named)
  if (want) {
    const exact = open.filter(e => norm(e.title) === want)
    if (exact.length === 1) return { event: exact[0], ask: [] }
    const partial = want.length >= 3 ? open.filter(e => { const t = norm(e.title); return t.length > 0 && t.includes(want) }) : []
    if (!exact.length && partial.length === 1) return { event: partial[0], ask: [] }
    return { event: null, ask: (exact.length ? exact : partial.length ? partial : open).slice(0, 6), unknownName: !exact.length && !partial.length }
  }
  if (open.length <= 1) return { event: open[0] || null, ask: [] }
  const draft = activeDraft(events, now)
  return draft ? { event: draft, ask: [] } : { event: null, ask: open.slice(0, 6) }
}
/** A guest-supplied name as it appears in the organizer's chat: no WhatsApp formatting characters, no links, quoted. */
export function shownName(v: unknown): string {
  const plain = String(v ?? '').replace(/https?:\/\/\S+|www\.\S+|\b[a-z0-9-]+\.(?:com|in|net|org|io|app|link|ly|me|co)\b\S*/gi, '[link]').replace(/[*_~`>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60)
  return `"${plain || 'Guest'}"`
}

export type EventReply = { text: string; action: EventAction['action'] | 'confirm'; eventId?: string }
const CHANGES_FOR_GUESTS = 'Guests see this on their invitation link. I have not messaged anyone.'

/** Carries out one typed action. Returns null for "none" so the message goes on to the ordinary assistant. */
export async function runEventAction(owner: string, a: EventAction, ctx: { timezone: string; events: EventRow[]; hostName?: string | null; now?: number; onlyEventId?: string | null }, db?: Db): Promise<EventReply | null> {
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
      return { ...reply(await afterDraftChange(owner, created.id, problems, db, true)), eventId: created.id }
    }
    const { event: current, ask, unknownName } = targetEvent(ctx.events, a.event, now)
    if (!current) {
      const list = ask.map(e => `• ${e.title} (${whenText(e.starts_at, e.timezone)})`).join('\n')
      return reply(unknownName ? (ask.length ? `I could not find an event with that name. Your open events:\n${list}` : 'You have no open event. Tell me what you are planning, for example "plan a birthday on 22 November at 5 pm".')
        : ask.length ? `Which event do you mean?\n${list}` : 'You have no open event. Tell me what you are planning, for example "plan a birthday on 22 November at 5 pm".')
    }
    // A bare follow-up (no event words) may only touch the draft being planned right now.
    if (ctx.onlyEventId && current.id !== ctx.onlyEventId) return null
    const live = current.status === 'published'
    if (a.action === 'update') {
      const { patch, problems } = patchFromAction(a, tz, current)
      if (!Object.keys(patch).length) return reply(problems[0] || 'Tell me what to change: the date, time, place, name or number of people.')
      const moved = Boolean(patch.startsAt && current.starts_at && patch.startsAt !== current.starts_at)
      if (live && moved) {
        // What guests have been told is not changed on one reading of one message: it waits for an explicit yes.
        const { startsAt, ...rest } = patch
        if (Date.parse(startsAt as string) <= now) return reply('That time is in the past, so I have not changed anything.')
        // Park the move first: if that fails, nothing at all has changed and the reply says so truthfully.
        await clearOtherPending(owner, ctx.events, current.id, now, db)
        await store.setPendingAction(owner, current.id, { type: 'move', startsAt: startsAt as string }, db, now)
        const ask = `Move *${current.title}* from ${whenText(current.starts_at, current.timezone)} to ${whenText(startsAt as string, current.timezone)}? Guests will see the new time on their invitation link. Reply *yes* to confirm.`
        if (!Object.keys(rest).length) return reply(ask)
        try {
          await store.updateEvent(owner, current.id, rest, db)
          return reply(`Updated now: ${changedLabel(rest)}. ${CHANGES_FOR_GUESTS}\n\n${ask}`)
        } catch (error: any) {
          return reply(`${ask}\n\nThe other change (${changedLabel(rest)}) did not go through: ${errorText(error instanceof store.EventsError ? error.code : '')}`)
        }
      }
      await store.updateEvent(owner, current.id, patch, db)
      const text = await afterDraftChange(owner, current.id, problems, db, false)
      return { ...reply(live ? `${text}\n\n${CHANGES_FOR_GUESTS}` : text), eventId: current.id }
    }
    if (a.action === 'publish') {
      const r = await store.publishEvent(owner, current.id, db)
      if (!r.event) return reply(`Before I can publish *${current.title}*: ${ASK[r.missing[0]] || 'a few details are missing.'}`)
      return reply(`Published *${current.title}*. Forward this link to your guests:\n${r.shareUrl}\n\nI have not messaged anyone. Ask me "how many are coming?" any time.${r.event.max_plus_ones ? '' : '\n\nEach guest replies for themselves. To let them bring someone, say "allow one plus-one".'}`)
    }
    if (a.action === 'cancel') {
      if (!live) { await store.cancelEvent(owner, current.id, db); return reply(`The draft *${current.title}* is discarded. It was never published, so no guest saw it.`) }
      await clearOtherPending(owner, ctx.events, current.id, now, db)
      await store.setPendingAction(owner, current.id, { type: 'cancel' }, db, now)
      return reply(`Cancel *${current.title}* (${whenText(current.starts_at, current.timezone)})? Guests who open their invitation link will see it is cancelled, and this cannot be undone. Reply *yes* to confirm.`)
    }
    if (a.action === 'add_guests') {
      const input = (a.guests || []).filter(g => g && typeof g.name === 'string' && g.name.trim()).map(g => ({ name: String(g.name), phone: typeof g.phone === 'string' && g.phone.trim() ? g.phone : null }))
      if (!input.length) return reply('Who should I add? Give me their names.')
      const r = await store.addGuests(owner, current.id, input, db)
      const shown = r.added.slice(0, 20)
      const few = (names: string[]) => names.slice(0, 20).join(', ') + (names.length > 20 ? ` and ${names.length - 20} more` : '')
      const lines = [r.added.length ? `Added ${r.added.length} to *${current.title}*: ${few(r.added.map(g => g.name))}.` : 'Nobody new was added.',
        r.duplicates.length ? `Already on the list: ${few(r.duplicates)}.` : '', r.invalid.length ? `I could not read: ${few(r.invalid)}.` : '',
        shown.length ? `Personal links (each is for one person):\n${shown.map(g => `${g.name}: ${g.link}`).join('\n')}` : '',
        r.added.length > shown.length ? `For the other ${r.added.length - shown.length}, ask me "link for" and the name.` : '',
        'I have not messaged anyone.']
      return reply(lines.filter(Boolean).join('\n'))
    }
    if (a.action === 'remove_guest' || (a.action === 'link' && a.guests?.[0]?.name)) {
      const raw = norm(a.guests?.[0]?.name)
      if (!raw) return reply('Who do you mean? Give me the name as it is on the guest list.')
      const guests = (await store.listGuests(owner, current.id, db)).filter(g => !g.revoked)
      // "Rahul 2" picks the second of several guests called Rahul, in the order shown in the list below.
      const numbered = /^(.*\S)\s+(\d{1,2})$/.exec(raw)
      const sameName = (n: string) => guests.filter(g => norm(g.name) === n)
      let pick = sameName(raw)
      if (!pick.length && numbered && sameName(numbered[1]).length > 1) { const all = sameName(numbered[1]); const k = Number(numbered[2]); pick = k >= 1 && k <= all.length ? [all[k - 1]] : [] }
      const describe = (g: store.OrganizerGuest, i?: number) => `${shownName(g.name)}${i ? ` ${i}` : ''} (${g.source === 'share_link' ? 'joined through the link' : 'added by you'}${g.rsvp !== 'none' ? `, replied ${g.rsvp}` : ''})`
      if (pick.length > 1) return reply(`More than one guest is called ${shownName(pick[0].name)}:\n${pick.slice(0, 9).map((g, i) => `• ${describe(g, i + 1)}`).join('\n')}\nSay the name with its number, for example "${a.action === 'link' ? 'link for' : 'remove'} ${norm(pick[0].name)} 2".`)
      if (!pick.length) {
        const close = raw.length >= 3 ? guests.filter(g => norm(g.name).includes(raw)) : []
        // A partial name is only a suggestion: nobody is removed without their exact name.
        return reply(close.length ? `I could not find exactly that name. Did you mean ${close.slice(0, 5).map(g => shownName(g.name)).join(', ')}? Say the full name.` : `I could not find that name on the guest list for *${current.title}*.`)
      }
      const guest = pick[0]
      if (a.action === 'link') {
        const link = await store.guestLink(owner, current.id, guest.id, db)
        return reply(link ? `Personal link for ${shownName(guest.name)}:\n${link}` : `${shownName(guest.name)} joined through the shared link and holds their own personal link. I cannot issue it again.`)
      }
      await store.revokeGuest(owner, current.id, guest.id, db)
      return reply(`${shownName(guest.name)} is removed from *${current.title}* and their link no longer works.${guest.source === 'share_link' ? ' They joined through the shared link, so they could join again with it. Say "new invitation link" to replace the shared link.' : ''}`)
    }
    if (a.action === 'headcount') return reply(`${current.title}: ${headcountLine(await store.headcount(owner, current.id, db))}`)
    if (a.action === 'pending') {
      const waiting = (await store.listGuests(owner, current.id, db)).filter(g => g.rsvp === 'none' && !g.revoked)
      return reply(waiting.length ? `Not replied yet for ${current.title} (${waiting.length}): ${waiting.slice(0, 30).map(g => shownName(g.name)).join(', ')}${waiting.length > 30 ? ' and more' : ''}.` : `Everyone on the list for ${current.title} has replied.`)
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

const LABELS: Record<string, string> = { title: 'name', venueName: 'place', venueAddress: 'address', onlineUrl: 'online link', hostName: 'host', dressCode: 'dress code', description: 'description', capacity: 'number of people', maxPlusOnes: 'plus-ones', kind: 'type', endsAt: 'end time', timezone: 'timezone', rsvpClosesAt: 'reply deadline' }
const changedLabel = (patch: EventDraft) => Object.keys(patch).map(k => LABELS[k] || k).join(', ')
async function clearOtherPending(owner: string, events: EventRow[], keepId: string, now: number, db?: Db) {
  for (const e of events) if (e.id !== keepId && store.pendingActionOf(e, now)) await store.setPendingAction(owner, e.id, null, db)
}
const parked = (events: EventRow[], now: number) => openEvents(events, now).map(e => ({ e, p: store.pendingActionOf(e, now) })).filter(x => x.p && x.e.status === 'published')

/** The organizer's "yes" to a parked cancel or time change. It must be the very next message, name the same action
 *  if it names one, and there must be exactly one event waiting. */
export async function confirmPending(owner: string, events: EventRow[], now: number, db?: Db, text = 'yes'): Promise<EventReply | null> {
  const waiting = parked(events, now)
  if (!waiting.length) return null
  if (waiting.length > 1) return { action: 'confirm', text: `Two changes are waiting for a yes (${waiting.map(w => w.e.title).join(' and ')}), so I have not done either. Please ask again for the one you want.` }
  const { e, p } = waiting[0]
  const verb = confirmVerb(text)
  if (verb && verb !== p!.type) { await store.setPendingAction(owner, e.id, null, db); return { action: 'confirm', text: `That does not match what I asked (${p!.type === 'cancel' ? 'cancelling' : 'moving'} *${e.title}*), so I have done nothing. Ask again if you want it.` } }
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

export type EventDeps = { extract?: Extractor; db?: Db; now?: number; search?: import('./venue-enquiry').Search; saveDraft?: (draft: Record<string, unknown>) => Promise<void>
  /** The email draft the person has waiting right now (to be sent with "send it"), if any. */
  pendingDraft?: () => Promise<Record<string, unknown> | null>; clearDraft?: () => Promise<void> }

/** After a create or an edit: when the event now has a date, a named venue and a group size, look up how that venue
 *  takes group bookings and draft the enquiry (lib/events/venue-enquiry.ts). Once per event and venue. Bounded to a
 *  few seconds; any failure adds nothing. Nothing is sent: the draft goes to the Gmail path, which needs "send it" and
 *  then an approved card. Switch off with GOGO_EVENTS_VENUE_HELP=off. */
async function venueNextStep(actor: AgentActor, owner: string, eventId: string, now: number, deps: EventDeps): Promise<string | null> {
  const env = ((globalThis as any).process?.env || {}) as Record<string, string | undefined>
  if (env.GOGO_EVENTS_VENUE_HELP === 'off' || (!deps.search && !env.VERCEL_ENV)) return null
  const v = await import('./venue-enquiry')
  const e = await store.getEvent(owner, eventId, deps.db)
  const fs = deps.pendingDraft && deps.saveDraft && deps.clearDraft ? null : await import('@/lib/bot/handlers/followup-state')
  const pending = deps.pendingDraft ? await deps.pendingDraft() : await (async () => {
    const state = await fs!.getLatestFollowupState(actor.legacyTelegramId, 'gmail_reply_draft')
    return state && fs!.isStrictlyFreshFollowupState(state, 30) && state.payload?.draft ? state.payload.draft as Record<string, unknown> : null
  })()
  const mine = pending && pending.eventEnquiryFor === e.id ? pending : null
  // An enquiry Gogo drafted for this event that no longer matches it is withdrawn, so "send it" can never send an old
  // date, number or venue. A draft to anyone else is never touched.
  const withdraw = async () => {
    if (!mine) return
    await (deps.clearDraft ? deps.clearDraft() : fs!.clearFollowupState(actor.legacyTelegramId, 'gmail_reply_draft'))
    await store.recordOwnerAudit(owner, e.id, 'event.venue_enquiry_drafted', { key: 'withdrawn' }, deps.db).catch(() => {})
  }
  if (!v.needsVenueEnquiry(e, now)) { await withdraw(); return null }
  // One enquiry per venue, date and headcount; an edit that changes none of them does not offer it again.
  const key = [String(e.venue_name).toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 120), e.starts_at, e.capacity].join('|')
  // Compared with the latest record only: going back to an earlier number, or coming back after a withdrawal, drafts again.
  const seen = (await store.ownerAuditDetails(owner, e.id, 'event.venue_enquiry_drafted', deps.db))[0]?.key === key
  if (mine && mine.enquiryKey === key) return null
  if (seen && !mine) return null
  const started = Date.now()
  // Page text only: an address must be read off the page itself, never out of a model-written summary.
  const search: import('./venue-enquiry').Search = deps.search || (async (q, o) => (await import('@/lib/web-search')).searchWebResults(q, { timeoutMs: o?.timeoutMs, pageTextOnly: true }))
  const contact = await Promise.race([v.findVenueContact(String(e.venue_name), search, 6000), new Promise<null>(r => setTimeout(() => r(null), 7000))])
  if (!contact) { await withdraw(); console.log('EVENT_VENUE_STEP:', JSON.stringify({ found: 'timeout', ms: Date.now() - started })); return null }
  const step = v.venueStepText(e, contact, actor.name || '')
  if (step.draft) {
    // Another email draft is waiting for "send it": it is not replaced, and this one is not queued or recorded.
    if (pending && !mine) {
      console.log('EVENT_VENUE_STEP:', JSON.stringify({ found: 'held', ms: Date.now() - started }))
      return `Next step: booking ${String(e.venue_name).replace(/[\r\n]+/g, ' ').slice(0, 120)}. I found their enquiries address, but you have another email draft waiting, so I have not prepared this one. Send or drop that draft first. I'll offer this again the next time you change this event.`
    }
    const draft = { ...step.draft, eventEnquiryFor: e.id, enquiryKey: key }
    // Hand the draft to the existing Gmail path: "send it" stages an approval card; only an approved card sends.
    const save = deps.saveDraft || (async (d: Record<string, unknown>) => {
      await fs!.clearFollowupState(actor.legacyTelegramId, 'gmail_reply_draft')
      await fs!.saveFollowupState(actor.legacyTelegramId, 'gmail_reply_draft', { draft: d, created_at: new Date().toISOString() })
      await import('@/lib/agent/typed-object-context').then(m => m.rememberTypedObjects(actor.legacyTelegramId, 'email', [{ id: `draft:${d.to}`, title: `Draft to ${d.to}: ${d.subject}` }])).catch(() => {})
    })
    await save(draft)
  } else await withdraw()
  // A lookup that could not run is not recorded, so the next change tries again. A failed record never hides a draft
  // that was saved: the text is still shown.
  if (step.found !== 'unavailable') await store.recordOwnerAudit(owner, e.id, 'event.venue_enquiry_drafted', { key, found: step.found }, deps.db).catch(() => { console.error('EVENT_VENUE_STEP_FAILED:', JSON.stringify({ code: 'audit' })) })
  console.log('EVENT_VENUE_STEP:', JSON.stringify({ found: step.found, ms: Date.now() - started }))
  // When an older draft was withdrawn and nothing replaces it, say so.
  return mine && !step.draft ? `${step.text}\nThe earlier enquiry draft no longer matches the event, so I have withdrawn it.` : step.text
}

/** Entry point for both surfaces. Null means "not an events message": carry on as usual. */
export async function tryEventAsk(actor: AgentActor, text: string, surface: EventSurface, deps: EventDeps = {}): Promise<string | null> {
  const owner = String(actor.legacyTelegramId)
  if (!eventsEnabledFor(owner)) return null
  const message = String(text || '').trim()
  if (!message || message.length > 1200) return null
  // "send it" belongs to the email draft (including the venue enquiry Gogo drafted), never to the event being planned.
  // Same words as the email path accepts (lib/agent/gmail-send.ts).
  if (/^(?:send\s+it|send\s+this\s+reply)$/i.test(message)) return null
  try {
    const now = deps.now ?? Date.now()
    const tz = normalizeTimezone(actor.timezone)
    const events = await store.listEvents(owner, deps.db)
    // An explicit yes to a question this module asked. Deterministic; the model is not consulted. Any other message
    // withdraws the question, so a "yes" meant for something else later can never cancel or move an event.
    if (CONFIRM_RE.test(message)) {
      const confirmed = await confirmPending(owner, events, now, deps.db, message)
      if (confirmed) { console.log('EVENT_ASK:', JSON.stringify({ action: confirmed.action, surface })); return confirmed.text }
    } else {
      for (const w of parked(events, now)) await store.setPendingAction(owner, w.e.id, null, deps.db)
    }
    const draft = activeDraft(events, now)
    if (!EVENT_GATE.test(message) && !draft) return null
    const local = getLocalParts(new Date(now), tz) as any
    const today = `${local.year}-${pad(Number(local.month))}-${pad(Number(local.day))}`
    const weekday = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long' }).format(new Date(now))
    const extract = deps.extract || (await import('./extract')).extractEventAction
    // Only the organizer's own event names and times go to the model. Guest-supplied text never does.
    const open = openEvents(events, now).slice(0, 6)
    const active = open.length ? open.map(e => `"${e.title}" (${e.status === 'published' ? 'published' : 'draft'}; ${whenText(e.starts_at, e.timezone)}; ${e.venue_name || 'no place yet'})`).join(' | ') : null
    const action = await extract({ text: message, today, weekday, timezone: tz, active })
    if (!action || action.action === 'none') return null
    // Outside a gate match, the only thing a bare follow-up may do is fill in or publish the draft being planned.
    const gated = EVENT_GATE.test(message)
    if (!gated && !(['update', 'publish', 'add_guests'].includes(action.action) && draft)) return null
    const result = await runEventAction(owner, action, { timezone: tz, events, hostName: actor.name || null, now, onlyEventId: gated ? null : draft!.id }, deps.db)
    if (!result) return null
    console.log('EVENT_ASK:', JSON.stringify({ action: result.action, surface }))
    const next = result.eventId ? await venueNextStep(actor, owner, result.eventId, now, deps).catch(() => null) : null
    return next ? `${result.text}\n\n${next}` : result.text
  } catch (error: any) {
    console.error('EVENT_ASK_FAILED:', String(error?.code || error?.name || 'error').slice(0, 60))
    return null
  }
}
