import { ticketTimezone, ticketInstant, flightInstants } from './travel-time'
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

function resolveDepartTz(city?: string): string {
  return city ? ticketTimezone(city) || '' : 'Asia/Kolkata'
}
const computeDepartAt = ticketInstant

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

// Local date + 24h time in the departure timezone for naming a specific alert's fire time, e.g.
// "Thu 27 Aug 11:30". Used only in the confirmation copy, so on any formatter error
// it degrades to the raw ISO rather than throwing.
function formatAlertWhen(d: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      weekday: 'short', day: '2-digit', month: 'short',
      hour: '2-digit', minute: '2-digit', hour12: false,
      timeZone: timezone,
    }).format(d).replace(/,/g, '')
  } catch {
    return d.toISOString()
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

export function buildLegs(info: NonNullable<TicketInfo>): Leg[] {
  const legs: Leg[] = []

  if (info.type === 'flight') {
    const fi = info as FlightInfo
    const group = fi.flights[0]?.pnr || null
    fi.flights.forEach((f, i) => {
      const { departAt, arriveAt, departTz: tz } = flightInstants(f)
      const departLabel = f.date
      const link = checkInLink(iataFromFlightNo(f.flightNo))
      legs.push({
        type: 'flight',
        legIndex: i,
        bookingGroup: f.pnr || group,
        fromCity: f.from, toCity: f.to,
        departAt,
        arriveAt,
        departTz: tz,
        dateLabel: f.date, departLocal: f.departure,
        airline: f.airline, flightNo: f.flightNo,
        trainNo: null, trainName: null, eventName: null, venue: null,
        pnr: f.pnr, seat: f.seat || null,
        passengers: fi.passengers || null,
        raw: f,
        reminderMsg: `✈️ ${f.from} → ${f.to} departs in 3 hours at ${f.departure} (${tz || "timezone unverified"})! PNR: ${f.pnr}`,
        checkinMsg:
          `🧳 Web check-in open — ${f.airline} ${f.flightNo} (${f.from} → ${f.to}) ` +
          `departs ${departLabel} at ${f.departure} (${tz || "timezone unverified"}). Check in now to pick your seat. PNR: ${f.pnr}` +
          (link ? `\n${link}` : ''),
      })
    })
  } else if (info.type === 'train') {
    const t = info as TrainInfo
    const tz = resolveDepartTz(t.from) || 'Asia/Kolkata' // Indian rail station codes retain the established IST default.
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

// Reconcile printed flight identity independently of timing verification;
// non-flight records retain their exact departure identity. Writes fail closed.
async function persistLeg(ctx: TicketContext, leg: Leg): Promise<Date|undefined> {
  if (!leg.departAt&&leg.type!=='flight') return
  const iso = leg.departAt?.toISOString()||null
  try {
    let sel = supabaseAdmin
      .from('travel_tickets')
      .select('id,depart_at,pnr,flight_no')
      .eq('telegram_id', ctx.telegramId)
      .eq('type', leg.type)
    if(leg.type==='flight'&&leg.pnr&&leg.flightNo&&leg.dateLabel){
      sel=sel.eq('pnr',leg.pnr).eq('date_label',leg.dateLabel).eq('leg_index',leg.legIndex).eq('from_city',leg.fromCity).eq('to_city',leg.toCity)
    }else if(leg.type==='flight'){
      sel=sel.eq('from_city',leg.fromCity).eq('to_city',leg.toCity)
      sel=leg.dateLabel==null?sel.is('date_label',null):sel.eq('date_label',leg.dateLabel)
      sel=leg.departLocal==null?sel.is('depart_local',null):sel.eq('depart_local',leg.departLocal)
      sel=leg.pnr==null?sel.is('pnr',null):sel.eq('pnr',leg.pnr)
      if(leg.flightNo==null)sel=sel.is('flight_no',null)
    }else if(iso)sel=sel.eq('depart_at',iso)
    if (leg.flightNo) sel = sel.eq('flight_no', leg.flightNo)
    else if (leg.trainNo) sel = sel.eq('train_no', leg.trainNo)
    else if (leg.eventName) sel = sel.eq('event_name', leg.eventName)

    let { data: existing, error: lookupError } = await sel.limit(2)
    if(lookupError)throw new Error(lookupError.message)
    if(!existing?.length&&leg.type==='flight'){
      let unknown=supabaseAdmin.from('travel_tickets').select('id,depart_at,date_label,depart_local,pnr,flight_no,leg_index,from_city,to_city')
        .eq('telegram_id',ctx.telegramId).eq('type','flight').is('depart_at',null)
      // Missing stored identifiers may be enriched, but conflicting identifiers
      // never match. Compare locally without interpolating parser text in filters.
      unknown=unknown.eq('leg_index',leg.legIndex)
      const result=await unknown.limit(101)
      if(result.error)throw new Error(result.error.message)
      if((result.data?.length||0)>100)throw new Error('travel_ticket_identity_ambiguous')
      const printed=ticketInstant(leg.dateLabel||undefined,leg.departLocal||undefined,'UTC')?.toISOString()
      existing=(result.data||[]).filter(row=>{
        const compatible=(stored:string|null,incoming:string|undefined|null)=>!incoming||!stored||stored===incoming
        if(!compatible(row.pnr,leg.pnr)||!compatible(row.flight_no,leg.flightNo))return false
        if(!(row.pnr&&row.flight_no&&leg.pnr&&leg.flightNo)&& (row.from_city!==leg.fromCity||row.to_city!==leg.toCity))return false
        return printed&&ticketInstant(row.date_label,row.depart_local,'UTC')?.toISOString()===printed
      })
    }
    // Printed labels can vary between parsers while the canonical flight stays
    // the same. Reuse its database dedupe identity after null-time reconciliation.
    if(!existing?.length&&leg.type==='flight'&&iso){
      const result=await supabaseAdmin.from('travel_tickets').select('id,depart_at,pnr,flight_no,leg_index,from_city,to_city')
        .eq('telegram_id',ctx.telegramId).eq('type',leg.type).eq('depart_at',iso).limit(101)
      if(result.error)throw new Error(result.error.message)
      if((result.data?.length||0)>100)throw new Error('travel_ticket_identity_ambiguous')
      existing=(result.data||[]).filter(row=>{
        const compatible=(stored:string|null,incoming:string|undefined|null)=>!incoming||!stored||stored===incoming
        if(!compatible(row.pnr,leg.pnr)||!compatible(row.flight_no,leg.flightNo))return false
        return row.pnr&&row.flight_no&&leg.pnr&&leg.flightNo||row.from_city===leg.fromCity&&row.to_city===leg.toCity&&row.leg_index===leg.legIndex
      })
    }
    if(existing&&existing.length>1)throw new Error('travel_ticket_identity_ambiguous')
    if(existing?.[0]){
      leg.pnr=leg.pnr||existing[0].pnr||undefined
      leg.flightNo=leg.flightNo||existing[0].flight_no||undefined
    }
    const row={
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
      flight_no: leg.flightNo||existing?.[0]?.flight_no||null,
      train_no: leg.trainNo,
      train_name: leg.trainName,
      event_name: leg.eventName,
      venue: leg.venue,
      pnr: leg.pnr||existing?.[0]?.pnr||null,
      seat: leg.seat,
      passengers: leg.passengers,
      source: ctx.source,
      raw: {...leg.raw,timeNormalizationVersion:2},
    }
    if(existing?.[0]){
      const previous=existing[0].depart_at?new Date(existing[0].depart_at):null
      const {error}=await supabaseAdmin.from('travel_tickets').update(row).eq('telegram_id',ctx.telegramId).eq('id',existing[0].id)
      if(error)throw new Error(error.message)
      return previous&&Number.isFinite(previous.getTime())?previous:undefined
    }
    const {error}=await supabaseAdmin.from('travel_tickets').insert(row)
    if(error)throw new Error(error.message)
  } catch (err: any) {
    console.error('TRAVEL_TICKET_PERSIST_ERROR:', err?.message || err)
    throw new Error('travel_ticket_persist_failed')
  }
}

// Result of an attempted reminder write. 'failed' is distinct from 'exists' so the
// caller can warn the user instead of silently claiming the alert was set.
type ReminderWriteResult = 'inserted' | 'exists' | 'already_sent' | 'failed'

// Create a reminder unless one with the same message + remind_at already exists.
// The insert MUST mirror the columns the primary writer createReminder
// (process-message.ts) sets — notably chat_id and sent — or a NOT NULL constraint
// rejects every row here and the alert is lost. chat_id is the telegramId, matching
// createReminder's own `createReminder(telegramId, telegramId, ...)` calls: for a
// Telegram private chat the chat id equals the user id, and on WhatsApp the cron
// delivers via whatsapp_to, so telegramId is the correct, constraint-satisfying value.
function ticketAlertIdentity(message:string){
  return message.replace(/\s+\((?:[A-Za-z_]+\/[A-Za-z0-9_+\/-]+|timezone unverified)\)(?=[!.])/g,'')
    .replace(/(\bdeparts )[^\n]+?( at \d{1,2}:\d{2})/gi,'$1$2')
    .replace(/\s+/g,' ').trim()
}

async function retireUnverifiedTicketAlerts(ctx:TicketContext,leg:Leg,previousDeparture?:Date){
  const departures=[previousDeparture,ticketInstant(leg.dateLabel||undefined,leg.departLocal||undefined,'Asia/Kolkata')].filter((date):date is Date=>!!date)
  const decisions=departures.flatMap(departAt=>planLegReminders({...leg,departAt},Number.NEGATIVE_INFINITY)).filter((decision):decision is Extract<TicketReminderDecision,{remindAt:Date}>=>'remindAt' in decision)
  if(!decisions.length)return
  const {data,error}=await supabaseAdmin.from('reminders').select('id,message,remind_at,sent').eq('telegram_id',ctx.telegramId).eq('sent',false).in('remind_at',[...new Set(decisions.map(d=>d.remindAt.toISOString()))]).limit(1000)
  if(error)throw new Error('travel_unverified_alert_cleanup_failed')
  const ids=(data||[]).filter((row:any)=>decisions.some(d=>d.remindAt.toISOString()===row.remind_at&&ticketAlertIdentity(d.message)===ticketAlertIdentity(String(row.message||'')))).map((row:any)=>row.id)
  if(ids.length){
    const {error}=await supabaseAdmin.from('reminders').delete().eq('telegram_id',ctx.telegramId).eq('sent',false).in('id',ids)
    if(error)throw new Error('travel_unverified_alert_cleanup_failed')
  }
}

async function createReminderIfAbsent(ctx: TicketContext, message: string, remindAt: Date, previousRemindAt:Date[]=[]): Promise<ReminderWriteResult> {
  const iso = remindAt.toISOString()
  const { data: existing, error: selError } = await supabaseAdmin
    .from('reminders')
    .select('id,message,timezone,remind_at,sent')
    .eq('telegram_id', ctx.telegramId)
    .in('remind_at', [...new Set([iso,...previousRemindAt.map(date=>date.toISOString())])])
    .limit(1000)
  // A failed existence check must not silently drop the reminder — log and fall
  // through to insert (the DB unique-index backstop still guards against a dupe).
  if (selError) console.error('TRAVEL_REMINDER_DEDUPE_CHECK_FAILED:', selError.message)
  const matches=(existing||[]).filter((row:any)=>ticketAlertIdentity(String(row.message||''))===ticketAlertIdentity(message))
  const matched=matches.find((row:any)=>!row.sent&&row.remind_at===iso)||matches.find((row:any)=>!row.sent)||matches[0]
  if(matched){
    if(matched.sent)return 'already_sent'
    if(matched.message!==message||matched.timezone!==ctx.timezone||matched.remind_at!==iso){
      const {error}=await supabaseAdmin.from('reminders').update({message,timezone:ctx.timezone,remind_at:iso}).eq('telegram_id',ctx.telegramId).eq('id',matched.id)
      if(error)return 'failed'
    }
    const duplicateIds=matches.filter((row:any)=>!row.sent&&row.id!==matched.id).map((row:any)=>row.id)
    if(duplicateIds.length){
      const {error}=await supabaseAdmin.from('reminders').delete().eq('telegram_id',ctx.telegramId).eq('sent',false).in('id',duplicateIds)
      if(error)return 'failed'
    }
    return 'exists'
  }

  const { error } = await supabaseAdmin.from('reminders').insert({
    telegram_id: ctx.telegramId,
    chat_id: ctx.telegramId,
    whatsapp_to: ctx.whatsappTo,
    timezone: ctx.timezone,
    message,
    remind_at: iso,
    sent: false,
    created_at: new Date().toISOString(),
  })
  if (error) {
    console.error('TRAVEL_REMINDER_INSERT_FAILED:', error.message)
    return 'failed'
  }
  return 'inserted'
}

// A scheduling decision for one leg. Pure — no DB, no clock beyond the injected
// `now` — so the harness can assert it against the REAL shipped logic.
//   departure       — the T-3h departure alert (still in the future)
//   checkin         — the web check-in nudge, scheduled for when the window opens
//   checkin_open_now — the check-in window ALREADY opened before the ticket was saved;
//                      surface it in the reply now instead of silently skipping
export type TicketReminderDecision =
  | { kind: 'departure'; message: string; remindAt: Date }
  | { kind: 'checkin'; message: string; remindAt: Date }
  | { kind: 'checkin_open_now'; message: string }

export function planLegReminders(leg: Leg, now: number): TicketReminderDecision[] {
  const decisions: TicketReminderDecision[] = []
  if (!leg.departAt) return decisions

  // T-3h departure reminder — only if it hasn't already passed.
  const t3 = new Date(leg.departAt.getTime() - 3 * 60 * 60 * 1000)
  if (t3.getTime() > now) {
    decisions.push({ kind: 'departure', message: leg.reminderMsg, remindAt: t3 })
  }

  // Web check-in — flights only. Window is per-airline (Indian carriers open at 48h),
  // derived from the flight number's IATA prefix; any lookup miss falls back to the
  // default window so a failure never drops the nudge. isInternational is false: no
  // international flag exists on the leg, and firing early is safer than firing late.
  if (leg.type === 'flight' && leg.checkinMsg) {
    let windowHours = DEFAULT_CHECKIN_OPENS_HOURS
    try {
      windowHours = checkInOpensHours(iataFromFlightNo(leg.flightNo), false)
    } catch (err: any) {
      console.error('CHECKIN_WINDOW_FALLBACK:', err?.message || err)
    }
    const tCheckin = new Date(leg.departAt.getTime() - windowHours * 60 * 60 * 1000)
    if (tCheckin.getTime() > now) {
      // Window opens later → schedule the nudge for then.
      decisions.push({ kind: 'checkin', message: leg.checkinMsg, remindAt: tCheckin })
    } else if (leg.departAt.getTime() > now) {
      // Window already open but the flight hasn't left → tell them NOW, don't skip.
      decisions.push({ kind: 'checkin_open_now', message: leg.checkinMsg })
    }
    // else: the flight has already departed → nothing to say.
  }

  return decisions
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
  let remindersFailed = 0
  let remindersAlreadySent = 0
  const openNowNotes: string[] = []
  // Alerts that are actually scheduled (inserted now OR already present on a re-forward)
  // so the confirmation can name each with its real fire time. 'failed' is excluded —
  // it's surfaced separately below so we never claim an alert that didn't land.
  const scheduledAlerts: { kind: 'departure' | 'checkin'; legType: Leg['type']; remindAt: Date; timezone:string }[] = []

  for (const leg of legs) {
    const previousDeparture=await persistLeg(ctx, leg)
    if(leg.type==='flight'&&!leg.departAt)await retireUnverifiedTicketAlerts(ctx,leg,previousDeparture)

    for (const decision of planLegReminders(leg, now)) {
      if (decision.kind === 'checkin_open_now') {
        openNowNotes.push(decision.message)
        continue
      }
      const res = await createReminderIfAbsent({...ctx,timezone:leg.departTz||ctx.timezone}, decision.message, decision.remindAt, leg.departAt?[previousDeparture,leg.type==='flight'?ticketInstant(leg.dateLabel||undefined,leg.departLocal||undefined,'Asia/Kolkata'):null].filter((date):date is Date=>!!date).map(date=>new Date(date.getTime()+decision.remindAt.getTime()-leg.departAt!.getTime())):[])
      if (res === 'inserted') remindersSet++
      else if (res === 'failed') remindersFailed++
      else if (res === 'already_sent') remindersAlreadySent++
      if (res === 'inserted' || res === 'exists') {
        scheduledAlerts.push({ kind: decision.kind, legType: leg.type, remindAt: decision.remindAt, timezone:leg.departTz||ctx.timezone })
      }
    }
  }

  // Keep one human-readable line in the notes list (replaces the old truncated JSON).
  try {
    await addToList(ctx.telegramId, 'notes', [oneLineNote(info)])
  } catch (err: any) {
    console.error('TRAVEL_TICKET_NOTE_FAILED:', err?.message || err)
  }

  // Name every alert that's actually scheduled with its local fire time, instead of
  // the old blanket "3 hours before each departure" (which lied about the check-in alert).
  let reminderTail = ''
  if (scheduledAlerts.length) {
    const parts = scheduledAlerts.map((a) => {
      const when = `${formatAlertWhen(a.remindAt,a.timezone)} (${a.timezone})`
      if (a.kind === 'checkin') return `🧳 Check-in alert ${when}`
      return `⏰ ${a.legType === 'event' ? 'Event' : 'Departure'} alert ${when}`
    })
    reminderTail = `\n\n${parts.join(' · ')}`
  } else if (remindersFailed === 0 && openNowNotes.length === 0) {
    // Nothing scheduled and nothing failed/open-now → be honest rather than silent.
    reminderTail = remindersAlreadySent>0
      ? '\n\nNo new alerts scheduled — the matching alerts were already sent and were not rearmed.'
      : legs.some(leg=>!leg.departAt)
      ? `\n\n⏰ I could not verify the departure date, time or airport timezone. No alerts were set for that leg; please confirm those details.`
      : `\n\n⏰ No alerts set — the departure time has already passed.`
  }
  let reply = buildTicketReply(info, reminderTail)

  // Check-in window already open → surface it now rather than skipping silently.
  if (openNowNotes.length) {
    reply += `\n\n✅ *Check-in is already open* — you can check in now:\n\n${openNowNotes.join('\n\n')}`
  }

  // A "saved!" reply must NOT quietly imply alerts that never landed. If any insert
  // failed, tell the user so they can set it themselves.
  if (remindersFailed > 0) {
    const n = remindersFailed === 1 ? 'one alert' : `${remindersFailed} alerts`
    const it = remindersFailed === 1 ? 'it' : 'them'
    reply += `\n\n⚠️ I saved the ticket but couldn't set ${n} for this trip — please add ${it} manually with *remind me …*.`
  }

  return { reply, remindersSet }
}
