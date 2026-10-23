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
  // Booking, ordering and reviews of one named place have their own flows.
  if (/\b(?:book|reserve|order|deliver|table for|call|reviews? of|menu of|timings? of)\b/i.test(t)) return null
  const area = t.match(/\b(?:in|near|around|at|close to)\s+([A-Za-z][A-Za-z .'-]{2,40}?)(?=\s+(?:for|with|that|which|open|under|below|within)\b|$)/i)?.[1]?.trim()
  if (!area || /^(?:me|here|my (?:area|place|home|office))$/i.test(area)) return null
  const n = t.match(/\b(\d{1,2}|one|two|three|four|five|six|seven|eight)\b/i)?.[1]?.toLowerCase()
  const count = Math.max(1, Math.min(8, n ? (COUNT_WORDS[n] || Number(n)) : 5))
  const query = t.replace(LEAD, '').replace(/\b(\d{1,2}|one|two|three|four|five|six|seven|eight)\b/i, '').replace(/\s+/g, ' ').trim()
  return { query: /\b(?:bengaluru|bangalore|mumbai|delhi|chennai|hyderabad|pune|kolkata|dubai|india)\b/i.test(query) ? query : `${query}, Bengaluru`, area, count }
}

export type Place = { title: string; address: string; rating?: number; ratingCount?: number; category?: string; phone?: string; website?: string; cid?: string }

export async function searchPlaces(query: string, fetchImpl: typeof fetch = fetch): Promise<Place[]> {
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
    phone: p.phoneNumber ? String(p.phoneNumber) : undefined, website: p.website ? String(p.website) : undefined, cid: p.cid ? String(p.cid) : undefined,
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
  // Prefer places whose address is really in the area asked for, then better-rated, well-reviewed ones.
  const kindOk = places.filter(p => kindMatch(p, ask))
  const pool = kindOk.length >= Math.min(ask.count, 2) ? kindOk : places
  const ranked = [...pool].sort((x, y) => Number(inArea(y, ask.area)) - Number(inArea(x, ask.area)) || (y.rating || 0) * Math.log10((y.ratingCount || 1) + 9) - (x.rating || 0) * Math.log10((x.ratingCount || 1) + 9))
  const local = ranked.filter(p => inArea(p, ask.area))
  const shown = (local.length >= Math.min(ask.count, 2) ? local : ranked).slice(0, ask.count)
  if (!shown.length) return null
  const lines = shown.map((p, i) => {
    const rating = p.rating ? ` · ${p.rating}★${p.ratingCount ? ` (${new Intl.NumberFormat('en-IN').format(p.ratingCount)})` : ''}` : ''
    const maps = p.cid ? `\nhttps://maps.google.com/?cid=${p.cid}` : ''
    return `${i + 1}. *${p.title}*${rating}\n${p.address}${p.category ? ` · ${p.category}` : ''}${maps}`
  })
  const note = local.length < Math.min(ask.count, 2) ? `\n\nFew results were inside ${ask.area}, so some are nearby.` : ''
  return `📍 ${shown.length === 1 ? 'A good pick' : `${shown.length} good picks`} in ${ask.area}\n\n${lines.join('\n\n')}${note}\n\nAsk "which of these is open late?" or "book a table at <name>".`
}

export async function answerPlaces(text: string, fetchImpl: typeof fetch = fetch) {
  const ask = placeAsk(text)
  if (!ask) return null
  const places = await searchPlaces(ask.query, fetchImpl).catch((err: any) => { console.error('PLACES_SEARCH_FAILED:', String(err?.message || err).slice(0, 120)); return [] })
  return places.length ? formatPlaces(ask, places) : null
}
