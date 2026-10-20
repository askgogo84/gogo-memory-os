// A booking date read from a ticket, a forwarded message or a provider page often has no year
// ("Sat, 19 Oct, 9:45 PM"). The extraction models were never told today's date, so they filled the
// year themselves — 20 Oct 2026 live: a Jailer 2 booking for 19 Oct 2026 was also saved as
// 19 Oct 2024 (the year in which 19 Oct falls on a Saturday) and recall reported a show "731 days ago".
//
// Rule: when the evidence does not state the year the model returned, the year is not evidence. It is
// re-anchored to the occurrence of that same month/day/time nearest the reference date (the message
// or ticket date, normally now). A year the evidence states is always kept. Pure.

const YEAR_RE = /\b(19|20)\d{2}\b/g

/** Years written in the evidence: "2026", and the 2-digit year of a numeric date such as 19/10/26. */
export function yearsStatedIn(evidence: string): Set<number> {
  // A page footer ("© 2024 Bigtree Entertainment") is not the booking's year.
  const text = String(evidence || '').replace(/(?:©|\(c\)|copyright)\s*(?:(?:19|20)\d{2}\s*(?:[-–]\s*(?:19|20)?\d{2,4})?)/gi, ' ')
  const years = new Set<number>()
  for (const m of text.matchAll(YEAR_RE)) years.add(Number(m[0]))
  for (const m of text.matchAll(/\b\d{1,2}[/.-]\d{1,2}[/.-](\d{2})\b/g)) years.add(2000 + Number(m[1]))
  // "19 Oct '26" / "Oct 19, '26"
  for (const m of text.matchAll(/'(\d{2})\b/g)) years.add(2000 + Number(m[1]))
  return years
}

function withUtcYear(ms: number, year: number): number | null {
  const d = new Date(ms)
  const shifted = new Date(ms)
  shifted.setUTCFullYear(year)
  // 29 Feb into a non-leap year rolls to 1 Mar: not the same date, so it is not a candidate.
  if (shifted.getUTCMonth() !== d.getUTCMonth() || shifted.getUTCDate() !== d.getUTCDate()) return null
  return shifted.getTime()
}

/**
 * The extracted ISO instant with its year re-anchored when the evidence never stated that year.
 * Returns the input unchanged when it is not a valid instant or its year is in the evidence.
 */
export function anchorYearlessInstant(iso: string | null | undefined, evidence: string, reference: Date = new Date()): string | null {
  if (!iso) return iso ?? null
  const ms = Date.parse(String(iso))
  if (!Number.isFinite(ms)) return String(iso)
  const year = new Date(ms).getUTCFullYear()
  const stated = yearsStatedIn(evidence)
  if (stated.has(year)) return String(iso)
  const refMs = reference.getTime()
  const refYear = reference.getUTCFullYear()
  let best: number | null = null
  for (const y of [refYear - 1, refYear, refYear + 1]) {
    const candidate = withUtcYear(ms, y)
    if (candidate === null) continue
    if (best === null || Math.abs(candidate - refMs) < Math.abs(best - refMs)) best = candidate
  }
  if (best === null || best === ms) return String(iso)
  return new Date(best).toISOString()
}

/** "Today is 2026-10-20 (Tuesday)." — so an extraction model never guesses the current year. */
export function todayLine(reference: Date = new Date(), timezone = 'Asia/Kolkata'): string {
  try {
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(reference)
    const weekday = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'long' }).format(reference)
    return `Today is ${date} (${weekday}, ${timezone}). A date without a year means its nearest occurrence to today; never assume another year.`
  } catch {
    return `Today is ${reference.toISOString().slice(0, 10)}. A date without a year means its nearest occurrence to today; never assume another year.`
  }
}
