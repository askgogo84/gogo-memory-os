/**
 * Google Places (New): owner-selected business phone candidate, never automatic calling.
 *
 * SAFE DEFAULT: entirely off without owner-managed flag and API key. Only an explicitly
 * owner-selected Google Maps Place ID is sent to Google Place Details; user business names,
 * locality, free-text tasks, patient or travel details are NEVER sent in search queries.
 * Name and locality are verified only in memory against the returned structured details.
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
const ORIGIN = 'https://places.googleapis.com'
const DETAILS_MASK = 'id,displayName,formattedAddress,addressComponents,businessStatus,internationalPhoneNumber'
// The supported pilot accepts only the common opaque Google Maps ChIJ Place ID form,
// not arbitrary IDs extracted from prose or a user's task. Other formats need a separately
// reviewed provenance adapter; an invalid or absent ID never triggers a paid request.
const validPlaceId = (id: unknown): id is string =>
  typeof id === 'string' && /^ChIJ[A-Za-z0-9_-]{20,76}$/.test(id)
const display = (p: GooglePlace) => typeof p.displayName?.text === 'string' ? p.displayName.text.trim() : ''
const address = (p: GooglePlace) => typeof p.formattedAddress === 'string' ? p.formattedAddress.trim() : ''
const norm = (s: string) => s.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
// Never send phone numbers disguised with spaces, STD parentheses or dashes to a paid provider.
const includesFormattedPhone = (s: string) => /(?:\d[\s().-]*){10,}/.test(s)
// A six-digit locality PIN is valid location context, not a phone number. Permit at
// most one India-shaped PIN in the locality, never in a business name. Keep all
// 7+ contiguous digits and 10+ formatted digits out of paid provider requests.
const hasUnsafeNumericRuns = (value: string, allowLocalityPin: boolean) => {
  const runs: string[] = value.match(/\d+/g) ?? []
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
  /** Explicit owner-selected Google Maps Place ID, not a value guessed from free text. */
  placeId?: string
  env?: Record<string,string|undefined>
  fetcher?: FetchLike
}

/**
 * An owner-selected Places identity allows a single Details read without transmitting raw
 * business/locality/task/patient text. There is deliberately NO free-text Google search here:
 * the owner must select/share the exact Place ID in a trusted upstream UX. The feature is
 * off until owner-managed API enablement; no caller/route is wired to this pilot.
 *
 * A candidate is not provider-verified proof of the correct phone: verify the venue and
 * number with the person, then obtain a SECOND, separate action-level call-plan approval.
 */
export async function proposeGeneralCallPhoneFromPlaces(request: PhoneCandidateRequest): Promise<GeneralCallPhoneCandidate|null> {
  const env = request.env || process.env
  const key = env.GOOGLE_MAPS_API_KEY
  if (env.GOGO_GENERAL_CALL_PLACES_LOOKUP !== '1' || !key || key.length < 8) return null
  const name = safeInput(request.businessName,90), loc = safeInput(request.locality,90)
  const placeId = request.placeId
  if (!validPlaceId(placeId) || !name || !loc || norm(name) === norm(loc)) return null
  // Never send unstructured instructions, health details or numbers in any provider request.
  // These checks also prevent accidental paid reads with malformed owner-selected inputs.
  if (/\b(?:call|book|reserve|appointment|doctor's|for my|tomorrow|tonight|patient|consultation|cancel|diabetes|diagnosed|medication|symptoms)\b/i.test(name+' '+loc) ||
      hasUnsafeNumericRuns(name,false) || hasUnsafeNumericRuns(loc,true) ||
      includesFormattedPhone(name) || includesFormattedPhone(loc)) return null
  const fetcher = request.fetcher || fetch
  try {
    const detailsUrl = ORIGIN + '/v1/places/' + encodeURIComponent(placeId)
    const response = await fetcher(detailsUrl,{ method:'GET',signal:AbortSignal.timeout(5_000),
      headers:{'X-Goog-Api-Key':key,'X-Goog-FieldMask':DETAILS_MASK} })
    if (!response.ok) return null
    const detail:GooglePlace = await response.json()
    if (!detail || detail.id !== placeId || !eligible(detail,name,loc)) return null
    const phone = verifiedIndiaPhone(detail.internationalPhoneNumber)
    if (!phone) return null
    return {placeId,name:display(detail),address:address(detail),phone,
      mapUrl:'https://www.google.com/maps/place/?q=place_id:'+encodeURIComponent(placeId),
      source:'Google Places',requiresNumberConfirmation:true,isVerifiedPhone:false}
  } catch {
    // No provider bodies, API keys, personal content or raw request data in logs.
    return null
  }
}
