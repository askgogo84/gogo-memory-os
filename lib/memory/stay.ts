// Hotel stays (29 Oct): a forwarded hotel email or screenshot becomes a saved stay linked to its trip.
// Live failure it fixes: Mukesh's "pls add Goverdhan as the 2nd guest" to Four Seasons was answered
// "you've added me as the 2nd guest", filed as a generic note dated 28 Oct, and never linked to the
// BLR → BOM flight landing that morning.
import { supabaseAdmin } from '@/lib/supabase-admin'
import { loadTrips, tripFor, arrivalLeg, normCity, currentTrip, type Trip } from './life-graph'

export type Stay = {
  hotel: string
  city: string | null
  checkIn: string | null      // YYYY-MM-DD
  checkOut: string | null     // YYYY-MM-DD
  checkInTime: string | null  // "3:00 pm"
  bookingRef: string | null
  bookedBy: string | null
  guests: string[]
  userRole: 'booker' | 'guest' | 'unknown'
  isRequest: boolean          // a request to the hotel (add a guest, change dates), not the hotel's confirmation
  address: string | null
}

const HOTEL_WORD = /\b(?:hotels?|resorts?|inn|suites?|villas?|homestay|hostel|lodge|palace|marriott|taj|oberoi|itc|hyatt|hilton|leela|four seasons|novotel|ibis|radisson|sheraton|westin|jw|trident|lemon tree|oyo|treebo|fabhotels|airbnb|booking\.com|agoda|makemytrip|goibibo)\b/i
const STAY_WORD = /\b(?:check[- ]?in|check[- ]?out|reservation|booking|confirmation|guests?|stay|arrival|room|nights?)\b/i

/** Cheap gate before any model call: names a hotel and a stay word. Pure. */
export function looksLikeHotelBooking(text: string): boolean {
  const t = String(text || '')
  if (t.length < 40) return false
  return HOTEL_WORD.test(t) && STAY_WORD.test(t)
}

const iso = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)
const str = (v: unknown, max = 120) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)

/** Model output → Stay, rejecting anything without a hotel name. Pure. */
export function stayFromJson(raw: any): Stay | null {
  if (!raw || typeof raw !== 'object') return null
  const hotel = str(raw.hotel, 120)
  if (!hotel || /^(?:hotel|the hotel|unknown)$/i.test(hotel)) return null
  const role = raw.userRole === 'booker' || raw.userRole === 'guest' ? raw.userRole : 'unknown'
  return {
    hotel, city: str(raw.city, 60), checkIn: iso(raw.checkIn), checkOut: iso(raw.checkOut), checkInTime: str(raw.checkInTime, 20),
    bookingRef: str(raw.bookingRef, 40), bookedBy: str(raw.bookedBy, 80),
    guests: Array.isArray(raw.guests) ? raw.guests.map((g: unknown) => str(g, 80)).filter(Boolean).slice(0, 8) as string[] : [],
    userRole: role, isRequest: raw.isRequest === true, address: str(raw.address, 200),
  }
}

type Fetch = typeof fetch

/** Read a hotel booking out of email or screenshot text. Null when it is not a hotel stay or the read failed. */
export async function extractStay(text: string, opts: { userName?: string | null; now?: Date; fetcher?: Fetch } = {}): Promise<Stay | null> {
  const apiKey = (globalThis as any).process?.env?.ANTHROPIC_API_KEY
  if (!apiKey || !looksLikeHotelBooking(text)) return null
  const now = opts.now || new Date()
  const prompt = `Today is ${now.toISOString().slice(0, 10)}. The user is ${opts.userName || 'the user'} (their name may appear in other spellings).
Read this forwarded email or screenshot text. If it is about a hotel stay (a confirmation, a change, or a request to a hotel), return JSON only:
{"isHotelStay":true,"hotel":"","city":"","checkIn":"YYYY-MM-DD or null","checkOut":"YYYY-MM-DD or null","checkInTime":"or null","bookingRef":"or null","bookedBy":"name of the person the booking is under, or null","guests":["names"],"userRole":"booker|guest|unknown","isRequest":true|false,"address":"or null"}
Rules: dates only when the text states the stay dates; the date an email was SENT is never a check-in date. userRole is "guest" when someone else's booking adds the user as a guest. isRequest is true when the text asks the hotel to do something (add a guest, change dates) rather than confirming. If it is not a hotel stay, return {"isHotelStay":false}. Never invent.
TEXT:
${String(text).slice(0, 6000)}`
  try {
    const res = await (opts.fetcher || fetch)('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5', max_tokens: 400, messages: [{ role: 'user', content: prompt }] }),
      signal: AbortSignal.timeout(12000),
    })
    if (!res.ok) { console.error('STAY_EXTRACT_FAILED:', res.status); return null }
    const data: any = await res.json()
    const out = (data?.content || []).filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('')
    const json = JSON.parse(String(out).match(/\{[\s\S]*\}/)?.[0] || '{}')
    if (json.isHotelStay !== true) return null
    return stayFromJson(json)
  } catch (err: any) {
    console.error('STAY_EXTRACT_FAILED:', String(err?.message || err).slice(0, 120))
    return null
  }
}

/** "Four Seasons Hotels and Resorts" + Mumbai → "Four Seasons Mumbai": a chain name is not the property. Pure. */
export function propertyName(hotel: string, city: string | null): string {
  const raw = String(hotel || '').trim()
  const base = raw.replace(/\s+(?:hotels?\s*(?:and|&)\s*resorts?|hotels?|resorts?|group|international)\s*$/i, '').trim() || raw
  if (base === raw || !city) return base
  const esc = city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`\\b${esc}\\b`, 'i').test(base) ? base : `${base} ${city}`
}

/** "pls add Goverdhan Dodammane as the 2nd guest" on someone else's booking: the user is a guest. Pure. */
export function inferGuestRole(text: string, userNames: string[]): boolean {
  const m = String(text || '').match(/\badd\s+([A-Za-z][A-Za-z .'-]{1,60}?)\s+as\s+(?:the\s+|a\s+|an\s+)?(?:\d+(?:st|nd|rd|th)\s+|second\s+|additional\s+|extra\s+)?guest\b/i)
  if (!m) return false
  const named = m[1].toLowerCase().split(/\s+/)
  const mine = userNames.flatMap(n => String(n || '').toLowerCase().split(/\s+/)).filter(w => w.length > 2)
  return mine.some(w => named.includes(w))
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)

/** Same hotel and city is one stay unless both carry different check-in dates. Pure. */
export function stayDedupeKey(s: Stay): string {
  return `stay:${slug(s.hotel)}:${slug(normCity(s.city) || 'city')}`
}

/** Merge a new read into what was saved: keep known facts, add new ones, never blank a field. Pure. */
export function mergeStay(prev: Partial<Stay> | null | undefined, next: Stay): Stay {
  const p = prev || {}
  return {
    hotel: next.hotel || String(p.hotel || ''),
    city: next.city || p.city || null,
    checkIn: next.checkIn || p.checkIn || null,
    checkOut: next.checkOut || p.checkOut || null,
    checkInTime: next.checkInTime || p.checkInTime || null,
    bookingRef: next.bookingRef || p.bookingRef || null,
    bookedBy: next.bookedBy || p.bookedBy || null,
    guests: [...new Set([...(p.guests || []), ...next.guests])].slice(0, 8),
    userRole: next.userRole !== 'unknown' ? next.userRole : (p.userRole || 'unknown'),
    isRequest: next.isRequest && !!p.isRequest,
    address: next.address || p.address || null,
  }
}

function dayStartIso(day: string | null, hour = 14) {
  if (!day) return null
  const d = new Date(`${day}T${String(hour).padStart(2, '0')}:00:00+05:30`)
  return Number.isFinite(d.getTime()) ? d.toISOString() : null
}

/** Save (or merge into) the stay. Returns the merged stay and whether it was new. */
export async function saveStay(telegramId: number | string, stay: Stay, source: { kind: string; text?: string }): Promise<{ stay: Stay; created: boolean } | null> {
  const tg = String(telegramId)
  const key = stayDedupeKey(stay)
  const { data: existing } = await supabaseAdmin.from('life_events').select('id,metadata_json').eq('telegram_id', tg).eq('dedupe_key', key).maybeSingle()
  const merged = mergeStay(existing?.metadata_json?.stay, stay)
  const row = {
    telegram_id: tg, event_type: 'reservation', subtype: 'hotel_stay', source: source.kind,
    title: `${merged.hotel}${merged.city ? `, ${merged.city}` : ''}`.slice(0, 240), provider: merged.hotel,
    start_at: dayStartIso(merged.checkIn, 14), end_at: dayStartIso(merged.checkOut, 11), timezone: 'Asia/Kolkata',
    location: merged.city, confirmation_ref: merged.bookingRef,
    lifecycle_state: 'planned', participants: merged.guests,
    metadata_json: { stay: merged, city: merged.city, hotel: merged.hotel, checkIn: merged.checkIn, checkOut: merged.checkOut, bookedBy: merged.bookedBy, userRole: merged.userRole },
    source_refs: [{ kind: source.kind, at: new Date().toISOString(), excerpt: String(source.text || '').slice(0, 300) }],
    dedupe_key: key, updated_at: new Date().toISOString(),
  }
  const { error } = await supabaseAdmin.from('life_events').upsert(row, { onConflict: 'telegram_id,dedupe_key' })
  if (error) { console.error('STAY_SAVE_FAILED:', error.message); return null }
  return { stay: merged, created: !existing }
}

function firstName(n: string | null) { return n ? n.split(/\s+/)[0] : '' }
function fmtDay(day: string | null) {
  if (!day) return ''
  return new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`))
}
function fmtTime(iso: string | null) {
  if (!iso) return ''
  return new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }).format(new Date(iso)).replace(/\s?([ap])m/i, (_, m) => ` ${m.toLowerCase()}m`)
}

/** The reply: what was saved, how it links to the trip, and only the one missing thing. Never claims Gogo acted. Pure. */
export function stayReply(stay: Stay, trip: Trip | null): string {
  const lines: string[] = []
  const who = stay.userRole === 'guest' && stay.bookedBy
    ? `you're a guest on ${stay.bookedBy}'s booking${stay.isRequest ? ` (${firstName(stay.bookedBy)} has asked the hotel to add you)` : ''}`
    : stay.bookedBy ? `booking under ${stay.bookedBy}` : ''
  lines.push(`🏨 *Saved: ${stay.hotel}${stay.city ? `, ${stay.city}` : ''}*${who ? `\n${who.charAt(0).toUpperCase()}${who.slice(1)}.` : ''}`)
  const dates = [stay.checkIn ? `Check-in ${fmtDay(stay.checkIn)}${stay.checkInTime ? `, ${stay.checkInTime}` : ''}` : '', stay.checkOut ? `check-out ${fmtDay(stay.checkOut)}` : ''].filter(Boolean).join(' · ')
  if (dates) lines.push(dates)
  if (stay.bookingRef) lines.push(`Ref: ${stay.bookingRef}`)
  const leg = trip ? arrivalLeg(trip) : null
  if (trip) lines.push(`\n🔗 Linked to your ${trip.city} trip${leg?.endAt ? `: you arrive ${fmtDay(leg.endAt.slice(0, 10))} at ${fmtTime(leg.endAt)} (${leg.title.replace(/\s+\S+\s+→\s+\S+$/, '')})` : ''}.`)
  const missing = !stay.checkIn && !stay.checkOut ? 'Which dates is the stay?' : !stay.checkOut ? 'Which day do you check out?' : !stay.checkIn ? 'Which day do you check in?' : ''
  if (missing) lines.push(`\n${missing}`)
  else lines.push(`\nI'll send you the hotel details on arrival day and a check-out reminder that morning.`)
  return lines.join('\n')
}

async function insertReminderOnce(tg: number, whatsappTo: string | null, atIso: string, message: string) {
  if (Date.parse(atIso) <= Date.now() + 5 * 60_000) return
  const { data } = await supabaseAdmin.from('reminders').select('id').eq('telegram_id', tg).eq('remind_at', atIso).eq('message', message).limit(1)
  if (data?.length) return
  const { error } = await supabaseAdmin.from('reminders').insert({ telegram_id: tg, chat_id: tg, whatsapp_to: whatsappTo, timezone: 'Asia/Kolkata', message, remind_at: atIso, sent: false, created_at: new Date().toISOString() })
  if (error) console.error('STAY_REMINDER_FAILED:', error.message)
}

/** Arrival-day and check-out-morning reminders, only from stated dates. */
export async function scheduleStayReminders(tg: number, whatsappTo: string | null, stay: Stay) {
  const under = stay.bookedBy ? ` (booking under ${stay.bookedBy})` : ''
  if (stay.checkIn) await insertReminderOnce(tg, whatsappTo, new Date(`${stay.checkIn}T08:00:00+05:30`).toISOString(), `🏨 Today: check in at ${stay.hotel}${stay.city ? `, ${stay.city}` : ''}${stay.checkInTime ? ` from ${stay.checkInTime}` : ''}${under}.${stay.address ? ` ${stay.address}` : ''}`)
  if (stay.checkOut) await insertReminderOnce(tg, whatsappTo, new Date(`${stay.checkOut}T07:30:00+05:30`).toISOString(), `🏨 Check-out today at ${stay.hotel}. Need a late check-out or an airport cab?`)
}

/** Full path: read → save → link → reminders → reply. Null when the text is not a hotel stay. */
export async function ingestStayFromText(p: { telegramId: number; whatsappTo?: string | null; userName?: string | null; userNames?: string[]; text: string; source: string; now?: Date }): Promise<string | null> {
  if (!looksLikeHotelBooking(p.text)) return null
  const names = [...new Set([p.userName, ...(p.userNames || [])].filter(Boolean) as string[])]
  const read = await extractStay(p.text, { userName: names.join(' / ') || null, now: p.now })
  if (!read) return null
  const now = p.now || new Date()
  const trips = await loadTrips(p.telegramId, now)
  // 29 Oct live: Mukesh's email named no city, so the stay saved with no trip. A stay with no city and no dates that
  // arrives during (or just before) a trip belongs to that trip.
  const live = !read.city && !read.checkIn ? currentTrip(trips, now.getTime()) : null
  const city = read.city || live?.city || null
  const stay: Stay = { ...read, city, hotel: propertyName(read.hotel, city), userRole: read.userRole === 'unknown' && read.bookedBy && inferGuestRole(p.text, names) ? 'guest' : read.userRole }
  const saved = await saveStay(p.telegramId, stay, { kind: p.source, text: p.text })
  if (!saved) return null
  const trip = saved.stay.city ? tripFor(await loadTrips(p.telegramId, now), saved.stay.city, saved.stay.checkIn) : null
  await scheduleStayReminders(p.telegramId, p.whatsappTo || null, saved.stay).catch(() => {})
  console.log('STAY_SAVED:', JSON.stringify({ created: saved.created, hotel: saved.stay.hotel, city: saved.stay.city, linkedTrip: trip?.key || null, dated: !!saved.stay.checkIn }))
  return stayReply(saved.stay, trip)
}
