import { searchWebResults, type WebSearchResult } from '@/lib/web-search'
import { askClaudeFlightStatus } from '@/lib/claude'
import { extractFlightCodes, extractDateTokens } from '@/lib/agent/watcher-quality'
import { normalizeNumericDates, resolveRelativeDates, localTodayYmd, extractDateHint, requestedFlightCodes, datesContradict, requestedYears } from '@/lib/bot/flight-codes'
// Re-export so existing importers/tests keep their entry point.
export { normalizeNumericDates, requestedFlightCodes } from '@/lib/bot/flight-codes'

// Normalise numeric + relative dates in a request to absolute ISO for querying and validation.
function normalizeRequest(userText: string, refYmd: string): string {
  return resolveRelativeDates(normalizeNumericDates(userText), refYmd)
}

// Flight-tracking sources. Scoping the search to these keeps a status lookup from
// collapsing into airfare shopping (Momondo/Expedia/Skyscanner rank first for a bare
// "EY1 Abu Dhabi to New York" query, which is how status turned into "fare not verified").
export const FLIGHT_TRACKER_DOMAINS = [
  'flightaware.com',
  'flightradar24.com',
  'flightstats.com',
  'flightera.net',
  'airportia.com',
  'flightconnections.com',
  'planemapper.com',
  'radarbox.com',
]

// Airfare / OTA / shopping signals. A status answer must never surface these.
const FARE_DOMAIN_RE = /(momondo|expedia|skyscanner|kayak|makemytrip|cleartrip|ixigo|goibibo|yatra|booking\.com|google\.[a-z.]+\/travel|kiwi\.com|trip\.com|easemytrip|happyfares|wego|hopper|priceline|orbitz|travelocity)/i
// No single trailing \b — a currency amount like "$520" has no word boundary between its
// digits, which previously let multi-digit fares slip past the guard. Match the whole amount
// and cover standalone booking language ("book now", "buy tickets").
const FARE_TEXT_RE = /(cheap(?:est)? flights?|book (?:your |a )?flights?|book (?:now|online|tickets?|your ticket)|buy (?:a )?tickets?|air ?fares?|\bfares?\b|ticket price|lowest price|best price|flight deals?|compare (?:prices|flights)|starting (?:at|from)|per (?:adult|person|passenger)|round[- ]trip fare|one[- ]way fare|(?:[$₹€£¥]|usd|inr|eur|gbp|jpy|aed|sgd|cad|aud|rs\.?)\s?[\d,]+|[\d,]+\s?(?:usd|inr|eur|gbp|jpy|aed|sgd|cad|aud|dollars?|euros?|pounds?|rupees?|yen))/i

// Operational-status signals — at least one must be present for a result to count as a
// real status source rather than a listing/marketing page.
const STATUS_TEXT_RE = /\b(on[- ]time|delayed|delay|cancell?ed|diverted|departed|arrived|landed|en ?route|in ?air|scheduled|estimated|gate|terminal|boarding|taxiing|now tracking|actual (?:arrival|departure)|status:)\b/i

export function isFareShoppingResult(r: WebSearchResult): boolean {
  const hay = `${r.title || ''} ${r.snippet || ''}`
  return FARE_DOMAIN_RE.test(r.url || '') || (FARE_TEXT_RE.test(hay) && !STATUS_TEXT_RE.test(hay))
}

export function hasStatusSignal(r: WebSearchResult): boolean {
  return STATUS_TEXT_RE.test(`${r.title || ''} ${r.snippet || ''}`)
}

// True when a produced answer leaked fare/shopping content and must be suppressed.
export function answerLeaksFare(text: string): boolean {
  return FARE_TEXT_RE.test(String(text || ''))
}

export function buildFlightStatusQuery(userText: string, refYmd = localTodayYmd()): string {
  const norm = normalizeRequest(userText, refYmd)
  const dateHint = extractDateHint(norm)
  const codes = requestedFlightCodes(norm).map(c => c.toUpperCase())
  const codePart = codes.length ? codes.join(' ') : String(userText || '').slice(0, 80)
  return `${codePart} flight status ${dateHint} arrival landed on time delayed`.replace(/\s+/g, ' ').trim()
}

// A tracker result is only usable if it concerns the REQUESTED flight occurrence: it must name
// one of the requested flight codes and must not contradict the requested date. This stops a
// recurring flight on another day (or a nearby flight number) from reporting the wrong status.
export function matchesRequestedOccurrence(r: WebSearchResult, userText: string, refYmd = localTodayYmd()): boolean {
  const norm = normalizeRequest(userText, refYmd)
  const url = String(r.url || '')
  const hay = normalizeNumericDates(`${r.title || ''} ${r.snippet || ''}`)
  const wanted = requestedFlightCodes(norm)
  if (wanted.length) {
    const got = new Set(extractFlightCodes(hay))
    if (!wanted.some(c => got.has(c))) return false
  }
  // When the request names a NON-today calendar date, a dateless result (a current/live recurring
  // page) must not satisfy it — otherwise today's EY1 answers "EY1 on 28 September". A plain
  // "today" query (relative date resolved to today) still accepts a dateless live page.
  const reqDates = extractDateTokens(norm)
  const todayTokens = extractDateTokens(refYmd)
  const nonTodayRequested = reqDates.some(d => !todayTokens.includes(d))
  if (nonTodayRequested && !extractDateTokens(hay).length) return false
  // For a non-today dated request that supplies a YEAR, require compatible year evidence in the
  // result text OR URL (trackers encode the date in the path) — a "Sep 28" result with no year
  // could be an archived occurrence from another year and must not ground a definitive claim.
  const years = requestedYears(norm)
  if (nonTodayRequested && years.length && !years.some(y => hay.includes(y) || url.includes(y))) return false
  if (datesContradict(norm, hay)) return false
  return true
}

// Definitive operational states and the evidence that must appear in the retrieved context
// before a reply may assert them. A prompt instruction is not an enforcement boundary, so any
// state the model asserts without matching source evidence forces the unverified fallback.
const STATE_EVIDENCE: Array<[RegExp, RegExp]> = [
  [/\b(landed|arrived|touched down|on the ground)\b/i, /\b(landed|arrived|touched down|on the ground)\b/i],
  [/\bcancell?ed\b/i, /\bcancell?ed\b/i],
  [/\bdelayed\b/i, /\bdelay(?:ed)?\b/i],
  [/\bdiverted\b/i, /\bdivert(?:ed)?\b/i],
  [/\b(departed|took off)\b/i, /\b(departed|took off|en ?route|in ?air|airborne|in flight)\b/i],
  [/\b(en ?route|in ?air|airborne|in flight)\b/i, /\b(en ?route|in ?air|airborne|in flight|departed|took off)\b/i],
  // "on time" needs an ACTUAL punctuality signal — a mere published schedule is not evidence
  // the flight is running on time.
  [/\bon[- ]time\b/i, /\b(on[- ]time|no delay|as scheduled|arrived on schedule|actual)\b/i],
]
function statusUngrounded(reply: string, context: string): boolean {
  return STATE_EVIDENCE.some(([inReply, inContext]) => inReply.test(reply) && !inContext.test(context))
}

// Clock times mentioned in a text, normalised to "H:MM" (leading zero and am/pm dropped) so a
// reply's cited times can be compared against the retrieved context.
function clockTimes(text: string): Set<string> {
  const out = new Set<string>()
  for (const m of String(text || '').matchAll(/\b(\d{1,2}):(\d{2})\s*(?:am|pm)?\b/gi)) {
    out.add(`${Number(m[1])}:${m[2]}`)
  }
  return out
}
// True when the reply cites a clock time that does NOT appear in the retrieved context — i.e. the
// model invented or altered a departure/arrival time. The state verb being grounded is not
// enough; the specific time must come from the source.
function timesUngrounded(reply: string, context: string): boolean {
  const ctx = clockTimes(context)
  return Array.from(clockTimes(reply)).some(t => !ctx.has(t))
}

const COULD_NOT_VERIFY =
  "I couldn't verify the live status from the flight trackers just now. Check the airline's official flight-status page or a tracker like FlightAware or Flightradar24 for the current status — I won't guess it from the schedule."

/**
 * Answer a live flight-status question WITHOUT ever turning into flight shopping.
 * Pipeline: tracker-scoped search -> drop any fare/OTA results -> status-only LLM summary
 * -> hard fare guard on the output. Deterministic fallbacks keep it safe when search or the
 * LLM is unavailable, and it never claims a landing that the results don't state.
 */
export type FlightStatusDeps = {
  search?: (query: string, opts?: { includeDomains?: string[] }) => Promise<WebSearchResult[]>
  ask?: (userText: string, context: string, userName: string) => Promise<string>
}

export async function answerLiveFlightStatus(userText: string, userName: string, deps: FlightStatusDeps = {}): Promise<string> {
  const search = deps.search || ((q, o) => searchWebResults(q, o))
  const ask = deps.ask || ((u, c, n) => askClaudeFlightStatus(u, c, n))
  // Resolve "today"/"tomorrow" once against the user's local calendar so the query and occurrence
  // validation agree on the same absolute date.
  const refYmd = localTodayYmd()
  const query = buildFlightStatusQuery(userText, refYmd)
  // Keep only non-shopping results that concern the REQUESTED flight occurrence (right flight
  // code, non-contradicting date) — so a recurring flight on another day can't be reported.
  const usable = (list: WebSearchResult[]) => list
    .filter(r => !isFareShoppingResult(r))
    .filter(r => matchesRequestedOccurrence(r, userText, refYmd))

  // 1) Prefer flight-tracker domains so airfare pages never enter the context.
  let results = usable(await search(query, { includeDomains: FLIGHT_TRACKER_DOMAINS }))
  // 2) If the scoped search yielded nothing usable AFTER filtering (empty, all shopping, or
  //    wrong occurrence), fall back to an open search and filter it the same way.
  if (!results.length) {
    results = usable(await search(query))
  }

  // No usable status source for this occurrence -> say so; never report fares.
  if (!results.length) return COULD_NOT_VERIFY

  const context = results
    .map((r, i) => `${i + 1}. ${r.title}\n${r.snippet}\nSource: ${r.url}`)
    .join('\n\n')

  let reply = ''
  try {
    reply = await ask(userText, context, userName)
  } catch {
    reply = ''
  }

  // Hard guard: if the model produced nothing usable, or leaked fare/shopping content,
  // suppress it entirely rather than deliver airfare in a status answer.
  if (!reply.trim() || answerLeaksFare(reply) || /i apologize|unable to provide|don'?t have access/i.test(reply)) {
    return COULD_NOT_VERIFY
  }
  // Ground EVERY definitive operational-status claim against the retrieved context — not just
  // arrival. A reply asserting landed/cancelled/delayed/diverted/departed/on-time without
  // matching source evidence, OR citing a clock time absent from the source, is suppressed.
  if (statusUngrounded(reply, context) || timesUngrounded(reply, context)) {
    return COULD_NOT_VERIFY
  }
  return reply.trim()
}
