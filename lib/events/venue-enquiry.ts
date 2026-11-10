// AskGogo Events: the step after the plan. Once an event has a date, a venue and a headcount, Gogo looks up how that
// venue takes group bookings and drafts the enquiry email for the organizer. Nothing is sent from here: the draft is
// handed to the existing Gmail path, where "send it" raises an approval card and only an approved card sends.
// A contact is used only when it is verifiably the venue's own: the address must appear word for word in a search
// result, on the venue's own domain, and that domain must carry the venue's name. Anything less gets no draft, only
// the official page to check. Nothing is guessed.
import type { EventRow } from './core'

export type SearchHit = { title: string; snippet: string; url: string; /** Read from the page itself, not a search excerpt. */ fromPage?: boolean }
export type Search = (query: string, opts?: { timeoutMs?: number }) => Promise<SearchHit[]>
export type VenueContact =
  | { kind: 'email'; email: string; sourceUrl: string }
  | { kind: 'page'; sourceUrl: string }
  | { kind: 'none' }
  | { kind: 'unavailable' }

const FREE_MAIL = /@(?:gmail|googlemail|yahoo|ymail|rediffmail|hotmail|outlook|live|icloud|proton(?:mail)?|aol|zoho)\./i
const AGGREGATOR = /(?:^|\.)(?:zomato|swiggy|dineout|eazydiner|tripadvisor|justdial|magicpin|facebook|instagram|linkedin|x|twitter|google|youtube|wikipedia|sulekha|venuelook|weddingwire|wedmegood|quora|reddit|yelp|opentable|sevenrooms|bookmyshow|district)\.[a-z.]+$/i
// A home, a call, or a place named after a person ("Nithin's farmhouse"): never looked up, so no person's name goes to search.
// Shared hosting: anyone can have a name here, so a site on one is never taken as a venue's own.
const HOSTED = /(?:^|\.)(?:vercel\.app|netlify\.app|github\.io|gitlab\.io|web\.app|firebaseapp\.com|pages\.dev|workers\.dev|herokuapp\.com|onrender\.com|wixsite\.com|wix\.com|business\.site|sites\.google\.com|blogspot\.com|wordpress\.com|weebly\.com|godaddysites\.com|square\.site|squarespace\.com|myshopify\.com|webflow\.io|carrd\.co|linktr\.ee|notion\.site|glitch\.me|replit\.app|surge\.sh|000webhostapp\.com|ghost\.io|railway\.app|fly\.dev|medium\.com|canva\.site|framer\.app|framer\.website|super\.site|render\.com|bubble\.io|bubbleapps\.io|tumblr\.com|substack\.com|dotpe\.in|petpooja\.com|zohosites\.com|zohosites\.in|site123\.me|strikingly\.com|jimdosite\.com|webnode\.page|mystrikingly\.com|azurewebsites\.net|cloudfront\.net|amazonaws\.com|appspot\.com|run\.app|ngrok\.io|ngrok-free\.app)$/i
const HOME_LIKE = /\b(?:home|house|my place|our place|flat|apartment|terrace|office|online|zoom|google meet|teams|tbd|not decided|farm\s?house|villa|residence|club\s?house|bungalow)\b|\p{L}['’‘ʼ′`´]s\b/iu
// Words that are not a venue's name by themselves: a domain made of one of these proves nothing.
const GENERIC = new Set(['the', 'and', 'com', 'net', 'org', 'www', 'company', 'brewing', 'beach', 'deli', 'smoke', 'bakery', 'bakehouse', 'tavern', 'taproom', 'craft', 'craftworks', 'works', 'collective', 'project', 'co', 'pvt', 'ltd', 'llp', 'inc', 'group', 'hospitality', 'foods', 'pizzeria', 'pizza', 'burger', 'tea', 'wine', 'beer', 'spice', 'village', 'farm', 'farms', 'yard', 'deck', 'sky', 'sun', 'moon', 'star', 'social', 'table', 'cafe', 'coffee', 'bar', 'pub', 'hotel', 'kitchen', 'house', 'club', 'bistro', 'restaurant', 'restaurants', 'lounge', 'grill', 'garden', 'gardens', 'brewery', 'brewing', 'brewpub', 'diner', 'dining', 'food', 'foods', 'eat', 'eats', 'events', 'event', 'party', 'banquet', 'banquets', 'hall', 'resort', 'resorts', 'palace', 'grand', 'royal', 'park', 'plaza', 'cinema', 'studio', 'room', 'rooms', 'terrace', 'rooftop', 'india', 'bangalore', 'bengaluru', 'mumbai', 'delhi', 'chennai', 'hyderabad', 'pune', 'goa', 'city', 'central', 'express', 'world', 'place', 'spot', 'point', 'corner', 'street', 'road', 'new', 'old', 'big', 'little', 'blue', 'green', 'red', 'black', 'white', 'golden', 'one', 'first'])
const letters = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
const hostOf = (url: string) => { try { const u = new URL(url); return u.protocol === 'https:' || u.protocol === 'http:' ? u.hostname.toLowerCase().replace(/^www\./, '') : '' } catch { return '' } }
const TWO_LEVEL = /^(?:co|com|net|org|gov|ac|edu)\.(?:in|uk|ae|au|nz|sg|za|jp|id|th|my|lk|np|bd|pk|ph|hk|kr|br|mx|tr|il|ke|ng|sa|qa|om|bh|kw)$/
/** The registrable domain of a host: toit.in for www.toit.in, theblackrabbit.co.in for events.theblackrabbit.co.in.
 *  Only real two-level endings count as one (co.in), so toit.com.xyz is com.xyz and toit.co.com is co.com: not Toit's. */
export function registrable(host: string): string { const p = host.split('.'); return p.slice(-(p.length >= 3 && TWO_LEVEL.test(p.slice(-2).join('.')) ? 3 : 2)).join('.') }
/** The name part of a host: "toit" for toit.in, "theblackrabbit" for theblackrabbit.co.in. */
const brandOf = (host: string) => registrable(host).split('.')[0] || ''
/** The address is on the site's own registrable domain, or a subdomain of it. */
const sameSite = (emailDomain: string, host: string) => { const reg = registrable(host); return emailDomain === reg || emailDomain.endsWith(`.${reg}`) }
const wordsOf = (venue: string) => venue.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
/** How a domain's name relates to the venue's name. 'full': the name written together from its first word on
 *  (theblackrabbit for "The Black Rabbit", toit for "Toit"). 'word': one distinctive word of a longer name (toit for
 *  "Toit Indiranagar"), which needs the page itself to mention another word of the name before it counts.
 *  Generic words (social, table, cafe…), listing sites and non-ASCII hosts never count. */
export function domainMatch(host: string, venue: string): 'full' | 'word' | null {
  if (!/^[a-z0-9.-]+$/.test(host) || host.includes('xn--') || AGGREGATOR.test(host) || HOSTED.test(host)) return null
  const brand = brandOf(host) // hyphens are kept: to-it.in is not toit
  if (brand.length < 3 || GENERIC.has(brand)) return null
  const words = wordsOf(venue), lead = words[0] === 'the' ? words.slice(1) : words
  for (const list of [words, lead]) for (let k = list.length; k >= 1; k--) if (list.slice(0, k).join('') === brand) return k === list.length ? 'full' : k >= 2 ? 'full' : 'word'
  return words.includes(brand) ? 'word' : null
}
export const domainIsVenue = (host: string, venue: string) => domainMatch(host, venue) !== null

/** What an enquiry was written for: the venue, the time and the number. A draft is good only while this is unchanged. */
export const enquiryKey = (e: EventRow) => [String(e.venue_name || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 120), e.starts_at, e.capacity].join('|')
/** Whether a waiting enquiry draft still matches its event, checked at the moment of "send it": the event must still
 *  need an enquiry and have the same venue, time and number the draft was written for. */
export function enquiryDraftCurrent(draft: { enquiryKey?: unknown } | null | undefined, e: EventRow | null, now = Date.now()): boolean {
  return Boolean(draft && e && needsVenueEnquiry(e, now) && draft.enquiryKey === enquiryKey(e))
}

/** Whether this event is worth a venue enquiry: a named venue (not a home or a call), a future date and a group. */
export function needsVenueEnquiry(e: EventRow, now = Date.now()): boolean {
  return e.status !== 'cancelled' && Boolean(e.venue_name) && !HOME_LIKE.test(String(e.venue_name)) && Boolean(e.starts_at) && Date.parse(e.starts_at as string) > now
    && Number.isInteger(e.capacity) && (e.capacity as number) >= 8
}

/** https, host and a plain path only: what is safe to show. No query string; an unusual path is dropped, so a link can
 *  never carry words written as an instruction. */
export function shownUrl(url: string): string {
  try { const u = new URL(url); return u.protocol === 'https:' ? `https://${u.hostname}${/^\/[a-z0-9]{1,16}\/?$/i.test(u.pathname) ? u.pathname : '/'}` : '' } catch { return '' }
}
const HOSPITALITY = /\b(?:restaurants?|brewpub|brewery|microbrewery|taproom|bar|pub|cafe|café|bistro|kitchen|dining|diner|menu|lounge|hotel|resort|banquets?|eatery|grill|cuisine|cocktails?|reservations?|table bookings?)\b/i
const PLACE = /\b(?:bengaluru|bangalore|mumbai|delhi|gurgaon|gurugram|noida|chennai|hyderabad|kolkata|pune|kochi|ahmedabad|jaipur|lucknow|chandigarh|goa|mysuru|mysore|mangaluru|coimbatore|indore|india|dubai|abu dhabi|sharjah|uae|indiranagar|koramangala|whitefield|jayanagar|rajajinagar|malleshwaram|hsr layout|jp nagar|mg road|bandra|andheri|powai|connaught place|hauz khas|cyber hub|jubilee hills|banjara hills)\b/i
const OTHER_PURPOSE = /\b(?:franchis\w*|press|media\s+(?:enquir\w*|inquir\w*|relations|contact|queries)|careers?|jobs?|cv|resumes?|hiring|recruit\w*|investors?|vendors?|suppliers?|wholesale|distribut\w*|feedback|complaints?|grievances?|accounts?|billing|invoices?)\b/i
/** An email address, not followed by more name or domain characters (bookings@toit.in_evil.com and
 *  bookings@toit.in.evil.com are not bookings@toit.in), with at most five domain labels. */
const EMAIL_RE = /[a-z0-9][a-z0-9._%+-]{0,63}@[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63}){1,4}(?![\w@-]|\.[\w-])/gi
const BOOKING_WORDS = /\b(?:private|group|event|events|party|parties|corporate|booking|bookings|reserv\w*|enquir\w*|inquir\w*)\b/i
const NOT_BOOKING = /^(?:noreply|no-reply|donotreply|careers?|jobs|hr|press|media|privacy|legal|abuse|accounts?|billing|finance|franchise|marketing|vendors?|suppliers?|investors?|webmaster|admin|support)@/

/** The sites among the results that pass as the venue's own, each with its results. */
export function venueSites(hits: SearchHit[], fullName: string): [string, SearchHit[]][] {
  // The name without its locality ("Toit" for "Toit Indiranagar"): a locality is where the venue is, not what it is
  // called, so it neither makes a one-word name longer nor counts as a second word of the name.
  const core = wordsOf(fullName).filter(w => !PLACE.test(w))
  const venue = core.length ? core.join(' ') : fullName
  const others = wordsOf(venue).filter(w => w.length >= 4 && !GENERIC.has(w))
  const byHost = new Map<string, SearchHit[]>()
  for (const h of hits) { const host = hostOf(h.url); if (host && h.url.startsWith('https://') && domainMatch(host, venue)) byHost.set(host, [...(byHost.get(host) || []), h]) }
  // A matching name is not enough (olive.com is not Olive Beach; windmills.com may be anyone). The pages themselves
  // must read like a place that serves food or drink, and must also carry either another distinctive word of the
  // venue's name or a city, so a same-named business elsewhere in the world, or in another trade, is not taken.
  const sites = [...byHost.entries()].filter(([host, list]) => {
    const brand = brandOf(host), text = list.map(h => `${h.title} ${h.snippet}`).join(' ').toLowerCase(), titles = list.map(h => h.title).join(' ')
    if (!HOSPITALITY.test(text)) return false
    const nameWord = others.some(w => w !== brand && new RegExp(`\\b${w}\\b`).test(text))
    // One word of a longer name (toit for "Toit Indiranagar") needs another word of that name on the page. The whole
    // name (toit for "Toit") needs that, or a known city in the page's own title.
    return domainMatch(host, venue) === 'word' ? nameWord : nameWord || PLACE.test(titles)
  })
  return sites
}

/** Picks the venue's own contact out of search results. Pure. An address is used only when: it is on a site whose
 *  name is the venue's (and, for a one-word match, whose results also mention another word of the venue's name); only
 *  one such site turned up; the address is on that site's own domain; the words around it, or its own name, are about
 *  bookings or events; and no other address is as likely. Anything less: the official page, and no draft. */
export function pickVenueContact(hits: SearchHit[], fullName: string): VenueContact {
  const sites = venueSites(hits, fullName)
  if (!sites.length) return { kind: 'none' }
  const brands = new Set(sites.map(([host]) => registrable(host)))
  const page = shownUrl(sites[0][1][0].url)
  // Two different sites both look like the venue's (toit.in and toit.com): not certain which is theirs.
  if (brands.size > 1) return page ? { kind: 'page', sourceUrl: page } : { kind: 'none' }
  const found: { email: string; sourceUrl: string; score: number }[] = []
  for (const [host, list] of sites) for (const h of list) {
    const text = `${h.title} ${h.snippet}`
    for (const m of text.matchAll(EMAIL_RE)) {
      const email = m[0].toLowerCase().replace(/[.,;:]+$/, ''), domain = email.split('@')[1]
      if (FREE_MAIL.test(email) || !sameSite(domain, host) || NOT_BOOKING.test(email)) continue
      const at = m.index || 0, end = at + m[0].length
      // The words around this address, without any other address (another address's name is not this one's context).
      const near = `${text.slice(Math.max(0, at - 160), at)} ${text.slice(end, end + 160)}`.replace(EMAIL_RE, ' ')
      if (email.length > 80) continue
      if (/\b(?:do\s?n[o']t|no longer|not in use|not for|old|former|discontinued|instead of)\b/i.test(near)) continue
      // A label for another purpose right beside the address, before it ("Press and media: …") or after it ("… for
      // franchise enquiries"), up to the next address. Only the nearest words count: on a real page, other departments'
      // addresses sit a line away from the right one.
      const before = text.slice(Math.max(0, at - 60), at), afterRaw = text.slice(end, end + 60), nextAt = afterRaw.search(EMAIL_RE)
      // Words that lead into the NEXT address ("… Press: press@…") are that address's label, not this one's.
      const after = nextAt >= 0 ? afterRaw.slice(0, nextAt).replace(/[^.|,;)]*:\s*$/, '') : afterRaw
      if (OTHER_PURPOSE.test(before.replace(EMAIL_RE, ' ').split(/[.!?|]\s/).pop() || '') || OTHER_PURPOSE.test(after.split(/[.!?|]\s/)[0])) continue
      const score = (BOOKING_WORDS.test(near) ? 2 : 0) + (/^(?:events?|bookings?|reservations?|parties|enquir\w*|hello|info|contact)\b/.test(email) ? 1 : 0)
      // From a search excerpt, an address named for bookings is enough. From a whole page, the words beside it must be
      // about bookings or events: a page lists many addresses, and a general one (info@, hello@) proves nothing alone.
      if (score >= (h.fromPage ? 2 : 1)) found.push({ email, sourceUrl: shownUrl(h.url), score })
    }
  }
  found.sort((a, b) => b.score - a.score)
  const best = found[0]
  if (!best || !best.sourceUrl || found.some(f => f.email !== best.email && f.score === best.score)) return page ? { kind: 'page', sourceUrl: page } : { kind: 'none' }
  return { kind: 'email', email: best.email, sourceUrl: best.sourceUrl }
}

export type PageReader = (url: string, sameSite: (host: string) => boolean) => Promise<{ url: string; title: string; text: string } | null>
/** Hits made from a page that was read: one per address on it, each with the words around that address, so the same
 *  rules apply as for a search excerpt (the address must sit beside words about bookings). */
export function hitsFromPage(page: { url: string; title: string; text: string }, baseTitle = ''): SearchHit[] {
  // Only addresses written as addresses are read. "name (at) venue (dot) in" spellings are not converted: a sentence
  // can contain those words without being an address.
  const out: SearchHit[] = []
  for (const m of page.text.matchAll(EMAIL_RE)) {
    if (out.length >= 8) break
    const at = m.index || 0
    out.push({ title: `${page.title} ${baseTitle}`.trim().slice(0, 300), snippet: page.text.slice(Math.max(0, at - 200), at + m[0].length + 200), url: page.url, fromPage: true })
  }
  return out
}

/** Looks up how a venue takes bookings. First from search excerpts; when those find the venue's own site but no
 *  address on it, up to two of that site's own pages are read (the pages search returned, FAQ and contact first). */
/** What the lookup learned about the venue's own site when it found the site but no address on it: the site, its
 *  pages that search returned (contact, events and FAQ first) and what search said about them. For a deeper read. */
export type VenueLookupDetail = { site?: string; urls?: string[]; hits?: SearchHit[] }
export async function findVenueContact(venue: string, search: Search, timeoutMs = 6000, readPage?: PageReader, detail?: VenueLookupDetail): Promise<VenueContact> {
  const name = venue.replace(/[^\p{L}\p{N} &'.-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
  if (name.length < 3) return { kind: 'none' }
  const runs = await Promise.allSettled([`${name} private events group booking enquiry email`, `${name} official website contact email`].map(q => search(q, { timeoutMs })))
  // Every search failed: that is "could not look", not "they have no site".
  if (runs.every(r => r.status === 'rejected')) return { kind: 'unavailable' }
  const hits = runs.flatMap(r => r.status === 'fulfilled' && Array.isArray(r.value) ? r.value : []).filter(h => h && typeof h.url === 'string').slice(0, 30)
    .map(h => ({ title: String(h.title || '').slice(0, 300), snippet: String(h.snippet || '').slice(0, 1500), url: h.url }))
  const first = pickVenueContact(hits, name)
  if (first.kind !== 'page') return first
  const sites = venueSites(hits, name)
  if (sites.length !== 1) return first
  const [host, list] = sites[0], reg = registrable(host)
  const rank = (u: string) => (/faq|contact|event|private|book|reserv|party|group/i.test(u) ? 0 : 1)
  const urls = [...new Set(list.map(h => h.url))].sort((a, b) => rank(a) - rank(b)).slice(0, 2)
  const describe = () => { if (detail) { detail.site = reg; detail.urls = urls; detail.hits = list.filter((h, k) => list.findIndex(o => o.url === h.url && o.snippet === h.snippet) === k).slice(0, 6).map(h => ({ title: h.title.slice(0, 200), snippet: h.snippet.slice(0, 600), url: h.url })) } }
  if (!readPage) { describe(); return first }
  // Bounded here as well: a page that will not finish must not lose the answer search already gave.
  const bounded = (u: string) => { let t: ReturnType<typeof setTimeout> | undefined; return Promise.race([readPage(u, h => registrable(h) === reg).catch(() => null), new Promise<null>(r => { t = setTimeout(() => r(null), 4000) })]).finally(() => { if (t) clearTimeout(t) }) }
  const pages = await Promise.all(urls.map(bounded))
  const more = pages.flatMap((p, k) => (p && registrable(hostOf(p.url)) === reg ? hitsFromPage(p, list.find(h => h.url === urls[k])?.title || '') : []))
  const second = more.length ? pickVenueContact([...hits, ...more], name) : first
  if (second.kind === 'email') return second
  describe()
  return first
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
    return { found: 'email', draft, text: [`Next step: booking ${venue} for ${e.capacity}. I found ${contact.email} for enquiries on ${contact.sourceUrl}, which looks like their own site. Please check the address before you send. Here is a draft:`,
      `To: ${draft.to}\nSubject: ${draft.subject}\n\n${draft.body}`,
      `Nothing has been sent. Say *send it* and I'll show it once more for your approval before it goes, or tell me what to change.`].join('\n\n') }
  }
  if (contact.kind === 'page') return { found: 'page', draft: null, text: `Next step: booking ${venue} for ${e.capacity}. I could not confirm a booking email from their own site, so I have not drafted anything. Their page: ${contact.sourceUrl}\nSend me the right address and I'll draft the enquiry.` }
  if (contact.kind === 'unavailable') return { found: 'unavailable', draft: null, text: `Next step: booking ${venue} for ${e.capacity}. I could not look up how they take group bookings just now, so I have not drafted anything. Send me their email address and I'll draft the enquiry.` }
  return { found: 'none', draft: null, text: `Next step: booking ${venue} for ${e.capacity}. I could not find their official site, so I have not drafted anything. Send me their email address and I'll draft the enquiry.` }
}

/** Said in place of "could not confirm" when the venue's own site is being opened in the cloud browser. */
export function venueBrowsingText(e: EventRow): string {
  return `Next step: booking ${oneLine(e.venue_name, 120)} for ${e.capacity}. Their site does not show a booking email to a quick read, so I'm opening it in a browser now. I'll send what I find here in a minute or two. Nothing will be sent to them.`
}
