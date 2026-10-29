// Connected memory (29 Oct): flights, trains, hotel stays and cabs are one trip when they share a destination city and
// overlapping dates. Every saved booking lives in life_events (tickets are promoted there by the database trigger;
// stays are written by lib/memory/stay.ts). This module reads them and links them into trips, so every feature can
// see "you land in Mumbai at 11:45 and stay at Four Seasons under Mukesh" instead of unrelated scraps.
import { supabaseAdmin } from '@/lib/supabase-admin'

export type GraphItem = {
  id: string
  kind: 'flight' | 'train' | 'stay' | 'cab' | 'event' | 'other'
  title: string
  city: string | null
  fromCity: string | null
  startAt: string | null
  endAt: string | null
  ref: string | null
  meta: Record<string, any>
}

export type Trip = { key: string; city: string; startAt: string | null; endAt: string | null; items: GraphItem[] }

const CITY_ALIASES: Record<string, string> = {
  bombay: 'mumbai', bom: 'mumbai', bangalore: 'bengaluru', blr: 'bengaluru', bengaluru: 'bengaluru', del: 'delhi', 'new delhi': 'delhi',
  madras: 'chennai', maa: 'chennai', calcutta: 'kolkata', ccu: 'kolkata', hyd: 'hyderabad', goi: 'goa', pnq: 'pune', poona: 'pune',
  dxb: 'dubai', sin: 'singapore', lhr: 'london', amd: 'ahmedabad', cok: 'kochi', cochin: 'kochi', jai: 'jaipur', lko: 'lucknow',
  ixc: 'chandigarh', trv: 'thiruvananthapuram', trivandrum: 'thiruvananthapuram', ixe: 'mangaluru', mangalore: 'mangaluru', mysore: 'mysuru',
  gau: 'guwahati', bbi: 'bhubaneswar', nag: 'nagpur', idr: 'indore', sxr: 'srinagar', vns: 'varanasi', auh: 'abu dhabi', doh: 'doha',
}

export function normCity(raw: unknown): string {
  const t = String(raw || '').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/\b(?:t\s?\d|terminal\s*\d*|airport|international|intl|city)\b/g, ' ').replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim()
  return CITY_ALIASES[t] || t
}

const titleCase = (s: string) => s.replace(/\b\w/g, c => c.toUpperCase())

/** One life_events row as a graph item. Pure. */
export function itemFromLifeEvent(row: any): GraphItem | null {
  if (!row?.id) return null
  const sub = String(row.subtype || '').toLowerCase()
  const meta = row.metadata_json && typeof row.metadata_json === 'object' ? row.metadata_json : {}
  const loc = String(row.location || '')
  const [from, to] = loc.includes('→') ? loc.split('→').map(s => s.trim()) : [null, loc || null]
  const kind: GraphItem['kind'] = sub === 'flight' ? 'flight' : sub === 'train' ? 'train' : sub === 'hotel_stay' ? 'stay' : sub === 'cab' ? 'cab' : row.event_type === 'event' ? 'event' : 'other'
  return {
    id: String(row.id), kind, title: String(row.title || '').slice(0, 160),
    city: kind === 'stay' || kind === 'cab' ? (meta.city || to || null) : to, fromCity: from,
    startAt: row.start_at || null, endAt: row.end_at || null, ref: row.confirmation_ref || null, meta,
  }
}

const DAY = 86_400_000
const ms = (iso: string | null) => (iso ? Date.parse(iso) : NaN)

/** Group items into trips: a trip is a destination city plus the bookings whose dates overlap it (±1 day). Pure. */
export function linkTrips(items: GraphItem[]): { trips: Trip[]; loose: GraphItem[] } {
  const trips: Trip[] = []
  const loose: GraphItem[] = []
  const sorted = [...items].sort((a, b) => (ms(a.startAt) || 0) - (ms(b.startAt) || 0))
  const returned = new Set<Trip>()
  for (const item of sorted) {
    const city = normCity(item.city)
    if (!city || !['flight', 'train', 'stay', 'cab'].includes(item.kind)) { loose.push(item); continue }
    const s = ms(item.startAt), e = Number.isFinite(ms(item.endAt)) ? ms(item.endAt) : s
    // A flight or train leaving a trip city within 21 days of arriving is that trip's way home, not a new trip.
    if ((item.kind === 'flight' || item.kind === 'train') && Number.isFinite(s)) {
      const from = normCity(item.fromCity)
      const home = trips.find(t => !returned.has(t) && normCity(t.city) === from && Number.isFinite(ms(t.startAt)) && s >= ms(t.startAt) && s <= ms(t.startAt) + 21 * DAY)
      if (home) { home.items.push(item); returned.add(home); if (!Number.isFinite(ms(home.endAt)) || s > ms(home.endAt)) home.endAt = item.startAt; continue }
    }
    const match = trips.find(t => {
      if (normCity(t.city) !== city) return false
      const ts = ms(t.startAt), te = Number.isFinite(ms(t.endAt)) ? ms(t.endAt) : ts
      if (!Number.isFinite(s) || !Number.isFinite(ts)) return true // an undated booking joins the same-city trip
      return s <= te + DAY && e >= ts - DAY
    })
    if (match) {
      match.items.push(item)
      if (Number.isFinite(s) && (!Number.isFinite(ms(match.startAt)) || s < ms(match.startAt))) match.startAt = item.startAt
      if (Number.isFinite(e) && (!Number.isFinite(ms(match.endAt)) || e > ms(match.endAt))) match.endAt = item.endAt || item.startAt
    } else {
      trips.push({ key: `trip:${city}:${(item.startAt || 'undated').slice(0, 10)}`, city: titleCase(city), startAt: item.startAt, endAt: item.endAt || item.startAt, items: [item] })
    }
  }
  return { trips: trips.filter(t => t.items.length), loose }
}

function clock(iso: string | null, tz: string) {
  if (!iso) return ''
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return ''
  return new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz }).format(d).replace(/\s?([ap])m/i, (_, m) => ` ${m.toLowerCase()}m`)
}
function dayOnly(iso: string | null, tz: string) {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isFinite(d.getTime()) ? new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz }).format(d) : ''
}

/** One readable line per linked booking. Pure. */
export function itemLine(i: GraphItem, tz: string): string {
  if (i.kind === 'stay') {
    const m = i.meta || {}
    const dates = m.checkIn || m.checkOut ? `${m.checkIn ? `check-in ${m.checkIn}` : 'check-in date not given'}${m.checkOut ? `, check-out ${m.checkOut}` : ', check-out date not given'}` : 'dates not given'
    const who = m.bookedBy ? `booking under ${m.bookedBy}${m.userRole === 'guest' ? ', you are an added guest' : ''}` : ''
    return `🏨 ${m.hotel || i.title}${m.city ? `, ${m.city}` : ''} · ${dates}${who ? ` · ${who}` : ''}${i.ref ? ` · ref ${i.ref}` : ''}`
  }
  if (i.kind === 'cab') return `🚕 Cab: ${i.meta?.details || i.title}${i.startAt ? ` · ${clock(i.startAt, tz)}` : ''}`
  const icon = i.kind === 'train' ? '🚆' : '✈️'
  return `${icon} ${i.title} · departs ${clock(i.startAt, tz) || 'time not recorded'}${i.endAt ? ` · arrives ${clock(i.endAt, tz)}` : ''}${i.ref ? ` · PNR ${i.ref}` : ''}`
}

/** Trips as context lines for the brain and the chat model. Pure. */
export function tripLines(trips: Trip[], tz = 'Asia/Kolkata', now = Date.now()): string[] {
  const out: string[] = []
  for (const t of trips) {
    const end = Number.isFinite(ms(t.endAt)) ? ms(t.endAt) : ms(t.startAt)
    if (Number.isFinite(end) && end < now - DAY) continue
    const span = [dayOnly(t.startAt, tz), dayOnly(t.endAt, tz)].filter(Boolean)
    const label = span.length === 2 && span[0] !== span[1] ? `${span[0]} – ${span[1]}` : span[0] || 'dates not given'
    out.push(`${t.city} trip (${label}), linked bookings:`)
    for (const i of t.items) out.push(`  ${itemLine(i, tz)}`)
  }
  return out.slice(0, 24)
}

/** The user's trips: life_events from 2 days ago to 45 days ahead (and undated stays), linked. Fails soft to []. */
export async function loadTrips(telegramId: number | string, now = new Date()): Promise<Trip[]> {
  try {
    const lower = new Date(now.getTime() - 2 * DAY).toISOString(), upper = new Date(now.getTime() + 45 * DAY).toISOString()
    const { data, error } = await supabaseAdmin.from('life_events')
      .select('id,event_type,subtype,title,provider,start_at,end_at,location,confirmation_ref,lifecycle_state,metadata_json')
      .eq('telegram_id', String(telegramId))
      .not('lifecycle_state', 'in', '(cancelled,expired)')
      .or(`and(start_at.gte.${lower},start_at.lte.${upper}),and(end_at.gte.${lower},start_at.lte.${upper}),and(start_at.is.null,subtype.eq.hotel_stay)`)
      .order('start_at', { ascending: true, nullsFirst: false })
      .limit(60)
    if (error) { console.error('LIFE_GRAPH_READ_FAILED:', error.message); return [] }
    const items = (data || []).map(itemFromLifeEvent).filter((x): x is GraphItem => !!x)
    // Tickets are promoted to life_events by a database trigger; read travel_tickets too so a missed promotion
    // still links. A ticket already present as a life event is not added twice.
    const promoted = new Set(items.map(i => String(i.meta?.travel_ticket_id || '')).filter(Boolean))
    const { data: tickets } = await supabaseAdmin.from('travel_tickets')
      .select('id,type,from_city,to_city,depart_at,arrive_at,airline,flight_no,train_no,train_name,pnr')
      .eq('telegram_id', Number(telegramId)).gte('depart_at', lower).lte('depart_at', upper).limit(40)
      .then(r => r, () => ({ data: [] as any[] }))
    for (const t of (tickets || []) as any[]) {
      if (promoted.has(String(t.id)) || (t.type !== 'flight' && t.type !== 'train')) continue
      items.push({
        id: `tt:${t.id}`, kind: t.type, title: t.type === 'flight' ? [t.airline || 'Flight', t.flight_no, `${t.from_city} → ${t.to_city}`].filter(Boolean).join(' ') : [t.train_name || 'Train', t.train_no, `${t.from_city} → ${t.to_city}`].filter(Boolean).join(' '),
        city: t.to_city || null, fromCity: t.from_city || null, startAt: t.depart_at || null, endAt: t.arrive_at || null, ref: t.pnr || null, meta: { travel_ticket_id: t.id },
      })
    }
    return linkTrips(items).trips
  } catch (err: any) {
    console.error('LIFE_GRAPH_READ_FAILED:', String(err?.message || err).slice(0, 120))
    return []
  }
}

/** The trip a city and date belong to, if any. Pure. */
export function tripFor(trips: Trip[], city: string, dayIso?: string | null): Trip | null {
  const c = normCity(city)
  const candidates = trips.filter(t => normCity(t.city) === c)
  if (!dayIso) return candidates[0] || null
  const d = Date.parse(dayIso)
  return candidates.find(t => {
    const s = ms(t.startAt), e = Number.isFinite(ms(t.endAt)) ? ms(t.endAt) : s
    return !Number.isFinite(s) || (d <= e + DAY && d >= s - DAY)
  }) || candidates[0] || null
}

/** The arriving leg of a trip (first flight or train into the city). Pure. */
export function arrivalLeg(t: Trip): GraphItem | null {
  return t.items.find(i => (i.kind === 'flight' || i.kind === 'train') && normCity(i.city) === normCity(t.city)) || null
}
