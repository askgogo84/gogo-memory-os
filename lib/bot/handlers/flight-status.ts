import { searchWebResults, type WebSearchResult } from '@/lib/web-search'
import { askClaudeFlightStatus } from '@/lib/claude'
import { extractFlightCodes, extractDateTokens, extractDateTokensYear } from '@/lib/agent/watcher-quality'

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
const FARE_TEXT_RE = /(cheap(?:est)? flights?|book (?:your |a )?flights?|book (?:now|online|tickets?|your ticket)|buy (?:a )?tickets?|air ?fares?|\bfares?\b|ticket price|lowest price|best price|flight deals?|compare (?:prices|flights)|starting (?:at|from)|per (?:adult|person|passenger)|round[- ]trip fare|one[- ]way fare|(?:\$|₹|usd|inr|rs\.?)\s?[\d,]+)/i

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

const MONTHS = 'jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec'
function extractDateHint(text: string): string {
  const t = String(text || '')
  const iso = t.match(/\b\d{4}-\d{2}-\d{2}\b/)
  if (iso) return iso[0]
  const dm = t.match(new RegExp(`\\b\\d{1,2}\\s+(?:${MONTHS})[a-z]*(?:\\s+\\d{4})?`, 'i'))
  if (dm) return dm[0]
  const md = t.match(new RegExp(`\\b(?:${MONTHS})[a-z]*\\s+\\d{1,2}(?:,?\\s+\\d{4})?`, 'i'))
  if (md) return md[0]
  return ''
}

// Two-letter tokens that are English words, not airline prefixes — extractFlightCodes()'s
// generic pattern otherwise reads "on 28 September" as the code "ON28".
const NON_AIRLINE_PREFIXES = new Set(['on', 'at', 'in', 'by', 'of', 'to', 'no', 'so', 'as', 'is', 'it', 'am', 'pm', 'be', 'or', 'an', 'do', 'if', 'my', 'me', 'we', 'he'])

// The genuine flight codes in a request — preposition+number artefacts ("on28") and codes
// overlapping the date phrase ("er2026" from "September 2026") removed. Lowercase, matching
// extractFlightCodes() output, so it compares directly against codes found in a result.
export function requestedFlightCodes(userText: string): string[] {
  const dateCompact = extractDateHint(userText).toLowerCase().replace(/\s+/g, '')
  return extractFlightCodes(userText)
    .filter(c => !NON_AIRLINE_PREFIXES.has(c.replace(/\d+$/, '')))
    .filter(c => !(dateCompact && dateCompact.includes(c.toLowerCase())))
}

export function buildFlightStatusQuery(userText: string): string {
  const dateHint = extractDateHint(userText)
  const codes = requestedFlightCodes(userText).map(c => c.toUpperCase())
  const codePart = codes.length ? codes.join(' ') : String(userText || '').slice(0, 80)
  return `${codePart} flight status ${dateHint} arrival landed on time delayed`.replace(/\s+/g, ' ').trim()
}

// Year-aware date contradiction, mirroring watcher-quality's verifier: both sides must carry a
// date for a contradiction; if both also carry a year the year must match.
function datesContradict(a: string, b: string): boolean {
  const ka = extractDateTokens(a), kb = extractDateTokens(b)
  if (!ka.length || !kb.length) return false
  const ya = extractDateTokensYear(a), yb = extractDateTokensYear(b)
  if (ya.length && yb.length) return !yb.some(d => ya.includes(d))
  return !kb.some(d => ka.includes(d))
}

// A tracker result is only usable if it concerns the REQUESTED flight occurrence: it must name
// one of the requested flight codes and must not contradict the requested date. This stops a
// recurring flight on another day (or a nearby flight number) from reporting the wrong status.
export function matchesRequestedOccurrence(r: WebSearchResult, userText: string): boolean {
  const hay = `${r.title || ''} ${r.snippet || ''}`
  const wanted = requestedFlightCodes(userText)
  if (wanted.length) {
    const got = new Set(extractFlightCodes(hay))
    if (!wanted.some(c => got.has(c))) return false
  }
  if (datesContradict(userText, hay)) return false
  return true
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
  const query = buildFlightStatusQuery(userText)
  // Keep only non-shopping results that concern the REQUESTED flight occurrence (right flight
  // code, non-contradicting date) — so a recurring flight on another day can't be reported.
  const usable = (list: WebSearchResult[]) => list
    .filter(r => !isFareShoppingResult(r))
    .filter(r => matchesRequestedOccurrence(r, userText))

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
  return reply.trim()
}
