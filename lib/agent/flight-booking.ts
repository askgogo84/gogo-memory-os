import { supabaseAdmin } from '@/lib/supabase-admin'
import { redactSecretShapedText } from '@/lib/bot/memory-redaction'
import { browserApprovalBinding, createApprovalBrowserRun } from './browser-command'
import { roundTripDisplayOrder, roundTripSearchLink } from './travel-browser-task'
import type { BrowserFlightOption } from './travel-browser-task'
import type { AgentActor } from './actor'
import type { AgentSurface } from './orchestrator'

/**
 * 17 Oct: "book the cheapest" after a flight search. Gogo picks from the last result, asks each traveller's name
 * and date of birth, shows an approval card, then (after APPROVE) the secure browser fills the booking up to the
 * payment page and hands over a link. Gogo never enters card, UPI or bank details and never presses Pay.
 */

const MONTHS: Record<string, number> = {jan:1,january:1,feb:2,february:2,mar:3,march:3,apr:4,april:4,may:5,jun:6,june:6,jul:7,july:7,aug:8,august:8,sep:9,sept:9,september:9,oct:10,october:10,nov:11,november:11,dec:12,december:12}
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const ORDINALS: Record<string, number> = {first:1,second:2,third:3,fourth:4,fifth:5}
const NOT_FLIGHT = /\b(?:hotel|room|train|bus|table|restaurant|movie|show|slot|court|turf|cab|ride|appointment|doctor|salon|order|cart|groceries)\b/i

function safe(value: unknown, max = 400) {
  return redactSecretShapedText(String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max))
}

export type FlightPick = { kind: 'cheapest' } | { kind: 'nonstop' } | { kind: 'number'; n: number }

/** "Go ahead and book the cheapest option", "book #2", "book the non-stop". Null when it is not a booking request. */
export function flightBookingRequest(text: string): FlightPick | null {
  const raw = String(text || '').trim()
  if (!raw || /https?:\/\//i.test(raw) || NOT_FLIGHT.test(raw)) return null
  const m = raw.match(/^(?:(?:ok(?:ay)?|yes|yeah|sure|please)[,.! ]+)?(?:(?:go ahead|can you|could you|please|now)\s+(?:and\s+)?)*(?:book|reserve|buy|get me)\s+(?:me\s+)?(?:the\s+|that\s+|this\s+)?(.*?)[.!?\s]*$/i)
  if (!m) return null
  const rest = m[1].toLowerCase()
  if (/\bnon[- ]?stop\b|\bdirect\b/.test(rest)) return { kind: 'nonstop' }
  const num = rest.match(/(?:#|option\s*|number\s*|no\.?\s*)(\d)\b/) || rest.match(/^(\d)$/)
  if (num) return { kind: 'number', n: Number(num[1]) }
  const ord = Object.keys(ORDINALS).find(word => new RegExp(`\\b${word}\\b`).test(rest))
  if (ord) return { kind: 'number', n: ORDINALS[ord] }
  if (/\b(?:cheapest|lowest|best|cheap)\b/.test(rest)) return { kind: 'cheapest' }
  // "book it", "book that flight", "book this", "book the flight", "book the ticket"
  if (/^(?:it|that|this|that flight|this flight|the flight|flight|the ticket|ticket|that one|this one|the option|option)$/.test(rest) || rest === '') return { kind: 'cheapest' }
  return null
}

export type LastFlightResult = { runId: string; context: any; options: BrowserFlightOption[]; searchLink: string }

/** The newest completed round-trip result for this person, in the order it was shown. */
export async function loadLastFlightResult(actor: AgentActor): Promise<LastFlightResult | null> {
  const tg = String(actor.legacyTelegramId)
  const since = new Date(Date.now() - 12 * 3600_000).toISOString()
  const { data: runs, error } = await supabaseAdmin.from('agent_runs').select('id,metadata_json,started_at')
    .eq('telegram_id', tg).eq('type', 'travel_research').eq('status', 'completed').gte('started_at', since).order('started_at', { ascending: false }).limit(4)
  if (error) throw new Error(`flight_booking_runs_read_failed:${String(error.message).slice(0, 120)}`)
  for (const run of runs || []) {
    const metaContext: any = (run.metadata_json as any)?.context
    const { data: step } = await supabaseAdmin.from('agent_steps').select('output_json')
      .eq('run_id', run.id).eq('telegram_id', tg).eq('tool_name', 'travel').limit(1).maybeSingle()
    const flights = (step?.output_json as any)?.flights
    const context: any = (step?.output_json as any)?.context || metaContext
    if (!context || context.kind !== 'flight' || !context.roundTrip || !context.returnDate) continue
    if (!Array.isArray(flights) || !flights.length) continue
    const options = roundTripDisplayOrder(flights as BrowserFlightOption[])
    if (options.length) return { runId: String(run.id), context, options, searchLink: roundTripSearchLink(context) }
  }
  return null
}

export function pickFlight(options: BrowserFlightOption[], pick: FlightPick): BrowserFlightOption | null {
  if (pick.kind === 'cheapest') return options[0] || null
  if (pick.kind === 'nonstop') return options.find(o => o.stops === 0) || null
  return options[pick.n - 1] || null
}

export type Traveller = { name: string; dob: string }

const pad = (n: number) => String(n).padStart(2, '0')

/** One traveller per line (or separated by ";"): "Goverdhan Mandyam Dommane, 12 Mar 1985" or "... 12/03/1985". */
export function parseTravellers(text: string, now = new Date()): { travellers: Traveller[]; problems: string[] } {
  const travellers: Traveller[] = []
  const problems: string[] = []
  const chunks = String(text || '').split(/[\n;]+/).map(c => c.trim()).filter(Boolean)
  for (const chunk of chunks) {
    const dateRe = /(\d{1,2})[\s/.\-]+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|\d{1,2})[\s/.\-,]+(\d{4})/i
    const dm = chunk.match(dateRe)
    if (!dm) { problems.push(`no date of birth in “${chunk.slice(0, 40)}”`); continue }
    const day = Number(dm[1]); const monthRaw = dm[2].toLowerCase()
    const month = /^\d+$/.test(monthRaw) ? Number(monthRaw) : MONTHS[monthRaw.slice(0, 4)] || MONTHS[monthRaw.slice(0, 3)]
    const year = Number(dm[3])
    const date = new Date(Date.UTC(year, (month || 1) - 1, day))
    const valid = month >= 1 && month <= 12 && date.getUTCDate() === day && date.getUTCMonth() === month - 1 && year >= 1900 && date.getTime() < now.getTime()
    if (!valid) { problems.push(`“${dm[0]}” is not a valid date of birth`); continue }
    const name = chunk.replace(dm[0], ' ').replace(/\b(?:dob|d\.o\.b|date of birth|born(?: on)?|name|passenger|traveller|traveler|adult)\b\s*[:\-]?/gi, ' ')
      .replace(/[,:()\-]+/g, ' ').replace(/\s+/g, ' ').trim()
    if (!/^[A-Za-z][A-Za-z .'-]{1,78}$/.test(name) || name.split(' ').filter(Boolean).length < 2) { problems.push(`“${name.slice(0, 40) || chunk.slice(0, 40)}” needs a first and last name as on the passport`); continue }
    travellers.push({ name: name.replace(/\b([a-z])/g, c => c.toUpperCase()), dob: `${day} ${MONTH_NAMES[month - 1]} ${year}` })
  }
  return { travellers, problems }
}

export function describeFlight(option: BrowserFlightOption) {
  const stops = option.stops === 0 ? 'non-stop' : `${option.stops} stop${option.stops === 1 ? '' : 's'}${option.layover ? ` (${option.layover})` : ''}`
  return `${option.airline}, out ${option.departure} → ${option.arrival}, ${stops}`
}

export function flightBookingObjective(params: { context: any; option: BrowserFlightOption; travellers: Traveller[] }) {
  const { context, option, travellers } = params
  const fare = option.fareInr ? `₹${option.fareInr.toLocaleString('en-IN')}` : 'the listed fare'
  const who = travellers.map((t, i) => `traveller ${i + 1}: full name ${t.name}, date of birth ${t.dob}`).join('; ')
  return safe(`Flight booking up to payment on Google Flights: round trip ${context.origin?.code} to ${context.destination?.code}, depart ${context.startDate}, return ${context.returnDate}, ${travellers.length} adult${travellers.length === 1 ? '' : 's'}, ${String(context.cabin || 'economy').replace(/_/g, ' ')}. `
    + `Choose the ${option.airline} result that leaves ${option.departure} on ${context.startDate} (about ${fare} round trip), then the cheapest return on ${context.returnDate}, and continue (Select flight, Continue, Book) to the airline or booking site. `
    + `If the site asks for passenger details, use exactly: ${who}. Do not guess any other field; leave it for the person. `
    + `If the price on the booking page is more than 10% above ${fare}, or it is a different flight, stop and report. `
    + `Stop on the payment step: never pay, never enter card, UPI or bank details, never press Pay.`, 1700)
}

const askText = (count: number, problems: string[] = []) =>
  `${problems.length ? `I could not use that: ${problems.slice(0, 2).join('; ')}.\n\n` : ''}Send ${count === 1 ? 'the traveller’s' : `each of the ${count} travellers’`} full name exactly as on the passport and date of birth, ${count === 1 ? 'for example' : 'one per line, for example'}:\n\nAsha Rao, 12 Mar 1985`

type Waiting = { runId: undefined; status: 'waiting_user'; capability: 'travel'; risk: 'low'; handledBy: 'flight-booking'; text: string }
const waiting = (text: string): Waiting => ({ runId: undefined, status: 'waiting_user', capability: 'travel', risk: 'low', handledBy: 'flight-booking', text })
const norm = (v: unknown) => String(v || '').replace(/\s+/g, ' ').trim()

async function savePending(tg: string, state: Record<string, unknown>, reply: string) {
  const { error } = await supabaseAdmin.from('agent_activity').insert({ telegram_id: tg, event_type: 'flight_booking_details',
    message: 'Flight booking is waiting for traveller details.', metadata_json: { ...state, reply, at: new Date().toISOString() } })
  if (error) throw new Error('flight_booking_state_write_failed')
}

/** The traveller-details question is open only while it is the latest assistant message and recent. */
async function loadPending(actor: AgentActor, text: string): Promise<{ runId: string; optionIndex: number } | null> {
  const tg = String(actor.legacyTelegramId)
  const { data, error } = await supabaseAdmin.from('conversations').select('role,content,created_at').eq('telegram_id', Number(actor.legacyTelegramId)).order('created_at', { ascending: false }).limit(6)
  if (error) throw new Error('flight_booking_conversation_read_failed')
  const rows = Array.isArray(data) ? data : []
  const previous = rows.find(r => r.role === 'assistant')
  if (!previous) return null
  const at = Date.parse(String(previous.created_at || ''))
  if (!Number.isFinite(at) || Date.now() - at > 30 * 60_000) return null
  if (rows.some(r => r.role === 'user' && Date.parse(r.created_at) > at && String(r.content) !== text)) return null
  const { data: pending, error: pe } = await supabaseAdmin.from('agent_activity').select('metadata_json').eq('telegram_id', tg).eq('event_type', 'flight_booking_details').order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (pe) throw new Error('flight_booking_state_read_failed')
  const state: any = pending?.metadata_json
  const savedAt = Date.parse(String(state?.at || ''))
  if (!Number.isFinite(savedAt) || savedAt > at || Date.now() - savedAt > 30 * 60_000) return null
  if (!state?.runId || !Number.isInteger(state?.optionIndex) || norm(state.reply) !== norm(previous.content)) return null
  return { runId: String(state.runId), optionIndex: Number(state.optionIndex) }
}

/** A read problem here must never break an ordinary message: treat it as "not a booking turn". */
export async function tryFlightBooking(params: { actor: AgentActor; surface: AgentSurface; text: string }) {
  try { return await runFlightBooking(params) } catch (error: any) {
    console.warn('FLIGHT_BOOKING_SKIPPED:', String(error?.message || 'flight_booking_failed').slice(0, 160))
    return null
  }
}

async function runFlightBooking(params: { actor: AgentActor; surface: AgentSurface; text: string }) {
  const { actor, surface } = params
  const text = String(params.text || '').trim()
  const tg = String(actor.legacyTelegramId)
  const pending = await loadPending(actor, text)
  if (pending) {
    if (/^(?:cancel|stop|never ?mind|no|don'?t book|forget it)\b/i.test(text)) return waiting('Okay, I won’t book it. The search link is in the results above if you want to book it yourself.')
    const last = await loadLastFlightResult(actor)
    if (!last || last.runId !== pending.runId) return null
    const option = last.options[pending.optionIndex]
    if (!option) return null
    const count = Math.max(1, Number(last.context.adults) || 1)
    const parsed = parseTravellers(text)
    if (parsed.travellers.length < count || parsed.problems.length) {
      const reply = askText(count, parsed.problems.length ? parsed.problems : [`I need ${count} traveller${count === 1 ? '' : 's'}, I got ${parsed.travellers.length}`])
      await savePending(tg, { runId: pending.runId, optionIndex: pending.optionIndex }, reply)
      return waiting(reply)
    }
    return await createBookingApproval({ actor, surface, last, option, travellers: parsed.travellers.slice(0, count) })
  }
  const pick = flightBookingRequest(text)
  if (!pick) return null
  const last = await loadLastFlightResult(actor)
  if (!last) return null
  const option = pickFlight(last.options, pick)
  if (!option) return waiting(pick.kind === 'nonstop' ? 'None of the options I showed is non-stop. Tell me which number to book, for example “book #1”.' : 'Which one should I book? Tell me the number from the list, for example “book #1”.')
  const index = last.options.indexOf(option)
  const count = Math.max(1, Number(last.context.adults) || 1)
  const fare = option.fareInr ? `₹${option.fareInr.toLocaleString('en-IN')}` : 'the listed fare'
  const reply = `Booking: ${last.context.origin?.code} → ${last.context.destination?.code}, ${last.context.startDate} and back ${last.context.returnDate}.\n${describeFlight(option)}\nAbout ${fare} round trip for ${count} adult${count === 1 ? '' : 's'}; fares move, so I will stop if the price on the booking page is more than 10% higher.\n\n${askText(count)}`
  await savePending(tg, { runId: last.runId, optionIndex: index }, reply)
  return waiting(reply)
}

async function createBookingApproval(p: { actor: AgentActor; surface: AgentSurface; last: LastFlightResult; option: BrowserFlightOption; travellers: Traveller[] }) {
  const { actor, surface, last, option, travellers } = p
  const tg = String(actor.legacyTelegramId)
  const url = last.searchLink
  const objective = flightBookingObjective({ context: last.context, option, travellers })
  const command = { url, objective, mode: 'execute' as const, risk: 'high' as const, approvalAction: 'booking' as const, flow: 'provider_booking' as const }
  const purgeAt = new Date(Date.now() + 24 * 3600_000).toISOString()
  const metadata = { plan_type: 'secure_browser', url, objective, mode: 'execute', risk: 'high', approval_action: 'booking', flow: 'provider_booking',
    flight_booking: { search_run_id: last.runId, route: `${last.context.origin?.code}-${last.context.destination?.code}`, depart: last.context.startDate, return: last.context.returnDate,
      airline: option.airline, fare_inr: option.fareInr, travellers: travellers.length, pii_purge_at: purgeAt } }
  const booking = await createApprovalBrowserRun({ actor, surface, command, metadata })
  const { data: approval, error } = await supabaseAdmin.from('agent_approvals').insert({
    telegram_id: tg, run_id: booking.runId, action_type: 'booking',
    title: `Approve flight booking up to payment · ${last.context.origin?.code}→${last.context.destination?.code}`,
    description: 'Gogo will pick this flight, continue to the booking page, fill the traveller details you gave, and stop at payment with a link for you to pay. Gogo never pays.',
    payload_preview: [
      { label: 'Flight', value: safe(describeFlight(option), 220) },
      { label: 'Dates', value: `${last.context.startDate} → ${last.context.returnDate}` },
      { label: 'Travellers', value: safe(travellers.map(t => t.name).join(', '), 220) },
      { label: 'Quoted fare', value: option.fareInr ? `₹${option.fareInr.toLocaleString('en-IN')} round trip` : 'as listed' },
      { label: 'Risk', value: 'high' },
    ],
    execution_payload: { plan_type: 'secure_browser', stepId: booking.stepId, url },
    risk_level: 'high', status: 'pending',
    ...browserApprovalBinding(booking.runId, booking.stepId, command),
  }).select('id').single()
  if (error || !approval?.id) throw new Error(`flight_booking_approval_failed:${error?.message || 'unknown'}`)
  const now = new Date().toISOString()
  await supabaseAdmin.from('agent_steps').update({ status: 'waiting_approval' }).eq('id', booking.stepId)
  await supabaseAdmin.from('agent_runs').update({ status: 'waiting_approval', summary: 'Flight booking ready. Waiting for your approval before Gogo fills the booking.', progress: 25, updated_at: now }).eq('id', booking.runId).eq('telegram_id', tg)
  const fare = option.fareInr ? `₹${option.fareInr.toLocaleString('en-IN')}` : 'the listed fare'
  return {
    runId: booking.runId, status: 'waiting_approval' as const, capability: 'browser' as const, risk: 'high' as const,
    text: `Ready to book:\n${describeFlight(option)}\n${last.context.startDate} → ${last.context.returnDate} · ${fare} round trip\nTravellers: ${travellers.map(t => t.name).join(', ')}\n\nAfter you approve, I fill the booking on the airline or booking site and stop at payment. I never enter card or UPI details and never press Pay; I send you a link to pay yourself. Your details are deleted after 24 hours.\n\nReply *APPROVE* to continue or *REJECT* to stop.`,
    approvalId: String(approval.id), approvalRequired: true, handledBy: 'flight-booking' as const,
  }
}

/** Removes traveller names and dates of birth from finished or old flight booking runs. */
export async function purgeFlightBookingPii(options: { runId?: string } = {}) {
  let query = supabaseAdmin.from('agent_runs').select('id,telegram_id,metadata_json').eq('metadata_json->>plan_type', 'secure_browser').not('metadata_json->flight_booking', 'is', null)
  if (options.runId) query = query.eq('id', options.runId)
  else query = query.lt('metadata_json->flight_booking->>pii_purge_at', new Date().toISOString())
  const { data, error } = await query.limit(50)
  if (error) throw new Error('flight_booking_purge_read_failed')
  let purged = 0
  for (const run of data || []) {
    const meta: any = run.metadata_json || {}
    if (meta.flight_booking?.pii_purged) continue
    const next = { ...meta, objective: '[traveller details removed]', flight_booking: { ...meta.flight_booking, pii_purged: true } }
    const { error: ue } = await supabaseAdmin.from('agent_runs').update({ metadata_json: next }).eq('id', run.id)
    if (!ue) purged++
  }
  return purged
}
