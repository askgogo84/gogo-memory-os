import { redactSecretShapedText } from '../bot/memory-redaction'

// Local places (24 Oct live): "Suggest 3 South Indian restaurants in Rajajinagar" named ITC Windsor's Dakshin and a
// Crescent Road hotel, neither in Rajajinagar, from a web search. Place asks now use Google local results (via
// Serper's places search): real names, the area they are actually in, rating and a Maps link. Read-only.

export type PlaceAsk = { query: string; area: string; count: number }

const KIND = /\b(restaurants?|caf(?:e|é)s?|coffee (?:shops?|places?)|bars?|pubs?|breweries|brewery|bakery|bakeries|places? to eat|dhabas?|darshinis?|mess(?:es)?|biryani|dosa|pizza|burgers?|ice ?cream|desserts?|sweets? shops?|gyms?|salons?|spas?|parks?|hospitals?|clinics?|pharmac(?:y|ies)|chemists?|hotels?|stays?|co-?working spaces?|malls?|supermarkets?)\b/i
const LEAD = /^(?:please\s+)?(?:can you\s+|could you\s+)?(?:suggest|recommend|find|show(?: me)?|list|give me|what are|which are|any|best|top|good|nice|where can i (?:get|find|eat|have))\b/i
const COUNT_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 }

// 26 Oct live: "Find hotels near Mumbai Airport for 12–16 November for 2 adults" sent the dates and guests to the
// places search (zero results). A place search names the place; stay dates, nights, rooms and guests are not
// searchable listing attributes, and their rates/availability are never verified here.
// Whole month tokens only: 'Marwari', 'Marriott', 'Mayura', 'Junior', 'Decent' are not months (26 Oct review).
const MONTH = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?![a-z])'
const DAY = '\\d{1,2}(?:st|nd|rd|th)?'
const STAY_DATE = new RegExp(`\\b(?:from|on|for|between|check-?in|checking in|check-?out)?\\s*(?:${DAY}\\s*(?:[–—-]|to|and|until|till)\\s*${DAY}\\s+${MONTH}|${DAY}\\s+${MONTH}(?:\\s*(?:[–—-]|to|and|until|till)\\s*${DAY}(?:\\s+${MONTH})?)?|${MONTH}\\s+${DAY}(?:\\s*(?:[–—-]|to|and|until|till)\\s*${DAY})?)\\b`, 'gi')
const STAY_PARTY = /\b(?:for\s+)?\d{1,2}\s+(?:adults?|kids?|children|child|nights?|rooms?|guests?)\b/gi
function stripStayQualifiers(text: string) {
  return text.replace(STAY_DATE, ' ').replace(STAY_PARTY, ' ')
    .replace(/\b(?:check-?in|check-?out|checking in)\b/gi, ' ')
    .replace(/\s*,(?:\s*,)+/g, ',').replace(/(?:\s*,)+\s*$/, '').replace(/\s+(?:for|from|on|and)\s*$/i, '')
}
const OTHER_PLACE = /\b(?:bengaluru|bangalore|mumbai|delhi|new delhi|chennai|hyderabad|pune|kolkata|dubai|india|goa|jaipur|udaipur|jodhpur|kochi|cochin|mysuru|mysore|ooty|coorg|madikeri|chikmagalur|hampi|manali|shimla|agra|varanasi|rishikesh|kerala|munnar|alleppey|pondicherry|puducherry|gurgaon|gurugram|noida|ahmedabad|chandigarh|lonavala|amritsar|darjeeling|gangtok|leh|srinagar|london|singapore|bangkok|bali)\b/i
const STAY_KIND = /\b(?:hotels?|stays?|resorts?|hostels?|lodges?|homestays?|guest ?houses?)\b/i
const FOOD_KIND = /\b(?:restaurants?|caf(?:e|é)s?|coffee|bars?|pubs?|brewer(?:y|ies)|bakery|bakeries|places? to eat|dhabas?|darshinis?|mess(?:es)?|biryani|dosa|pizza|burgers?|ice ?cream|desserts?|sweets?)\b/i

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
  const area = primary.match(/\b(?:in|near|around|at|close to)\s+([A-Za-z][A-Za-z .'-]{2,40}?)(?=,|\s+(?:for|with|that|which|open|under|below|within|from|on|between|check-?in|checking in)\b|$)/i)?.[1]?.trim()
  if (!area || /^(?:me|here|my (?:area|place|home|office))$/i.test(area)) return null
  // Only an explicit requested number of venues sets result count; "for 2 people" is party size.
  const countPrefix = /^(?:(?:me|the|best|top|good|nice)\s+)*(\d{1,2}|one|two|three|four|five|six|seven|eight)\s+/i
  const explicitCount = primary.replace(LEAD, '').trimStart().match(countPrefix)?.[1]?.toLowerCase()
  const count = Math.max(1, Math.min(8, explicitCount ? (COUNT_WORDS[explicitCount] || Number(explicitCount)) : 5))
  // Only a stay ask drops dates/nights/rooms/guests; a food ask keeps its words ("open on 25 Dec").
  const discovery = (STAY_KIND.test(primary) ? stripStayQualifiers(primary) : primary)
    .replace(/\bfor\s+\d{1,2}\s+(?:people|persons?|guests?|pax)\b/gi, ' ')
    .replace(/\b(?:today|tonight|tomorrow)\b/gi, ' ')
    .replace(/\b(?:at\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/gi, ' ')
    .replace(LEAD, '').trimStart()
    .replace(countPrefix, '')
    .replace(/[\s,]+$/, '').replace(/\s+/g, ' ').trim()
  if (!discovery) return null
  // A place outside Bengaluru keeps its own city (26 Oct review: "hotels in Goa" became "…, Bengaluru").
  return { query: OTHER_PLACE.test(discovery) ? discovery : `${discovery}, Bengaluru`, area, count }
}

export type Place = { title: string; address: string; rating?: number; ratingCount?: number; category?: string; phone?: string; website?: string; cid?: string; placeId?: string }

// A source identifier must survive JSON transport losslessly. A rounded number
// cannot identify the provider's original listing; arbitrary URLs are not a fallback.
function canonicalPlaceCid(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  if (typeof value === 'number' && !Number.isSafeInteger(value)) return undefined
  const cid = String(value)
  if (!/^[1-9]\d{0,19}$/.test(cid) || BigInt(cid) > BigInt('18446744073709551615')) return undefined
  return cid
}

// 26 Oct: production hotel results carried no usable cid, so every listing was omitted. A Google place id is an
// equally exact provider identifier and has an official Maps URL form. Arbitrary URLs are still never a fallback.
function canonicalPlaceId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const id = value.trim()
  return /^[A-Za-z0-9_-]{16,300}$/.test(id) ? id : undefined
}

export function placeSourceUrl(p: Pick<Place, 'cid' | 'placeId'>): string | undefined {
  const cid = canonicalPlaceCid(p.cid)
  if (cid) return `https://maps.google.com/?cid=${encodeURIComponent(cid)}`
  const id = canonicalPlaceId(p.placeId)
  return id ? `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(id)}` : undefined
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
  const raw: any[] = Array.isArray(data?.places) ? data.places : []
  const unlinked = raw.filter(p => !canonicalPlaceCid(p?.cid) && !canonicalPlaceId(p?.placeId))
  // Field names only (never values) so a provider shape change is diagnosable.
  if (unlinked.length) console.warn('PLACES_UNLINKED:', JSON.stringify({ count: unlinked.length, of: raw.length, fields: [...new Set(unlinked.flatMap(p => Object.keys(p || {})))].sort().slice(0, 30) }))
  return raw.map((p: any): Place => ({
    title: String(p.title || '').trim(), address: String(p.address || '').trim(), rating: Number(p.rating) || undefined,
    ratingCount: Number(p.ratingCount) || undefined, category: p.category ? String(p.category) : undefined,
    phone: p.phoneNumber ? String(p.phoneNumber) : undefined, website: p.website ? String(p.website) : undefined, cid: canonicalPlaceCid(p.cid), placeId: canonicalPlaceId(p.placeId),
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
    const source = placeSourceUrl(p)
    return source ? [{ ...p, source }] : []
  })
  const omitted = places.length - linked.length
  if (places.length && !linked.length) return `${omitted} ${omitted === 1 ? 'listing' : 'listings'} omitted because no valid Maps source link was supplied. I will not recommend unlinked listings. No booking was made.`
  // Prefer places whose address is really in the area asked for, then better-rated, well-reviewed ones.
  const kindOk = linked.filter(p => kindMatch(p, ask))
  const pool = kindOk.length >= Math.min(ask.count, 2) ? kindOk : linked
  const ranked = [...pool].sort((x, y) => Number(inArea(y, ask.area)) - Number(inArea(x, ask.area)) || (y.rating || 0) * Math.log10((y.ratingCount || 1) + 9) - (x.rating || 0) * Math.log10((x.ratingCount || 1) + 9))
  const local = ranked.filter(p => inArea(p, ask.area))
  const shown = (local.length >= Math.min(ask.count, 2) ? local : ranked).slice(0, ask.count)
  if (!shown.length) return null
  const lines = shown.map((p, i) => {
    const rating = p.rating ? ` · ${p.rating}★${p.ratingCount ? ` (${new Intl.NumberFormat('en-IN').format(p.ratingCount)})` : ''}` : ''
    const maps = `\n${p.source}`
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
  const stay = STAY_KIND.test(ask.query) && !FOOD_KIND.test(ask.query)
  if (!places.length) return stay
    ? `I couldn't verify hotel listings in ${ask.area} right now. I won't invent hotels, source links, room rates or availability. No booking was made.`
    : FOOD_KIND.test(ask.query)
      ? `I couldn't verify local listings in ${ask.area} right now. I won't invent restaurants, source links or table availability. No booking was made.`
      : `I couldn't verify local listings in ${ask.area} right now. I won't invent places or source links. No booking was made.`
  const listing = formatPlaces(ask, places)
  if (!listing) return `I couldn't verify local listings in ${ask.area} right now. No booking was made.`
  // A place listing verifies the property, never a room rate or availability for dates.
  // When every listing was omitted, the line already says no booking was made; don't repeat it.
  if (stay && /I will not recommend unlinked listings\. No booking was made\.$/.test(listing)) return listing
  if (stay) return listing.replace(/\n\nAsk "which of these is open late\?" or "book a table at <name>"\.$/, '')
    + '\n\nRoom rates and availability for your dates are not verified here; no booking was made.'
  const tableRequest = /\bfor\s+\d{1,2}\s+(?:people|persons?|guests?|pax)\b/i.test(text)
    && /\b(?:today|tomorrow|tonight|\d{1,2}(?::\d{2})?\s*(?:am|pm))\b/i.test(text)
  // Google Places verifies a listing, not a real-time reservation slot.
  if (tableRequest) return listing.replace(/\n\nAsk "which of these is open late\?" or "book a table at <name>"\.$/, '')
    + '\n\nThese are directory listings, not live table availability. Your requested party/date/time is unverified; no booking was made.'
  return listing
}
