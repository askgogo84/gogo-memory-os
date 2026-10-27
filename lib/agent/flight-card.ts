// Result cards, Phase 1 (docs/result-cards): the data a WhatsApp flight card shows. Pure, so the card route, the
// worker and the tests share one shape. Every value comes from rows Gogo already verified on Google Flights
// (agent_steps.output_json with inventoryType 'browser-verified'); nothing here is produced by a model.

export type FlightCardRow = {
  n: number
  airline: string
  code: string
  colour: string
  departure: string
  arrival: string
  stops: string
  fareInr: number
  pick: boolean
}
export type FlightCardModel = { route: string; when: string; party: string; rows: FlightCardRow[]; observedAt: string | null }

const AIRLINES: Array<[RegExp, string, string]> = [
  [/^indigo\b/i, '6E', '#1d3f97'], [/^air india express\b/i, 'IX', '#d4252b'], [/^air india\b/i, 'AI', '#c8102e'],
  [/^akasa\b/i, 'QP', '#ff6d38'], [/^spicejet\b/i, 'SG', '#e3000f'], [/^vistara\b/i, 'UK', '#5f259f'],
  [/^alliance air\b/i, '9I', '#0b5aa6'], [/^star air\b/i, 'S5', '#1b3e6f'],
]
const brand = (airline: string) => {
  const hit = AIRLINES.find(([re]) => re.test(airline))
  if (hit) return { code: hit[1], colour: hit[2] }
  const letters = airline.replace(/[^A-Za-z ]/g, '').split(/\s+/).filter(Boolean)
  return { code: (letters.length > 1 ? letters[0][0] + letters[1][0] : (letters[0] || '?').slice(0, 2)).toUpperCase(), colour: '#3d4a42' }
}

const CLOCK = /^(?:[1-9]|1[0-2]):[0-5]\d [AP]M$/
const ARRIVAL = /^(?:[1-9]|1[0-2]):[0-5]\d [AP]M(?: [\p{L}\p{N}, +-]{1,40})?$/u
const CARRIER = /^[\p{L}\p{N} &'().,+-]{1,80}$/u

/** Same order as the text list (oneWayDisplayOrder): cheapest first, top five, plus the cheapest non-stop. */
function displayOrder<T extends { fareInr: number; stops: number }>(rows: T[]) {
  const sorted = [...rows].sort((a, b) => a.fareInr - b.fareInr)
  const top = sorted.slice(0, 5)
  const nonstop = sorted.find(r => r.stops === 0)
  return nonstop && !top.includes(nonstop) ? [...top, nonstop] : top
}

/** Returns null unless this is a completed, browser-verified one-way search with at least one clean row. */
export function flightCardModel(output: any): FlightCardModel | null {
  const ctx = output?.context
  if (!output || output.inventoryType !== 'browser-verified' || !ctx || ctx.roundTrip === true || ctx.returnDate) return null
  const from = ctx.origin?.code, to = ctx.destination?.code
  if (!/^[A-Z]{3}$/.test(String(from || '')) || !/^[A-Z]{3}$/.test(String(to || '')) || !/^20\d{2}-\d{2}-\d{2}$/.test(String(ctx.startDate || ''))) return null
  const adults = Number.isInteger(ctx.adults) && ctx.adults > 0 && ctx.adults < 10 ? ctx.adults : 1
  type Clean = { airline: string; departure: string; arrival: string; stops: number; fareInr: number }
  const clean: Clean[] = (Array.isArray(output.flights) ? output.flights : []).flatMap((f: any): Clean[] => {
    const airline = String(f?.airline || '').trim()
    if (!CARRIER.test(airline) || !CLOCK.test(String(f?.departure || '')) || !ARRIVAL.test(String(f?.arrival || ''))) return []
    if (!Number.isSafeInteger(f?.fareInr) || f.fareInr <= 0 || !Number.isInteger(f?.stops) || f.stops < 0 || f.stops > 4) return []
    // A party fare that was not verified as the whole party's total is not shown as a price for the party.
    if (adults > 1 && !(f.fareBasis === 'party_total' && f.farePassengers === adults)) return []
    return [{ airline, departure: String(f.departure), arrival: String(f.arrival), stops: f.stops as number, fareInr: f.fareInr as number }]
  })
  if (!clean.length) return null
  const rows = displayOrder(clean).map((f, i) => ({
    n: i + 1, airline: f.airline, ...brand(f.airline), departure: f.departure, arrival: f.arrival,
    stops: f.stops === 0 ? 'Nonstop' : `${f.stops} stop${f.stops === 1 ? '' : 's'}`, fareInr: f.fareInr, pick: i === 0,
  }))
  const date = new Date(`${ctx.startDate}T00:00:00Z`)
  const when = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(date).replace(',', '')
  const cabin = String(ctx.cabin || 'economy').replace(/_/g, ' ')
  const observed = Date.parse(String(output.browser?.observedAt || output.observedAt || ''))
  return { route: `${from} → ${to}`, when, party: `${adults} adult${adults === 1 ? '' : 's'} · ${cabin}`, rows, observedAt: Number.isFinite(observed) ? new Date(observed).toISOString() : null }
}

export const formatInr = (n: number, rupee = true) => `${rupee ? '₹' : 'Rs '}${n.toLocaleString('en-IN')}`

/** One line under the card naming the pick, from the same rows (no model). */
export function flightCardCaption(model: FlightCardModel) {
  const [a, b] = model.rows
  const reason = a.stops === 'Nonstop' ? 'cheapest and nonstop' : 'cheapest'
  const alt = b && b.departure !== a.departure ? ` #2 is ${b.fareInr === a.fareInr ? 'the same price' : `${formatInr(b.fareInr - a.fareInr)} more`} at ${b.departure}.` : ''
  return `${model.route} · ${model.when}: I'd pick #1, ${a.airline} at ${a.departure}, ${reason}.${alt} Say "book 1" to book.`
}
