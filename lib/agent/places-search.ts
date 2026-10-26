import { redactSecretShapedText } from '../bot/memory-redaction'

// Local places (24 Oct live): "Suggest 3 South Indian restaurants in Rajajinagar" named ITC Windsor's Dakshin and a
// Crescent Road hotel, neither in Rajajinagar, from a web search. Place asks now use Google local results (via
// Serper's places search): real names, the area they are actually in, rating and a Maps link. Read-only.

export type PlaceAsk = { query: string; area: string; count: number }

const KIND = /\b(restaurants?|caf(?:e|é)s?|coffee (?:shops?|places?)|bars?|pubs?|breweries|brewery|bakery|bakeries|places? to eat|dhabas?|darshinis?|mess(?:es)?|biryani|dosa|pizza|burgers?|ice ?cream|desserts?|sweets? shops?|gyms?|salons?|spas?|parks?|hospitals?|clinics?|pharmac(?:y|ies)|chemists?|hotels?|stays?|co-?working spaces?|malls?|supermarkets?)\b/i
const LEAD = /^(?:please\s+)?(?:can you\s+|could you\s+)?(?:suggest|recommend|find|show(?: me)?|list|give me|what are|which are|any|best|top|good|nice|where can i (?:get|find|eat|have))\b/i
const COUNT_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 }

export function placeAsk(text: string): PlaceAsk | null {
  const t = String(text || '').trim().replace(/[?.!]+$/, '')
  if (!t || t.length > 200) return null
  if (!LEAD.test(t) || !KIND.test(t)) return null
  // A negated action is a safety constraint, not an instruction to book.
  // Keep affirmative booking/ordering requests on their separate approval-gated routes.
  // Bound negation at punctuation, contrast or another action. Explicitly
  // coordinated negatives stay negative: "do not book or reserve a table".
  const action = '(?:book|reserve|order|buy|purchase)'
  const object = `(?:(?!\\b(?:${action}|call|deliver|but|then|however|instead|rather|and|or)\\b)[^.!?;,\\n])*`
  const negated = new RegExp(`\\b(?:do\\s+not|don['’]?t|never|without)\\s+${action}\\b${object}(?:\\b(?:and|or)\\s+${action}\\b${object})*`, 'gi')
  const affirmative = t.replace(negated, (match, offset: number) =>
    /^\s*(?:instead|rather)\b/i.test(t.slice(offset + match.length)) ? match : '')
  if (/\b(?:book|reserve|order|buy|purchase|deliver|table for|call|reviews? of|menu of|timings? of)\b/i.test(affirmative)) return null
  // Search the place, not its party size, dinner time or safety/availability instructions.
  const primary = t.split(/(?:[!?;\n]|\.(?=\s+(?:show|research|read|do|don['’]?t|only|without)\b))/i)[0]
    .split(/\b(?:do\s+not|don['’]?t|never|without)\s+(?:book|reserve|order|buy|purchase)\b/i)[0]
    .replace(/[\s,]+$/, '').trim()
  if (!KIND.test(primary)) return null
  const area = primary.match(/\b(?:in|near|around|at|close to)\s+([A-Za-z][A-Za-z .'-]{2,40}?)(?=,|\s+(?:for|with|that|which|open|under|below|within)\b|$)/i)?.[1]?.trim()
  if (!area || /^(?:me|here|my (?:area|place|home|office))$/i.test(area)) return null
  // Only an explicit requested number of venues sets result count; "for 2 people" is party size.
  const countPrefix = /^(?:(?:me|the|best|top|good|nice)\s+)*(\d{1,2}|one|two|three|four|five|six|seven|eight)\s+/i
  const explicitCount = primary.replace(LEAD, '').trimStart().match(countPrefix)?.[1]?.toLowerCase()
  const count = Math.max(1, Math.min(8, explicitCount ? (COUNT_WORDS[explicitCount] || Number(explicitCount)) : 5))
  const discovery = primary
    .replace(/\bfor\s+\d{1,2}\s+(?:people|persons?|guests?|pax)\b/gi, ' ')
    .replace(/\b(?:today|tonight|tomorrow)\b/gi, ' ')
    .replace(/\b(?:at\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/gi, ' ')
    .replace(LEAD, '').trimStart()
    .replace(countPrefix, '')
    .replace(/[\s,]+$/, '').replace(/\s+/g, ' ').trim()
  if (!discovery) return null
  return { query: /\b(?:bengaluru|bangalore|mumbai|delhi|chennai|hyderabad|pune|kolkata|dubai|india)\b/i.test(discovery) ? discovery : `${discovery}, Bengaluru`, area, count }
}

export type Place = { title: string; address: string; rating?: number; ratingCount?: number; category?: string; phone?: string; website?: string; cid?: string }

// A source identifier must survive JSON transport losslessly. A rounded number
// cannot identify the provider's original listing; arbitrary URLs are not a fallback.
function canonicalPlaceCid(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  if (typeof value === 'number' && !Number.isSafeInteger(value)) return undefined
  const cid = String(value)
  if (!/^[1-9]\d{0,19}$/.test(cid) || BigInt(cid) > BigInt('18446744073709551615')) return undefined
  return cid
}

function privatePlaceQuery(query: string) {
  // The shared text filter can mistake a following "in <city>" for an expiry
  // sentence. Keep an explicit short labelled identifier out of public search.
  return redactSecretShapedText(query) !== query
    || /\b(?:passport|pin)\b\s*(?:(?:number|no\.?|is)\s*)?(?:[:=-]\s*)?[a-z0-9]*\d[a-z0-9]*\b/i.test(query)
}

export async function searchPlaces(query: string, fetchImpl: typeof fetch = fetch): Promise<Place[]> {
  if (privatePlaceQuery(query)) return []
  const key = process.env.SERPER_API_KEY
  if (!key) return []
  const res = await fetchImpl('https://google.serper.dev/places', {
    method: 'POST', headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: query, gl: 'in', hl: 'en' }), signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error(`serper_places_${res.status}`)
  const data: any = await res.json()
  return (data?.places || []).map((p: any): Place => ({
    title: String(p.title || '').trim(), address: String(p.address || '').trim(), rating: Number(p.rating) || undefined,
    ratingCount: Number(p.ratingCount) || undefined, category: p.category ? String(p.category) : undefined,
    phone: p.phoneNumber ? String(p.phoneNumber) : undefined, website: p.website ? String(p.website) : undefined, cid: canonicalPlaceCid(p.cid),
  })).filter((p: Place) => p.title)
}

function inArea(p: Place, area: string) {
  const a = area.toLowerCase().replace(/\s+/g, ' ')
  const words = a.split(' ').filter(w => w.length > 3)
  const hay = `${p.address} ${p.title}`.toLowerCase().replace(/rajaji nagar/g, 'rajajinagar')
  return hay.includes(a) || (words.length > 0 && words.every(w => hay.includes(w)))
}

const GENERIC = new Set(['restaurant', 'restaurants', 'place', 'places', 'good', 'best', 'top', 'nice', 'near', 'around', 'bengaluru', 'bangalore', 'some', 'with', 'that', 'open', 'cafe', 'cafes', 'food'])
/** "South Indian restaurants" must not return a North Indian dhaba first: match the asked kind against category/title. */
function kindMatch(p: Place, ask: PlaceAsk) {
  const words = ask.query.toLowerCase().replace(/,.*$/, '').replace(new RegExp(`\\b(?:in|near|around|at)\\s+${ask.area.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), '')
    .split(/[^a-z]+/).filter(w => w.length > 2 && !GENERIC.has(w))
  if (!words.length) return true
  const hay = `${p.category || ''} ${p.title}`.toLowerCase()
  const phrase = words.join(' ')
  return hay.includes(phrase) || words.every(w => hay.includes(w))
}

export function formatPlaces(ask: PlaceAsk, places: Place[]) {
  const linked = places.flatMap(p => {
    const cid = canonicalPlaceCid(p.cid)
    return cid ? [{ ...p, cid }] : []
  })
  const omitted = places.length - linked.length
  if (places.length && !linked.length) return 'No valid Maps source link was supplied for these directory listings. I will not recommend unlinked listings. No booking was made.'
  // Prefer places whose address is really in the area asked for, then better-rated, well-reviewed ones.
  const kindOk = linked.filter(p => kindMatch(p, ask))
  const pool = kindOk.length >= Math.min(ask.count, 2) ? kindOk : linked
  const ranked = [...pool].sort((x, y) => Number(inArea(y, ask.area)) - Number(inArea(x, ask.area)) || (y.rating || 0) * Math.log10((y.ratingCount || 1) + 9) - (x.rating || 0) * Math.log10((x.ratingCount || 1) + 9))
  const local = ranked.filter(p => inArea(p, ask.area))
  const shown = (local.length >= Math.min(ask.count, 2) ? local : ranked).slice(0, ask.count)
  if (!shown.length) return null
  const lines = shown.map((p, i) => {
    const rating = p.rating ? ` · ${p.rating}★${p.ratingCount ? ` (${new Intl.NumberFormat('en-IN').format(p.ratingCount)})` : ''}` : ''
    const maps = `\nhttps://maps.google.com/?cid=${encodeURIComponent(p.cid)}`
    return `${i + 1}. *${p.title}*${rating}\n${p.address}${p.category ? ` · ${p.category}` : ''}${maps}`
  })
  const note = local.length < Math.min(ask.count, 2) ? `\n\nFew results were inside ${ask.area}, so some are nearby.` : ''
  const sourceNote = omitted ? `\n\n${omitted} ${omitted === 1 ? 'listing' : 'listings'} omitted because no valid Maps source link was supplied.` : ''
  return `📍 ${shown.length === 1 ? 'A good pick' : `${shown.length} good picks`} in ${ask.area}\n\n${lines.join('\n\n')}${note}${sourceNote}\n\nAsk "which of these is open late?" or "book a table at <name>".`
}

export async function answerPlaces(text: string, fetchImpl: typeof fetch = fetch) {
  const ask = placeAsk(text)
  if (!ask) return null
  if (privatePlaceQuery(ask.query)) return 'I cannot send a request containing sensitive details to public search. Remove those details and ask again. No booking was made.'
  const places = await searchPlaces(ask.query, fetchImpl).catch((err: any) => { console.error('PLACES_SEARCH_FAILED:', String(err?.message || err).slice(0, 120)); return [] })
  if (!places.length) return `I couldn't verify local listings in ${ask.area} right now. I won't invent restaurants, source links or table availability. No booking was made.`
  const listing = formatPlaces(ask, places)
  if (!listing) return `I couldn't verify local listings in ${ask.area} right now. No booking was made.`
  const tableRequest = /\bfor\s+\d{1,2}\s+(?:people|persons?|guests?|pax)\b/i.test(text)
    && /\b(?:today|tomorrow|tonight|\d{1,2}(?::\d{2})?\s*(?:am|pm))\b/i.test(text)
  // Google Places verifies a listing, not a real-time reservation slot.
  if (tableRequest) return listing.replace(/\n\nAsk "which of these is open late\?" or "book a table at <name>"\.$/, '')
    + '\n\nThese are directory listings, not live table availability. Your requested party/date/time is unverified; no booking was made.'
  return listing
}
