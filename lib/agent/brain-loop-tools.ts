// The first tools for the brain loop (docs/architecture/same-brain-3/05-brain-loop.md). Read tools do the look-up.
// Prepare and act tools are declared so the model can plan with them; in shadow none of them runs, and act tools have
// no run function at all.
import type { AgentActor } from './actor'
import type { LoopTool } from './brain-loop'

const str = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n)
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object' as const, properties, required })

export type LoopToolDeps = {
  search?: (q: string, o?: { timeoutMs?: number }) => Promise<{ title: string; snippet: string; url: string }[]>
  listEvents?: (owner: string) => Promise<any[]>
}

export function firstSliceTools(deps: LoopToolDeps = {}): LoopTool[] {
  const search = deps.search || (async (q: string, o?: { timeoutMs?: number }) => (await import('@/lib/web-search')).searchWebResults(q, { timeoutMs: o?.timeoutMs || 6000, pageTextOnly: true }))
  return [
    { name: 'web_search', klass: 'read', description: 'Search the web. Returns page titles, links and text from the pages. Use for facts about places, businesses, prices, opening times and how something is done.',
      input_schema: obj({ query: { type: 'string', description: 'What to search for' } }, ['query']),
      run: async (_actor, input) => {
        const q = str(input.query, 200)
        if (q.length < 3) return 'Give a search query.'
        const hits = (await search(q, { timeoutMs: 6000 })).slice(0, 5)
        return hits.length ? hits.map((h, i) => `${i + 1}. ${str(h.title, 120)}\n${str(h.url, 200)}\n${str(h.snippet, 500)}`).join('\n\n') : 'No results.'
      } },
    { name: 'venue_contact', klass: 'read', description: "Find a venue's own booking or events email address, verified against the venue's own website. Returns the address with the page it came from, or says that none could be verified. The only allowed source for a venue's email address.",
      input_schema: obj({ venue: { type: 'string', description: 'Venue name with its locality, as the person said it' } }, ['venue']),
      run: async (_actor, input) => {
        const venue = str(input.venue, 120)
        if (venue.length < 3) return 'Give the venue name.'
        const c = await (await import('@/lib/events/venue-enquiry')).findVenueContact(venue, search, 6000)
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
    { name: 'email_draft', klass: 'prepare', description: 'Prepare an email draft for the person to review. It is not sent. The recipient address must come from a tool result.',
      input_schema: obj({ to: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' } }, ['to', 'subject', 'body']) },
    { name: 'reminder', klass: 'prepare', description: 'Set a reminder for the person themselves.',
      input_schema: obj({ text: { type: 'string' }, when: { type: 'string', description: 'ISO date and time' } }, ['text', 'when']) },
    { name: 'request_send_email', klass: 'act', description: "Ask the person to approve sending a prepared email. Sends nothing by itself.", input_schema: obj({ to: { type: 'string' }, subject: { type: 'string' } }, ['to', 'subject']) },
    { name: 'request_publish_event', klass: 'act', description: 'Ask the person to approve publishing their event so guests can reply. Publishes nothing by itself.', input_schema: obj({ title: { type: 'string' } }, ['title']) },
    { name: 'request_booking', klass: 'act', description: 'Ask the person to approve a booking or reservation. Books nothing by itself.', input_schema: obj({ what: { type: 'string' }, when: { type: 'string' } }, ['what']) },
  ]
}
