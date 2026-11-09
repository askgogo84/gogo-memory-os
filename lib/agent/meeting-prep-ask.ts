// On-demand meeting prep. The proactive prep (meeting-prep.ts) runs before meetings on its own; this answers
// "Prep me for my next meeting" (Claude Duet / Muse benchmark, 6 Nov overnight run): went to a generic "what would
// you like?" reply although the calendar is connected. Read-only: the next timed meeting from the calendar, who is
// in it, the call link, and the latest emails with those people when Gmail is connected. Nothing is sent or changed.
import type { AgentActor } from './actor'
import { safeMeetLink } from './meeting-prep'

export const MEETING_PREP_RE = /^\s*(?:please\s+|can you\s+|could you\s+)?(?:prep(?:are)?|brief)\s+(?:me\s+)?(?:for|on|about)\s+(?:my\s+|the\s+)?(?:(?:next|upcoming|coming|first)\s+|today'?s\s+(?:next\s+)?|\d{1,2}(?::\d{2})?\s*(?:am|pm)\s+)?(?:meeting|call|appointment)\b|^\s*(?:what'?s|what\s+is)\s+my\s+next\s+(?:meeting|call)\s+about\b|^\s*meeting\s+prep\b/i

export function isMeetingPrepAsk(text: string) { return MEETING_PREP_RE.test(String(text || '').trim()) && String(text).length <= 160 }

export type PrepEvent = { summary: string; start: string; label: string; meetLink?: string; attendees?: { email: string; displayName?: string; self?: boolean; resource?: boolean; responseStatus?: string }[] }
export type GuestNotes = Map<string, string[]>
export type PrepEmail = { subject: string; from: string; date: string; snippet: string }

/** The next meeting that has not started yet; all-day items and ones already over are skipped. Pure. */
export function nextMeeting(events: PrepEvent[], now = Date.now()): PrepEvent | null {
  return events.filter(e => /T\d{2}:\d{2}/.test(e.start) && Date.parse(e.start) > now - 5 * 60_000)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))[0] || null
}

const who = (a: { email: string; displayName?: string }) => a.displayName || a.email.split('@')[0]

/** The prep note. Pure. */
export function formatPrep(e: PrepEvent, emails: PrepEmail[] | null, now = Date.now(), notes: GuestNotes = new Map()): string {
  const others = (e.attendees || []).filter(a => !a.self && !a.resource && a.email)
  const mins = Math.round((Date.parse(e.start) - now) / 60_000)
  const when = mins <= 0 ? 'starting now' : mins < 60 ? `in ${mins} min` : mins < 24 * 60 ? `in about ${Math.round(mins / 60)} h` : ''
  const lines = [`🗓️ *${e.summary}*`, `${e.label}${when ? ` · ${when}` : ''}`]
  const join = safeMeetLink(e.meetLink)
  if (join) lines.push(`Join: ${join}`)
  if (others.length) {
    const status = (s?: string) => s === 'accepted' ? '✓' : s === 'declined' ? '✗ declined' : s === 'tentative' ? 'maybe' : 'no reply yet'
    // What you've told Gogo about a guest (7 Nov, via lib/agent/people): "Nithin works from home on Fridays".
    lines.push('', `*Who's coming (${others.length})*`, ...others.slice(0, 8).flatMap(a => [`• ${who(a)} · ${status(a.responseStatus)}`, ...(notes.get(a.email.toLowerCase()) || []).map(n => `  ${n}`)]))
    if (others.length > 8) lines.push(`• and ${others.length - 8} more`)
  } else lines.push('', 'No other guests on the invite.')
  if (emails === null) lines.push('', 'Connect Gmail and I can add your latest emails with these people.')
  else if (emails.length) lines.push('', '*Latest emails with them*', ...emails.slice(0, 3).map(m => `• ${m.subject} · ${m.from.replace(/\s*<[^>]+>/, '')}${m.snippet ? `\n  ${m.snippet.slice(0, 140)}` : ''}`))
  else if (others.length) lines.push('', 'No recent emails with these guests.')
  lines.push('', 'Want me to draft an agenda or a note to the guests? I will show it to you before anything is sent.')
  return lines.join('\n')
}

export async function tryMeetingPrep(actor: AgentActor, text: string): Promise<string | null> {
  if (!isMeetingPrepAsk(text)) return null
  // Same Brain 3.0 (flagged owners): the same prep runs as the `meetings.prepare` procedure, a durable, traced run.
  // Read-only, no approval nodes. Any failure falls back to the direct path below so the person still gets an answer.
  const viaProcedure = await tryMeetingPrepProcedure(actor, text)
  if (viaProcedure) return viaProcedure
  const { executeReadOnlyCalendarStep } = await import('./calendar-read')
  let events: PrepEvent[] = []
  try {
    const out: any = await executeReadOnlyCalendarStep({ actor, instruction: 'what is on my calendar this week', missionText: 'what is on my calendar this week' })
    events = Array.isArray(out?.output?.events) ? out.output.events : []
  } catch (err: any) {
    const m = String(err?.message || err)
    console.error('MEETING_PREP_CALENDAR_FAILED:', m.slice(0, 120))
    if (/connect|token|auth|401|403|not_connected|missing/i.test(m)) {
      const { buildCalendarConnectUrl } = await import('@/lib/google-calendar')
      const url = buildCalendarConnectUrl(actor.legacyTelegramId)
      return `To prepare you for a meeting I need your Google Calendar.${url ? ` Connect it here:\n${url}` : ''}`
    }
    return "I couldn't read your calendar just now. Try again in a minute."
  }
  const next = nextMeeting(events)
  if (!next) return 'Nothing timed on your calendar for the rest of this week, so there is no meeting to prepare for.'
  const guests = (next.attendees || []).filter(a => !a.self && !a.resource && a.email).slice(0, 6)
  let emails: PrepEmail[] | null = []
  if (guests.length) {
    try {
      const { searchWorkspaceEmailsByQuery } = await import('./google-workspace-read')
      const q = `(${guests.map(g => `from:${g.email} OR to:${g.email}`).join(' OR ')}) newer_than:60d`
      emails = (await searchWorkspaceEmailsByQuery(actor, q, 3)) as PrepEmail[]
    } catch (err: any) {
      console.error('MEETING_PREP_GMAIL_SKIPPED:', String(err?.message || err).slice(0, 120))
      emails = null
    }
  }
  const notes = await import('./people').then(m => m.guestNotes(actor, guests), () => new Map<string, string[]>())
  console.log('MEETING_PREP:', JSON.stringify({ guests: guests.length, emails: emails === null ? 'no_gmail' : emails.length, notes: notes.size }))
  return formatPrep(next, emails, Date.now(), notes)
}

async function tryMeetingPrepProcedure(actor: AgentActor, text: string): Promise<string | null> {
  try {
    const { proceduresEnabledFor } = await import('@/lib/procedures/registry')
    if (!proceduresEnabledFor(String(actor.legacyTelegramId))) return null
    const { startProcedureRun } = await import('@/lib/procedures/runtime')
    const started = await startProcedureRun({ actor, procedureId: 'meetings.prepare', inputs: { eventId: 'next' }, objective: text.slice(0, 200), source: 'meeting-prep' })
    if (!started) return null
    const { supabaseAdmin } = await import('@/lib/supabase-admin')
    const { data } = await supabaseAdmin.from('agent_runs').select('metadata_json').eq('id', started.runId).eq('telegram_id', String(actor.legacyTelegramId)).maybeSingle()
    const state = (data?.metadata_json as any)?.procedure?.state
    console.log('MEETING_PREP_PROCEDURE:', JSON.stringify({ runId: started.runId, status: state?.status || started.status }))
    if (state?.status !== 'completed' || typeof state?.context?.brief !== 'string' || !state.context.brief) return null
    return String(state.context.brief)
  } catch (err: any) {
    console.error('MEETING_PREP_PROCEDURE_FAILED:', String(err?.message || err).slice(0, 160))
    return null
  }
}
