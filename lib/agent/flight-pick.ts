// 11 Nov 2026 (owner): "Gogo comparing the options and sending one pick with a short question, the way Instinct does."
//
// One recommendation from rows Gogo already read and verified on Google Flights, chosen by a fixed rule in code (no
// model): the cheapest fare, unless a non-stop costs at most a little more, in which case the non-stop. The rule is
// plain so the reason can be said in one line and checked. The pick is a number in the list the person sees, so
// "book 2" books exactly the flight that was recommended; nothing here changes the list order or what "book N" means.

export type PickRow = { fareInr: number | null; stops: number | null }
export type FlightPickChoice = {
  /** 1-based number in the displayed list ("book N"). */
  n: number
  /** One short reason, e.g. "Cheapest, and non-stop." */
  reason: string
  /** 1-based number of the cheapest non-stop when it is not the pick, for a one-line mention. */
  nonstopN: number | null
}

/** A non-stop is worth up to this much over the cheapest fare: ₹1,000 or 10% of it, whichever is more. */
export const nonstopPremiumLimit = (cheapest: number) => Math.max(1000, Math.round(cheapest * 0.1))

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`
const priced = (r: PickRow) => Number.isSafeInteger(r.fareInr) && (r.fareInr as number) > 0

/** Pure. `rows` must be in display order (cheapest first). Null when no row has a verified fare. */
export function chooseFlightPick(rows: PickRow[]): FlightPickChoice | null {
  const cheapestIdx = rows.findIndex(priced)
  if (cheapestIdx < 0) return null
  const cheapest = rows[cheapestIdx]
  const nonstopIdx = rows.findIndex(r => priced(r) && r.stops === 0)
  if (cheapest.stops === 0) return { n: cheapestIdx + 1, reason: 'Cheapest, and non-stop.', nonstopN: null }
  if (nonstopIdx >= 0) {
    const extra = (rows[nonstopIdx].fareInr as number) - (cheapest.fareInr as number)
    if (extra <= nonstopPremiumLimit(cheapest.fareInr as number)) {
      return { n: nonstopIdx + 1, reason: extra > 0 ? `Non-stop for ${inr(extra)} more than the cheapest (#${cheapestIdx + 1}).` : 'Non-stop, at the cheapest fare.', nonstopN: null }
    }
  }
  return { n: cheapestIdx + 1, reason: 'Cheapest.', nonstopN: nonstopIdx >= 0 ? nonstopIdx + 1 : null }
}


type Ordered = { fareInr: number | null; stops: number | null }
/** Cheapest five, plus the cheapest non-stop as a sixth row when none of the five is non-stop. */
function withCheapestNonstop<T extends Ordered>(sorted: T[], n: number): T[] {
  const top = sorted.slice(0, n)
  const nonstop = sorted.find(f => f.stops === 0 && f.fareInr)
  return nonstop && !top.includes(nonstop) ? [...top, nonstop] : top
}
/** The order the person sees for a one-way result: cheapest first, top five. "Book #2" refers to this list. */
export function oneWayDisplayOrder<T extends Ordered>(options: T[]): T[] {
  return withCheapestNonstop([...options].sort((a, b) => (a.fareInr ?? Infinity) - (b.fareInr ?? Infinity)), 5)
}
/** The order the person sees for a round trip: priced rows, cheapest first, top five. "Book #2" refers to this list. */
export function roundTripDisplayOrder<T extends Ordered>(options: T[]): T[] {
  return withCheapestNonstop([...options].filter(o => o.fareInr).sort((a, b) => a.fareInr! - b.fareInr!), 5)
}
