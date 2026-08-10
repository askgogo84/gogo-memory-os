import { supabaseAdmin } from '@/lib/supabase-admin'
import { addToList } from '@/lib/lists'
import { buildTicketReply, type TicketInfo, type FlightInfo, type TrainInfo, type EventInfo } from './pdf-reader'
import { AIRLINES, checkInOpensHours, checkInLink, DEFAULT_CHECKIN_OPENS_HOURS } from './airline-checkin'

// Shared store-and-remind path for parsed tickets, used by BOTH the PDF and
// image handlers so their behaviour is identical:
//  - persist each leg (round-trips = multiple rows) into travel_tickets,
//  - create the existing T-3h departure reminder (behaviour-preserving),
//  - create a NEW T-24h web check-in reminder (flights only),
//  - keep one human-readable line in the notes list,
//  - return the same buildTicketReply(...) message.
// Idempotent: re-forwarding the same ticket makes zero duplicate legs and zero
// duplicate reminders (explicit existence checks + a DB unique-index backstop).

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
}

// Domestic-exact tz map. Everything is IST for now; origin-city → IANA mapping
// is a phase-2 extension. Unknown zones fall back to IST with a logged warning.
const TZ_OFFSET_MIN: Record<string, number> = {
  'Asia/Kolkata': 330,
}

function resolveDepartTz(_city?: string): string {
  return 'Asia/Kolkata'
}

// Convert a ticket's local wall-clock (date + "HH:MM") to a UTC instant. For IST
// this yields Date.UTC(y,mo,d,h-5,m-30) — identical to the legacy getReminderTime
// departure calc, so the T-3h reminder is unchanged.
function computeDepartAt(dateStr?: string, timeStr?: string, tz: string = 'Asia/Kolkata'): Date | null {
  if (!dateStr || !timeStr) return null
  try {
    const parts = dateStr.toLowerCase().replace(/,/g, '').split(/\s+/)
    const day = parseInt(parts[0], 10)
    const month = MONTHS[parts[1]?.slice(0, 3)] ?? -1
    const year = parseInt(parts[2], 10)
    const [h, m] = timeStr.split(':').map(Number)
    if (isNaN(day) || month < 0 || isNaN(year) || isNaN(h)) return null
    const offset = TZ_OFFSET_MIN[tz]
    if (offset == null) console.warn('TRAVEL_TZ_FALLBACK_IST:', tz)
    const offMin = offset ?? 330
    return new Date(Date.UTC(year, month, day, h, m || 0, 0, 0) - offMin * 60000)
  } catch {
    return null
  }
}

// Derive the IATA carrier code from a stored flight number: strip non-alphanumerics,
// uppercase, take the leading two chars. Returns a code only when it maps to a known
// airline in AIRLINES; null on null / <2-char / unknown input, so callers fall back to
// the default window and drop the check-in link cleanly.
function iataFromFlightNo(flightNo: string | null): string | null {
  if (!flightNo) return null
  const cleaned = flightNo.replace(/[^a-z0-9]/gi, '').toUpperCase()
  if (cleaned.length < 2) return null
  const code = cleaned.slice(0, 2)
  return code in AIRLINES ? code : null
}

// Format a departure instant as an absolute IST date label, e.g. "Thu 14 Aug".
// Absolute wording reads correctly at any check-in offset (24h/48h), unlike the old
// relative "tomorrow". Returns null when the instant is missing so the caller can
// fall back to the raw date label.
function formatDepartDateIST(d: Date | null): string | null {
  if (!d) return null
  try {
    return new Intl.DateTimeFormat('en-GB', {
      weekday: 'short', day: '2-digit', month: 'short', timeZone: 'Asia/Kolkata',
    }).format(d).replace(/,/g, '')
  } catch {
    return null
  }
}

type TicketContext = {
  telegramId: number
  whatsappTo: string | null
  timezone: string
  source: 'pdf' | 'image' | 'text'
}

type Leg = {
  type: 'flight' | 'train' | 'event'
  legIndex: number
  bookingGroup: string | null
  fromCity: string | null
  toCity: string | null
  departAt: Date | null
  arriveAt: Date | null
  departTz: string
  dateLabel: string | null
  departLocal: string | null
  airline: string | null
  flightNo: string | null
  trainNo: string | null
  trainName: string | null
  eventName: string | null
  venue: string | null
  pnr: string | null
  seat: string | null
  passengers: string[] | null
  raw: any
  reminderMsg: string
  checkinMsg: string | null
}

function buildLegs(info: NonNullable<TicketInfo>): Leg[] {
  const legs: Leg[] = []

  if (info.type === 'flight') {
    const fi = info as FlightInfo
    const group = fi.flights[0]?.pnr || null
    fi.flights.forEach((f, i) => {
      const tz = resolveDepartTz(f.from)
      const departAt = computeDepartAt(f.date, f.departure, tz)
      const departLabel = formatDepartDateIST(departAt) || f.date
      const link = checkInLink(iataFromFlightNo(f.flightNo))
      legs.push({
        type: 'flight',
        legIndex: i,
        bookingGroup: f.pnr || group,
        fromCity: f.from, toCity: f.to,
        departAt,
        arriveAt: computeDepartAt(f.date, f.arrival, tz),
        departTz: tz,
        dateLabel: f.date, departLocal: f.departure,
        airline: f.airline, flightNo: f.flightNo,
        trainNo: null, trainName: null, eventName: null, venue: null,
        pnr: f.pnr, seat: f.seat || null,
        passengers: fi.passengers || null,
        raw: f,
        reminderMsg: `✈️ ${f.from} → ${f.to} departs in 3 hours at ${f.departure}! PNR: ${f.pnr}`,
        checkinMsg:
          `🧳 Web check-in open — ${f.airline} ${f.flightNo} (${f.from} → ${f.to}) ` +
          `departs ${departLabel} at ${f.departure}. Check in now to pick your seat. PNR: ${f.pnr}` +
          (link ? `\n${link}` : ''),
      })
    })
  } else if (info.type === 'train') {
    const t = info as TrainInfo
    const tz = resolveDepartTz(t.from)
    legs.push({
      type: 'train',
      legIndex: 0,
      bookingGroup: t.pnr || null,
      fromCity: t.from, toCity: t.to,
      departAt: computeDepartAt(t.date, t.departure, tz),
      arriveAt: computeDepartAt(t.date, t.arrival, tz),
      departTz: tz,
      dateLabel: t.date, departLocal: t.departure,
      airline: null, flightNo: null,
      trainNo: t.trainNo, trainName: t.trainName, eventName: null, venue: null,
      pnr: t.pnr, seat: t.seat || null,
      passengers: t.passengers || null,
      raw: t,
      reminderMsg: `🚆 ${t.from} → ${t.to} starts in 3 hours at ${t.departure}!`,
      checkinMsg: null,
    })
  } else if (info.type === 'event') {
    const e = info as EventInfo
    const tz = resolveDepartTz(undefined)
    legs.push({
      type: 'event',
      legIndex: 0,
      bookingGroup: null,
      fromCity: null, toCity: null,
      departAt: computeDepartAt(e.date, e.time, tz),
      arriveAt: null,
      departTz: tz,
      dateLabel: e.date, departLocal: e.time,
      airline: null, flightNo: null,
      trainNo: null, trainName: null, eventName: e.name, venue: e.venue,
      pnr: null, seat: null,
      passengers: null,
      raw: e,
      reminderMsg: `🎟️ ${e.name} starts in 3 hours at ${e.time}!`,
      checkinMsg: null,
    })
  }

  return legs
}

// Insert a leg unless an identical one already exists (same user, type, exact
// departure instant, and identifier). Tolerates the table being absent so a
// code-first deploy degrades gracefully.
async function persistLeg(ctx: TicketContext, leg: Leg): Promise<void> {
  if (!leg.departAt) return
  const iso = leg.departAt.toISOString()
  try {
    let sel = supabaseAdmin
      .from('travel_tickets')
      .select('id')
      .eq('telegram_id', ctx.telegramId)
      .eq('type', leg.type)
      .eq('depart_at', iso)
    if (leg.flightNo) sel = sel.eq('flight_no', leg.flightNo)
    else if (leg.trainNo) sel = sel.eq('train_no', leg.trainNo)
    else if (leg.eventName) sel = sel.eq('event_name', leg.eventName)

    const { data: existing } = await sel.limit(1)
    if (existing && existing.length) {
      console.log('TRAVEL_TICKET_DEDUPE_SKIP:', { type: leg.type, depart_at: iso })
      return
    }

    const { error } = await supabaseAdmin.from('travel_tickets').insert({
      telegram_id: ctx.telegramId,
      whatsapp_to: ctx.whatsappTo,
      type: leg.type,
      booking_group: leg.bookingGroup,
      leg_index: leg.legIndex,
      from_city: leg.fromCity,
      to_city: leg.toCity,
      depart_at: iso,
      arrive_at: leg.arriveAt ? leg.arriveAt.toISOString() : null,
      depart_tz: leg.departTz,
      date_label: leg.dateLabel,
      depart_local: leg.departLocal,
      airline: leg.airline,
      flight_no: leg.flightNo,
      train_no: leg.trainNo,
      train_name: leg.trainName,
      event_name: leg.eventName,
      venue: leg.venue,
      pnr: leg.pnr,
      seat: leg.seat,
      passengers: leg.passengers,
      source: ctx.source,
      raw: leg.raw,
    })
    if (error) console.error('TRAVEL_TICKET_INSERT_FAILED:', error.message)
  } catch (err: any) {
    console.error('TRAVEL_TICKET_PERSIST_ERROR:', err?.message || err)
  }
}

// Create a reminder unless one with the same message + remind_at already exists.
// Returns true if a new row was inserted.
async function createReminderIfAbsent(ctx: TicketContext, message: string, remindAt: Date): Promise<boolean> {
  const iso = remindAt.toISOString()
  const { data: existing } = await supabaseAdmin
    .from('reminders')
    .select('id')
    .eq('telegram_id', ctx.telegramId)
    .eq('message', message)
    .eq('remind_at', iso)
    .limit(1)
  if (existing && existing.length) return false

  const { error } = await supabaseAdmin.from('reminders').insert({
    telegram_id: ctx.telegramId,
    whatsapp_to: ctx.whatsappTo,
    timezone: ctx.timezone,
    message,
    remind_at: iso,
    created_at: new Date().toISOString(),
  })
  if (error) {
    console.error('TRAVEL_REMINDER_INSERT_FAILED:', error.message)
    return false
  }
  return true
}

function oneLineNote(info: NonNullable<TicketInfo>): string {
  if (info.type === 'flight') {
    const fi = info as FlightInfo
    const first = fi.flights[0]
    const extra = fi.flights.length > 1 ? ` (+${fi.flights.length - 1} more leg${fi.flights.length > 2 ? 's' : ''})` : ''
    return `✈️ ${first?.from}→${first?.to} ${first?.date} ${first?.departure} ${first?.flightNo} PNR ${first?.pnr}${extra}`
  }
  if (info.type === 'train') {
    const t = info as TrainInfo
    return `🚆 ${t.from}→${t.to} ${t.date} ${t.departure} ${t.trainName} PNR ${t.pnr}`
  }
  const e = info as EventInfo
  return `🎟️ ${e.name} ${e.date} ${e.time} @ ${e.venue}`
}

export async function persistAndRemindTicket(
  info: TicketInfo,
  ctx: TicketContext
): Promise<{ reply: string; remindersSet: number }> {
  if (!info) return { reply: buildTicketReply(null), remindersSet: 0 }

  const now = Date.now()
  const legs = buildLegs(info)
  let remindersSet = 0

  for (const leg of legs) {
    await persistLeg(ctx, leg)

    if (!leg.departAt) continue

    // T-3h departure reminder (behaviour-preserving vs. the legacy PDF path).
    const t3 = new Date(leg.departAt.getTime() - 3 * 60 * 60 * 1000)
    if (t3.getTime() > now) {
      if (await createReminderIfAbsent(ctx, leg.reminderMsg, t3)) remindersSet++
    }

    // T-minus web check-in reminder — flights only. The window is per-airline
    // (Indian carriers open at 48h, not 24h), derived from the flight number's
    // IATA prefix. Any miss — null/unparseable flight_no, unknown carrier, or a
    // throw — falls back to the default window so a lookup failure never drops the
    // reminder. isInternational is false: no international flag exists on the leg,
    // and firing early (the domestic window) is safer than firing late.
    if (leg.type === 'flight' && leg.checkinMsg) {
      let windowHours = DEFAULT_CHECKIN_OPENS_HOURS
      try {
        windowHours = checkInOpensHours(iataFromFlightNo(leg.flightNo), false)
      } catch (err: any) {
        console.error('CHECKIN_WINDOW_FALLBACK:', err?.message || err)
      }
      const tCheckin = new Date(leg.departAt.getTime() - windowHours * 60 * 60 * 1000)
      if (tCheckin.getTime() > now) {
        if (await createReminderIfAbsent(ctx, leg.checkinMsg, tCheckin)) remindersSet++
      }
    }
  }

  // Keep one human-readable line in the notes list (replaces the old truncated JSON).
  try {
    await addToList(ctx.telegramId, 'notes', [oneLineNote(info)])
  } catch (err: any) {
    console.error('TRAVEL_TICKET_NOTE_FAILED:', err?.message || err)
  }

  return { reply: buildTicketReply(info, remindersSet > 0), remindersSet }
}
