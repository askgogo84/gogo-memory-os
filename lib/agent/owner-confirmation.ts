// Duet parity (22 Oct, approved mock): only the owner marks a task complete. Gogo finishing a run means
// "Gogo thinks this is done"; the owner confirms it (Mark complete) or sends it back (Not yet). The decision lives
// on the run (metadata_json.owner_confirmation) and every decision is written to agent_activity, so a team/enterprise
// workspace later gets an audit trail of who accepted which piece of work. Pure helpers + one owner-scoped write.
import { supabaseAdmin } from '@/lib/supabase-admin'

export type OwnerDecision = 'done' | 'not_done'
export type OwnerConfirmation = { decision: OwnerDecision; at: string; by: string; surface: string; note?: string }

/** Run types that deliver an outcome the person asked for. Background checks, chat reads and automatic context
 *  pulls never ask for confirmation, or the list would fill with noise. */
export const CONFIRMABLE_RUN_TYPES = new Set([
  'general_multi_tool', 'agent_run', 'compound', 'autonomous',
  'travel_research', 'train_research', 'appointment_research', 'restaurant_reservation_research',
  'booking', 'browser_prepare', 'gmail_send', 'calendar_change', 'calendar_update', 'reminder_update',
  'memory_ticket_to_calendar', 'voice_call', 'life_event',
])
export const CONFIRM_WINDOW_DAYS = 7
export const CONFIRM_MAX = 5

export function ownerConfirmationOf(run: any): OwnerConfirmation | null {
  const c = (run?.metadata_json || run?.metadata || {})?.owner_confirmation
  return c && (c.decision === 'done' || c.decision === 'not_done') ? c as OwnerConfirmation : null
}

/** Completed, recent, an outcome-type run, and the owner has not decided yet. */
export function needsOwnerConfirmation(run: any, now: number = Date.now()): boolean {
  if (String(run?.status || '') !== 'completed') return false
  if (!CONFIRMABLE_RUN_TYPES.has(String(run?.type || ''))) return false
  if (ownerConfirmationOf(run)) return false
  const at = Date.parse(String(run?.updated_at || ''))
  return Number.isFinite(at) && now - at <= CONFIRM_WINDOW_DAYS * 86_400_000 && at <= now + 60_000
}

/** The owner said "not yet": it goes back to Needs you until they tell Gogo what is missing. */
export function ownerReopened(run: any): boolean {
  return ownerConfirmationOf(run)?.decision === 'not_done'
}

export function continuePrompt(title: string): string {
  return `Not done yet: ${String(title || 'that task').slice(0, 120)}. What's missing is `
}

export function parseOwnerDecision(raw: unknown): { decision: OwnerDecision; note: string } | null {
  const body: any = raw && typeof raw === 'object' ? raw : {}
  if (body.decision !== 'done' && body.decision !== 'not_done') return null
  const note = String(body.note ?? '').replace(/\s+/g, ' ').trim().slice(0, 500)
  return { decision: body.decision, note }
}

/** Owner-scoped write: only the owner's own completed run, only once per decision change. */
export async function recordOwnerDecision(params: { telegramId: string; runId: string; actorId: string; decision: OwnerDecision; note?: string; surface?: string }) {
  const { data: run, error } = await supabaseAdmin.from('agent_runs').select('id,title,status,type,metadata_json')
    .eq('id', params.runId).eq('telegram_id', params.telegramId).maybeSingle()
  if (error) throw new Error(`owner_confirmation_read_failed:${error.message}`)
  if (!run) return { ok: false as const, error: 'not_found' as const }
  if (String(run.status) !== 'completed') return { ok: false as const, error: 'not_finished' as const }
  const current = ownerConfirmationOf(run)
  if (current?.decision === params.decision) return { ok: true as const, unchanged: true, decision: params.decision }
  const confirmation: OwnerConfirmation = {
    decision: params.decision, at: new Date().toISOString(), by: params.actorId, surface: params.surface || 'web',
    ...(params.note ? { note: params.note } : {}),
  }
  const metadata = { ...(run.metadata_json || {}), owner_confirmation: confirmation }
  const { error: updateError } = await supabaseAdmin.from('agent_runs').update({ metadata_json: metadata, updated_at: confirmation.at })
    .eq('id', params.runId).eq('telegram_id', params.telegramId).eq('status', 'completed')
  if (updateError) throw new Error(`owner_confirmation_write_failed:${updateError.message}`)
  const { error: activityError } = await supabaseAdmin.from('agent_activity').insert({
    telegram_id: params.telegramId, run_id: params.runId,
    event_type: params.decision === 'done' ? 'task_owner_confirmed' : 'task_owner_reopened',
    message: `${params.decision === 'done' ? 'Marked complete' : 'Sent back: not done yet'} — ${String(run.title || 'task').slice(0, 200)}`,
    metadata_json: { decision: params.decision, by: params.actorId, surface: confirmation.surface, previous: current?.decision || null },
  })
  if (activityError) console.error('OWNER_CONFIRMATION_ACTIVITY_FAILED:', activityError.message)
  return { ok: true as const, unchanged: false, decision: params.decision }
}

// ---- Watching: why it exists, when it ends, and whether its own date has passed (R02: a 27 Sep flight watch
// was still "active" on 22 Oct). Pure.
const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 }
export function explicitDateIn(text: string, now: Date = new Date()): Date | null {
  const t = String(text || '').toLowerCase()
  const iso = t.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/)
  if (iso) return new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3]))
  const m = t.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?(?:,?\s+(20\d{2}))?\b/)
    || t.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(20\d{2}))?\b/)
  if (!m) return null
  const [day, mon] = /^\d/.test(m[1]) ? [+m[1], MONTHS[m[2]]] : [+m[2], MONTHS[m[1]]]
  if (!(day >= 1 && day <= 31) || mon === undefined) return null
  // No year: the date as written was meant within the last ~10 months or the coming ones, never a year ahead.
  let year = m[3] ? +m[3] : now.getUTCFullYear()
  if (!m[3] && Date.UTC(year, mon, day) - now.getTime() > 60 * 86_400_000) year -= 1
  return new Date(Date.UTC(year, mon, day))
}

export type WatchRow = { title?: string | null; type?: string | null; created_at?: string | null; condition_json?: any }
export function watchWhy(row: WatchRow): string {
  const c = row.condition_json || {}
  if (c.reason) return String(c.reason).slice(0, 140)
  const at = Date.parse(String(row.created_at || ''))
  return Number.isFinite(at)
    ? `You asked on ${new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' }).format(new Date(at))}`
    : 'You asked for this watch'
}
export function watchEnds(row: WatchRow, now: Date = new Date()): { label: string; datePassed: boolean } {
  const c = row.condition_json || {}
  const expires = Date.parse(String(c.expiresAt || c.expires_at || ''))
  if (Number.isFinite(expires)) {
    const label = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' }).format(new Date(expires))
    return expires < now.getTime() ? { label: `Ended ${label}`, datePassed: true } : { label: `Ends ${label}`, datePassed: false }
  }
  const named = explicitDateIn([row.title, c.title, c.originalRequest, c.query].filter(Boolean).join(' '), now)
  // The watch is about a dated thing (a flight on 27 Sep) and that day is over: say so instead of "active".
  if (named && named.getTime() + 86_400_000 < now.getTime()) {
    return { label: `Its date (${new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short' }).format(named)}) has passed`, datePassed: true }
  }
  return { label: 'Until you stop it', datePassed: false }
}
