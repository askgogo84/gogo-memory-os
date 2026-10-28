import { supabaseAdmin } from '@/lib/supabase-admin'
import { redactSecretShapedText } from '@/lib/bot/memory-redaction'
import { browserApprovalBinding, createApprovalBrowserRun } from './browser-command'
import { googleFlightsTfsUrl, oneWayDisplayOrder, oneWaySearchLink, roundTripDisplayOrder, roundTripSearchLink } from './travel-browser-task'
import type { BrowserFlightOption } from './travel-browser-task'
import { capabilityPaused, capabilityPausedText } from './policy'
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
  const m = raw.match(/^(?:(?:ok(?:ay)?|yes|yeah|sure|please)[,.! ]+)?(?:(?:go ahead|can you|could you|please|now)\s+(?:and\s+)?)*(?:book|reserve|buy|get me)(?:\s+(?:me\s+)?(?:the\s+|that\s+|this\s+)?(.*?))?[.!?\s]*$/i)
  if (!m) return null
  const rest = (m[1] || '').toLowerCase()
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

export type LastFlightResult = { runId: string; context: any; options: BrowserFlightOption[]; searchLink: string; startedAt?: string }

/**
 * 27 Oct 13:53 live: "flights … on 19 Nov", then "Book the cheapest" before those results arrived, booked from the
 * previous (18 Nov) result. A flight search still running that started after the result Gogo would book wins: say so.
 */
export async function newerFlightSearchPending(actor: AgentActor, after: string | null): Promise<{ date: string | null; route: string | null; failed?: boolean } | null> {
  const since = new Date(Date.now() - 30 * 60_000).toISOString()
  // 27 Oct 15:56 live: the 20 Nov search failed (no live rows) and "Book 1" then booked the 19 Nov result. A newer
  // search that failed also wins: Gogo says so instead of booking an older date.
  const q = supabaseAdmin.from('agent_runs').select('id,status,metadata_json,started_at').eq('telegram_id', String(actor.legacyTelegramId)).eq('type', 'travel_research')
    .in('status', ['queued', 'running', 'failed', 'completed']).gte('started_at', after && after > since ? after : since).order('started_at', { ascending: false }).limit(1)
  const { data, error } = await q
  if (error || !data?.length) return null
  if (after && !(String(data[0].started_at) > after)) return null
  const ctx: any = (data[0].metadata_json as any)?.context || {}
  const status = String((data[0] as any).status || 'running')
  return { date: typeof ctx.startDate === 'string' ? ctx.startDate : null, route: ctx.origin?.code && ctx.destination?.code ? `${ctx.origin.code} → ${ctx.destination.code}` : null, ...(status === 'failed' || status === 'completed' ? { failed: true } : {}) }
}

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
    if (!context || context.kind !== 'flight' || !context.startDate) continue
    if (!Array.isArray(flights) || !flights.length) continue
    // 18 Oct: a one-way result can be booked too; the list order is the one the person saw.
    const round = Boolean(context.roundTrip && context.returnDate)
    const options = round ? roundTripDisplayOrder(flights as BrowserFlightOption[]) : oneWayDisplayOrder(flights as BrowserFlightOption[])
    if (options.length) return { runId: String(run.id), context, options, searchLink: round ? roundTripSearchLink(context) : oneWaySearchLink(context), startedAt: String(run.started_at || '') }
  }
  return null
}

export function pickFlight(options: BrowserFlightOption[], pick: FlightPick): BrowserFlightOption | null {
  if (pick.kind === 'cheapest') return options[0] || null
  if (pick.kind === 'nonstop') return options.find(o => o.stops === 0) || null
  return options[pick.n - 1] || null
}

export type Traveller = { name: string; dob?: string; title?: string; gender?: 'Male' | 'Female' }
export type BookingContact = { email: string; mobile: string }
export type SeatChoice = 'free' | 'window' | 'aisle' | 'paid'

const TITLE = /^(mr|mrs|ms|miss|mstr|master)\.?\s+/i
const titleOf = (raw: string) => { const t = raw.toLowerCase(); return t === 'mr' ? 'Mr' : t === 'mrs' ? 'Mrs' : t === 'ms' ? 'Ms' : t === 'miss' ? 'Miss' : 'Master' }
const genderOf = (title: string): 'Male' | 'Female' => /^(mr|master)$/i.test(title) ? 'Male' : 'Female'

/**
 * 27 Oct (owner): "let it ask all the details and it should be able to book, even ask for paid seat or auto selection".
 * One reply carries everything the airline's passenger page needs: a line per traveller with title + name (and date of
 * birth abroad), the ticket email, the ticket mobile, and the seat choice. Nothing is guessed; a missing part is asked for.
 */
export function parseBookingDetails(text: string, count: number, options: { domestic?: boolean; now?: Date } = {}) {
  const problems: string[] = []
  let email = '', mobile = '', seat: SeatChoice | null = null
  const people: string[] = []
  for (const raw of String(text || '').split(/[\n;]+/).map(l => l.trim()).filter(Boolean)) {
    const line = raw.replace(/^\s*(?:email|e-mail|mobile|phone|seat|traveller|traveler|passenger|name)\s*\d*\s*[:\-]\s*/i, '')
    const em = line.match(/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/)
    if (em) { email = em[0].toLowerCase(); continue }
    const digits = line.replace(/[\s()-]/g, '')
    if (/^(?:\+?91|0)?[6-9]\d{9}$/.test(digits)) { mobile = digits.slice(-10); continue }
    if (/\b(?:seat|auto|free|window|aisle)\b/i.test(line) && !TITLE.test(line)) {
      seat = /\bwindow\b/i.test(line) ? 'window' : /\baisle\b/i.test(line) ? 'aisle' : /\bpaid\b/i.test(line) ? 'paid' : /\b(?:free|auto|any|no)\b/i.test(line) ? 'free' : null
      if (!seat) problems.push(`“${line.slice(0, 30)}”: say free seat, paid window seat or paid aisle seat`)
      continue
    }
    people.push(line)
  }
  const travellers: Traveller[] = []
  for (const line of people) {
    const t = line.match(TITLE)
    if (!t) { problems.push(`add Mr, Ms or Mrs before “${line.slice(0, 30)}”`); continue }
    const parsed = parseTravellers(line.replace(TITLE, ''), options.now || new Date(), { domestic: options.domestic })
    problems.push(...parsed.problems)
    for (const tr of parsed.travellers) { const title = titleOf(t[1]); travellers.push({ ...tr, title, gender: genderOf(title) }) }
  }
  if (travellers.length < count && !problems.length) problems.push(`I need ${count} traveller${count === 1 ? '' : 's'}, I got ${travellers.length}`)
  if (!email) problems.push('the email for the ticket')
  if (!mobile) problems.push('a 10-digit mobile for the ticket')
  if (!seat) problems.push('the seat choice')
  return { travellers: travellers.slice(0, count), contact: email && mobile ? { email, mobile } as BookingContact : null, seat, problems }
}

export const seatLabel = (seat: SeatChoice) => seat === 'free' ? 'Free seat (airline assigns it)' : seat === 'paid' ? 'Paid seat (cheapest available)' : `Paid ${seat} seat (cheapest available)`
const maskMobile = (m: string) => `••••••${m.slice(-4)}`

// 26 Oct (owner): domestic Indian flights need the name as on any government photo ID (Aadhaar, PAN, driving licence,
// passport); a passport and date of birth are only needed for international trips.
const INDIA_AIRPORTS = new Set(['BLR','BOM','DEL','HYD','MAA','CCU','PNQ','GOI','GOX','AMD','JAI','COK','TRV','LKO','IXC','CJB','IXE','VTZ','BBI','PAT','VNS','IDR','NAG','GAU','SXR','ATQ','UDR',
  'IXB','IXR','IXZ','RPR','BHO','IXM','TRZ','IXA','IXJ','VGA','IXU','STV','BDQ','HBX','IXG','MYQ','IMF','DIB','DED','RJA','TIR','CCJ','IXL','GOP','AGR','JDH','BHJ','IXD','KNU','GWL','JLR','IXY','IXS','DMU','AJL','HSR','SAG','KLH','NDC','JGA','PNY','TCR','IXP','DHM','KUU','BEK','HJR','VDY','JRG','BPM','GBI','GAY'])
export function isDomesticIndiaTrip(context: any) {
  const o = String(context?.origin?.code || '').toUpperCase(), d = String(context?.destination?.code || '').toUpperCase()
  return INDIA_AIRPORTS.has(o) && INDIA_AIRPORTS.has(d)
}

const pad = (n: number) => String(n).padStart(2, '0')

/** One traveller per line (or separated by ";"): "Goverdhan Mandyam Dommane, 12 Mar 1985" or "... 12/03/1985". */
export function parseTravellers(text: string, now = new Date(), options: { domestic?: boolean } = {}): { travellers: Traveller[]; problems: string[] } {
  const travellers: Traveller[] = []
  const problems: string[] = []
  const chunks = String(text || '').split(/[\n;]+/).map(c => c.trim()).filter(Boolean)
  for (const chunk of chunks) {
    const dateRe = /(\d{1,2})[\s/.\-]+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|\d{1,2})[\s/.\-,]+(\d{4})/i
    const dm = chunk.match(dateRe)
    const idLabel = options.domestic ? 'as on your government photo ID' : 'as on the passport'
    // Domestic: the date of birth is optional; only the name matters.
    if (!dm && options.domestic) {
      const single = chunk.match(/^\s*single\s+name\s*[:\-]?\s*([A-Za-z][A-Za-z'-]{1,40})\s*$/i)
      const name = (single ? single[1] : chunk).replace(/^\s*(?:name|passenger|traveller|traveler|adult)(?:\s+\d+)?\s*[:\-]\s*/i, ' ').replace(/[,:()\-]+/g, ' ').replace(/\s+/g, ' ').trim()
      if (!/^[A-Za-z][A-Za-z .'-]{1,78}$/.test(name) || (!single && name.split(' ').filter(Boolean).length < 2)) {
        problems.push(`“${name.slice(0, 40) || chunk.slice(0, 40)}” needs a first and last name ${idLabel} (if your ID shows only one name, send “single name ${name.split(' ')[0] || 'Name'}”)`); continue
      }
      travellers.push({ name: name.replace(/\b([a-z])/g, c => c.toUpperCase()) }); continue
    }
    if (!dm) { problems.push(`no date of birth in “${chunk.slice(0, 40)}”`); continue }
    const day = Number(dm[1]); const monthRaw = dm[2].toLowerCase()
    const month = /^\d+$/.test(monthRaw) ? Number(monthRaw) : MONTHS[monthRaw.slice(0, 4)] || MONTHS[monthRaw.slice(0, 3)]
    const year = Number(dm[3])
    const date = new Date(Date.UTC(year, (month || 1) - 1, day))
    const valid = month >= 1 && month <= 12 && date.getUTCDate() === day && date.getUTCMonth() === month - 1 && year >= 1900 && date.getTime() < now.getTime()
    if (!valid) { problems.push(`“${dm[0]}” is not a valid date of birth`); continue }
    const name = chunk.replace(dm[0], ' ')
      .replace(/\b(?:dob|d\.o\.b|date of birth|born(?: on)?)\b\s*[:\-]?\s*$/i,' ')
      .replace(/^\s*(?:name|passenger|traveller|traveler|adult)(?:\s+\d+)?\s*[:\-]\s*/i,' ')
      .replace(/[,:()\-]+/g, ' ').replace(/\s+/g, ' ').trim()
    const singleOk = Boolean(options.domestic) && /^\s*single\s+name\b/i.test(chunk)
    const cleanName = singleOk ? name.replace(/^single\s+name\s*/i, '').trim() : name
    if (!/^[A-Za-z][A-Za-z .'-]{1,78}$/.test(cleanName) || (!singleOk && cleanName.split(' ').filter(Boolean).length < 2)) { problems.push(`“${cleanName.slice(0, 40) || chunk.slice(0, 40)}” needs a first and last name ${idLabel}${options.domestic ? ` (if your ID shows only one name, send “single name ${cleanName.split(' ')[0] || 'Name'}”)` : ''}`); continue }
    travellers.push({ name: cleanName.replace(/\b([a-z])/g, c => c.toUpperCase()), dob: `${day} ${MONTH_NAMES[month - 1]} ${year}` })
  }
  return { travellers, problems }
}

export function describeFlight(option: BrowserFlightOption) {
  const stops = option.stops === 0 ? 'non-stop' : `${option.stops} stop${option.stops === 1 ? '' : 's'}${option.layover ? ` (${option.layover})` : ''}`
  return `${option.airline}, out ${option.departure} → ${option.arrival}, ${stops}`
}

const isRound = (context: any) => Boolean(context?.roundTrip && context?.returnDate)
const datesLabel = (context: any) => isRound(context) ? `${context.startDate} → ${context.returnDate}` : `${context.startDate} (one-way)`
const fareKind = (context: any) => isRound(context) ? 'round trip' : 'one-way'

export function flightBookingObjective(params: { context: any; option: BrowserFlightOption; travellers: Traveller[]; contact?: BookingContact | null; seat?: SeatChoice | null }) {
  const { context, option, travellers, contact, seat } = params
  const fare = option.fareInr ? `₹${option.fareInr.toLocaleString('en-IN')}` : 'the listed fare'
  const who = travellers.map((t, i) => `traveller ${i + 1}: ${t.title ? `title ${t.title}, gender ${t.gender}, ` : ''}full name ${t.name}${t.dob ? `, date of birth ${t.dob}` : ''}`).join('; ')
  const seatRule = seat === 'free' ? 'On seat selection, skip it or keep the free seat the airline assigns; never choose a paid seat. ' : seat ? `On seat selection, choose the cheapest available ${seat === 'paid' ? '' : `${seat} `}seat for each traveller; its price is added to the fare. ` : ''
  const round = isRound(context)
  return safe(`Flight booking up to payment on Google Flights: ${round ? 'round trip' : 'one-way'} ${context.origin?.code} to ${context.destination?.code}, depart ${context.startDate}${round ? `, return ${context.returnDate}` : ''}, ${travellers.length} adult${travellers.length === 1 ? '' : 's'}, ${String(context.cabin || 'economy').replace(/_/g, ' ')}. `
    + `Choose the ${option.airline} result that leaves ${option.departure} on ${context.startDate} (about ${fare} ${round ? 'round trip' : 'one-way'})${round ? `, then the cheapest return on ${context.returnDate}` : ''}, and continue (Select flight, Continue, Book) to the airline or booking site. `
    + `On the booking options, pick "Continue to book with ${option.airline}" (the airline itself) when it is listed; otherwise MakeMyTrip, Cleartrip, Goibibo, ixigo, EaseMyTrip or Yatra. Never pick any other agency. `
    + `If the site asks for passenger details, use exactly: ${who}. `
    + (contact ? `For contact details use email ${contact.email}, and fill the mobile number field with fill_phone (Gogo types the approved number). ` : '')
    + `Do not guess any other field; leave it for the person. Continue as a guest; never log in or create an account. `
    + seatRule + `Decline every other paid add-on (insurance, meals, extra baggage, priority, fare upgrades). `
    + `If the fare on the booking page (not counting a seat you chose) is more than 10% above ${fare}, or it is a different flight, stop and report. `
    + `Stop on the payment step: never pay, never enter card, UPI or bank details, never press Pay.`, 1800)
}

const askText = (count: number, problems: string[] = [], domestic = false) =>
  `${problems.length ? `I still need: ${problems.slice(0, 4).join('; ')}. Please send everything again in one message.\n\n` : ''}`
  + `Send these in one message, one per line:\n`
  + (domestic
    ? `${count === 1 ? 'Title and full name' : `Title and full name of each of the ${count} travellers, one per line`}, as on a government photo ID (Aadhaar, PAN, driving licence or passport)\n`
    : `${count === 1 ? 'Title, full name and date of birth' : `Title, full name and date of birth of each of the ${count} travellers, one per line`}, exactly as on the passport\n`)
  + `Email for the ticket\nMobile for the ticket\nSeat: free seat, paid window seat or paid aisle seat\n\nFor example:\n\n`
  + (domestic ? `Ms Divya Rao` : `Ms Divya Rao, 12 Mar 1990`) + `\ndivya.rao@gmail.com\n9876543210\nfree seat\n\n`
  + (domestic ? 'This is a domestic flight, so no passport or date of birth is needed. Carry the same ID to the airport.' : 'This is an international flight, so the name must match the passport.')

type Waiting = { runId: undefined; status: 'waiting_user'; capability: 'travel'; risk: 'low'; handledBy: 'flight-booking'; text: string }
const waiting = (text: string): Waiting => ({ runId: undefined, status: 'waiting_user', capability: 'travel', risk: 'low', handledBy: 'flight-booking', text })
const norm = (v: unknown) => String(v || '').replace(/\s+/g, ' ').trim()

async function savePending(tg: string, state: Record<string, unknown>, reply: string) {
  const { error } = await supabaseAdmin.from('agent_activity').insert({ telegram_id: tg, event_type: 'flight_booking_details',
    message: 'Flight booking is waiting for traveller details.', metadata_json: { ...state, reply, at: new Date().toISOString() } })
  if (error) throw new Error('flight_booking_state_write_failed')
}

/** The person's message before this one (the details they sent before a re-ask). Chat history only; nothing new is stored. */
async function previousUserMessage(actor: AgentActor, current: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin.from('conversations').select('role,content,created_at').eq('telegram_id', Number(actor.legacyTelegramId)).eq('role', 'user').order('created_at', { ascending: false }).limit(3)
  if (error || !Array.isArray(data)) return null
  const rows = data.map(r => String(r.content || ''))
  const i = rows.findIndex(r => norm(r) === norm(current))
  const prev = rows[i >= 0 ? i + 1 : 0]
  return prev && norm(prev) !== norm(current) ? prev : null
}

/** Puts the title in front of each traveller line that has none (email, mobile and seat lines are left alone). */
export function withTitle(details: string, title: string) {
  return String(details || '').split(/\n+/).map(line => {
    const l = line.trim()
    if (!l || /@/.test(l) || /^(?:\+?91|0)?[6-9]\d{9}$/.test(l.replace(/[\s()-]/g, '')) || /\b(?:seat|auto|free|window|aisle)\b/i.test(l) || /^(?:mr|mrs|ms|miss|mstr|master)\.?\s/i.test(l)) return l
    return `${title} ${l}`
  }).join('\n')
}

export type SavedBookingProfile = { travellers: Traveller[]; contact: BookingContact; seat: SeatChoice }

/**
 * 27 Oct (owner): "why does it keep asking the same details again and again". The details from the person's last
 * approved flight booking (kept only until that booking's 24-hour purge) are offered again with one YES.
 */
export async function loadSavedBookingProfile(actor: AgentActor, count: number): Promise<SavedBookingProfile | null> {
  const since = new Date(Date.now() - 24 * 3600_000).toISOString()
  const { data, error } = await supabaseAdmin.from('agent_runs').select('metadata_json,created_at').eq('telegram_id', String(actor.legacyTelegramId))
    .eq('metadata_json->>plan_type', 'secure_browser').not('metadata_json->flight_booking', 'is', null).gte('created_at', since).order('created_at', { ascending: false }).limit(5)
  if (error) return null
  for (const row of data || []) {
    const fb: any = (row.metadata_json as any)?.flight_booking
    const p: any = fb?.profile
    if (!fb || fb.pii_purged || !p || !Array.isArray(p.travellers) || p.travellers.length !== count) continue
    if (!/^[6-9]\d{9}$/.test(String(fb.contact_mobile || '')) || !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(String(p.email || '')) || !['free', 'window', 'aisle', 'paid'].includes(p.seat)) continue
    if (!p.travellers.every((t: any) => typeof t?.name === 'string' && typeof t?.title === 'string')) continue
    return { travellers: p.travellers, contact: { email: p.email, mobile: String(fb.contact_mobile) }, seat: p.seat }
  }
  return null
}

const profileLines = (p: SavedBookingProfile) => `${p.travellers.map(t => `${t.title} ${t.name}${t.dob ? `, ${t.dob}` : ''}`).join('\n')}\n${p.contact.email} · ${maskMobile(p.contact.mobile)}\n${seatLabel(p.seat)}`

// 28 Oct (owner): booking asked for every detail again though Gogo already knew his name, mobile and that he prefers
// window seats. With no recent booking to reuse, it now proposes what it knows and asks only for the title.
export type KnownDetails = { name: string; email: string; mobile: string; seat: SeatChoice; seatFromMemory: boolean }

export function seatFromPreference(texts: string[]): SeatChoice | null {
  for (const t of texts) {
    const l = String(t || '').toLowerCase()
    if (!/\bseat|\bprefer|\blike/.test(l)) continue
    if (/\bwindow\b/.test(l)) return 'window'
    if (/\baisle\b/.test(l)) return 'aisle'
  }
  return null
}

export async function loadKnownDetails(actor: AgentActor): Promise<KnownDetails | null> {
  const tg = Number(actor.legacyTelegramId)
  const [user, mems, prefs] = await Promise.all([
    supabaseAdmin.from('users').select('name,email,gmail_email').eq('telegram_id', tg).maybeSingle().then(r => r.data as any, () => null),
    supabaseAdmin.from('memories').select('content').eq('telegram_id', tg).order('created_at', { ascending: false }).limit(40).then(r => (r.data || []).map((m: any) => String(m.content || '')), () => []),
    supabaseAdmin.from('user_preferences').select('rule_text').eq('telegram_id', tg).limit(20).then(r => (r.data || []).map((m: any) => String(m.rule_text || '')), () => []),
  ])
  const name = String(user?.name || '').replace(/[^A-Za-z .'-]/g, ' ').replace(/\s+/g, ' ').trim()
  const email = [user?.email, user?.gmail_email].map(e => String(e || '').trim().toLowerCase()).find(e => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(e)) || ''
  const mobile = String(actor.whatsappId || '').replace(/\D/g, '').slice(-10)
  if (name.split(' ').length < 2 || !email || !/^[6-9]\d{9}$/.test(mobile)) return null
  const remembered = seatFromPreference([...mems, ...prefs])
  return { name, email, mobile, seat: remembered || 'free', seatFromMemory: Boolean(remembered) }
}

export const knownDetailsText = (k: KnownDetails) => `Shall I use what I already know?\n${k.name}\n${k.email} · ${maskMobile(k.mobile)}\n${seatLabel(k.seat)}${k.seatFromMemory ? ` (you said you prefer ${k.seat})` : ''}\n\nIf the name is exactly as on your photo ID, reply with just your title to book with these, for example:\n\nMr\n\nOr send new details (title and name, email, mobile, seat; one per line).`
const knownDetailsLines = (k: KnownDetails, title: string) => `${title} ${k.name}\n${k.email}\n${k.mobile}\n${k.seat === 'free' ? 'free seat' : `paid ${k.seat === 'paid' ? '' : `${k.seat} `}seat`}`

/** The traveller-details question is open only while it is the latest assistant message and recent. */
async function loadPending(actor: AgentActor, text: string): Promise<{ runId: string; optionIndex: number; reuse?: boolean; retry?: boolean; known?: boolean } | null> {
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
  return { runId: String(state.runId), optionIndex: Number(state.optionIndex), reuse: state.reuse === true, retry: state.retry === true, known: state.known === true }
}

async function lateBookingDetails(actor: AgentActor, text: string) {
  if (!/@/.test(text) || !/\n/.test(text)) return null
  const { data: pending } = await supabaseAdmin.from('agent_activity').select('metadata_json,created_at').eq('telegram_id', String(actor.legacyTelegramId)).eq('event_type', 'flight_booking_details')
    .gte('created_at', new Date(Date.now() - 2 * 3600_000).toISOString()).order('created_at', { ascending: false }).limit(1).maybeSingle()
  const state: any = pending?.metadata_json
  if (!state?.runId || !Number.isInteger(state?.optionIndex)) return null
  const last = await loadLastFlightResult(actor)
  if (!last || last.runId !== String(state.runId)) return null
  const option = last.options[Number(state.optionIndex)]
  const count = Math.max(1, Number(last.context.adults) || 1)
  if (!option) return null
  const parsed = parseBookingDetails(text, count, { domestic: isDomesticIndiaTrip(last.context) })
  if (parsed.travellers.length < count || parsed.problems.length || !parsed.contact || !parsed.seat) return null
  return { last, option, travellers: parsed.travellers, contact: parsed.contact, seat: parsed.seat }
}

/** A read problem here must never break an ordinary message: treat it as "not a booking turn". */
export async function tryFlightBooking(params: { actor: AgentActor; surface: AgentSurface; text: string }) {
  try { return await runFlightBooking(params) } catch (error: any) {
    console.warn('FLIGHT_BOOKING_SKIPPED:', String(error?.message || 'flight_booking_failed').slice(0, 160))
    return null
  }
}

/** Launch kill switch: bookings run in the person's signed-in browser, so either switch pauses them. */
const bookingPaused = () => capabilityPaused('booking') || capabilityPaused('logged_in_browser')
const bookingPausedReply = (last: LastFlightResult | null) =>
  waiting(capabilityPausedText('booking', { searchLink: last ? (googleFlightsTfsUrl(last.context) || last.searchLink) : null }))

async function runFlightBooking(params: { actor: AgentActor; surface: AgentSurface; text: string }) {
  const { actor, surface } = params
  const text = String(params.text || '').trim()
  const tg = String(actor.legacyTelegramId)
  const paused = bookingPaused()
  const pending = await loadPending(actor, text)
  if (pending) {
    if (/^(?:cancel|stop|never ?mind|no|don'?t book|forget it)\b/i.test(text)) return waiting('Okay, I won’t book it. The search link is in the results above if you want to book it yourself.')
    if (paused) return bookingPausedReply(await loadLastFlightResult(actor).catch(() => null))
    const last = await loadLastFlightResult(actor)
    if (!last || last.runId !== pending.runId) return null
    const option = last.options[pending.optionIndex]
    if (!option) return null
    const count = Math.max(1, Number(last.context.adults) || 1)
    const domestic = isDomesticIndiaTrip(last.context)
    if (pending.reuse && /^(?:yes|y|yeah|yep|ok(?:ay)?|sure|same|same details|use (?:the )?same|use them|yes(?:,)? (?:same|use them|please))[.! ]*$/i.test(text)) {
      const saved = await loadSavedBookingProfile(actor, count)
      if (saved) return await createBookingApproval({ actor, surface, last, option, travellers: saved.travellers, contact: saved.contact, seat: saved.seat })
    }
    // Only a flag is stored with the pending question; the details are read again from the profile, never copied.
    const known = pending.known && count === 1 ? await loadKnownDetails(actor).catch(() => null) : null
    if (known) {
      const t = text.match(/^\s*(?:(?:yes|ok(?:ay)?|sure)[,.!\s]*)?(mr|mrs|ms|miss)\.?\s*[.!]?\s*$/i)
      if (t) {
        const p = parseBookingDetails(knownDetailsLines(known, t[1]), count, { domestic })
        if (p.travellers.length === 1 && p.contact && p.seat && !p.problems.length) return await createBookingApproval({ actor, surface, last, option, travellers: p.travellers, contact: p.contact, seat: p.seat })
      }
      if (/^(?:yes|y|yeah|yep|ok(?:ay)?|sure|use them|same)[.! ]*$/i.test(text)) {
        const reply = `Almost done. Is that Mr, Ms or Mrs? Reply with just the title, for example:\n\nMr`
        await savePending(tg, { runId: pending.runId, optionIndex: pending.optionIndex, known: true }, reply)
        return waiting(reply)
      }
    }
    // 27 Oct 15:57 (owner): a missing "Mr" made him resend everything. After a re-ask, the reply is combined with the
    // details message he already sent (read from the chat history, nothing new is stored), and only the gap is asked for.
    const complete = (p: ReturnType<typeof parseBookingDetails>) => p.travellers.length >= count && !p.problems.length && Boolean(p.contact) && Boolean(p.seat)
    let parsed = parseBookingDetails(text, count, { domestic })
    const prev = !complete(parsed) && pending.retry ? await previousUserMessage(actor, text).catch(() => null) : null
    if (prev) {
      const title = text.match(/^\s*(mr|mrs|ms|miss|master)\.?\s*$/i)
      const merged = parseBookingDetails(title ? withTitle(prev, title[1]) : `${prev}\n${text}`, count, { domestic })
      if (complete(merged) || merged.problems.length < parsed.problems.length) parsed = merged
    }
    if (!complete(parsed)) {
      const onlyTitle = parsed.problems.length > 0 && parsed.problems.every(p => /Mr, Ms or Mrs/.test(p)) && parsed.contact && parsed.seat
      const reply = onlyTitle
        ? `Almost done. Is that Mr, Ms or Mrs? Reply with just the title, for example:\n\nMr`
        : prev || pending.retry
          ? `I still need: ${parsed.problems.slice(0, 4).join('; ')}. Send just ${parsed.problems.length === 1 ? 'that' : 'those'}; I've kept the rest.`
          : askText(count, parsed.problems, domestic)
      await savePending(tg, { runId: pending.runId, optionIndex: pending.optionIndex, retry: true }, reply)
      return waiting(reply)
    }
    return await createBookingApproval({ actor, surface, last, option, travellers: parsed.travellers, contact: parsed.contact, seat: parsed.seat })
  }
  // 28 Oct live: a status message Gogo sent at 10:40 sat between the details question and the person's details
  // (11:06), so the details were not treated as an answer and the chat model invented a booking. A message that is
  // complete booking details answers the latest open booking question from the last 2 hours, whatever came between.
  const late = await lateBookingDetails(actor, text).catch(() => null)
  if (late) return paused ? bookingPausedReply(late.last) : await createBookingApproval({ actor, surface, ...late })
  // "book from the 2026-11-19 results": the person explicitly picks the older completed search.
  const older = text.match(/\s*\bfrom the (20\d{2}-\d{2}-\d{2}) results\b/i)
  const pick = flightBookingRequest(older ? text.replace(older[0], '').trim() : text)
  if (!pick) return null
  if (paused) return bookingPausedReply(await loadLastFlightResult(actor).catch(() => null))
  const last = await loadLastFlightResult(actor)
  const newer = older && last?.context?.startDate === older[1] ? null : await newerFlightSearchPending(actor, last?.startedAt || null).catch(() => null)
  if (newer?.failed) return waiting(`Your latest search${newer.route ? ` (${newer.route}` : ''}${newer.date ? `${newer.route ? ', ' : ' ('}${newer.date})` : newer.route ? ')' : ''} didn't get live fares, so there's nothing from it to book. Send the search again${last ? `, or say "book from the ${last.context.startDate} results"` : ''}.`)
  if (newer) return waiting(`I'm still searching${newer.route ? ` ${newer.route}` : ''}${newer.date ? ` for ${newer.date}` : ''}. I'll send the options here in a minute or two; then say "book 1" (or "book the cheapest") and I'll book from those results, not the earlier search.`)
  if (!last) return null
  const option = pickFlight(last.options, pick)
  if (!option) return waiting(pick.kind === 'nonstop' ? 'None of the options I showed is non-stop. Tell me which number to book, for example “book #1”.' : 'Which one should I book? Tell me the number from the list, for example “book #1”.')
  const index = last.options.indexOf(option)
  const count = Math.max(1, Number(last.context.adults) || 1)
  const fare = option.fareInr ? `₹${option.fareInr.toLocaleString('en-IN')}` : 'the listed fare'
  const head = `Booking: ${last.context.origin?.code} → ${last.context.destination?.code}, ${isRound(last.context) ? `${last.context.startDate} and back ${last.context.returnDate}` : `${last.context.startDate}, one-way`}.\n${describeFlight(option)}\nAbout ${fare} ${fareKind(last.context)} for ${count} adult${count === 1 ? '' : 's'}; fares move, so I will stop if the price on the booking page is more than 10% higher.`
  const saved = await loadSavedBookingProfile(actor, count).catch(() => null)
  const known = !saved && count === 1 && isDomesticIndiaTrip(last.context) ? await loadKnownDetails(actor).catch(() => null) : null
  const reply = saved
    ? `${head}\n\nUse the same details as your last booking?\n${profileLines(saved)}\n\nReply *YES* to use them, or send new details (title and name, email, mobile, seat; one per line).`
    : known ? `${head}\n\n${knownDetailsText(known)}`
    : `${head}\n\n${askText(count, [], isDomesticIndiaTrip(last.context))}`
  await savePending(tg, { runId: last.runId, optionIndex: index, ...(saved ? { reuse: true } : {}), ...(known ? { known: true } : {}) }, reply)
  return waiting(reply)
}

async function createBookingApproval(p: { actor: AgentActor; surface: AgentSurface; last: LastFlightResult; option: BrowserFlightOption; travellers: Traveller[]; contact: BookingContact; seat: SeatChoice }) {
  const { actor, surface, last, option, travellers, contact, seat } = p
  // Defence in depth: no booking run or approval is ever created while bookings are paused.
  if (bookingPaused()) return bookingPausedReply(last)
  const tg = String(actor.legacyTelegramId)
  // 28 Oct live: the booking opened the prose q= link, Google ignored it and filled Pune (the cloud browser's
  // location) as the origin, and the planner could not get back to BLR. Bookings start from Google's own encoded
  // search (same as the search read), so route, date, travellers and cabin are set on load.
  const url = googleFlightsTfsUrl(last.context) || last.searchLink
  const objective = flightBookingObjective({ context: last.context, option, travellers, contact, seat })
  const command = { url, objective, mode: 'execute' as const, risk: 'high' as const, approvalAction: 'booking' as const, flow: 'provider_booking' as const }
  const purgeAt = new Date(Date.now() + 24 * 3600_000).toISOString()
  const metadata = { plan_type: 'secure_browser', url, objective, mode: 'execute', risk: 'high', approval_action: 'booking', flow: 'provider_booking',
    flight_booking: { search_run_id: last.runId, route: `${last.context.origin?.code}-${last.context.destination?.code}`, depart: last.context.startDate, return: last.context.returnDate || null,
      airline: option.airline, fare_inr: option.fareInr, travellers: travellers.length, seat, contact_mobile: contact.mobile,
      profile: { travellers, email: contact.email, seat }, pii_purge_at: purgeAt } }
  const booking = await createApprovalBrowserRun({ actor, surface, command, metadata })
  const { data: approval, error } = await supabaseAdmin.from('agent_approvals').insert({
    telegram_id: tg, run_id: booking.runId, action_type: 'booking',
    title: `Approve flight booking up to payment · ${last.context.origin?.code}→${last.context.destination?.code}`,
    description: 'Gogo will pick this flight, continue to the booking page, fill the traveller details you gave, and stop at payment with a link for you to pay. Gogo never pays.',
    payload_preview: [
      { label: 'Flight', value: safe(describeFlight(option), 220) },
      { label: 'Dates', value: datesLabel(last.context) },
      { label: 'Travellers', value: safe(travellers.map(t => `${t.title || ''} ${t.name}`.trim()).join(', '), 220) },
      { label: 'Ticket contact', value: `${contact.email} · ${maskMobile(contact.mobile)}` },
      { label: 'Seat', value: seatLabel(seat) },
      { label: 'Quoted fare', value: option.fareInr ? `₹${option.fareInr.toLocaleString('en-IN')} ${fareKind(last.context)}` : 'as listed' },
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
    text: `Ready to book:\n${describeFlight(option)}\n${datesLabel(last.context)} · ${fare} ${fareKind(last.context)}\nTravellers: ${travellers.map(t => `${t.title || ''} ${t.name}`.trim()).join(', ')}\nTicket contact: ${contact.email} · ${maskMobile(contact.mobile)}\nSeat: ${seatLabel(seat)}${seat !== 'free' ? ' (its price is added to what you pay)' : ''}\n\nAfter you approve, I fill the booking on the airline or booking site and stop at payment. I never enter card or UPI details and never press Pay; I send you a link to pay yourself. Your details are deleted after 24 hours.\n\nReply *APPROVE* to continue or *REJECT* to stop.`,
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
    const next = { ...meta, objective: '[traveller details removed]', flight_booking: { ...meta.flight_booking, contact_mobile: null, profile: null, pii_purged: true } }
    const { error: ue } = await supabaseAdmin.from('agent_runs').update({ metadata_json: next }).eq('id', run.id)
    if (!ue) purged++
  }
  return purged
}
