// Proactive pre-meeting intelligence (Duet brief, Phase 2). Pure: from a COMPLETE calendar read and the
// recent Gmail threads Gogo already reads for attention, find upcoming meetings with other people and the
// email context worth reading first. Nothing is guessed: a meeting with no related email says so.

export type PrepAttendee = { email?: string | null; self?: boolean; responseStatus?: string | null; resource?: boolean; displayName?: string | null }
export type PrepEvent = {
  id?: string; summary?: string | null; start?: string | null; end?: string | null
  status?: string | null; transparency?: string | null; attendees?: PrepAttendee[] | null
}
export type PrepThread = { id: string; subject: string; messages: Array<{ from: string; to: string; internalDate: number; snippet?: string }> }
export type MeetingPrep = {
  key: string; eventId: string; title: string; summary: string; startsAt: string
  attendees: string[]; threadIds: string[]
}

const MIN = 60_000
/** Prep is useful from ~18 h before until 20 min before the start. */
export const PREP_WINDOW = { fromMs: 20 * MIN, toMs: 18 * 60 * MIN }

const emailsIn = (header: string) => (String(header || '').toLowerCase().match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g) || [])
const clean = (s: unknown, n: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n)

function clock(ms: number, tz: string) {
  return new Intl.DateTimeFormat('en-IN', { weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz }).format(new Date(ms))
}
function dayMonth(ms: number, tz: string) {
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: tz }).format(new Date(ms))
}

export function findMeetingsNeedingPrep(events: PrepEvent[], threads: PrepThread[], ownEmail: string, now = new Date(), tz = 'Asia/Kolkata'): MeetingPrep[] {
  const me = String(ownEmail || '').toLowerCase()
  const out: MeetingPrep[] = []
  for (const e of events || []) {
    if (String(e?.status || '') === 'cancelled' || String(e?.transparency || '') === 'transparent') continue
    const start = Date.parse(String(e?.start || '')), end = Date.parse(String(e?.end || ''))
    if (!Number.isFinite(start) || !/T\d{2}:/.test(String(e?.start || ''))) continue // timed events only
    const lead = start - now.getTime()
    if (lead < PREP_WINDOW.fromMs || lead > PREP_WINDOW.toMs) continue
    const att = (e.attendees || []).filter(a => a && !a.resource)
    const self = att.find(a => a.self || (me && String(a.email || '').toLowerCase() === me))
    if (self && String(self.responseStatus || '') === 'declined') continue
    const others = att.filter(a => a !== self && String(a.email || '').includes('@') && String(a.email || '').toLowerCase() !== me && String(a.responseStatus || '') !== 'declined')
    if (!others.length) continue // solo blocks and focus time need no prep
    const otherEmails = [...new Set(others.map(a => String(a.email).toLowerCase()))].slice(0, 10)
    const related = (threads || []).map(t => {
      const hits = (t.messages || []).filter(m => [...emailsIn(m.from), ...emailsIn(m.to)].some(x => otherEmails.includes(x)))
      const last = hits.sort((a, b) => Number(b.internalDate || 0) - Number(a.internalDate || 0))[0]
      return last ? { t, last } : null
    }).filter((x): x is { t: PrepThread; last: PrepThread['messages'][number] } => Boolean(x))
      .sort((a, b) => Number(b.last.internalDate || 0) - Number(a.last.internalDate || 0)).slice(0, 3)
    const name = clean(e.summary || 'Meeting', 100)
    const who = others.slice(0, 3).map(a => clean(a.displayName || String(a.email).split('@')[0], 40)).join(', ') + (others.length > 3 ? ` +${others.length - 3}` : '')
    const emailLine = related.length
      ? `Read first: ${related.map(r => `“${clean(r.t.subject || '(no subject)', 70)}” (${dayMonth(Number(r.last.internalDate), tz)})`).join('; ')}.`
      : 'No recent email with them in the last two weeks.'
    out.push({
      key: `prep:${String(e.id || name)}:${new Date(start).toISOString()}`, eventId: String(e.id || ''),
      title: `Prepare for ${name} · ${clock(start, tz)}`,
      summary: `With ${who}${Number.isFinite(end) ? ` until ${new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz }).format(new Date(end))}` : ''}. ${emailLine}`,
      startsAt: new Date(start).toISOString(), attendees: otherEmails, threadIds: related.map(r => r.t.id),
    })
  }
  return out.sort((a, b) => a.startsAt.localeCompare(b.startsAt)).slice(0, 6)
}
