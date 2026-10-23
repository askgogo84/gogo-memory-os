// "Track Virgin Atlantic VS 354" (23 Oct live): Gogo answered "couldn't verify" and tracked nothing. A flight
// someone asks to track — with or without a saved ticket — gets its live status from the flight-data feed and a
// watch that sends delay, gate, take-off and landing updates until it lands. The flight is NOT saved as the
// owner's trip (they may be tracking someone else), so trip, conflict and briefing features never treat it as theirs.
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requestedFlightCodes, normalizeNumericDates, icaoFlightCode } from '@/lib/bot/flight-codes'
export { icaoFlightCode, IATA_TO_ICAO } from '@/lib/bot/flight-codes'
import { legEvents, normalizeFlightNo, parseFlightData, statusFromWeb, trackingWindow, type LegStatus, type TrackingState } from './flight-leg-tracker'
import { searchWebResults } from '@/lib/web-search'
import { FLIGHT_TRACKER_DOMAINS } from '@/lib/bot/handlers/flight-status'
import { checkCostAllowance, COST_ESTIMATES_PAISE, recordCostEvent } from '@/lib/services/cost-guard'
import { deliverWatchAlert } from './watch-alert-delivery'

const MIN = 60_000

export function trackCode(text: string): string {
  return normalizeFlightNo(requestedFlightCodes(normalizeNumericDates(String(text || '')))[0] || '')
}

export function isFlightTrackRequest(text: string): boolean {
  const t = String(text || '')
  if (/\b(?:stop|cancel|don'?t|do not)\s+(?:tracking|track|watching|monitoring)\b/i.test(t)) return false
  return /\b(?:track|tracking|keep (?:me )?posted|keep an eye on|monitor|follow)\b/i.test(t) && requestedFlightCodes(normalizeNumericDates(t)).length === 1
}

export type LiveFlight = {
  flightNo: string; airline?: string
  from: { iata: string; name: string }; to: { iata: string; name: string }
  depLocal?: string; arrLocal?: string; depUtc: string; arrUtc?: string
  depRevisedLocal?: string; arrRevisedLocal?: string
  status: LegStatus
}
type Occ = any
export type FlightFetcher = (code: string, ymd: string) => Promise<Occ[]>

const utcOf = (t: any) => { const ms = Date.parse(String(t?.utc || '').replace(' ', 'T')); return Number.isFinite(ms) ? ms : NaN }
const clockOf = (t: any) => String(t?.local || '').match(/\d{2}:\d{2}/)?.[0]
const dayOf = (t: any) => String(t?.local || '').slice(0, 10)

export async function fetchAeroDataBox(code: string, ymd: string): Promise<Occ[]> {
  const key = process.env.AERODATABOX_RAPIDAPI_KEY
  if (!key) return []
  const res = await fetch(`https://aerodatabox.p.rapidapi.com/flights/number/${encodeURIComponent(normalizeFlightNo(code))}/${ymd}?withAircraftImage=false&withLocation=false`, {
    headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': 'aerodatabox.p.rapidapi.com' }, signal: AbortSignal.timeout(8_000),
  })
  if (res.status === 204) return []
  if (!res.ok) { console.error('FLIGHT_TRACK_LOOKUP_FAILED:', res.status); return [] }
  const json = await res.json().catch(() => null)
  return Array.isArray(json) ? json : []
}

/** The occurrence that matters now: in the air, else the next departure, else one that landed in the last 3 h. */
export function pickLiveOccurrence(list: Occ[], now: number): Occ | null {
  const rows = (list || []).map(o => ({ o, dep: utcOf(o?.departure?.scheduledTime), arr: utcOf(o?.arrival?.scheduledTime) })).filter(r => Number.isFinite(r.dep))
  const airborne = rows.find(r => r.dep <= now && (Number.isFinite(r.arr) ? r.arr + 3 * 60 * MIN : r.dep + 20 * 60 * MIN) >= now && !/arrived|landed|cancel/i.test(String(r.o?.status || '')))
  if (airborne) return airborne.o
  const next = rows.filter(r => r.dep > now).sort((a, b) => a.dep - b.dep)[0]
  if (next && next.dep - now <= 48 * 60 * MIN) return next.o
  const recent = rows.filter(r => Number.isFinite(r.arr) && r.arr <= now && now - r.arr <= 3 * 60 * MIN).sort((a, b) => b.arr - a.arr)[0]
  return recent?.o || next?.o || null
}

export async function lookupLiveFlight(code: string, now = new Date(), tz = 'Asia/Kolkata', fetcher: FlightFetcher = fetchAeroDataBox): Promise<LiveFlight | null> {
  const ymd = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(ms))
  const days = [...new Set([ymd(now.getTime() - 86_400_000), ymd(now.getTime()), ymd(now.getTime() + 86_400_000)])]
  const list = (await Promise.all(days.map(d => fetcher(code, d).catch(() => [])))).flat()
  const o = pickLiveOccurrence(list, now.getTime())
  if (!o) return null
  const depUtc = new Date(utcOf(o.departure?.scheduledTime)).toISOString()
  const arrMs = utcOf(o.arrival?.scheduledTime)
  const status = parseFlightData([o], depUtc)
  if (!status) return null
  const ap = (a: any) => ({ iata: String(a?.iata || a?.icao || '').slice(0, 4), name: String(a?.municipalityName || a?.shortName || a?.name || a?.iata || '').slice(0, 60) })
  return {
    flightNo: normalizeFlightNo(String(o.number || code)), airline: o.airline?.name ? String(o.airline.name).slice(0, 60) : undefined,
    from: ap(o.departure?.airport), to: ap(o.arrival?.airport),
    depLocal: o.departure?.scheduledTime?.local, arrLocal: o.arrival?.scheduledTime?.local, depUtc, arrUtc: Number.isFinite(arrMs) ? new Date(arrMs).toISOString() : undefined,
    depRevisedLocal: o.departure?.revisedTime?.local || o.departure?.runwayTime?.local, arrRevisedLocal: o.arrival?.revisedTime?.local || o.arrival?.predictedTime?.local,
    status,
  }
}

const STATE_WORD: Record<string, string> = { scheduled: 'Scheduled', delayed: 'Delayed', departed: 'In the air', landed: 'Landed', cancelled: 'Cancelled', diverted: 'Diverted', unknown: 'Status not published yet' }

/** Reply built only from the feed's fields; times are airport-local, as printed on boarding passes. */
export function formatLiveFlight(f: LiveFlight): string {
  const at = (sched?: string, revised?: string) => {
    const s = clockOf({ local: sched }), r = clockOf({ local: revised })
    const day = dayOf({ local: sched }) ? ` (${new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${dayOf({ local: sched })}T00:00:00Z`))})` : ''
    return s ? (r && r !== s ? `${r} (was ${s})${day}` : `${s}${day}`) : 'time not published'
  }
  const st = f.status
  const delay = st.delayMinutes ? ` · about ${st.delayMinutes} min late` : ''
  const lines = [
    `✈️ *${f.flightNo}*${f.airline ? ` · ${f.airline}` : ''}`,
    `${f.from.name || f.from.iata} (${f.from.iata}) → ${f.to.name || f.to.iata} (${f.to.iata})`,
    `Status: *${STATE_WORD[st.state] || 'Unknown'}*${delay}`,
    `Departs ${at(f.depLocal, f.depRevisedLocal)} local${st.depTerminal ? ` · T${st.depTerminal}` : ''}${st.depGate ? ` · gate ${st.depGate}` : ''}`,
    `Arrives ${at(f.arrLocal, f.arrRevisedLocal)} local${st.arrTerminal ? ` · T${st.arrTerminal}` : ''}${st.belt ? ` · belt ${st.belt}` : ''}`,
  ]
  return lines.join('\n')
}

/** One watch per flight occurrence; asking again keeps the existing one. Ends 3 h after scheduled arrival. */
export async function createFlightTrackWatch(telegramId: string, f: LiveFlight): Promise<{ id: string; reused: boolean } | null> {
  const tg = String(telegramId)
  const { data: existing } = await supabaseAdmin.from('agent_watchers').select('id').eq('telegram_id', tg).eq('active', true)
    .eq('condition_json->adHocFlight->>flightNo', f.flightNo).eq('condition_json->adHocFlight->>departAt', f.depUtc).limit(1).maybeSingle()
  if (existing?.id) return { id: String(existing.id), reused: true }
  const w = trackingWindow(f.depUtc, f.arrUtc)
  const condition = {
    title: `Track ${f.flightNo} (${f.from.iata} → ${f.to.iata})`, query: `${f.flightNo} flight status`, keywords: [f.flightNo],
    adHocFlight: { flightNo: f.flightNo, departAt: f.depUtc, arriveAt: f.arrUtc || null, from: f.from.iata || f.from.name, to: f.to.iata || f.to.name, airline: f.airline || null },
    expiresAt: new Date(w.until + 60 * MIN).toISOString(), why: 'You asked Gogo to track this flight',
  }
  const { data, error } = await supabaseAdmin.from('agent_watchers').insert({
    telegram_id: tg, type: 'web_search', condition_json: condition, cadence_minutes: 15, active: true,
    next_check_at: new Date(Math.max(Date.now() + 5 * MIN, w.from)).toISOString(), last_state_json: { tracking: { state: null, sent: [] } },
  }).select('id').single()
  if (error || !data?.id) { console.error('FLIGHT_TRACK_WATCH_CREATE_FAILED:', error?.message); return null }
  return { id: String(data.id), reused: false }
}

/** Watcher pass for an ad-hoc tracked flight: feed status → new events only → owner's alert settings → next check. */
export async function processFlightTrackWatcher(watcher: any, now: Date, fetcher: FlightFetcher = fetchAeroDataBox) {
  const c = watcher.condition_json?.adHocFlight || {}
  const tg = String(watcher.telegram_id)
  const prev: TrackingState = watcher.last_state_json?.tracking || {}
  const w = trackingWindow(String(c.departAt), c.arriveAt)
  const finished = prev.state === 'landed' || prev.state === 'cancelled' || now.getTime() > w.until + 60 * MIN
  const save = (patch: Record<string, unknown>) => supabaseAdmin.from('agent_watchers').update({ ...patch, last_checked_at: now.toISOString(), updated_at: now.toISOString() })
    .eq('id', watcher.id).eq('telegram_id', tg).eq('active', true)
  if (finished) { await save({ active: false, next_check_at: null, last_state_json: { ...(watcher.last_state_json || {}), endedReason: prev.state || 'window_over' } }); return { triggered: false, failed: false } }
  if (now.getTime() < w.from) { await save({ next_check_at: new Date(w.from).toISOString() }); return { triggered: false, failed: false } }
  const tz = 'UTC'
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(String(c.departAt)))
  const list = await fetcher(String(c.flightNo), ymd).catch(() => [])
  let status = parseFlightData(list, String(c.departAt))
  // No flight-data feed (key not configured or no row): tracker pages, searched by IATA and ICAO code, within budget.
  if (!status && !list.length) {
    const allowance = await checkCostAllowance(tg, COST_ESTIMATES_PAISE.web_search_basic).catch(() => ({ allowed: false }))
    if (allowance.allowed) {
      const date = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(String(c.departAt)))
      const results = await searchWebResults(`${[c.flightNo, icaoFlightCode(String(c.flightNo))].filter(Boolean).join(' ')} flight status ${date}`, { includeDomains: FLIGHT_TRACKER_DOMAINS }).catch(() => [])
      await recordCostEvent({ telegramId: tg, category: 'web_search_basic', metadata: { source: 'flight_track', watcher_id: watcher.id } }).catch(() => {})
      status = statusFromWeb(results, { flightNo: String(c.flightNo), departAt: String(c.departAt), arriveAt: c.arriveAt, fromCity: String(c.from || '') }, now.getTime())
    }
  }
  let sent = 0
  const tracking: TrackingState = { ...prev, lastCheckedAt: now.toISOString() }
  if (status) {
    const leg = { id: String(watcher.id), telegramId: tg, flightNo: String(c.flightNo), airline: c.airline, fromCity: String(c.from || ''), toCity: String(c.to || ''), departAt: String(c.departAt), arriveAt: c.arriveAt, tracking: prev }
    for (const e of legEvents(leg, status)) {
      await deliverWatchAlert({ watcherId: String(watcher.id), owner: tg, key: `flight-track/${watcher.id}/${e.key}`, due: new Date(now.getTime() - 60_000).toISOString(), condition: watcher.condition_json, message: e.text, topic: 'travel' })
      tracking.sent = [...new Set([...(tracking.sent || []), e.key])]
      if (e.kind === 'delayed') tracking.delayNotified = status.delayMinutes || 0
      if (e.kind === 'gate') tracking.gateNotified = status.depGate
      sent++
    }
    tracking.state = status.state
    if (status.revisedArrival) tracking.etaArrival = status.revisedArrival
    if (status.actualArrival) tracking.actualArrival = status.actualArrival
  }
  const near = Math.abs(now.getTime() - w.dep) <= 60 * MIN || Math.abs(now.getTime() - w.arr) <= 60 * MIN
  await save({ next_check_at: new Date(now.getTime() + (near ? 15 : 30) * MIN).toISOString(), last_state_json: { ...(watcher.last_state_json || {}), tracking, source: status ? 'flight_data' : 'unavailable' } })
  return { triggered: sent > 0, failed: false }
}

// 23 Oct live (side by side with Instinct): after "Track VS 354", the follow-up "Alert me once it lands" fell to
// general chat, which claimed a 9:25 reminder. A follow-up about "it" landing/departing/delay binds to the flight
// in the last few hours of this conversation and starts (or reuses) the same tracking watch — never a reminder.
const FOLLOW_UP = /\b(?:alert|notify|tell|ping|message|update|let)\s+(?:me|us)\b[^.?!]{0,40}\b(?:when|once|after|as soon as|if)\b[^.?!]{0,30}\b(?:lands?|landed|landing|arrives?|arrival|touches down|takes? off|departs?|departure|is delayed|gets delayed|delay)\b|^\s*(?:track|keep tracking|follow|monitor|watch)\s+(?:it|that|this|that flight|this flight)\s*[.!]?\s*$/i

export function isFlightFollowUp(text: string): boolean {
  return FOLLOW_UP.test(String(text || '')) && !trackCode(text)
}

/** The flight code most recently mentioned in this conversation within `hours` (newest first). */
export function flightCodeFromHistory(rows: Array<{ content?: string | null; created_at?: string | null }>, now = Date.now(), hours = 6): string {
  for (const r of rows || []) {
    const at = Date.parse(String(r?.created_at || ''))
    if (Number.isFinite(at) && now - at > hours * 3_600_000) break
    const code = trackCode(String(r?.content || ''))
    if (code) return code
  }
  return ''
}

export async function handleFlightFollowUp(p: { telegramId: string | number; text: string; timezone?: string; now?: Date }): Promise<string | null> {
  if (!isFlightFollowUp(p.text)) return null
  const tg = String(p.telegramId), now = p.now || new Date()
  const { data } = await supabaseAdmin.from('conversations').select('content,created_at').eq('telegram_id', Number(tg))
    .order('created_at', { ascending: false }).limit(10)
  const code = flightCodeFromHistory(data || [], now.getTime())
  if (!code) return null
  const live = await lookupLiveFlight(code, now, p.timezone || 'Asia/Kolkata').catch(() => null)
  if (!live) {
    return process.env.AERODATABOX_RAPIDAPI_KEY
      ? `I couldn't find ${code} flying today or tomorrow, so I can't follow it yet. Send the date, for example: Track ${code} on 25 Oct. I haven't set a reminder.`
      : `I can't follow ${code} live yet: live flight tracking isn't switched on. I haven't set a reminder, so nothing will fire at a guessed time.`
  }
  if (live.status.state === 'landed') return `${code} has already landed.\n\n${formatLiveFlight(live)}`
  const watch = await createFlightTrackWatch(tg, live).catch(() => null)
  if (!watch) return `I couldn't start tracking ${code} just now. Ask again in a minute.`
  const eta = live.status.revisedArrival || live.arrUtc
  const etaText = eta ? new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: p.timezone || 'Asia/Kolkata' }).format(new Date(eta)) : ''
  return `${watch.reused ? `I'm already tracking ${code}` : `Done. I'm tracking ${code}`} (${live.from.iata} → ${live.to.iata}) and will message you here when it lands${etaText ? ` (estimated ${etaText})` : ''}, plus any delay or gate change before that.`
}
