// 20 Oct live (02:05 IST, dashboard): "My bookings" reached general chat, which answered "*TONIGHT:* Jailer 2
// at PVR Orion Mall, 9:45pm IST" for a show that had started at 21:45 the evening before, and opened with
// "Boss, I already showed your bookings 4 messages back". Recent chat history still carried the earlier
// "tonight" reply and the model copied it. "My bookings" is now answered from the saved bookings
// themselves, with local times and the upcoming/over status computed here, never by the model.
import { supabaseAdmin } from '@/lib/supabase-admin'

const BOOKING_TYPES = new Set(['travel', 'event', 'reservation', 'appointment', 'hotel'])
const CLOSED_STATES = new Set(['cancelled', 'canceled', 'failed', 'archived', 'dismissed', 'expired', 'rejected'])
const EARLIER_WINDOW_MS = 24 * 3_600_000
const MAX_UPCOMING = 10

/** "my bookings", "show my bookings", "what are my upcoming reservations?" — a whole-message read, nothing else. */
export function isMyBookingsQuery(text: string): boolean {
  const t = String(text || '').trim().toLowerCase().replace(/\s+/g, ' ')
  if (t.length > 60) return false
  return /^(?:(?:please\s+)?(?:show|list|give|tell|get)\s+(?:me\s+)?|what\s+are\s+|what'?s\s+|whats\s+|any\s+)?(?:all\s+)?(?:of\s+)?my\s+(?:upcoming\s+|current\s+|saved\s+)?(?:bookings?|reservations?)(?:\s+(?:please|now|again))?\s*[?.!]*$/.test(t)
    || /^(?:what|which|any)\s+(?:upcoming\s+)?(?:bookings?|reservations?)\s+do\s+i\s+have\s*[?.!]*$/.test(t)
}

export type BookingRow = {
  id?: string
  event_type?: string | null
  subtype?: string | null
  title?: string | null
  provider?: string | null
  location?: string | null
  start_at?: string | null
  end_at?: string | null
  timezone?: string | null
  lifecycle_state?: string | null
}

function validZone(tz: string) { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true } catch { return false } }
function zoneOf(row: BookingRow) { return row.timezone && validZone(row.timezone) ? row.timezone : 'Asia/Kolkata' }
function dayKey(ms: number, tz: string) { return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms)) }

export function localBookingTime(ms: number, tz: string): string {
  const when = new Intl.DateTimeFormat('en-IN', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true })
    .format(new Date(ms)).replace(/\s?([ap])m\b/i, (_m, a) => ` ${a.toLowerCase()}m`)
  const zone = new Intl.DateTimeFormat('en-IN', { timeZone: tz, timeZoneName: 'short' }).formatToParts(new Date(ms)).find(p => p.type === 'timeZoneName')?.value || tz
  return `${when} ${zone === 'GMT+5:30' ? 'IST' : zone}`
}

function span(ms: number) {
  const minutes = Math.max(0, Math.round(ms / 60_000))
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60), rest = minutes % 60
  if (hours < 48) return rest ? `${hours} h ${rest} min` : `${hours} h`
  return `${Math.round(hours / 24)} days`
}

function line(row: BookingRow, start: number, status: string) {
  const tz = zoneOf(row)
  const title = String(row.title || row.subtype || row.event_type || 'Booking').replace(/\s+/g, ' ').trim().slice(0, 140)
  const where = row.location ? ` · ${String(row.location).replace(/\s+/g, ' ').trim().slice(0, 100)}` : ''
  const pending = row.lifecycle_state === 'waiting_approval' ? ' · waiting for your approval, not booked yet' : ''
  return `• ${title} — ${localBookingTime(start, tz)}${where} · ${status}${pending}`
}

/**
 * The reply, from saved bookings only. Upcoming (and in-progress) bookings first, nearest first; bookings that
 * already started in the last 24 hours go under "Earlier"; older ones and undated plans are left out. Pure.
 */
export function renderMyBookingsReply(rows: BookingRow[], now: number = Date.now()): string {
  const upcoming: Array<{ start: number; text: string }> = []
  const earlier: Array<{ start: number; text: string }> = []
  for (const row of rows || []) {
    if (!row) continue
    const kind = String(row.event_type || '').toLowerCase()
    const sub = String(row.subtype || '').toLowerCase()
    if (!BOOKING_TYPES.has(kind) && sub !== 'hotel') continue
    if (CLOSED_STATES.has(String(row.lifecycle_state || '').toLowerCase())) continue
    const start = Date.parse(String(row.start_at || ''))
    if (!Number.isFinite(start)) continue
    const endRaw = Date.parse(String(row.end_at || ''))
    const end = Number.isFinite(endRaw) && endRaw >= start ? endRaw : NaN
    const tz = zoneOf(row)
    if (start > now) {
      const day = dayKey(start, tz) === dayKey(now, tz) ? ' (today)' : dayKey(start, tz) === dayKey(now + 86_400_000, tz) ? ' (tomorrow)' : ''
      upcoming.push({ start, text: line(row, start, `starts in ${span(start - now)}${day}`) })
    } else if (Number.isFinite(end) && end > now) {
      upcoming.push({ start, text: line(row, start, `in progress, started ${span(now - start)} ago`) })
    } else if (now - start <= EARLIER_WINDOW_MS) {
      earlier.push({ start, text: line(row, start, `over, started ${span(now - start)} ago`) })
    }
  }
  upcoming.sort((a, b) => a.start - b.start)
  earlier.sort((a, b) => b.start - a.start)
  const parts: string[] = []
  if (upcoming.length) {
    parts.push(`*Your upcoming bookings*\n${upcoming.slice(0, MAX_UPCOMING).map(x => x.text).join('\n')}`)
    if (upcoming.length > MAX_UPCOMING) parts.push(`…and ${upcoming.length - MAX_UPCOMING} more.`)
  } else {
    parts.push('You have no upcoming bookings saved.')
  }
  if (earlier.length) parts.push(`*Earlier*\n${earlier.map(x => x.text).join('\n')}`)
  return parts.join('\n\n')
}

/** Owner-bound read of the saved bookings. Returns null only when the store cannot be read (the caller falls through). */
export async function buildMyBookingsReply(telegramId: number | string, now: number = Date.now()): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('life_events')
    .select('id,event_type,subtype,title,provider,location,start_at,end_at,timezone,lifecycle_state')
    .eq('telegram_id', String(telegramId))
    .order('updated_at', { ascending: false })
    .limit(120)
  if (error) return null
  return renderMyBookingsReply((data || []) as BookingRow[], now)
}
