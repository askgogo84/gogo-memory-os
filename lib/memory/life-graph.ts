// Connected memory (29 Oct): flights, trains, hotel stays and cabs are one trip when they share a destination city and
// overlapping dates. Every saved booking lives in life_events (tickets are promoted there by the database trigger;
// stays are written by lib/memory/stay.ts). This module reads them and links them into trips, so every feature can
// see "you land in Mumbai at 11:45 and stay at Four Seasons under Mukesh" instead of unrelated scraps.
import { supabaseAdmin } from '@/lib/supabase-admin'

export type GraphItem = {
  id: string
  kind: 'flight' | 'train' | 'stay' | 'cab' | 'note' | 'event' | 'other'
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
  const kind: GraphItem['kind'] = sub === 'flight' ? 'flight' : sub === 'train' ? 'train' : sub === 'hotel_stay' ? 'stay' : sub === 'cab' ? 'cab' : sub === 'trip_note' ? 'note' : row.event_type === 'event' ? 'event' : 'other'
  return {
    id: String(row.id), kind, title: String(row.title || '').slice(0, 160),
    city: kind === 'stay' || kind === 'cab' || kind === 'note' ? (meta.city || to || null) : to, fromCity: from,
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
    if (!city || !['flight', 'train', 'stay', 'cab', 'note'].includes(item.kind)) { loose.push(item); continue }
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
    const who = m.bookedBy ? `booking name: ${m.bookedBy}${m.arrangedBy && m.arrangedBy !== m.bookedBy ? ` (arranged by ${m.arrangedBy})` : ''}${m.userRole === 'guest' ? ', you are an added guest' : ''}` : ''
    const hotelName = String(m.hotel || i.title)
    return `🏨 ${hotelName}${m.city && !hotelName.toLowerCase().includes(String(m.city).toLowerCase()) ? `, ${m.city}` : ''} · ${dates}${who ? ` · ${who}` : ''}${i.ref ? ` · ref ${i.ref}` : ''}`
  }
  if (i.kind === 'note') return `📌 ${i.meta?.text || i.title}${i.meta?.from ? ` (from ${i.meta.from})` : ''}`
  if (i.kind === 'event') return `📅 ${clock(i.startAt, tz) || dayOnly(i.startAt, tz)} · ${i.title}${i.meta?.location ? ` · ${String(i.meta.location).slice(0, 80)}` : ''}${i.meta?.gap ? ` (${i.meta.gap})` : ''}`
  if (i.kind === 'cab') return `🚕 Cab: ${i.meta?.details || i.title}${i.startAt ? ` · ${clock(i.startAt, tz)}` : ''}`
  const icon = i.kind === 'train' ? '🚆' : '✈️'
  return `${icon} ${i.title} · departs ${clock(i.startAt, tz) || 'time not recorded'}${i.endAt ? ` · arrives ${clock(i.endAt, tz)}` : ''}${i.ref ? ` · PNR ${i.ref}` : ''}`
}

const KIND_ORDER: Record<string, number> = { flight: 0, train: 0, cab: 1, stay: 2, event: 3, note: 4, other: 5 }

/** Dated travel first in time order, then the stay, meetings, and notes last. Pure. */
export function orderItems(items: GraphItem[]): GraphItem[] {
  return [...items].sort((a, b) => {
    const notesA = a.kind === 'note' ? 1 : 0, notesB = b.kind === 'note' ? 1 : 0
    if (notesA !== notesB) return notesA - notesB
    const sa = ms(a.startAt), sb = ms(b.startAt)
    if (Number.isFinite(sa) && Number.isFinite(sb) && sa !== sb) return sa - sb
    if (Number.isFinite(sa) !== Number.isFinite(sb)) return Number.isFinite(sa) ? -1 : 1
    return (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9)
  })
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
    for (const i of orderItems(t.items)) out.push(`  ${itemLine(i, tz)}`)
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

/** The trip happening now, or starting within 3 days (the one forwarded notes and cab details belong to). Pure. */
export function currentTrip(trips: Trip[], now = Date.now()): Trip | null {
  const live = trips.find(t => { const st = Date.parse(String(t.startAt)), e = Date.parse(String(t.endAt || t.startAt)); return st - 12 * 36e5 <= now && now <= e + DAY })
  return live || trips.find(t => Date.parse(String(t.startAt)) > now && Date.parse(String(t.startAt)) - now < 3 * DAY) || null
}

// ── 29 Oct, round 2: notes, meetings and documents join the trip ─────────────────────────────────────────────────

/** "Booking is in the name of Aman Chamedia" / "booked under Aman" → "Aman Chamedia". Pure. */
export function bookingNameIn(text: string): string | null {
  const m = String(text || '').match(/\b(?:booking|booked|reservation|reserved|room)\b[^.]{0,30}?\b(?:in\s+the\s+name\s+of|under\s+the\s+name(?:\s+of)?|under)\s+([a-z][a-z.'-]+(?:\s+(?!for\b|and\b|at\b|in\b|on\b|so\b)[a-z][a-z.'-]+){0,3})/i)
  return m ? m[1].trim().replace(/\b\w/g, c => c.toUpperCase()) : null
}

/** 29 Oct live: the trip answer said "Mukesh Chamedia (Aman Chamedia)". Mukesh forwarded the email; the hotel holds
 * the room under Aman. A note naming the booking name sets it, and whoever was recorded before becomes "arranged by".
 * Read-time only, so stays saved before this fix display correctly too. Pure. */
export function applyTripNotes(trips: Trip[]): Trip[] {
  for (const t of trips) {
    const stay = t.items.find(i => i.kind === 'stay')
    if (!stay) continue
    for (const n of t.items.filter(i => i.kind === 'note')) {
      const text = String(n.meta?.text || n.title || '')
      const name = bookingNameIn(text)
      if (name) {
        const meta = { ...(stay.meta || {}) }
        const prev = String(meta.bookedBy || meta.stay?.bookedBy || '')
        if (prev && prev.toLowerCase() !== name.toLowerCase() && !meta.arrangedBy) meta.arrangedBy = prev
        meta.bookedBy = name
        stay.meta = meta
        n.meta = { ...(n.meta || {}), appliedTo: 'stay' }
      }
      if (/\b(?:added|add(?:ing)?)\s+you\b[^.]*\bguest\b/i.test(text)) { stay.meta = { ...(stay.meta || {}), userRole: 'guest' }; n.meta = { ...(n.meta || {}), appliedTo: 'stay' } }
    }
    // A note fully absorbed into the stay line is not repeated as a separate line.
    t.items = t.items.filter(i => !(i.kind === 'note' && i.meta?.appliedTo === 'stay' && !/\b(?:card|incidental|deposit|pay|paid|breakfast|late|early|key|lobby)\b/i.test(String(i.meta?.text || i.title))))
  }
  return trips
}

const KNOWN_CITIES = new Set(Object.values(CITY_ALIASES).concat(['mumbai', 'bengaluru', 'delhi', 'chennai', 'kolkata', 'hyderabad', 'goa', 'pune', 'dubai', 'singapore', 'london']))

/** A city named in free text ("BKC, Mumbai", "Taj Lands End Bandra"), if it is one we know. Pure. */
export function cityIn(text: string): string | null {
  const words = String(text || '').toLowerCase().replace(/[^a-z ]+/g, ' ').split(/\s+/).filter(Boolean)
  for (let n = 2; n >= 1; n--) for (let i = 0; i + n <= words.length; i++) {
    const c = normCity(words.slice(i, i + n).join(' '))
    if (KNOWN_CITIES.has(c)) return c
  }
  return null
}

/** A Google Calendar event as a graph item. Pure. */
export function itemFromCalendarEvent(e: any): GraphItem | null {
  const start = e?.start?.dateTime || null
  if (!start) return null // all-day entries are not meetings
  return { id: `gcal:${e.id || start}`, kind: 'event', title: String(e.summary || 'Busy').slice(0, 120), city: cityIn(e.location || '') , fromCity: null, startAt: start, endAt: e.end?.dateTime || null, ref: null, meta: { location: e.location || null } }
}

function hoursBetween(a: number, b: number) {
  const h = Math.round(((b - a) / 36e5) * 2) / 2
  return h >= 1 ? `${h} h` : `${Math.round((b - a) / 60000)} min`
}

/** 29 Oct live: the 4 pm meeting on the Mumbai day was not linked to the trip. A timed meeting between landing and the
 * flight home belongs to that trip, unless its location names another city. Notes the gap after landing. Pure. */
export function linkCalendar(trips: Trip[], events: GraphItem[]): Trip[] {
  for (const ev of events) {
    const at = ms(ev.startAt)
    if (!Number.isFinite(at)) continue
    for (const t of trips) {
      const city = normCity(t.city)
      if (ev.city && normCity(ev.city) !== city) continue
      const arrive = t.items.find(i => (i.kind === 'flight' || i.kind === 'train') && normCity(i.city) === city)
      const leave = t.items.find(i => (i.kind === 'flight' || i.kind === 'train') && normCity(i.fromCity) === city)
      const from = arrive ? (ms(arrive.endAt) || ms(arrive.startAt)) : ms(t.startAt)
      const until = leave ? ms(leave.startAt) : (Number.isFinite(ms(t.endAt)) ? ms(t.endAt) + DAY : NaN)
      if (!Number.isFinite(from) || at < from || (Number.isFinite(until) && at > until)) continue
      if (t.items.some(i => i.id === ev.id)) break
      const meta = { ...ev.meta }
      if (arrive && at - from < 12 * 36e5) meta.gap = `${hoursBetween(from, at)} after you land`
      else if (leave && until - at < 12 * 36e5) meta.gap = `${hoursBetween(at, until)} before your flight home`
      t.items.push({ ...ev, meta })
      break
    }
  }
  return trips
}

export type TravelDoc = { kind: 'passport' | 'id_document'; label: string | null; holder: string | null; expiry: string | null; expired: boolean; title: string }

export { labelNameMismatch } from './names'
import { labelNameMismatch } from './names'

/** Travel documents as trip lines: who, expiry, and any warning. Never prints a document number. Pure. */
export function travelDocLines(docs: TravelDoc[], trips: Trip[]): string[] {
  if (!docs.length || !trips.length) return []
  const out = ['Travel documents on file:']
  const guests = trips.flatMap(t => t.items.filter(i => i.kind === 'stay').map(i => String(i.meta?.bookedBy || ''))).filter(Boolean).map(s => s.toLowerCase())
  for (const d of docs.slice(0, 6)) {
    const name = d.holder || d.label || 'holder not read'
    const bits = [`🛂 ${d.kind === 'passport' ? 'Passport' : 'ID'}: ${name}${d.label && d.holder && d.label.toLowerCase() !== d.holder.toLowerCase() ? ` (saved as "${d.label}")` : ''}`]
    if (d.expiry) bits.push(d.expired ? `EXPIRED ${d.expiry}, a hotel or airline may refuse it` : `valid till ${d.expiry}`)
    if (labelNameMismatch(d.label, d.holder)) bits.push(`the name read from the page does not match the label, so it may be misread; ask the user to confirm`)
    const first = (d.holder || d.label || '').toLowerCase().split(/\s+/)[0]
    if (first && guests.some(g => g.split(/\s+/)[0] === first)) bits.push('same person as the hotel booking name')
    out.push(`  ${bits.join(' · ')}`)
  }
  return out
}

function expiredIso(v: string | null, now: number) {
  const t = Date.parse(String(v || ''))
  return Number.isFinite(t) && t < now
}

/** Passports and IDs the user saved (no numbers selected). Fails soft to []. */
export async function loadTravelDocs(telegramId: number | string, now = Date.now()): Promise<TravelDoc[]> {
  try {
    const { data } = await supabaseAdmin.from('documents').select('doc_type,title,extracted,expires_on,created_at')
      .eq('telegram_id', Number(telegramId)).in('doc_type', ['passport', 'id_document']).order('created_at', { ascending: false }).limit(8)
    return ((data || []) as any[]).map(r => {
      const f = r.extracted?.fields || {}
      const expiry = r.expires_on || r.extracted?.expiryHuman || f.expiry_date || null
      return { kind: r.doc_type, label: r.extracted?.userLabel || null, holder: f.name || null, expiry: expiry ? String(expiry).slice(0, 20) : null, expired: expiredIso(r.expires_on, now), title: String(r.title || '') } as TravelDoc
    })
  } catch { return [] }
}

/** Timed calendar events across the trips' span, from every connected calendar. Fails soft to []. */
export async function loadTripCalendar(telegramId: number | string, trips: Trip[], now = Date.now()): Promise<GraphItem[]> {
  const live = trips.filter(t => (Number.isFinite(ms(t.endAt)) ? ms(t.endAt) : ms(t.startAt)) >= now - DAY && Number.isFinite(ms(t.startAt)))
  if (!live.length) return []
  try {
    const { getAllCalendarAccountAccess, fetchMergedCalendarEventsPage } = await import('@/lib/services/google-calendar-accounts')
    const accounts = await getAllCalendarAccountAccess(telegramId)
    if (!accounts.length) return []
    const from = new Date(Math.max(now - 12 * 36e5, Math.min(...live.map(t => ms(t.startAt))))).toISOString()
    const until = new Date(Math.max(...live.map(t => (Number.isFinite(ms(t.endAt)) ? ms(t.endAt) : ms(t.startAt)) + DAY))).toISOString()
    const page = await fetchMergedCalendarEventsPage(accounts, from, until, 'LIFE_GRAPH_CALENDAR_READ_FAILED', 30)
    return (page.events || []).map(itemFromCalendarEvent).filter((x: GraphItem | null): x is GraphItem => !!x)
  } catch { return [] }
}

function soft<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([p.catch(() => fallback), new Promise<T>(r => { timer = setTimeout(() => r(fallback), ms) })]).finally(() => timer && clearTimeout(timer))
}

/** Everything the trip answer needs: linked bookings, notes applied, meetings in the city, travel documents. */
export async function tripContextLines(telegramId: number | string, now = new Date(), tz = 'Asia/Kolkata'): Promise<string[]> {
  const trips = applyTripNotes(await loadTrips(telegramId, now))
  if (!trips.length) return []
  const [events, docs] = await Promise.all([soft(loadTripCalendar(telegramId, trips, now.getTime()), 1500, [] as GraphItem[]), soft(loadTravelDocs(telegramId, now.getTime()), 800, [] as TravelDoc[])])
  linkCalendar(trips, events)
  const lines = tripLines(trips, tz, now.getTime())
  return lines.length ? [...lines, ...travelDocLines(docs, trips)].slice(0, 32) : []
}
