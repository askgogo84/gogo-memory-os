import { searchWebResults, type WebSearchResult } from '@/lib/web-search'
import { askClaudeFlightStatus } from '@/lib/claude'
import { extractFlightCodes } from '@/lib/agent/watcher-quality'

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

export function buildFlightStatusQuery(userText: string): string {
  const dateHint = extractDateHint(userText)
  const dateCompact = dateHint.toLowerCase().replace(/\s+/g, '')
  const codes = extractFlightCodes(userText)
    // Drop preposition+number artefacts ("on28") and any code that overlaps the date phrase
    // ("er2026" from "September 2026") so the tracker query is not polluted with a wrong flight.
    .filter(c => !NON_AIRLINE_PREFIXES.has(c.replace(/\d+$/, '')))
    .filter(c => !(dateCompact && dateCompact.includes(c.toLowerCase())))
    .map(c => c.toUpperCase())
  const codePart = codes.length ? codes.join(' ') : String(userText || '').slice(0, 80)
  return `${codePart} flight status ${dateHint} arrival landed on time delayed`.replace(/\s+/g, ' ').trim()
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

  // 1) Prefer flight-tracker domains so airfare pages never enter the context.
  let results = await search(query, { includeDomains: FLIGHT_TRACKER_DOMAINS })
  // 2) If trackers returned nothing, fall back to an open search but strip shopping results.
  if (!results.length) {
    const open = await search(query)
    results = open.filter(r => !isFareShoppingResult(r))
  } else {
    results = results.filter(r => !isFareShoppingResult(r))
  }

  // No usable, non-shopping status source -> say so; never report fares.
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
