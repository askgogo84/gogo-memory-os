import { searchWebResults, type WebSearchResult } from '@/lib/web-search'
import { askClaudeFlightStatus } from '@/lib/claude'
import { extractFlightCodes, extractDateTokens, extractDateTokensYear } from '@/lib/agent/watcher-quality'
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

export type OccurrenceReason = 'ok' | 'flight_number_mismatch' | 'dateless_for_dated_request' | 'wrong_year' | 'date_contradiction'

// Classify whether a result concerns the REQUESTED flight occurrence, returning a REASON so the
// decision is traceable (query logs) and testable — the difference between "no evidence exists"
// and "validation rejected it" must be visible. Rules, least to most specific:
//  - the result must name a requested flight code (when the request has one);
//  - a NON-today dated request needs a dated result (a dateless live page can't confirm a past day);
//  - the date must not contradict — YEAR-AWARE: an explicit different year (Sep 28 2025 vs 2026) is
//    rejected, but a same-day result that merely OMITS the year is accepted rather than over-
//    restricting historical lookups that legitimately lack a year token.
export function classifyOccurrence(r: WebSearchResult, userText: string, refYmd = localTodayYmd()): { usable: boolean; reason: OccurrenceReason } {
  const norm = normalizeRequest(userText, refYmd)
  const url = String(r.url || '')
  const hay = normalizeNumericDates(`${r.title || ''} ${r.snippet || ''}`)
  const wanted = requestedFlightCodes(norm)
  if (wanted.length) {
    const got = new Set(extractFlightCodes(hay))
    if (!wanted.some(c => got.has(c))) return { usable: false, reason: 'flight_number_mismatch' }
  }
  const reqDates = extractDateTokens(norm)
  const todayTokens = extractDateTokens(refYmd)
  const nonTodayRequested = reqDates.some(d => !todayTokens.includes(d))
  if (nonTodayRequested && !extractDateTokens(hay).length) return { usable: false, reason: 'dateless_for_dated_request' }
  // Explicit wrong-year is a distinct, high-confidence rejection. Years come from the snippet AND
  // the URL (trackers encode the date in the path, e.g. /history/20250928), so a "28 September"
  // snippet whose URL says 2025 is caught; a yearless same-day result falls through to below.
  const reqYears = requestedYears(norm)
  const gotYears = new Set([...extractDateTokensYear(hay).map(t => t.slice(-4)), ...(url.match(/20\d{2}/g) || [])])
  if (reqYears.length && gotYears.size && !reqYears.some(y => gotYears.has(y))) return { usable: false, reason: 'wrong_year' }
  if (datesContradict(norm, hay)) return { usable: false, reason: 'date_contradiction' }
  return { usable: true, reason: 'ok' }
}

export function matchesRequestedOccurrence(r: WebSearchResult, userText: string, refYmd = localTodayYmd()): boolean {
  return classifyOccurrence(r, userText, refYmd).usable
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
// Remove NEGATED state mentions ("not landed", "yet to depart", "no delay") so a source saying a
// flight has NOT landed is never treated as evidence for a reply claiming it landed.
// Include noun forms (delay/cancellation/diversion) so "no delay" / "no cancellation" are
// stripped — the evidence regexes accept the bare noun, so negation must cover it too.
const STATE_WORDS = 'landed|arrived|touched down|cancell?ed|cancellations?|delay(?:ed)?|diverted|diversions?|departed|took off|en ?route|in ?air|airborne|in flight|on[- ]time'
function stripNegatedStates(text: string): string {
  const neg = new RegExp(`\\b(?:not|no|never|hasn'?t|haven'?t|isn'?t|aren'?t|wasn'?t|weren'?t|won'?t|didn'?t|yet to)\\s+(?:\\w+\\s+){0,2}?(?:${STATE_WORDS})\\b`, 'gi')
  return String(text || '').replace(neg, ' ')
}
function statusUngrounded(reply: string, context: string): boolean {
  const r = stripNegatedStates(reply)   // a "not landed" reply makes no positive landed claim
  const c = stripNegatedStates(context) // a "not landed" source is not evidence of landing
  return STATE_EVIDENCE.some(([inReply, inContext]) => inReply.test(r) && !inContext.test(c))
}

// Clock times mentioned in a text, normalised to "H:MM" plus meridiem when stated, so a reply's
// cited times can be compared against the retrieved context (8:40 AM must not match 8:40 PM).
function clockTimes(text: string): Array<{ hm: string; mer: string }> {
  const out: Array<{ hm: string; mer: string }> = []
  for (const m of String(text || '').matchAll(/\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/gi)) {
    out.push({ hm: `${Number(m[1])}:${m[2]}`, mer: (m[3] || '').toLowerCase() })
  }
  return out
}
const TZ_RE = /\b(UTC|GMT|IST|EDT|EST|PDT|PST|MDT|MST|CDT|CST|BST|CET|CEST|EET|AEDT|AEST|SGT|JST|GST|HKT|KST|WET)\b/g
// True when the reply cites a clock time OR timezone that does NOT appear in the retrieved
// context — the model invented or altered a departure/arrival time, meridiem or timezone.
function timesUngrounded(reply: string, context: string): boolean {
  const ctx = clockTimes(context)
  const timeBad = clockTimes(reply).some(rt => {
    const sameHm = ctx.filter(ct => ct.hm === rt.hm)
    if (!sameHm.length) return true                       // time not in source at all
    if (!rt.mer) return false                             // reply gave no meridiem -> H:MM is enough
    return !sameHm.some(ct => !ct.mer || ct.mer === rt.mer) // reply's meridiem must be consistent
  })
  const ctxTz = new Set((context.match(TZ_RE) || []).map(s => s.toUpperCase()))
  const tzBad = (reply.match(TZ_RE) || []).some(t => !ctxTz.has(t.toUpperCase()))
  return timeBad || tzBad
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

export async function answerLiveFlightStatus(userText: string, userName: string, deps: FlightStatusDeps = {}, timezone?: string): Promise<string> {
  const search = deps.search || ((q, o) => searchWebResults(q, o))
  const ask = deps.ask || ((u, c, n) => askClaudeFlightStatus(u, c, n))
  // Resolve "today"/"tomorrow" once against the USER's local calendar (not a fixed default) so the
  // query and occurrence validation agree on the correct absolute date for that user.
  const refYmd = localTodayYmd(timezone)
  const query = buildFlightStatusQuery(userText, refYmd)
  // Keep only non-shopping results that concern the REQUESTED flight occurrence. Each drop is
  // logged with its reason so production traces can distinguish "no evidence exists" from
  // "faulty retrieval" from "over-restrictive validation" (never inferred, never invented).
  const usable = (list: WebSearchResult[], stage: string) => list.filter(r => {
    if (isFareShoppingResult(r)) { console.log('FLIGHT_STATUS_TRACE:', JSON.stringify({ stage, drop: 'fare_shopping', url: r.url })); return false }
    const { usable: ok, reason } = classifyOccurrence(r, userText, refYmd)
    if (!ok) console.log('FLIGHT_STATUS_TRACE:', JSON.stringify({ stage, drop: reason, url: r.url, title: (r.title || '').slice(0, 120) }))
    return ok
  })

  console.log('FLIGHT_STATUS_TRACE:', JSON.stringify({ stage: 'query', query, refYmd }))
  // 1) Prefer flight-tracker domains so airfare pages never enter the context.
  const scopedRaw = await search(query, { includeDomains: FLIGHT_TRACKER_DOMAINS })
  let results = usable(scopedRaw, 'scoped')
  // 2) If the scoped search yielded nothing usable AFTER filtering (empty, all shopping, or
  //    wrong occurrence), fall back to an open search and filter it the same way.
  let openRaw: WebSearchResult[] = []
  if (!results.length) {
    openRaw = await search(query)
    results = usable(openRaw, 'open')
  }

  // No usable status source for this occurrence -> say so; never report fares. The trace records
  // whether retrieval was empty (no evidence) or everything was filtered out (validation).
  if (!results.length) {
    console.log('FLIGHT_STATUS_TRACE:', JSON.stringify({ stage: 'no_result', scopedRaw: scopedRaw.length, openRaw: openRaw.length, outcome: (scopedRaw.length + openRaw.length) ? 'all_filtered' : 'retrieval_empty' }))
    return COULD_NOT_VERIFY
  }

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
