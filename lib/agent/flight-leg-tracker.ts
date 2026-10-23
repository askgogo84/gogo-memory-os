// Live per-flight tracking (12 Oct, after comparing with Instinct). The trip monitors watch the
// web every few hours for disruption news; this follows each saved flight leg itself, from 3 hours
// before departure until after landing, and messages the user as it happens: delay, gate, take-off,
// landing, cancellation, diversion. It runs from the agent-watchers cron (every 15 minutes) and only
// for users whose trip flight-status monitor is active, so plan limits and "stop" still apply.
//
// Source: a flight-data API when AERODATABOX_RAPIDAPI_KEY is set (exact status, times, gates);
// otherwise flight-tracker search results, accepted only when they name this flight AND its date,
// and only for states that are possible at that point in the schedule. Nothing is guessed from the
// timetable.
import { supabaseAdmin } from '@/lib/supabase-admin'
import { searchWebResults, type WebSearchResult } from '@/lib/web-search'
import { checkCostAllowance, COST_ESTIMATES_PAISE, recordCostEvent } from '@/lib/services/cost-guard'
import { FLIGHT_TRACKER_DOMAINS, isFareShoppingResult, classifyOccurrence, stripNegatedStates } from '@/lib/bot/handlers/flight-status'
import { extractDateTokens } from '@/lib/agent/watcher-quality'
import { ticketTimezone, withTicketYears, flightInstants } from '@/lib/services/travel-time'
import { deliverWatchAlert } from './watch-alert-delivery'

export type LegState = 'scheduled' | 'delayed' | 'departed' | 'landed' | 'cancelled' | 'diverted' | 'unknown'
export type LegStatus = {
  state: LegState
  delayMinutes?: number
  depGate?: string; depTerminal?: string; arrGate?: string; arrTerminal?: string; belt?: string
  revisedDeparture?: string; revisedArrival?: string; actualArrival?: string; scheduledArrival?: string
  /** Landing seen from aircraft position / tracker pages without a runway time: it was on the ground by then. */
  landedBy?: string
  source: 'flight_data' | 'web'; url?: string
}
export type TrackedLeg = {
  id: string; telegramId: string; flightNo: string; airline?: string | null
  fromCity: string; toCity: string; departAt: string; arriveAt?: string | null
  alias?: string | null; tracking?: TrackingState
}
export type TrackingState = { lastCheckedAt?: string; state?: LegState; sent?: string[]; delayNotified?: number; gateNotified?: string
  /** Latest live arrival estimate / actual landing from the flight-status feed (ISO), kept so "when does she land?" can be answered. */
  etaArrival?: string; actualArrival?: string; scheduledArrival?: string }
export type LegEvent = { kind: 'delayed' | 'gate' | 'departed' | 'landed' | 'cancelled' | 'diverted'; key: string; text: string }

const MIN = 60_000
/** "KL0642" → "KL642": trackers drop the leading zero, tickets often print it. */
export function normalizeFlightNo(code: string): string {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^([A-Z0-9]{2})0+(\d)/, '$1$2')
}

export function trackingWindow(departAt: string, arriveAt?: string | null) {
  const dep = Date.parse(departAt)
  const arr = arriveAt && Date.parse(arriveAt) > dep ? Date.parse(arriveAt) : dep + 18 * 60 * MIN
  return { from: dep - 3 * 60 * MIN, until: arr + 2 * 60 * MIN, dep, arr }
}

/** Every 15 minutes within an hour of take-off or landing, otherwise every 30. */
export function dueForCheck(now: number, leg: Pick<TrackedLeg, 'departAt' | 'arriveAt' | 'tracking'>) {
  const w = trackingWindow(leg.departAt, leg.arriveAt)
  if (now < w.from || now > w.until) return false
  const s = leg.tracking?.state
  if (s === 'landed' || s === 'cancelled' || s === 'diverted') return false
  const near = Math.abs(now - w.dep) <= 60 * MIN || Math.abs(now - w.arr) <= 60 * MIN
  // 23 Oct feedback: alert as soon as it lands. Around the expected landing (live estimate, else schedule) the
  // leg is checked every 2 minutes; the per-minute cron runs this tracker too.
  const eta = Date.parse(String(leg.tracking?.etaArrival || leg.arriveAt || ''))
  const landingWindow = Number.isFinite(eta) && now >= eta - 40 * MIN && now <= eta + 90 * MIN
  const last = Date.parse(String(leg.tracking?.lastCheckedAt || ''))
  return !Number.isFinite(last) || now - last >= (landingWindow ? 2 : near ? 14 : 29) * MIN
}

const adbTime = (t: any) => { const v = String(t?.utc || '').trim(); const ms = Date.parse(v.replace(' ', 'T')); return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined }

/** AeroDataBox /flights/number/{no}/{date}: picks the occurrence nearest the ticket's departure. */
export function parseFlightData(json: any, departAt: string): LegStatus | null {
  const list = Array.isArray(json) ? json : []
  const want = Date.parse(departAt)
  const best = list
    .map(f => ({ f, at: Date.parse(adbTime(f?.departure?.scheduledTime) || '') }))
    .filter(x => Number.isFinite(x.at) && Math.abs(x.at - want) <= 6 * 60 * MIN)
    .sort((a, b) => Math.abs(a.at - want) - Math.abs(b.at - want))[0]?.f
  if (!best) return null
  const raw = String(best.status || '').toLowerCase()
  const sched = adbTime(best.departure?.scheduledTime), revised = adbTime(best.departure?.revisedTime) || adbTime(best.departure?.runwayTime)
  const delay = sched && revised ? Math.round((Date.parse(revised) - Date.parse(sched)) / MIN) : 0
  const state: LegState = /cancel/.test(raw) ? 'cancelled' : /divert/.test(raw) ? 'diverted'
    : /arrived|landed/.test(raw) ? 'landed' : /departed|enroute|approaching/.test(raw) ? 'departed'
    : delay >= 15 || /delay/.test(raw) ? 'delayed' : raw ? 'scheduled' : 'unknown'
  const s = (v: any) => (v == null || v === '' ? undefined : String(v).slice(0, 12))
  return {
    state, delayMinutes: delay > 0 ? delay : undefined, source: 'flight_data',
    depGate: s(best.departure?.gate), depTerminal: s(best.departure?.terminal),
    arrGate: s(best.arrival?.gate), arrTerminal: s(best.arrival?.terminal), belt: s(best.arrival?.baggageBelt),
    revisedDeparture: revised, revisedArrival: adbTime(best.arrival?.predictedTime) || adbTime(best.arrival?.revisedTime),
    actualArrival: adbTime(best.arrival?.runwayTime) || adbTime(best.arrival?.actualTime),
    scheduledArrival: adbTime(best.arrival?.scheduledTime),
  }
}

/** Tracker search results → a state, only from results naming this flight and its date. */
export function statusFromWeb(results: WebSearchResult[], leg: Pick<TrackedLeg, 'flightNo' | 'departAt' | 'arriveAt' | 'fromCity'>, now: number): LegStatus | null {
  const code = normalizeFlightNo(leg.flightNo)
  const tz = ticketTimezone(leg.fromCity) || 'UTC'
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(leg.departAt))
  const w = trackingWindow(leg.departAt, leg.arriveAt)
  const rank: LegState[] = ['cancelled', 'diverted', 'landed', 'departed', 'delayed']
  // Per tracker site: the most serious state it reports for THIS flight and date.
  const bySite = new Map<string, { state: LegState; url?: string }>()
  const positive = new Set<string>() // sites showing the flight operating normally
  for (const r of results) {
    if (isFareShoppingResult(r)) continue
    const hay = `${r.title || ''} ${r.snippet || ''}`
    if (!extractDateTokens(hay).length && !/20\d{2}-?\d{2}-?\d{2}/.test(String(r.url || ''))) continue // must be dated
    if (!classifyOccurrence(r, `${code} on ${ymd}`, ymd).usable) continue
    let site = ''
    try { site = new URL(String(r.url || '')).hostname.replace(/^www\./, '') } catch { continue }
    const t = stripNegatedStates(hay)
    if (/\b(on[- ]time|scheduled|as scheduled|boarding|departed|en ?route|in ?air|landed|arrived)\b/i.test(t) && !/\bcancell?ed\b/i.test(t)) positive.add(site)
    const state: LegState | null = /\bcancell?ed\b/i.test(t) ? 'cancelled' : /\bdiverted\b/i.test(t) ? 'diverted'
      : /\b(landed|arrived)\b/i.test(t) && now >= w.arr - 60 * MIN ? 'landed'
      : /\b(departed|took off|en ?route|in ?air|airborne)\b/i.test(t) && now >= w.dep - 30 * MIN ? 'departed'
      : /\bdelay(?:ed)?\b/i.test(t) ? 'delayed' : null
    const prev = bySite.get(site)
    if (state && (!prev || rank.indexOf(state) < rank.indexOf(prev.state))) bySite.set(site, { state, url: r.url })
  }
  // A cancellation or diversion is only reported when two different trackers agree and none
  // shows the flight operating; one site's flag is often stale or about another day.
  const sitesWith = (st: LegState) => [...bySite.entries()].filter(([, v]) => v.state === st)
  for (const st of ['cancelled', 'diverted'] as LegState[]) {
    const agree = sitesWith(st)
    const contradicted = [...positive].some(site => !agree.some(([a]) => a === site))
    if (agree.length >= 2 && !contradicted) return { state: st, source: 'web', url: agree[0][1].url }
  }
  for (const st of ['landed', 'departed', 'delayed'] as LegState[]) {
    const hit = sitesWith(st)[0]
    if (hit) return { state: st, source: 'web', url: hit[1].url }
  }
  return null
}

function localClock(iso: string | undefined, city: string) {
  if (!iso) return ''
  const tz = ticketTimezone(city) || 'UTC'
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso))
}

/** What changed since the last check, as messages. Each kind is sent once (delays again only if 15+ min worse). */
export function legEvents(leg: TrackedLeg, status: LegStatus): LegEvent[] {
  const prev = leg.tracking || {}
  const sent = new Set(prev.sent || [])
  const flight = `${leg.alias ? `${leg.alias}'s flight` : 'Flight'} ${leg.flightNo}`
  const route = `(${leg.fromCity} → ${leg.toCity})`
  const src = status.source === 'web' && status.url ? `\n\nSource: ${status.url}` : ''
  const out: LegEvent[] = []
  const add = (kind: LegEvent['kind'], key: string, text: string) => { if (!sent.has(key)) out.push({ kind, key, text: text + src }) }
  if (status.state === 'cancelled') add('cancelled', 'cancelled', `❌ ${flight} ${route} is showing as cancelled. Check with ${leg.airline || 'the airline'} about rebooking.`)
  if (status.state === 'diverted') add('diverted', 'diverted', `⚠️ ${flight} ${route} has been diverted. I'll keep checking where it lands.`)
  if (status.state === 'landed') {
    const at = localClock(status.actualArrival, leg.toCity)
    const where = [status.arrTerminal && `terminal ${status.arrTerminal}`, status.arrGate && `gate ${status.arrGate}`, status.belt && `bags on belt ${status.belt}`].filter(Boolean).join(', ')
    const by = at ? '' : localClock(status.landedBy, leg.toCity)
    add('landed', 'landed', `🛬 ${flight} has landed in ${leg.toCity}${at ? ` at ${at} local time` : by ? ` (on the ground by ${by} local time)` : ''}.${where ? ` Arrival: ${where}.` : ''}`)
  }
  if (status.state === 'departed') {
    const eta = localClock(status.revisedArrival, leg.toCity)
    add('departed', 'departed', `🛫 ${flight} ${route} has taken off.${eta ? ` Expected in ${leg.toCity} at ${eta} local time.` : ''}`)
  }
  if (status.state === 'delayed' || (status.delayMinutes || 0) >= 15) {
    const mins = status.delayMinutes || 0
    if (status.state !== 'landed' && status.state !== 'departed' && status.state !== 'cancelled') {
      if (status.source === 'flight_data' ? mins >= 15 && mins >= (prev.delayNotified || 0) + 15 : !sent.has('delayed')) {
        const newDep = localClock(status.revisedDeparture, leg.fromCity)
        out.push({ kind: 'delayed', key: status.source === 'flight_data' ? `delayed-${mins}` : 'delayed', text: `⏱️ ${flight} ${route} is delayed${mins ? ` by about ${mins} min` : ''}${newDep ? `, now leaving at ${newDep} local time` : ''}.` + src })
      }
    }
  }
  if (status.depGate && status.depGate !== prev.gateNotified && (status.state === 'scheduled' || status.state === 'delayed')) {
    out.push({ kind: 'gate', key: `gate-${status.depGate}`, text: `🚪 ${flight} ${route} boards from gate ${status.depGate}${status.depTerminal ? `, terminal ${status.depTerminal}` : ''}.` })
  }
  return out
}

async function fetchFlightData(leg: TrackedLeg): Promise<LegStatus | null> {
  const key = process.env.AERODATABOX_RAPIDAPI_KEY
  if (!key) return null
  const tz = ticketTimezone(leg.fromCity) || 'UTC'
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(leg.departAt))
  const res = await fetch(`https://aerodatabox.p.rapidapi.com/flights/number/${encodeURIComponent(normalizeFlightNo(leg.flightNo))}/${ymd}?withAircraftImage=false&withLocation=false`, {
    headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': 'aerodatabox.p.rapidapi.com' }, signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) { console.error('FLIGHT_TRACKER_DATA_FAILED:', res.status); return null }
  return parseFlightData(await res.json().catch(() => null), leg.departAt)
}

async function webStatus(leg: TrackedLeg, now: number): Promise<LegStatus | null> {
  const tz = ticketTimezone(leg.fromCity) || 'UTC'
  const date = new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(leg.departAt))
  const results = await searchWebResults(`${normalizeFlightNo(leg.flightNo)} flight status ${date}`, { includeDomains: FLIGHT_TRACKER_DOMAINS })
  await recordCostEvent({ telegramId: leg.telegramId, category: 'web_search_basic', metadata: { source: 'flight_leg_tracker', ticket_id: leg.id } }).catch(() => {})
  return statusFromWeb(results, leg, now)
}

/**
 * Boarding passes saved before the missing-year fix have no departure time, so nothing tracks
 * them. Date legs saved in the last 3 days whose printed date lacks only the year, relative to
 * when they were saved.
 */
export async function repairYearlessFlightLegs(nowMs = Date.now()) {
  const { data, error } = await supabaseAdmin.from('travel_tickets')
    .select('id,telegram_id,from_city,to_city,raw,created_at')
    .eq('type', 'flight').is('depart_at', null)
    .gte('created_at', new Date(nowMs - 3 * 24 * 60 * MIN).toISOString()).limit(100)
  if (error) throw new Error(`flight_repair_read_failed:${error.message}`)
  let repaired = 0
  for (const row of data || []) {
    const raw: any = row.raw || {}
    if (!raw.date || /\b\d{4}\b/.test(String(raw.date))) continue
    const savedAt = Date.parse(String(row.created_at)) || nowMs
    const dated: any = withTicketYears({ type: 'flight', flights: [raw] }, savedAt)
    const f = dated.flights[0]
    const { departAt, arriveAt, departTz } = flightInstants({ ...f, from: f.from || row.from_city, to: f.to || row.to_city })
    if (!departAt) continue
    const { error: upErr } = await supabaseAdmin.from('travel_tickets').update({
      depart_at: departAt.toISOString(), arrive_at: arriveAt ? arriveAt.toISOString() : null, depart_tz: departTz || null,
      date_label: f.date, raw: { ...raw, date: f.date, ...(f.arrivalDate ? { arrivalDate: f.arrivalDate } : {}), yearRepairedAt: new Date(nowMs).toISOString() },
    }).eq('id', row.id).eq('telegram_id', row.telegram_id).is('depart_at', null)
    if (!upErr) repaired++
  }
  return { repaired }
}

export async function runFlightLegTracker(nowMs = Date.now()) {
  const { data, error } = await supabaseAdmin.from('travel_tickets')
    .select('id,telegram_id,from_city,to_city,depart_at,arrive_at,airline,flight_no,raw')
    .eq('type', 'flight').not('flight_no', 'is', null)
    .gte('depart_at', new Date(nowMs - 24 * 60 * MIN).toISOString()).lte('depart_at', new Date(nowMs + 3 * 60 * MIN).toISOString())
    .limit(300)
  if (error) throw new Error(`flight_tracker_read_failed:${error.message}`)
  let checked = 0, sent = 0, skipped = 0
  const monitors = new Map<string, any>()
  for (const row of data || []) {
    const raw: any = row.raw || {}
    const leg: TrackedLeg = {
      id: String(row.id), telegramId: String(row.telegram_id), flightNo: String(row.flight_no), airline: row.airline,
      fromCity: String(row.from_city || ''), toCity: String(row.to_city || ''), departAt: String(row.depart_at), arriveAt: row.arrive_at,
      alias: Object.values(raw.travellerAliases || {})[0] as string || null, tracking: raw.liveTracking || {},
    }
    if (!dueForCheck(nowMs, leg)) continue
    if (!monitors.has(leg.telegramId)) {
      const { data: w } = await supabaseAdmin.from('agent_watchers').select('id,condition_json')
        .eq('telegram_id', leg.telegramId).eq('active', true)
        .eq('condition_json->>contextualKind', 'travel').eq('condition_json->>contextClass', 'flight_status').limit(1).maybeSingle()
      monitors.set(leg.telegramId, w || null)
    }
    const monitor = monitors.get(leg.telegramId)
    if (!monitor) { skipped++; console.log('FLIGHT_TRACKER_LEG:', JSON.stringify({ leg: leg.id, flight: normalizeFlightNo(leg.flightNo), skipped: 'no_active_flight_monitor' })); continue }
    try {
      const dataKey = Boolean(process.env.AERODATABOX_RAPIDAPI_KEY)
      let status = await fetchFlightData(leg).catch((err: any) => { console.error('FLIGHT_TRACKER_DATA_FAILED:', String(err?.message || err).slice(0, 120)); return null })
      const source = status ? 'flight_data' : 'web'
      if (!status) {
        const allowance = await checkCostAllowance(leg.telegramId, COST_ESTIMATES_PAISE.web_search_basic)
        if (!allowance.allowed) { skipped++; continue }
        status = await webStatus(leg, nowMs)
      }
      checked++
      const events = status ? legEvents(leg, status) : []
      console.log('FLIGHT_TRACKER_LEG:', JSON.stringify({ leg: leg.id, flight: normalizeFlightNo(leg.flightNo), dataKey, source, state: status?.state || null, delay: status?.delayMinutes || 0, hasEta: Boolean(status?.revisedArrival), hasScheduledArrival: Boolean(status?.scheduledArrival), events: events.map(e => e.key) }))
      const prev = leg.tracking || {}
      const delivered = new Set(prev.sent || [])
      for (const e of events) {
        // Due a minute early so a server/database clock difference can't defer the claim.
        const delivery = await deliverWatchAlert({ watcherId: String(monitor.id), owner: leg.telegramId, key: `flight-alert/${leg.id}/${e.key}`, due: new Date(nowMs - 60_000).toISOString(), condition: monitor.condition_json, message: e.text, topic: 'travel' })
        console.log('FLIGHT_TRACKER_DELIVERY:', JSON.stringify({ leg: leg.id, event: e.key, state: delivery.state, accepted: delivery.accepted }))
        if (delivery.accepted || ['outcome_unknown'].includes(delivery.state)) {
          delivered.add(e.key); sent++
          await supabaseAdmin.from('conversations').insert({ telegram_id: Number(leg.telegramId), role: 'assistant', content: e.text }).then(() => {}, () => {})
        }
      }
      const delayEvent = events.find(e => e.kind === 'delayed' && delivered.has(e.key))
      const gateEvent = events.find(e => e.kind === 'gate' && delivered.has(e.key))
      const tracking: TrackingState = {
        lastCheckedAt: new Date(nowMs).toISOString(), state: status?.state || prev.state, sent: [...delivered].slice(-30),
        delayNotified: delayEvent ? status?.delayMinutes || prev.delayNotified : prev.delayNotified,
        gateNotified: gateEvent ? status?.depGate : prev.gateNotified,
        etaArrival: status?.revisedArrival || prev.etaArrival, actualArrival: status?.actualArrival || prev.actualArrival,
        scheduledArrival: status?.scheduledArrival || prev.scheduledArrival,
      }
      await supabaseAdmin.from('travel_tickets').update({ raw: { ...raw, liveTracking: tracking } }).eq('id', leg.id).eq('telegram_id', row.telegram_id)
    } catch (err: any) {
      console.error('FLIGHT_TRACKER_LEG_FAILED:', leg.id, String(err?.message || err).slice(0, 200))
    }
  }
  console.log('FLIGHT_TRACKER_RUN:', JSON.stringify({ legs: (data || []).length, checked, sent, skipped }))
  return { checked, sent, skipped }
}
