// AskGogo Events: the deeper venue lookup. When the quick lookup (lib/events/venue-enquiry.ts) finds a venue's own site
// but no booking address in what search or a plain page read returned (the page was slow, built by script, or sent the
// reader elsewhere), the site is opened in Gogo's existing cloud browser, in the background, and the result is sent as
// a later WhatsApp message.
//
// What this may do: one public, read-only browser run on the venue's own site (no sign-in, no saved login, nothing
// filled or submitted; lib/agent/secure-computer.ts enforces that). What decides the address is the same code as the
// quick lookup: the address must be read off the page's own text, sit on the venue's own domain and be beside words
// about bookings. The browser's own written answer is never read for an address. Nothing is sent to the venue: a draft
// is saved for the existing Gmail path, where "send it" raises an approval card and only an approved card sends.
// Off unless GOGO_EVENTS_VENUE_BROWSER=on (and never for an owner without Events).
import type { AgentActor } from '@/lib/agent/actor'
import { eventsEnabledFor, type EventRow } from './core'
import * as store from './store'
import { enquiryKey, hitsFromPage, needsVenueEnquiry, pickVenueContact, registrable, venueStepText, type SearchHit, type VenueLookupDetail } from './venue-enquiry'
import { readableUrl } from './venue-page'

type Env = Record<string, string | undefined>
type Db = Parameters<typeof store.getEvent>[2]
const envOf = () => ((globalThis as any).process?.env || {}) as Env
/** Browser lookups one organizer may start in 24 hours, unless GOGO_EVENTS_VENUE_BROWSER_DAILY says fewer or more (1 to 20). */
export const BROWSE_DAILY = 5
const SITE = /^[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63}){1,3}$/

export function venueBrowseEnabledFor(owner: string, env: Env = envOf()): boolean {
  return env.GOGO_EVENTS_VENUE_HELP !== 'off' && env.GOGO_EVENTS_VENUE_BROWSER === 'on' && eventsEnabledFor(owner, env)
}

const hostSite = (host: string) => registrable(host.toLowerCase().replace(/^www\./, ''))
/** https, host and a plain path: no query, no fragment, nothing that could carry words or a token. */
const plainUrl = (u: URL) => `https://${u.hostname.toLowerCase()}${/^\/[A-Za-z0-9\-_/.]{0,120}$/.test(u.pathname) && !u.pathname.includes('..') && !u.pathname.includes('//') ? u.pathname : '/'}`

/** The page to open: the first of the site's own pages that search returned, as https, host and path only. */
export function browseTarget(urls: unknown, site: string): string | null {
  if (!SITE.test(site) || !Array.isArray(urls)) return null
  for (const raw of urls.slice(0, 4)) {
    const u = typeof raw === 'string' ? readableUrl(raw) : null
    if (u && hostSite(u.hostname) === site) return plainUrl(u)
  }
  return null
}

/** What the browser is asked to do. Fixed words and one address that was checked; nothing the organizer or a page wrote. */
export const browseObjective = (url: string) => `Read-only: open ${url} and find the email address this venue gives for group or private event enquiries. If this page does not show one, open this same site's Contact, Events or FAQ page and read it there. Do not log in, fill in or submit anything.`

export type BrowseMeta = { eventId: string; key: string; site: string; url: string; venue: string; hits: SearchHit[] }
/** The stored request, checked again from scratch: it is read back from a database row, so nothing in it is trusted. */
export function readBrowseMeta(raw: unknown): BrowseMeta | null {
  const m = raw as any
  if (!m || typeof m !== 'object' || typeof m.eventId !== 'string' || !/^[0-9a-f-]{8,64}$/i.test(m.eventId) || typeof m.key !== 'string' || !m.key || m.key.length > 400
    || typeof m.site !== 'string' || !SITE.test(m.site) || typeof m.venue !== 'string' || !m.venue.trim() || m.venue.length > 120) return null
  const u = typeof m.url === 'string' ? readableUrl(m.url) : null
  if (!u || hostSite(u.hostname) !== m.site || plainUrl(u) !== m.url) return null
  const hits = (Array.isArray(m.hits) ? m.hits : []).slice(0, 6).filter((h: any) => h && typeof h.url === 'string' && typeof h.title === 'string' && typeof h.snippet === 'string')
    // Only what search said about this same site; never marked as read from a page.
    .filter((h: any) => { const hu = readableUrl(h.url); return Boolean(hu && hostSite(hu.hostname) === m.site) })
    .map((h: any) => ({ title: h.title.slice(0, 200), snippet: h.snippet.slice(0, 600), url: h.url.slice(0, 400) }))
  return { eventId: m.eventId, key: m.key, site: m.site, url: m.url, venue: m.venue, hits }
}

export type BrowseQueue = (p: { actor: AgentActor; text: string; metadata: Record<string, unknown> }) => Promise<boolean>
const realQueue: BrowseQueue = async p => {
  // The existing background read queue: it checks the organizer's browser permission, creates the run and hands it to
  // the 300-second worker, which calls runVenueBrowse below for a run carrying venue_enquiry.
  const { queueBrowserRead } = await import('@/lib/agent/browser-command')
  return Boolean(await queueBrowserRead({ actor: p.actor, surface: 'whatsapp', text: p.text, metadata: p.metadata }))
}
const realCount = async (owner: string): Promise<number> => {
  const { supabaseAdmin } = await import('@/lib/supabase-admin')
  const { count, error } = await supabaseAdmin.from('agent_runs').select('id', { count: 'exact', head: true })
    .eq('telegram_id', owner).eq('type', 'secure_browser').gte('started_at', new Date(Date.now() - 24 * 3600_000).toISOString()).contains('metadata_json', { venue_browse: true })
  if (error || typeof count !== 'number') throw new Error('venue_browse_count_failed')
  return count
}

/** Starts the background browser lookup. False (and nothing started) when it is off, over the daily number, there is no
 *  WhatsApp number to answer on, or anything about the request does not check out. Never throws. */
export async function queueVenueBrowse(p: { actor: AgentActor; owner: string; event: EventRow; key: string; detail: VenueLookupDetail },
  deps: { env?: Env; queue?: BrowseQueue; countToday?: (owner: string) => Promise<number> } = {}): Promise<boolean> {
  try {
    const env = deps.env || envOf()
    if (!venueBrowseEnabledFor(p.owner, env) || !p.actor.whatsappId || String(p.actor.legacyTelegramId) !== p.owner) return false
    const site = String(p.detail.site || ''), url = browseTarget(p.detail.urls, site)
    if (!url) return false
    const asked = Number(env.GOGO_EVENTS_VENUE_BROWSER_DAILY), cap = Number.isInteger(asked) && asked >= 1 && asked <= 20 ? asked : BROWSE_DAILY
    // The number could not be read: nothing is started.
    if (!((await (deps.countToday || realCount)(p.owner)) < cap)) { console.log('VENUE_BROWSE_QUEUE:', JSON.stringify({ started: false, why: 'daily' })); return false }
    const meta = readBrowseMeta({ eventId: p.event.id, key: p.key, site, url, venue: String(p.event.venue_name || '').replace(/[\r\n\u0000-\u001f]+/g, ' ').trim().slice(0, 120), hits: p.detail.hits || [] })
    if (!meta) return false
    const started = await (deps.queue || realQueue)({ actor: p.actor, text: browseObjective(url), metadata: { venue_browse: true, venue_enquiry: meta } })
    console.log('VENUE_BROWSE_QUEUE:', JSON.stringify({ started }))
    return started
  } catch (err: any) {
    console.error('VENUE_BROWSE_QUEUE_FAILED:', JSON.stringify({ code: String(err?.message || 'error').replace(/[^a-z0-9_:]/gi, '').slice(0, 60) }))
    return false
  }
}

export type BrowsedPage = { status: string; url: string; title: string; pageText: string }
export type VenueBrowseOutcome = { found: 'email' | 'page' | 'unread' | 'held' | 'stale' | 'off' | 'invalid'; text: string | null }

const realBrowse = async (actor: AgentActor, url: string): Promise<BrowsedPage> => {
  const [{ evaluateAgentSentinel }, { evaluateAgentExecutionPolicy }, { runSecureBrowser }] = await Promise.all([import('@/lib/agent/sentinel'), import('@/lib/agent/policy'), import('@/lib/agent/secure-computer')])
  const objective = browseObjective(url)
  // The same gates as any other read in the cloud browser.
  if (!evaluateAgentSentinel({ capability: 'browser', mode: 'read', risk: 'low', irreversible: false, approved: false, instruction: objective, url, actionCount: 12 }).allowed) throw new Error('venue_browse_sentinel_blocked')
  if (!evaluateAgentExecutionPolicy({ capability: 'browser', permissionLevel: 'ask', mode: 'read', risk: 'low', irreversible: false, approvalStatus: null }).allowed) throw new Error('venue_browse_policy_blocked')
  // Its own browser, apart from any task the organizer has open. Public only: no saved login, no sign-in, no handoff.
  return runSecureBrowser({ userId: `${actor.userId}:venue`, url, objective, mode: 'read', publicOnly: true, vaultCredentialId: null, reserveHumanHandoff: false, reservePasswordHandoff: false, readDeadline: Date.now() + 170_000 })
}
const realPending = async (tg: number) => {
  const fs = await import('@/lib/bot/handlers/followup-state')
  const state = await fs.getLatestFollowupState(tg, 'gmail_reply_draft')
  return state && fs.isStrictlyFreshFollowupState(state, 30) && state.payload?.draft ? state.payload.draft as Record<string, unknown> : null
}
// The same hand-over as the quick lookup (lib/events/entry.ts): "send it" stages an approval card; only an approved card sends.
const realSave = async (tg: number, d: Record<string, unknown>) => {
  const fs = await import('@/lib/bot/handlers/followup-state')
  await fs.clearFollowupState(tg, 'gmail_reply_draft')
  await fs.saveFollowupState(tg, 'gmail_reply_draft', { draft: d, created_at: new Date().toISOString() })
  await import('@/lib/agent/typed-object-context').then(m => m.rememberTypedObjects(tg, 'email', [{ id: `draft:${d.to}`, title: `Draft to ${d.to}: ${d.subject}` }])).catch(() => {})
}

/** Runs one queued lookup and returns what to tell the organizer (null: say nothing). Never throws, never sends. */
export async function runVenueBrowse(actor: AgentActor, rawMeta: unknown, deps: { env?: Env; db?: Db; now?: number; browse?: (url: string) => Promise<BrowsedPage>
  pendingDraft?: () => Promise<Record<string, unknown> | null>; saveDraft?: (d: Record<string, unknown>) => Promise<void> } = {}): Promise<VenueBrowseOutcome> {
  const meta = readBrowseMeta(rawMeta)
  if (!meta) return { found: 'invalid', text: null }
  const owner = String(actor.legacyTelegramId), env = deps.env || envOf(), now = () => deps.now ?? Date.now()
  // Switched off since it was queued: nothing is opened and nothing is said.
  if (!venueBrowseEnabledFor(owner, env)) return { found: 'off', text: null }
  // The event as it is now. Changed or gone since the lookup was started: the answer would be for the wrong plan.
  const current = async (): Promise<EventRow | null> => {
    const e = await store.getEvent(owner, meta.eventId, deps.db).catch(() => null)
    return e && needsVenueEnquiry(e, now()) && enquiryKey(e) === meta.key ? e : null
  }
  try {
    if (!await current()) return { found: 'stale', text: null }
    const unread: VenueBrowseOutcome = { found: 'unread', text: `I could not open ${meta.site} in a browser just now, so I have not drafted anything. Send me their booking email address and I'll draft the enquiry.` }
    const page = await (deps.browse || (url => realBrowse(actor, url)))(meta.url).catch((err: any) => { console.error('VENUE_BROWSE_READ_FAILED:', JSON.stringify({ code: String(err?.message || 'error').replace(/[^a-z0-9_:]/gi, '').slice(0, 60) })); return null })
    if (!page || page.status !== 'completed') return unread
    // Where the browser ended up must still be the venue's own site.
    const at = readableUrl(String(page.url || ''))
    if (!at || hostSite(at.hostname) !== meta.site) return unread
    const text = String(page.pageText || '').slice(0, 12_000)
    const pageHits = hitsFromPage({ url: plainUrl(at), title: String(page.title || '').replace(/\s+/g, ' ').slice(0, 200), text })
    // The same rules as the quick lookup, over what search said about this site plus what the page itself shows.
    const contact = pickVenueContact([...meta.hits, ...pageHits], meta.venue)
    console.log('VENUE_BROWSE_READ:', JSON.stringify({ text: text.length, at_signs: (text.match(/@/g) || []).length, found: contact.kind }))
    if (contact.kind !== 'email') return { found: 'page', text: `I opened ${meta.site} in a browser and still could not confirm a booking email on it, so I have not drafted anything. Send me the right address and I'll draft the enquiry.` }
    // The read took a while: the plan is checked again before anything is saved.
    const e = await current()
    if (!e) return { found: 'stale', text: null }
    const pending = await (deps.pendingDraft ? deps.pendingDraft() : realPending(actor.legacyTelegramId))
    if (pending && pending.eventEnquiryFor !== e.id) return { found: 'held', text: `I opened ${meta.site} in a browser and found their enquiries address, but you have another email draft waiting, so I have not prepared this one. Send or drop that draft first. I'll offer this again the next time you change this event.` }
    const step = venueStepText(e, contact, actor.name || '')
    if (!step.draft) return { found: 'page', text: null }
    await (deps.saveDraft ? deps.saveDraft : (d: Record<string, unknown>) => realSave(actor.legacyTelegramId, d))({ ...step.draft, eventEnquiryFor: e.id, enquiryKey: meta.key })
    await store.recordOwnerAudit(owner, e.id, 'event.venue_enquiry_drafted', { key: meta.key, found: 'email', via: 'browser' }, deps.db).catch(() => { console.error('VENUE_BROWSE_FAILED:', JSON.stringify({ code: 'audit' })) })
    return { found: 'email', text: `I opened ${meta.site} in a browser. ${step.text}` }
  } catch (err: any) {
    console.error('VENUE_BROWSE_FAILED:', JSON.stringify({ code: String(err?.message || 'error').replace(/[^a-z0-9_:]/gi, '').slice(0, 60) }))
    return { found: 'unread', text: `I could not finish looking at ${meta.site} in a browser just now, so I have not drafted anything. Send me their booking email address and I'll draft the enquiry.` }
  }
}
