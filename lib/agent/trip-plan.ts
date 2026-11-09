// "Plan a Goa trip 12 to 15 Dec with Divya and Nithin" (7 Nov live): the destination and dates were in the message,
// yet Gogo asked "what should it include: going out, food, rest…". A trip ask with a place and dates gets a plan
// skeleton at once: the dates and nights, who is going, flights (the existing travel research, which keeps running
// in the background) and stays (the existing local places search). Read-only: nothing is booked or held.
import type { AgentActor } from './actor'

export type TripAsk = { destination: string; start: string; end: string; nights: number; companions: string[]; from: string }
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const LEAD = /^(?:please\s+)?(?:can you\s+|could you\s+|help me\s+)?(?:plan|organi[sz]e|put together|arrange)\s+(?:a|an|my|our|the)?\s*/i
const NOT_TRIP = /\b(?:book|pay|reserve|cancel|refund|remind|meeting|wedding|party|menu|diet|workout|study|budget sheet)\b/i

const pad = (n: number) => String(n).padStart(2, '0')
function toISO(day: number, monthIdx: number, now: Date, explicitYear?: number): string | null {
  let y = explicitYear ?? now.getFullYear()
  let candidate = new Date(Date.UTC(y, monthIdx, day))
  if (explicitYear === undefined && candidate.getTime() < now.getTime() - 86_400_000) {
    y += 1
    candidate = new Date(Date.UTC(y, monthIdx, day))
  }
  // Date.UTC normalizes 31 February to March; never invent a different user date.
  if (candidate.getUTCFullYear() !== y || candidate.getUTCMonth() !== monthIdx || candidate.getUTCDate() !== day) return null
  return `${y}-${pad(monthIdx + 1)}-${pad(day)}`
}

/** "plan a goa trip 12 to 15 dec with Divya and Nithin" → destination, ISO dates, nights, companions. Pure. */
export function tripAsk(text: string, now = new Date()): TripAsk | null {
  const raw = String(text || '').trim().replace(/[.!?]+$/, '')
  if (raw.length > 200 || !LEAD.test(raw) || NOT_TRIP.test(raw)) return null
  const t = raw.replace(LEAD, '')
  // Dates: "12 to 15 dec", "12-15 dec", "dec 12 to 15", "12 dec to 15 dec", "from 12 to 15 december".
  const months = MONTHS.join('|')
  const d1 = t.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:(${months})[a-z]*)?\\s*(?:to|-|–|till|until|through)\\s*(\\d{1,2})(?:st|nd|rd|th)?\\s*(${months})[a-z]*\\b(?:[\\s,]+(20\\d{2}))?`, 'i'))
  const d2 = t.match(new RegExp(`\\b(${months})[a-z]*\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:to|-|–|till|until|through)\\s*(\\d{1,2})(?:st|nd|rd|th)?\\b(?:[\\s,]+(20\\d{2}))?`, 'i'))
  let startDay: number, endDay: number, startMonth: number, endMonth: number
  if (d1) { startDay = Number(d1[1]); endDay = Number(d1[3]); endMonth = MONTHS.indexOf(d1[4].slice(0, 3).toLowerCase()); startMonth = d1[2] ? MONTHS.indexOf(d1[2].slice(0, 3).toLowerCase()) : endMonth }
  else if (d2) { startMonth = endMonth = MONTHS.indexOf(d2[1].slice(0, 3).toLowerCase()); startDay = Number(d2[2]); endDay = Number(d2[3]) }
  else return null
  if (startDay < 1 || startDay > 31 || endDay < 1 || endDay > 31) return null
  // An explicit year is authority, not a hint for next-occurrence inference.
  const suppliedYear = d1?.[5] || d2?.[4]
  const explicitYear = suppliedYear ? Number(suppliedYear) : undefined
  const start = toISO(startDay, startMonth, now, explicitYear)
  if (!start) return null
  // Resolve the whole yearless range relative to its start, not separately to "now".
  const endYear = explicitYear ?? Number(start.slice(0, 4)) + (endMonth < startMonth ? 1 : 0)
  const end = toISO(endDay, endMonth, now, endYear)
  if (!end) return null
  const nights = Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000)
  if (nights < 1 || nights > 30) return null
  // Destination: "<place> trip", "trip to <place>", "<n> days in <place>", "holiday in <place>".
  const dest = t.match(/\btrip\s+to\s+([A-Z][\w' ]{1,30}?)(?=\s+(?:from|on|with|for|between)\b|\s+\d|$)/i)?.[1]
    || t.match(/^(?:(?:\d+|few|long)[- ]?(?:day|night)s?\s+)?(?:trip|holiday|vacation|getaway|weekend)\s+(?:to|in)\s+([A-Z][\w' ]{1,30}?)(?=\s+(?:from|on|with|for|between)\b|\s+\d|$)/i)?.[1]
    || t.match(/^([A-Z][\w' ]{1,30}?)\s+(?:trip|holiday|vacation|getaway|weekend)\b/i)?.[1]
  if (!dest) return null
  const companions = (t.match(/\bwith\s+([A-Z][\w']+(?:\s*(?:,|and|&)\s*[A-Z][\w']+)*)/i)?.[1] || '').split(/\s*(?:,|\band\b|&)\s*/i).map(x => x.trim()).filter(x => x && !/^(?:my|the|a|an|friends?|family|wife|husband|kids?|parents?)$/i.test(x))
  const destination = dest.trim().replace(/\s+/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  return { destination, start, end, nights, companions, from: 'Bengaluru' }
}

/** The research reply is a paragraph of instructions; the plan keeps its first sentence and the promise to send results. */
export function firstSentences(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  const first = flat.match(/^[^.!?]*[.!?]/)?.[0] || flat.slice(0, 160)
  const promise = /will send the cheapest options here when it finishes/i.test(flat) ? " I'll send the cheapest options here when the search finishes." : ''
  return `${first}${promise}`.trim()
}
const fmt = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
const list = (xs: string[]) => xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`
const flightDay = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
/** Forward complete flight dates, including year, to avoid researching a previous January. Pure. */
export function tripFlightQuery(ask: TripAsk): string {
  return `flights ${ask.from} to ${ask.destination} ${flightDay(ask.start)} back ${flightDay(ask.end)}`
}

/** The plan skeleton. Pure. */
export function formatTripPlan(ask: TripAsk, parts: { flights: string | null; stays: string | null }): string {
  const who = ask.companions.length ? ` with ${list(ask.companions)}` : ''
  const lines = [`🧳 *${ask.destination}, ${fmt(ask.start)} – ${fmt(ask.end)}* · ${ask.nights} night${ask.nights === 1 ? '' : 's'}${who}`]
  lines.push('', `*Flights* (${ask.from} → ${ask.destination}, back ${fmt(ask.end)})`, parts.flights || `Say "${tripFlightQuery(ask)}" and I'll check the sites.`)
  lines.push('', `*Stays*`, parts.stays || `Say "hotels in ${ask.destination}" or "villas in ${ask.destination}" and I'll list verified options.`)
  lines.push('', `Next: tell me a budget per night or an area${ask.companions.length ? `, or say "split it ${ask.companions.length + 1} ways" when you book` : ''}. I won't book or hold anything without your approval.`)
  return lines.join('\n')
}

/** Runs the flight research (background) and a stays search together and returns the plan. */
export async function tryTripPlan(actor: AgentActor, surface: 'whatsapp' | 'web', text: string): Promise<string | null> {
  const ask = tripAsk(text)
  if (!ask) return null
  const flightText = tripFlightQuery(ask)
  const [flights, stays] = await Promise.all([
    import('./travel-research').then(m => m.tryRunTravelResearch({ actor, surface: surface as any, text: flightText })).then((r: any) => r?.text ? firstSentences(String(r.text)) : null, () => null),
    import('./places-search').then(m => m.answerPlaces(`hotels in ${ask.destination}`)).then(s => s && !/couldn't verify/i.test(s) ? s.split('\n').slice(0, 9).join('\n') : null, () => null),
  ])
  console.log('TRIP_PLAN:', JSON.stringify({ destination: ask.destination, nights: ask.nights, companions: ask.companions.length, flights: !!flights, stays: !!stays }))
  return formatTripPlan(ask, { flights, stays })
}
