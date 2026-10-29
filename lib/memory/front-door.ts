// The connected-memory front door (29 Oct): runs before the brain on WhatsApp and web chat.
// 1. A forwarded hotel booking becomes a saved stay linked to its trip.
// 2. A short date reply to Gogo's "which day do you check out?" updates that stay.
// 3. Cab details sent during a trip are saved to that trip.
// Anything else returns null and the normal pipeline runs untouched.
import { supabaseAdmin } from '@/lib/supabase-admin'
import { ingestStayFromText, looksLikeHotelBooking, saveStay, scheduleStayReminders, stayFromJson, bookingNameFrom, addedAsGuest, type Stay } from './stay'
import { loadTrips, normCity, currentTrip } from './life-graph'

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 }
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

function ymdIst(d: Date) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d) }
function addDays(ymd: string, n: number) { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

/** Dates in a short reply, in order: "31 Oct", "31st", "Saturday", "tomorrow", "31 Oct to 2 Nov". Pure. */
export function parseReplyDates(text: string, now = new Date()): string[] {
  const t = String(text || '').toLowerCase()
  const today = ymdIst(now)
  const year = Number(today.slice(0, 4)), month = Number(today.slice(5, 7)) - 1, day = Number(today.slice(8, 10))
  const found: { at: number; ymd: string }[] = []
  const push = (at: number, ymd: string | null) => { if (ymd) found.push({ at, ymd }) }
  for (const m of t.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?\s*(?:of\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/g)) {
    const mo = MONTHS[m[2]]; let y = year; if (mo < month - 1) y++
    push(m.index!, `${y}-${String(mo + 1).padStart(2, '0')}-${String(Number(m[1])).padStart(2, '0')}`)
  }
  for (const m of t.matchAll(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?\b/g)) {
    const mo = MONTHS[m[1]]; let y = year; if (mo < month - 1) y++
    push(m.index!, `${y}-${String(mo + 1).padStart(2, '0')}-${String(Number(m[2])).padStart(2, '0')}`)
  }
  if (!found.length) for (const m of t.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)\b/g)) {
    const d = Number(m[1]); if (d < 1 || d > 31) continue
    let y = year, mo = month; if (d < day) { mo++; if (mo > 11) { mo = 0; y++ } }
    push(m.index!, `${y}-${String(mo + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
  }
  for (const m of t.matchAll(/\b(today|tonight|tomorrow|day after tomorrow)\b/g)) push(m.index!, m[1] === 'tomorrow' ? addDays(today, 1) : m[1] === 'day after tomorrow' ? addDays(today, 2) : today)
  for (const m of t.matchAll(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/g)) {
    const target = WEEKDAYS.indexOf(m[1]); const cur = new Date(`${today}T00:00:00Z`).getUTCDay()
    push(m.index!, addDays(today, ((target - cur + 7) % 7) || 7))
  }
  return [...new Map(found.sort((a, b) => a.at - b.at).map(f => [f.ymd, f.ymd])).values()].slice(0, 2)
}

/** A reply that is only dates ("31st", "29 Oct to 31 Oct", "checking out Saturday"), not "the 2nd guest". Pure. */
export function isDateAnswer(text: string): boolean {
  const rest = String(text || '').toLowerCase()
    .replace(/\b\d{1,2}(?:st|nd|rd|th)?\s*(?:of\s+)?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/g, ' ')
    .replace(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}(?:st|nd|rd|th)?\b/g, ' ')
    .replace(/\b\d{1,2}(?:st|nd|rd|th)\b/g, ' ')
    .replace(/\b(?:today|tonight|tomorrow|day after tomorrow|sunday|monday|tuesday|wednesday|thursday|friday|saturday|this|next)\b/g, ' ')
    .replace(/\b(?:on|the|from|to|till|until|and|check(?:ing)?|out|in|i|am|will|be|its|it's|it|is|we|are|leaving|staying|arriving|stay|dates?)\b/g, ' ')
    .replace(/[^a-z]+/g, ' ').trim()
  return parseReplyDates(text).length > 0 && rest.split(/\s+/).filter(Boolean).length === 0
}

/** Which stay field a Gogo question asked for. Pure. */
export function askedStayField(assistantText: string): 'both' | 'checkOut' | 'checkIn' | null {
  const t = String(assistantText || '')
  if (!/🏨 \*Saved:/.test(t)) return null
  if (/Which dates is the stay\?/.test(t)) return 'both'
  if (/Which day do you check out\?/.test(t)) return 'checkOut'
  if (/Which day do you check in\?/.test(t)) return 'checkIn'
  return null
}

const TRIP_TALK = /\b(?:hotel|room|check[- ]?in|check[- ]?out|guest|stay|booking|reservation|incidentals?|deposit|card|cab|taxi|driver|car|pick\s?-?up|airport|flight|land(?:s|ed|ing)?|late|arriv(?:e|al|ing)|breakfast|lobby|reception|key)\b/i

const CAB_WORD = /\b(?:cab|taxi|driver|chauffeur|car\s+(?:no|number|details)|pick\s?-?up|pickup|uber|ola|blusmart|meru)\b/i
const CAB_DETAIL = /\b[A-Z]{2}\s?-?\d{1,2}\s?-?[A-Z]{1,3}\s?-?\d{3,4}\b|(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}\b|\b(?:driver(?:'s)?\s+(?:name|is)|name\s*:)/i

/** Cheap pre-filter for the route harnesses: only these shapes load the module. Pure. */
export function frontDoorCandidate(text: string): boolean {
  const t = String(text || '')
  if (t.length >= 40 && looksLikeHotelBooking(t)) return true
  if (CAB_WORD.test(t) && CAB_DETAIL.test(t)) return true
  return t.length <= 80 && /\b(?:\d{1,2}(?:st|nd|rd|th)\b|\d{1,2}\s*(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)|today|tonight|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i.test(t)
}

async function latestAssistant(tg: number): Promise<{ content: string; at: number } | null> {
  const { data } = await supabaseAdmin.from('conversations').select('role,content,created_at').eq('telegram_id', tg).order('created_at', { ascending: false }).limit(4)
  const row = (data || []).find((r: any) => r.role === 'assistant')
  return row ? { content: String(row.content || ''), at: Date.parse(String(row.created_at || '')) } : null
}

async function latestStay(tg: number): Promise<{ id: string; stay: Stay } | null> {
  const { data } = await supabaseAdmin.from('life_events').select('id,metadata_json,updated_at').eq('telegram_id', String(tg)).eq('subtype', 'hotel_stay').order('updated_at', { ascending: false }).limit(1)
  const row = data?.[0]
  const stay = row ? stayFromJson(row.metadata_json?.stay) : null
  return row && stay ? { id: String(row.id), stay } : null
}

function fmtDay(day: string) { return new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`)) }

export { currentTrip } from './life-graph'

export async function tryLifeGraphTurn(p: { telegramId: number; whatsappTo?: string | null; userName?: string | null; userNames?: string[]; text: string; surface: 'whatsapp' | 'web'; now?: Date; forwarded?: boolean }): Promise<{ text: string; handledBy: string } | null> {
  const text = String(p.text || '').trim()
  const now = p.now || new Date()
  if (!text) return null
  try {
    // 1. A forwarded hotel booking.
    if (text.length >= 40 && looksLikeHotelBooking(text)) {
      const reply = await ingestStayFromText({ telegramId: p.telegramId, whatsappTo: p.whatsappTo, userName: p.userName, userNames: p.userNames, text, source: `${p.surface}_text`, now })
      if (reply) return { text: reply, handledBy: 'life-graph-stay' }
    }
    // 2. A date answer to Gogo's own stay question (within 6 hours).
    if (!p.forwarded && text.length <= 80 && isDateAnswer(text)) {
      const last = await latestAssistant(p.telegramId)
      const field = last && now.getTime() - last.at < 6 * 36e5 ? askedStayField(last.content) : null
      const dates = field ? parseReplyDates(text, now) : []
      if (field && dates.length) {
        const current = await latestStay(p.telegramId)
        if (current) {
          const next: Stay = { ...current.stay }
          if (field === 'both') { next.checkIn = dates[0]; next.checkOut = dates[1] || null }
          else if (field === 'checkOut') next.checkOut = dates[dates.length - 1]
          else next.checkIn = dates[0]
          if (next.checkIn && next.checkOut && next.checkOut < next.checkIn) return { text: `Check-out (${fmtDay(next.checkOut)}) is before check-in (${fmtDay(next.checkIn)}). Which day do you check out?`, handledBy: 'life-graph-stay-dates' }
          const saved = await saveStay(p.telegramId, next, { kind: `${p.surface}_reply`, text })
          if (saved) {
            await scheduleStayReminders(p.telegramId, p.whatsappTo || null, saved.stay).catch(() => {})
            const s = saved.stay
            const parts = [s.checkIn ? `check-in ${fmtDay(s.checkIn)}` : '', s.checkOut ? `check-out ${fmtDay(s.checkOut)}` : ''].filter(Boolean).join(' · ')
            const more = !s.checkIn ? '\n\nWhich day do you check in?' : !s.checkOut ? '\n\nWhich day do you check out?' : `\n\nI'll remind you on arrival day and on the morning of check-out.`
            return { text: `🏨 *Updated: ${s.hotel}*\n${parts.charAt(0).toUpperCase()}${parts.slice(1)}.${more}`, handledBy: 'life-graph-stay-dates' }
          }
        }
      }
    }
    // 3. Cab details during a trip.
    if (CAB_WORD.test(text) && CAB_DETAIL.test(text)) {
      const trips = await loadTrips(p.telegramId, now)
      const trip = currentTrip(trips, now.getTime())
      if (trip) {
        const details = text.replace(/\s+/g, ' ').slice(0, 300)
        const { error } = await supabaseAdmin.from('life_events').upsert({
          telegram_id: String(p.telegramId), event_type: 'travel', subtype: 'cab', source: `${p.surface}_text`,
          title: `Cab in ${trip.city}`, start_at: trip.items.find(i => i.kind === 'flight' && normCity(i.city) === normCity(trip.city))?.endAt || trip.startAt,
          location: trip.city, lifecycle_state: 'planned', metadata_json: { city: trip.city, details, tripKey: trip.key },
          source_refs: [{ kind: 'message', at: now.toISOString() }], dedupe_key: `cab:${trip.key}`, updated_at: now.toISOString(),
        }, { onConflict: 'telegram_id,dedupe_key' })
        if (!error) return { text: `🚕 Saved the cab details to your ${trip.city} trip.\n\n${details}\n\nAsk *my cab details* any time.`, handledBy: 'life-graph-cab' }
        console.error('CAB_SAVE_FAILED:', error.message)
      }
    }
    // 4. A forwarded message during a trip (29 Oct live: "Have added you as the 2nd guest", "Room is paid for but they
    //    might take your card for incidentals" were answered as if the owner said them to Gogo: "you've added me").
    //    It is information from someone else for the trip: saved to the trip and acknowledged in the owner's terms.
    if (p.forwarded && text.length <= 600 && TRIP_TALK.test(text)) {
      const trips = await loadTrips(p.telegramId, now)
      const trip = currentTrip(trips, now.getTime())
      if (trip) {
        const stayItem = trip.items.find(i => i.kind === 'stay')
        if (stayItem && addedAsGuest(text)) {
          const cur = stayFromJson(stayItem.meta?.stay)
          if (cur) {
            const saved = await saveStay(p.telegramId, { ...cur, userRole: 'guest' }, { kind: 'forwarded_message', text })
            if (saved) return { text: `📌 Noted: you've been added as a guest at ${saved.stay.hotel}${saved.stay.bookedBy ? ` (booking under ${saved.stay.bookedBy})` : ''}.`, handledBy: 'life-graph-note' }
          }
        }
        // "Booking is in the name of Aman Chamedia" / "booked under X": the name the hotel will look up.
        const underName = bookingNameFrom(text)
        if (stayItem && underName) {
          const cur = stayFromJson(stayItem.meta?.stay)
          if (cur) {
            const saved = await saveStay(p.telegramId, { ...cur, bookedBy: underName }, { kind: 'forwarded_message', text })
            if (saved) return { text: `📌 Noted: the ${saved.stay.hotel} booking is in the name of ${saved.stay.bookedBy}.`, handledBy: 'life-graph-note' }
          }
        }
        const key = `note:${trip.key}:${text.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 80)}`
        const { error } = await supabaseAdmin.from('life_events').upsert({
          telegram_id: String(p.telegramId), event_type: 'other', subtype: 'trip_note', source: 'forwarded_message',
          title: text.slice(0, 200), start_at: trip.startAt, location: trip.city, lifecycle_state: 'captured',
          metadata_json: { city: trip.city, text: text.slice(0, 600), from: 'a forwarded message', tripKey: trip.key },
          source_refs: [{ kind: 'forwarded_message', at: now.toISOString() }], dedupe_key: key, updated_at: now.toISOString(),
        }, { onConflict: 'telegram_id,dedupe_key' })
        if (!error) return { text: `📌 Noted for your ${trip.city} trip:\n"${text.replace(/\s+/g, ' ').slice(0, 300)}"`, handledBy: 'life-graph-note' }
        console.error('TRIP_NOTE_SAVE_FAILED:', error.message)
      }
    }
  } catch (err: any) {
    console.error('LIFE_GRAPH_TURN_FAILED:', String(err?.message || err).slice(0, 160))
  }
  return null
}
