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
export const plain = (v: unknown) => String(v ?? '').normalize('NFKC').replace(/[\u200b-\u200f\u2060-\u2064\ufeff\u00ad\u034f\u061c\u180e]/g, '')
/** What a draft written by the model may not contain. A draft is the person's own plain words to a venue: no web or
 *  email addresses in any spelling, no phone or account numbers, nothing about approvals, codes or money transfers, and
 *  only ordinary letters (a look-alike alphabet is refused). The reason is returned, or null when the text is fine. */
export function draftTextProblem(text: string): string | null {
  const t = plain(text)
  if (/[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u.test(t)) return 'unusual letters'
  if (/@|https?|hxxp|www|:\/\/|\[\.\]|\(\.\)|\bdot\b/i.test(t)) return 'a web or email address'
  if (/\p{L}\s?\.\s?\p{L}{2,}/u.test(t.replace(/\b(?:a\.m|p\.m|e\.g|i\.e)\b\.?/gi, ' ').replace(/\.\s+(?=\p{Lu})/gu, ' '))) return 'a web address'
  if (/\d[\d\s().+-]{5,}\d/.test(t)) return 'a phone or account number'
  if (/\b(?:approv\w*|otp|one[- ]time|passcode|password|cvv|pin|upi|gpay|google pay|phonepe|paytm|bank|transfer|deposit\s+to|wallet|verification code|\d-digit code|whatsapp\s+(?:this|me|us)|click|tap|press)\b/i.test(t)) return 'words about approvals, codes or payments'
  return null
}
/** True when the venue, as a whole phrase, is in the allowed text (the person's own current message or the venue of
 *  one of their own events). A phrase, not loose words, so a locality alone never unlocks another venue there. */
export function venueNamedByPerson(venue: string, allowed: string): boolean {
  const norm = (v: string) => ` ${plain(v).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `
  const want = norm(venue)
  return want.trim().length >= 3 && want.trim().split(' ').some(w => w.length >= 3) && allowed.split('\n').some(line => norm(line).includes(want))
}
const oneLine = (v: unknown, n: number) => String(v ?? '').replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n)
const bodyText = (v: unknown, n: number) => String(v ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, n)

/** Saves an email draft for the person to review. Runs only in live mode. It can be addressed only to a contact a
 *  verifying tool returned in this same pass; it never replaces a draft that is already waiting; it sends nothing. The
 *  existing email path sends it only after the person says "send it" and approves the card. */
async function saveEmailDraft(actor: AgentActor, input: Record<string, unknown>, state: LoopState, deps: LoopToolDeps): Promise<string> {
  const to = oneLine(input.to, 120).toLowerCase(), subject = oneLine(plain(input.subject), 120), body = bodyText(plain(input.body), 900)
  if (!state.verified.has(to)) return 'Refused. That address did not come from a verifying tool in this turn. Never write an address yourself: look it up with venue_contact, or ask the person for it.'
  if (subject.length < 3 || body.length < 20) return 'Refused. The draft needs a subject and a message.'
  const problem = draftTextProblem(subject) || draftTextProblem(body)
  if (problem) return `Refused. The draft contains ${problem}. Write it again as a short, plain enquiry in the person's own voice: who, when, how many, and what you would like to know.`
  if (state.prepared.length) return 'Refused. One draft per message. Finish and tell the person about the draft that is ready.'
  const fs = deps.pendingDraft && deps.saveDraft ? null : await import('@/lib/bot/handlers/followup-state')
  const pending = deps.pendingDraft ? await deps.pendingDraft(actor) : await (async () => {
    const st = await fs!.getLatestFollowupState(actor.legacyTelegramId, 'gmail_reply_draft')
    return st && fs!.isStrictlyFreshFollowupState(st, 30) && st.payload?.draft ? st.payload.draft as Record<string, unknown> : null
  })()
  if (pending) return 'Not saved. The person already has an email draft waiting to be sent, and it must not be replaced. Tell them that, and that you can draft this one once that is sent or dropped.'
  const draft = { newMessage: true, threadId: '', sourceMessageId: '', inReplyTo: null, to, subject, body, loopDraft: true }
  // Recorded before the save starts: if the save is slow and this tool is cut off, the pass still knows a draft may
  // exist, so the person is shown it (a draft is never left unseen). A save that fails takes it back out.
  const mine = { kind: 'email_draft' as const, to, subject, body }
  state.prepared.push(mine)
  try {
    if (deps.saveDraft) await deps.saveDraft(actor, draft)
    else {
      await fs!.saveFollowupState(actor.legacyTelegramId, 'gmail_reply_draft', { draft, created_at: new Date().toISOString() })
      await import('@/lib/agent/typed-object-context').then(m => m.rememberTypedObjects(actor.legacyTelegramId, 'email', [{ id: `draft:${to}`, title: `Draft to ${to}: ${subject}` }])).catch(() => {})
    }
  } catch (e) { const k = state.prepared.indexOf(mine); if (k >= 0) state.prepared.splice(k, 1); throw e }
  return 'Saved as a draft. It has NOT been sent. The person will be shown the full draft, so do not repeat its text: tell them in one line what it is for. They send it by saying "send it" and approving the card.'
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
        if (c.kind === 'email') state.verified.add(c.email.toLowerCase())
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
    { name: 'email_draft', klass: 'prepare', description: 'Prepare an email draft for the person to review. It is not sent. The recipient address must be one that venue_contact returned in this turn. Write it in the person\'s own voice from what they told you; plain text, no links.',
      input_schema: obj({ to: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' } }, ['to', 'subject', 'body']),
      run: (actor, input, state) => saveEmailDraft(actor, input, state, deps) },
    { name: 'reminder', klass: 'prepare', description: 'Set a reminder for the person themselves.',
      input_schema: obj({ text: { type: 'string' }, when: { type: 'string', description: 'ISO date and time' } }, ['text', 'when']) },
    { name: 'request_send_email', klass: 'act', description: "Ask the person to approve sending a prepared email. Sends nothing by itself.", input_schema: obj({ to: { type: 'string' }, subject: { type: 'string' } }, ['to', 'subject']) },
    { name: 'request_publish_event', klass: 'act', description: 'Ask the person to approve publishing their event so guests can reply. Publishes nothing by itself.', input_schema: obj({ title: { type: 'string' } }, ['title']) },
    { name: 'request_booking', klass: 'act', description: 'Ask the person to approve a booking or reservation. Books nothing by itself.', input_schema: obj({ what: { type: 'string' }, when: { type: 'string' } }, ['what']) },
  ]
}
