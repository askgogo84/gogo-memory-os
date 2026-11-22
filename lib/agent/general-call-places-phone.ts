/**
 * Google Places (New): business-phone candidate discovery, never automatic calling.
 *
 * SAFE DEFAULT: entirely off without owner-managed flag and API key. The only content sent to
 * Google is businessName + locality; NEVER the user's phone task, health details, hotel stay,
 * payment data or other personal content.
 *
 * A candidate is not a verified phone number. The user must affirm that this is the right
 * business and telephone number BEFORE the normal separate call-plan approval. The caller
 * MUST NOT consume this object's phone directly. This file has no DB, dial or write imports.
 *
 * Official docs:
 * https://developers.google.com/maps/documentation/places/web-service/text-search
 * https://developers.google.com/maps/documentation/places/web-service/place-details
 */
export type GeneralCallPhoneCandidate = {
  placeId: string
  name: string
  address: string
  phone: string
  mapUrl: string
  source: 'Google Places'
  requiresNumberConfirmation: true
  isVerifiedPhone: false
}

type GooglePlace = {
  id?: unknown
  displayName?: { text?: unknown }
  formattedAddress?: unknown
  addressComponents?: unknown
  businessStatus?: unknown
  internationalPhoneNumber?: unknown
}
type SearchResults = { places?: unknown; nextPageToken?: unknown }

const ORIGIN = 'https://places.googleapis.com'
const SEARCH_URL = ORIGIN + '/v1/places:searchText'
const SEARCH_MASK = 'places.id,places.displayName,places.formattedAddress,places.addressComponents,places.businessStatus,nextPageToken'
const DETAILS_MASK = 'id,displayName,formattedAddress,addressComponents,businessStatus,internationalPhoneNumber'
const validPlaceId = (id: unknown): id is string =>
  typeof id === 'string' && /^[a-zA-Z0-9_-]{10,180}$/.test(id)
const display = (p: GooglePlace) => typeof p.displayName?.text === 'string' ? p.displayName.text.trim() : ''
const address = (p: GooglePlace) => typeof p.formattedAddress === 'string' ? p.formattedAddress.trim() : ''
const norm = (s: string) => s.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
// Never send phone numbers disguised with spaces, STD parentheses or dashes to a paid provider.
const includesFormattedPhone = (s: string) => /(?:\d[\s().-]*){10,}/.test(s)
// A six-digit locality PIN is valid location context, not a phone number. Permit at
// most one India-shaped PIN in the locality, never in a business name. Keep all
// 7+ contiguous digits and 10+ formatted digits out of paid provider requests.
const hasUnsafeNumericRuns = (value: string, allowLocalityPin: boolean) => {
  const runs = value.match(/\d+/g) || []
  const pins = runs.filter(run => run.length === 6)
  return runs.some(run => run.length >= 7) ||
    pins.length > (allowLocalityPin ? 1 : 0) ||
    pins.some(pin => !/^[1-9]\d{5}$/.test(pin))
}
// Google's regionCode=IN legitimately omits "India" from formattedAddress. A country code
// in structured addressComponents is required instead; never infer country from query bias.
const countryIsIndia = (p: GooglePlace) =>
  Array.isArray(p.addressComponents) && p.addressComponents.some((c: any) =>
    c && c.shortText === 'IN' && Array.isArray(c.types) && c.types.includes('country'))
const localityMatch = (addr: string, loc: string) => {
  // Keep short, numeric, and unit tokens: "Phase 1" must NOT match "Phase 2".
  const tokens = norm(loc).split(/\s+/).filter(Boolean)
  const inAddress = new Set(norm(addr).split(/\s+/).filter(Boolean))
  return tokens.length > 0 && tokens.some(t => /[a-z]{2,}/.test(t)) &&
    tokens.every(t => inAddress.has(t))
}
const eligible = (p: GooglePlace, business: string, locality: string) =>
  validPlaceId(p.id) && p.businessStatus === 'OPERATIONAL' &&
  norm(display(p)) === norm(business) &&
  address(p).length >= 10 &&
  countryIsIndia(p) && localityMatch(address(p), locality)

/** A unique exact business-name + locality match, not the provider's top-ranked guess. */
export function uniqueBusinessPlace(raw: unknown, name: string, locality: string): GooglePlace | null {
  if (!Array.isArray(raw)) return null
  const candidates = (raw as GooglePlace[]).filter(p => !!p && typeof p === 'object' && eligible(p,name,locality))
  return candidates.length === 1 ? candidates[0] : null
}
export function verifiedIndiaPhone(raw: unknown): string | null {
  if (typeof raw !== 'string' || !/^\+[\d\s().-]{10,24}$/.test(raw)) return null
  const normalized = '+' + raw.replace(/\D/g, '')
  if (!/^\+91[1-9]\d{9}$/.test(normalized) || /^\+91(?:1800|1900)/.test(normalized)) return null
  return normalized
}
function safeInput(s: unknown, max: number): string | null {
  if (typeof s !== 'string' || s.length > max) return null
  const value = s.trim().replace(/\s+/g,' ')
  if (value.length < 3 || !/^[a-zA-Z0-9 ,.'()&-]+$/.test(value) || /\b(?:https?|www|@)\b/i.test(value) || !norm(value).split(/\s+/).some(t => /[a-z]{2,}/.test(t))) return null
  return value
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Pick<Response,'ok'|'json'>>
export type PhoneCandidateRequest = {
  businessName: string
  locality: string
  env?: Record<string,string|undefined>
  fetcher?: FetchLike
}

/**
 * Returns a *candidate for confirmation*, never a plan, booking or call.
 * Requires an exact name, explicit locality, a single operational India listing, and an
 * India number on the same Place ID's Details. Does not trust search result order.
 * Fail closed on duplicate results, provider errors, missing fields or unsafe locations.
 */
export async function proposeGeneralCallPhoneFromPlaces(request: PhoneCandidateRequest): Promise<GeneralCallPhoneCandidate|null> {
  const env = request.env || process.env
  const key = env.GOOGLE_MAPS_API_KEY
  if (env.GOGO_GENERAL_CALL_PLACES_LOOKUP !== '1' || !key || key.length < 8) return null
  const name = safeInput(request.businessName,90), loc = safeInput(request.locality,90)
  if (!name || !loc || norm(name) === norm(loc) || /\b(?:hospitalized|diagnosed|symptoms|medication)\b/i.test(name+' '+loc)) return null
  // Do not send unstructured call instructions, patient details, or phone numbers as a Google query.
  if (/\b(?:call|book|reserve|appointment|doctor's|for my|tomorrow|tonight)\b/i.test(name+' '+loc) ||
      hasUnsafeNumericRuns(name,false) || hasUnsafeNumericRuns(loc,true) ||
      includesFormattedPhone(name) || includesFormattedPhone(loc)) return null
  const fetcher = request.fetcher || fetch
  const headers = { 'Content-Type':'application/json', 'X-Goog-Api-Key':key, 'X-Goog-FieldMask':SEARCH_MASK }
  try {
    const response = await fetcher(SEARCH_URL,{ method:'POST', headers, signal:AbortSignal.timeout(5_000),
      body:JSON.stringify({textQuery:name+', '+loc+', India',pageSize:5,regionCode:'IN',languageCode:'en'}) })
    if (!response.ok) return null
    const parsed:SearchResults=await response.json()
    // More pages may contain another branch with the same name: never assume the first is unique.
    if (parsed?.nextPageToken) return null
    const chosen=uniqueBusinessPlace(parsed?.places,name,loc)
    if (!chosen || !validPlaceId(chosen.id)) return null
    const detailsUrl = ORIGIN + '/v1/places/' + encodeURIComponent(chosen.id)
    const detailed=await fetcher(detailsUrl,{ method:'GET',signal:AbortSignal.timeout(5_000),
      headers: { 'X-Goog-Api-Key':key, 'X-Goog-FieldMask':DETAILS_MASK } })
    if (!detailed.ok) return null
    const detail:GooglePlace=await detailed.json()
    if (!detail || detail.id !== chosen.id || !eligible(detail,name,loc)) return null
    const phone=verifiedIndiaPhone(detail.internationalPhoneNumber)
    if (!phone) return null
    return {placeId:chosen.id,name:display(detail),address:address(detail),phone,
      mapUrl:'https://www.google.com/maps/place/?q=place_id:'+encodeURIComponent(chosen.id),
      source:'Google Places',requiresNumberConfirmation:true,isVerifiedPhone:false}
  } catch {
    // Fail closed. Never expose provider response bodies or API keys in logs.
    return null
  }
}
