// Proactive calendar conflict discovery (Duet brief: pre-meeting intelligence / genuine scheduling conflicts).
// Pure: takes events from a COMPLETE Google Calendar read plus the owner's saved flights and returns conflicts
// with their evidence. Availability is never inferred from missing data — the caller only passes complete reads.

export type CalendarEventLike = {
  id?: string; summary?: string | null; status?: string | null; transparency?: string | null
  start?: { dateTime?: string | null; date?: string | null } | null
  end?: { dateTime?: string | null; date?: string | null } | null
  attendees?: Array<{ self?: boolean; responseStatus?: string | null }> | null
}
export type TicketLike = { id?: string | number; flight_no?: string | null; from_city?: string | null; to_city?: string | null; depart_at?: string | null }
export type ScheduleConflict = {
  key: string; kind: 'overlap' | 'flight'; title: string; summary: string; startsAt: string
  evidence: { eventIds: string[]; ticketId?: string; window: [string, string] }
}

const BEFORE_FLIGHT_MS = 3 * 3_600_000 // leaving for the airport
const AFTER_DEPARTURE_MS = 60 * 60_000

function interval(e: CalendarEventLike): { start: number; end: number } | null {
  const s = Date.parse(String(e?.start?.dateTime || '')), en = Date.parse(String(e?.end?.dateTime || ''))
  return Number.isFinite(s) && Number.isFinite(en) && en > s ? { start: s, end: en } : null // all-day/unknown ends are skipped
}
function busy(e: CalendarEventLike) {
  if (String(e?.status || '') === 'cancelled' || String(e?.transparency || '') === 'transparent') return false
  const me = (e?.attendees || []).find(a => a?.self)
  return !(me && String(me.responseStatus || '') === 'declined')
}
const name = (e: CalendarEventLike) => String(e?.summary || 'Busy').replace(/\s+/g, ' ').trim().slice(0, 120)
function clock(ms: number, tz: string) {
  return new Intl.DateTimeFormat('en-IN', { weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz }).format(new Date(ms))
}

export function findScheduleConflicts(events: CalendarEventLike[], tickets: TicketLike[], now = new Date(), tz = 'Asia/Kolkata'): ScheduleConflict[] {
  const timed = (events || []).filter(busy).map(e => ({ e, i: interval(e) })).filter((x): x is { e: CalendarEventLike; i: { start: number; end: number } } => Boolean(x.i) && x.i!.end > now.getTime())
  const out: ScheduleConflict[] = []
  for (let a = 0; a < timed.length; a++) for (let b = a + 1; b < timed.length; b++) {
    const x = timed[a], y = timed[b]
    if (!(x.i.start < y.i.end && x.i.end > y.i.start)) continue
    const [first, second] = x.i.start <= y.i.start ? [x, y] : [y, x]
    const ids = [String(first.e.id || name(first.e)), String(second.e.id || name(second.e))].sort()
    out.push({
      key: `overlap:${ids.join('+')}:${new Date(first.i.start).toISOString()}`, kind: 'overlap',
      title: `${name(first.e)} overlaps ${name(second.e)}`,
      summary: `Both are on your calendar at ${clock(second.i.start, tz)}. Move one, or tell Gogo which one wins.`,
      startsAt: new Date(second.i.start).toISOString(),
      evidence: { eventIds: ids, window: [new Date(Math.max(first.i.start, second.i.start)).toISOString(), new Date(Math.min(first.i.end, second.i.end)).toISOString()] },
    })
  }
  for (const t of tickets || []) {
    const dep = Date.parse(String(t?.depart_at || ''))
    if (!Number.isFinite(dep) || dep <= now.getTime()) continue
    const flight = [t.flight_no, t.from_city && t.to_city ? `${t.from_city} → ${t.to_city}` : ''].filter(Boolean).join(' · ') || 'your flight'
    for (const { e, i } of timed) {
      if (!(i.start < dep + AFTER_DEPARTURE_MS && i.end > dep - BEFORE_FLIGHT_MS)) continue
      const hours = Math.max(0, Math.round((dep - i.start) / 360_000) / 10)
      out.push({
        key: `flight:${String(t.id ?? t.flight_no)}:${String(e.id || name(e))}`, kind: 'flight',
        title: `${name(e)} is close to ${flight}`,
        summary: `${name(e)} starts ${clock(i.start, tz)}, ${hours ? `${hours} h before` : 'at'} departure (${clock(dep, tz)}). Move it?`,
        startsAt: new Date(i.start).toISOString(),
        evidence: { eventIds: [String(e.id || name(e))], ticketId: String(t.id ?? ''), window: [new Date(dep - BEFORE_FLIGHT_MS).toISOString(), new Date(dep + AFTER_DEPARTURE_MS).toISOString()] },
      })
    }
  }
  return out.slice(0, 10)
}
