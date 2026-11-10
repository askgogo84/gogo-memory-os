// The first tools for the brain loop (docs/architecture/same-brain-3/05-brain-loop.md). Read tools do the look-up.
// Prepare and act tools are declared so the model can plan with them; in shadow none of them runs, and act tools have
// no run function at all.
import type { AgentActor } from './actor'
import type { LoopTool, LoopState } from './brain-loop'

const str = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n)
/** A search query with email addresses and long digit runs removed. */
export const searchable = (v: unknown) => str(v, 200).replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, ' ').replace(/\+?\d[\d\s-]{6,}\d/g, ' ').replace(/\s+/g, ' ').trim()
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object' as const, properties, required })

export type LoopToolDeps = {
  search?: (q: string, o?: { timeoutMs?: number }) => Promise<{ title: string; snippet: string; url: string }[]>
  listEvents?: (owner: string) => Promise<any[]>
  /** The email draft the person has waiting for "send it", if any (fresh within 30 minutes). */
  pendingDraft?: (actor: AgentActor) => Promise<Record<string, unknown> | null>
  saveDraft?: (actor: AgentActor, draft: Record<string, unknown>) => Promise<void>
  /** The person's own current message. A venue may be looked up only if they named it there, or it is the venue of
   *  one of their own events. Without this, any venue is allowed (shadow planning only). */
  userText?: string
}
/** The same text with look-alike forms folded (full-width, ligatures) and invisible characters removed. */
export const plain = (v: unknown) => String(v ?? '').normalize('NFKC').replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff\u00ad\u034f\u061c\u180e\ufe00-\ufe0f]|[\u{e0000}-\u{e007f}]/gu, '')
/** True when the venue, as a whole phrase, is in the allowed text (the person's own current message or the venue of
 *  one of their own events). A phrase, not loose words, so a locality alone never unlocks another venue there. */
export function venueNamedByPerson(venue: string, allowed: string): boolean {
  const norm = (v: string) => ` ${plain(v).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `
  const want = norm(venue)
  return want.trim().length >= 3 && want.trim().split(' ').some(w => w.length >= 3) && allowed.split('\n').some(line => norm(line).includes(want))
}

// ---- the enquiry is written by code --------------------------------------------------------------------------------
// The model never writes a word of the email. It gives facts in fixed shapes (an occasion from a list, a date, a time,
// a number, questions from a list) and this file writes the subject and the body. So nothing a web page says, and
// nothing the model makes up, can appear in what the person is shown or in what the venue would receive.
export const OCCASIONS: Record<string, string> = { birthday: 'a birthday celebration', anniversary: 'an anniversary celebration', dinner: 'a group dinner', lunch: 'a group lunch', party: 'a party', farewell: 'a farewell', reunion: 'a reunion', team_outing: 'a team outing', get_together: 'a get-together' }
export const ASKS: Record<string, string> = {
  reserved_section: 'Can you accommodate us, ideally in a reserved section?', group_menu: 'Could you share your group menu or package prices?',
  deposit_terms: 'Is there a minimum spend or deposit, and what are your cancellation terms?', cake: 'Can we bring a cake?', decorations: 'Can we bring a few decorations?',
  vegetarian: 'Do you have good vegetarian options for a group?', parking: 'Is parking available for guests?', kids: 'Is the space suitable for children?',
}
// Letters, spaces, apostrophes and hyphens only: no dot, digit or sign can come through a name.
const personName = (v: unknown) => plain(v).replace(/[^\p{L}\p{M} '-]/gu, ' ').replace(/\b(?:https?|www|hxxp)\b/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, 60)
/** The subject and body, from facts only. Null when a fact is missing or out of range. */
export function enquiryFromFacts(f: { venue: string; occasion: unknown; date: unknown; time: unknown; people: unknown; asks: unknown; organizer: string; timezone?: string }, now = Date.now()): { subject: string; body: string } | null {
  // Own keys only: a name such as "constructor" or "__proto__" is not an occasion.
  const what = typeof f.occasion === 'string' && Object.hasOwn(OCCASIONS, f.occasion) ? OCCASIONS[f.occasion] : ''
  const people = Number.isInteger(f.people) && (f.people as number) >= 2 && (f.people as number) <= 500 ? (f.people as number) : null
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(f.date)) ? String(f.date) : '', time = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(f.time)) ? String(f.time) : ''
  if (!what || !people || !date || !time) return null
  const day = new Date(`${date}T12:00:00Z`)
  if (Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== date || day.getTime() < now - 12 * 3600_000 || day.getTime() > now + 400 * 86400_000) return null
  const dayText = new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(day)
  const [h, m] = time.split(':').map(Number), timeText = `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'am' : 'pm'}`
  const asks = [...new Set((Array.isArray(f.asks) ? f.asks : []).filter((a): a is string => typeof a === 'string' && Object.hasOwn(ASKS, a)))].slice(0, 5)
  const questions = (asks.length ? asks : ['reserved_section', 'group_menu', 'deposit_terms']).map(a => ASKS[a]).join(' ')
  // The venue's name as the person wrote it: letters, short numbers ("1522", "13th Floor"), spaces, & ' and -. No dot
  // or slash, no long number, no web words.
  const venue = plain(f.venue).replace(/[^\p{L}\p{M}\p{N} &'-]/gu, ' ').replace(/\p{Nd}[\p{Nd} -]{4,}\p{Nd}/gu, ' ').replace(/\b(?:https?|www|hxxp)\b/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
  if (venue.length < 2) return null
  return {
    subject: `Group booking enquiry: ${people} guests, ${dayText}, ${timeText}`,
    body: [`Hi team,`, `I'd like to host ${what} for ${people} people at ${venue} on ${dayText} at ${timeText}.`, questions, `Thanks,\n${personName(f.organizer) || 'The organizer'}`].join('\n\n'),
  }
}

/** Saves the enquiry as a draft for the person to review. Live mode only. The address is the one venue_contact
 *  verified in this pass for this venue; the words are written by enquiryFromFacts. It never replaces a draft that is
 *  already waiting and it sends nothing: the existing email path sends only after "send it" and an approved card. */
async function saveEnquiryDraft(actor: AgentActor, input: Record<string, unknown>, state: LoopState, deps: LoopToolDeps): Promise<string> {
  const v = state.venue
  if (!v || !state.verified.has(v.email)) return 'Refused. Look up the venue with venue_contact first. A draft can only go to an address that tool verified in this turn.'
  if (state.prepared.length) return 'Refused. One draft per message. Finish.'
  const written = enquiryFromFacts({ venue: v.name, occasion: input.occasion, date: input.date, time: input.time, people: input.people, asks: input.asks, organizer: actor.name, timezone: actor.timezone })
  if (!written) return 'Refused. Give the occasion (one of the listed values), the date as YYYY-MM-DD, the time as HH:MM (24-hour) and the number of people, exactly as the person stated them. If the person has not stated one of these, do not guess: finish without a draft.'
  const fs = deps.pendingDraft && deps.saveDraft ? null : await import('@/lib/bot/handlers/followup-state')
  const pending = deps.pendingDraft ? await deps.pendingDraft(actor) : await (async () => {
    const st = await fs!.getLatestFollowupState(actor.legacyTelegramId, 'gmail_reply_draft')
    return st && fs!.isStrictlyFreshFollowupState(st, 30) && st.payload?.draft ? st.payload.draft as Record<string, unknown> : null
  })()
  if (pending) return 'Not saved. The person already has an email draft waiting to be sent, and it must not be replaced. Finish.'
  const draft = { newMessage: true, threadId: '', sourceMessageId: '', inReplyTo: null, to: v.email, subject: written.subject, body: written.body, loopDraft: true }
  // Recorded before the save starts: if the save is slow and this tool is cut off, the pass still knows a draft may
  // exist, so the person is shown it (a draft is never left unseen). A save that fails takes it back out.
  const mine = { kind: 'email_draft' as const, to: v.email, subject: written.subject, body: written.body }
  state.prepared.push(mine)
  try {
    if (deps.saveDraft) await deps.saveDraft(actor, draft)
    else {
      await fs!.saveFollowupState(actor.legacyTelegramId, 'gmail_reply_draft', { draft, created_at: new Date().toISOString() })
      await import('@/lib/agent/typed-object-context').then(m => m.rememberTypedObjects(actor.legacyTelegramId, 'email', [{ id: `draft:${v.email}`, title: `Draft to ${v.email}: ${written.subject}` }])).catch(() => {})
    }
  } catch (e) { const k = state.prepared.indexOf(mine); if (k >= 0) state.prepared.splice(k, 1); throw e }
  return 'Saved as a draft. It has NOT been sent. The person will be shown it in full. Finish.'
}

export function firstSliceTools(deps: LoopToolDeps = {}): LoopTool[] {
  const search = deps.search || (async (q: string, o?: { timeoutMs?: number }) => (await import('@/lib/web-search')).searchWebResults(q, { timeoutMs: o?.timeoutMs || 6000, pageTextOnly: true }))
  return [
    { name: 'web_search', klass: 'read', description: 'Search the web. Returns page titles, links and text from the pages. Use for facts about places, businesses, prices, opening times and how something is done.',
      input_schema: obj({ query: { type: 'string', description: 'What to search for' } }, ['query']),
      run: async (_actor, input) => {
        // What leaves for the search service: no email addresses and no long numbers (phones, accounts), whatever the model wrote.
        const q = searchable(input.query)
        if (q.length < 3) return 'Give a search query for a place, a business or a public fact.'
        const hits = (await search(q, { timeoutMs: 6000 })).slice(0, 5)
        return hits.length ? hits.map((h, i) => `${i + 1}. ${str(h.title, 120)}\n${str(h.url, 200)}\n${str(h.snippet, 500)}`).join('\n\n') : 'No results.'
      } },
    { name: 'venue_contact', klass: 'read', description: "Find a venue's own booking or events email address, verified against the venue's own website. Returns the address with the page it came from, or says that none could be verified. The only allowed source for a venue's email address.",
      input_schema: obj({ venue: { type: 'string', description: 'Venue name with its locality, as the person said it' } }, ['venue']),
      run: async (actor, input, state) => {
        const venue = str(input.venue, 120)
        if (venue.length < 3) return 'Give the venue name.'
        // Only a venue the person named themselves, or the venue of one of their own events: text from a web page, an
        // email or an earlier reply can never choose whose address is looked up.
        if (deps.userText !== undefined) {
          const owner = String(actor.legacyTelegramId)
          const mine = await (deps.listEvents ? deps.listEvents(owner) : import('@/lib/events/core').then(async c => (c.eventsEnabledFor(owner) ? (await import('@/lib/events/store')).listEvents(owner) : []))).catch(() => [] as any[])
          const allowed = [deps.userText, ...mine.filter((e: any) => e.status !== 'cancelled').map((e: any) => String(e.venue_name || ''))].join('\n')
          if (!venueNamedByPerson(venue, allowed)) return 'Refused. Look up only a venue the person named in their own messages or one of their own events.'
        }
        const c = await (await import('@/lib/events/venue-enquiry')).findVenueContact(venue, search, 6000)
        if (c.kind === 'email') { state.verified.add(c.email.toLowerCase()); state.venue = { name: venue, email: c.email.toLowerCase() } }
        return c.kind === 'email' ? `Verified address: ${c.email} (found on ${c.sourceUrl}). Ask the person to check it before sending.`
          : c.kind === 'page' ? `No booking address could be verified. The venue's page: ${c.sourceUrl}. Do not write an address yourself.`
          : c.kind === 'unavailable' ? 'The look-up could not run just now. Do not write an address yourself.' : "The venue's own website was not found. Do not write an address yourself."
      } },
    { name: 'events_list', klass: 'read', description: "The person's own events in AskGogo Events (drafts and published): name, date, place, number of people, status.",
      input_schema: obj({}),
      run: async (actor: AgentActor) => {
        const owner = String(actor.legacyTelegramId)
        const { eventsEnabledFor } = await import('@/lib/events/core')
        if (!eventsEnabledFor(owner)) return 'Events are not switched on for this person.'
        const list = deps.listEvents ? await deps.listEvents(owner) : await (await import('@/lib/events/store')).listEvents(owner)
        const open = list.filter((e: any) => e.status !== 'cancelled').slice(0, 8)
        return open.length ? open.map((e: any) => `- ${str(e.title, 80)} | ${e.starts_at || 'no date'} (${e.timezone}) | ${str(e.venue_name || 'no place', 80)} | ${e.capacity ? `${e.capacity} people` : 'number not set'} | ${e.status}`).join('\n') : 'No events yet.'
      } },
    // Planned with, never run in shadow.
    { name: 'event_draft', klass: 'prepare', description: "Create or update the person's own event draft (private until they publish): name, date, time, place, number of people.",
      input_schema: obj({ title: { type: 'string' }, date: { type: 'string', description: 'YYYY-MM-DD' }, time: { type: 'string', description: 'HH:MM, 24-hour' }, venue: { type: 'string' }, people: { type: 'integer' } }, ['title']) },
    { name: 'venue_enquiry_draft', klass: 'prepare', description: 'Prepare a booking enquiry email to the venue that venue_contact just verified, for the person to review. It is not sent. You give only facts the person stated; the email itself is written for you. If the person has not stated the date, time or number of people, do not guess: finish without a draft.',
      input_schema: obj({ occasion: { type: 'string', enum: Object.keys(OCCASIONS) }, date: { type: 'string', description: 'YYYY-MM-DD, as the person stated' }, time: { type: 'string', description: 'HH:MM, 24-hour, as the person stated' }, people: { type: 'integer', description: 'Number of people, as the person stated' }, asks: { type: 'array', items: { type: 'string', enum: Object.keys(ASKS) }, description: 'Which standard questions to include' } }, ['occasion', 'date', 'time', 'people']),
      run: (actor, input, state) => saveEnquiryDraft(actor, input, state, deps) },
    { name: 'reminder', klass: 'prepare', description: 'Set a reminder for the person themselves.',
      input_schema: obj({ text: { type: 'string' }, when: { type: 'string', description: 'ISO date and time' } }, ['text', 'when']) },
    { name: 'request_send_email', klass: 'act', description: "Ask the person to approve sending a prepared email. Sends nothing by itself.", input_schema: obj({ to: { type: 'string' }, subject: { type: 'string' } }, ['to', 'subject']) },
    { name: 'request_publish_event', klass: 'act', description: 'Ask the person to approve publishing their event so guests can reply. Publishes nothing by itself.', input_schema: obj({ title: { type: 'string' } }, ['title']) },
    { name: 'request_booking', klass: 'act', description: 'Ask the person to approve a booking or reservation. Books nothing by itself.', input_schema: obj({ what: { type: 'string' }, when: { type: 'string' } }, ['what']) },
  ]
}
