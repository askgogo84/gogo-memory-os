import { extractFlightCodes, extractDateTokens, extractDateTokensYear } from '@/lib/agent/watcher-quality'

// Pure flight-code / date helpers shared by the intent router (detect-intent) and the
// flight-status executor. Kept dependency-light (only watcher-quality, which imports crypto)
// so detect-intent's hot path does not pull in the web-search / LLM client graph.

const MONTHS = 'jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec'

// Remove date expressions (with any leading preposition) BEFORE extracting flight codes, so
// "on 28 September" does not yield the bogus code "ON28" — WITHOUT blacklisting real airline
// designators that happen to be English words (AM Aeroméxico, AS Alaska, AT Royal Air Maroc).
function stripDateExpressions(text: string): string {
  let t = String(text || '')
  t = t.replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ')                                                                    // ISO (incl. normalised numeric)
  t = t.replace(new RegExp(`\\b(?:on|at|for|by)\\s+\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${MONTHS})[a-z]*(?:,?\\s+\\d{4})?`, 'gi'), ' ') // "on 28 September 2026"
  t = t.replace(new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${MONTHS})[a-z]*(?:,?\\s+\\d{4})?`, 'gi'), ' ')      // "28 September 2026"
  t = t.replace(new RegExp(`\\b(?:${MONTHS})[a-z]*\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?`, 'gi'), ' ')      // "September 28, 2026"
  t = t.replace(/\b(?:on|at|for|by)\s+\d{1,2}(?:st|nd|rd|th)\b/gi, ' ')                                           // "on 28th"
  return t
}

// Normalise numeric dates ("9/28/2026", "28/9/26") to ISO so they survive into the query AND
// are seen by the date-contradiction check. Order is resolved unambiguously when one part is
// >12; for genuinely ambiguous values it follows the app's India-default day-first convention
// (dayFirst) rather than silently assuming US month-first, which would change the occurrence.
export function normalizeNumericDates(text: string, dayFirst = true): string {
  return String(text || '').replace(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/g, (m, a, b, y) => {
    let A = Number(a), B = Number(b), Y = Number(y)
    if (Y < 100) Y += 2000
    let month: number, day: number
    if (A > 12 && B <= 12) { day = A; month = B }        // D/M/Y (first part can't be a month)
    else if (B > 12 && A <= 12) { month = A; day = B }   // M/D/Y (second part can't be a month)
    else if (dayFirst) { day = A; month = B }            // ambiguous -> India day-first
    else { month = A; day = B }
    if (month < 1 || month > 12 || day < 1 || day > 31) return m
    return `${Y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  })
}

export function extractDateHint(text: string): string {
  const t = String(text || '')
  const iso = t.match(/\b\d{4}-\d{2}-\d{2}\b/)
  if (iso) return iso[0]
  const dm = t.match(new RegExp(`\\b\\d{1,2}\\s+(?:${MONTHS})[a-z]*(?:\\s+\\d{4})?`, 'i'))
  if (dm) return dm[0]
  const md = t.match(new RegExp(`\\b(?:${MONTHS})[a-z]*\\s+\\d{1,2}(?:,?\\s+\\d{4})?`, 'i'))
  if (md) return md[0]
  return ''
}

// The genuine flight codes in a request. Date expressions are removed first (contextually), so
// "on 28 September" yields no code while a real designator that is also a word (AM5, AS204) is
// preserved. Lowercase, matching extractFlightCodes() output.
export function requestedFlightCodes(userText: string): string[] {
  return extractFlightCodes(stripDateExpressions(userText))
}

// True only when a REAL airline flight code is present (not "on 28" / a date fragment). Used at
// the routing gate so a codeless question is never sent to the dedicated status handler, where an
// empty wanted-list would let any dated tracker result be summarised as "your flight".
export function hasConcreteFlightCode(text: string): boolean {
  return requestedFlightCodes(normalizeNumericDates(String(text || ''))).length > 0
}

// Year-aware date contradiction, mirroring watcher-quality's verifier: both sides must carry a
// date for a contradiction; if both also carry a year the year must match.
export function datesContradict(a: string, b: string): boolean {
  const ka = extractDateTokens(a), kb = extractDateTokens(b)
  if (!ka.length || !kb.length) return false
  const ya = extractDateTokensYear(a), yb = extractDateTokensYear(b)
  if (ya.length && yb.length) return !yb.some(d => ya.includes(d))
  return !kb.some(d => ka.includes(d))
}

// The years explicitly requested (e.g. "2026" from "28 September 2026"), for occurrence
// validation that must reject an archived same-day result from another year.
export function requestedYears(text: string): string[] {
  return Array.from(new Set(extractDateTokensYear(text).map(t => t.slice(-4))))
}
