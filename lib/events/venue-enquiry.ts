// AskGogo Events: the step after the plan. Once an event has a date, a venue and a headcount, Gogo looks up how that
// venue takes group bookings and drafts the enquiry email for the organizer. Nothing is sent from here: the draft is
// handed to the existing Gmail path, where "send it" raises an approval card and only an approved card sends.
// A contact is used only when it is verifiably the venue's own: the address must appear word for word in a search
// result, on the venue's own domain, and that domain must carry the venue's name. Anything less gets no draft, only
// the official page to check. Nothing is guessed.
import type { EventRow } from './core'

export type SearchHit = { title: string; snippet: string; url: string }
export type Search = (query: string, opts?: { timeoutMs?: number }) => Promise<SearchHit[]>
export type VenueContact =
  | { kind: 'email'; email: string; sourceUrl: string }
  | { kind: 'page'; sourceUrl: string }
  | { kind: 'none' }

const FREE_MAIL = /@(?:gmail|googlemail|yahoo|ymail|rediffmail|hotmail|outlook|live|icloud|proton(?:mail)?|aol|zoho)\./i
const AGGREGATOR = /(?:^|\.)(?:zomato|swiggy|dineout|eazydiner|tripadvisor|justdial|magicpin|facebook|instagram|linkedin|x|twitter|google|youtube|wikipedia|sulekha|venuelook|weddingwire|wedmegood|quora|reddit|yelp|opentable|sevenrooms|bookmyshow|district)\.[a-z.]+$/i
const HOME_LIKE = /\b(?:home|house|my place|our place|flat|apartment|terrace|office|online|zoom|google meet|teams|tbd|not decided)\b/i
const letters = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
const hostOf = (url: string) => { try { const u = new URL(url); return u.protocol === 'https:' || u.protocol === 'http:' ? u.hostname.toLowerCase().replace(/^www\./, '') : '' } catch { return '' } }
/** The name part of a host: "toit" for toit.in, "theblackrabbit" for theblackrabbit.co.in. */
const brandOf = (host: string) => { const p = host.split('.'); const tld2 = p.length >= 3 && /^(?:co|com|net|org)$/.test(p[p.length - 2]); return p[p.length - (tld2 ? 3 : 2)] || '' }
const sameSite = (a: string, b: string) => a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`)

/** True when the brand of a domain is the venue's own name ("toit" in "Toit Indiranagar"). Short brands must be a whole
 *  word of the venue name; longer ones may be the name written together. */
export function domainIsVenue(host: string, venue: string): boolean {
  const brand = letters(brandOf(host))
  if (brand.length < 3 || AGGREGATOR.test(host)) return false
  const words = venue.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  if (words.includes(brand)) return true
  return brand.length >= 6 && letters(venue).startsWith(brand)
}

/** Whether this event is worth a venue enquiry: a named venue (not a home or a call), a future date and a group. */
export function needsVenueEnquiry(e: EventRow, now = Date.now()): boolean {
  return e.status !== 'cancelled' && Boolean(e.venue_name) && !HOME_LIKE.test(String(e.venue_name)) && Boolean(e.starts_at) && Date.parse(e.starts_at as string) > now
    && Number.isInteger(e.capacity) && (e.capacity as number) >= 8
}

/** Picks the venue's own contact out of search results. Pure. */
export function pickVenueContact(hits: SearchHit[], venue: string): VenueContact {
  const own = hits.filter(h => domainIsVenue(hostOf(h.url), venue))
  const found: { email: string; sourceUrl: string; score: number }[] = []
  for (const h of own) {
    const host = hostOf(h.url), text = `${h.title} ${h.snippet}`
    for (const m of text.matchAll(/[a-z0-9][a-z0-9._%+-]{0,63}@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi)) {
      const email = m[0].toLowerCase().replace(/[.,;:]+$/, ''), domain = email.split('@')[1]
      if (FREE_MAIL.test(email) || !sameSite(domain, host) || /^(?:noreply|no-reply|donotreply|careers|jobs|hr|press|privacy|legal|abuse)@/.test(email)) continue
      const near = text.slice(Math.max(0, (m.index || 0) - 160), (m.index || 0) + 160)
      found.push({ email, sourceUrl: h.url, score: (/\b(?:private|group|event|events|party|parties|corporate|booking|bookings|reserv\w*|enquir\w*|inquir\w*)\b/i.test(near) ? 2 : 0) + (/^(?:events?|bookings?|reservations?|parties|enquir\w*|hello|info|contact)\b/.test(email) ? 1 : 0) })
    }
  }
  if (found.length) {
    found.sort((a, b) => b.score - a.score)
    // Two different addresses that look equally right: not certain which one takes bookings, so no draft.
    if (found[1] && found[1].email !== found[0].email && found[1].score === found[0].score) return { kind: 'page', sourceUrl: found[0].sourceUrl }
    return { kind: 'email', email: found[0].email, sourceUrl: found[0].sourceUrl }
  }
  return own.length ? { kind: 'page', sourceUrl: own[0].url } : { kind: 'none' }
}

export async function findVenueContact(venue: string, search: Search, timeoutMs = 6000): Promise<VenueContact> {
  const name = venue.replace(/[^\p{L}\p{N} &'.-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
  if (name.length < 3) return { kind: 'none' }
  const runs = await Promise.allSettled([`${name} private events group booking enquiry email`, `${name} official website contact email`].map(q => search(q, { timeoutMs })))
  const hits = runs.flatMap(r => r.status === 'fulfilled' && Array.isArray(r.value) ? r.value : []).filter(h => h && typeof h.url === 'string').slice(0, 30)
    .map(h => ({ title: String(h.title || '').slice(0, 300), snippet: String(h.snippet || '').slice(0, 1500), url: h.url }))
  return pickVenueContact(hits, name)
}

const KIND_WORDS: Record<string, string> = { birthday: 'a birthday celebration', anniversary: 'an anniversary celebration', dinner: 'a group dinner', lunch: 'a group lunch', party: 'a party', wedding: 'a wedding function', farewell: 'a farewell', reunion: 'a reunion' }
const oneLine = (v: unknown, n: number) => String(v ?? '').replace(/[\r\n\u0000-\u001f]+/g, ' ').trim().slice(0, n)

/** The enquiry, written only from what the organizer told Gogo. No guest names, no phone numbers. */
export function enquiryDraft(e: EventRow, to: string, organizer: string) {
  const tz = e.timezone || 'Asia/Kolkata', at = new Date(e.starts_at as string)
  const day = new Intl.DateTimeFormat('en-IN', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' }).format(at)
  const time = new Intl.DateTimeFormat('en-IN', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }).format(at).replace(':00', '').replace(/\s?(am|pm)/i, (_m, p) => ` ${p.toLowerCase()}`)
  const venue = oneLine(e.venue_name, 120), what = KIND_WORDS[String(e.kind)] || 'a get-together', name = oneLine(organizer, 80) || 'The organizer'
  return {
    newMessage: true, threadId: '', sourceMessageId: '', inReplyTo: null, to,
    subject: `Group booking enquiry: ${e.capacity} guests, ${day}, ${time}`,
    body: [`Hi team,`, `I'd like to host ${what} for ${e.capacity} people at ${venue} on ${day} at ${time}.`,
      `Can you accommodate us, ideally in a reserved section? Please share your group menu or package prices, any minimum spend or deposit, and your cancellation terms. Can we bring a cake and a few decorations?`,
      `Thanks,\n${name}`].join('\n\n'),
  }
}

export type VenueStep = { text: string; draft: ReturnType<typeof enquiryDraft> | null; found: VenueContact['kind'] }
/** The text added under the event reply. Says exactly where the address came from and that nothing was sent. */
export function venueStepText(e: EventRow, contact: VenueContact, organizer: string): VenueStep {
  const venue = oneLine(e.venue_name, 120)
  if (contact.kind === 'email') {
    const draft = enquiryDraft(e, contact.email, organizer)
    return { found: 'email', draft, text: [`Next step: booking ${venue} for ${e.capacity}. Their own site lists ${contact.email} for enquiries (${contact.sourceUrl}). Here is a draft:`,
      `To: ${draft.to}\nSubject: ${draft.subject}\n\n${draft.body}`,
      `Nothing has been sent. Say *send it* and I'll show it once more for your approval before it goes, or tell me what to change.`].join('\n\n') }
  }
  if (contact.kind === 'page') return { found: 'page', draft: null, text: `Next step: booking ${venue} for ${e.capacity}. I could not confirm a booking email from their own site, so I have not drafted anything. Their page: ${contact.sourceUrl}\nSend me the right address and I'll draft the enquiry.` }
  return { found: 'none', draft: null, text: `Next step: booking ${venue} for ${e.capacity}. I could not find their official site, so I have not drafted anything. Send me their email address and I'll draft the enquiry.` }
}
