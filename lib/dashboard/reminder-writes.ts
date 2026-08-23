import { supabaseAdmin } from '@/lib/supabase-admin'
import { cancelFollowupChain } from '@/lib/bot/handlers/edit-reminder'
import { stopReminderSeries, skipReminderOccurrence } from '@/lib/services/reminder-series'

// ── The dashboard's reminder write layer ──────────────────────────────────────
// Two id-scoped services, mirroring the read layer in lib/dashboard/queries.ts. The
// dashboard does NOT reuse the bot's NL handlers (editLatestReminder/cancelReminder):
// those parse WhatsApp text and return WhatsApp-formatted strings. The dashboard has
// a row id in hand, so it addresses the row directly.
//
// IDENTITY BOUNDARY: every query is scoped on BOTH telegram_id AND id. telegram_id
// comes only from the session (the caller passes it, resolved server-side by
// getSession) — never from the request body — and id names the row. Scoping on id
// alone would let one signed-in user touch another's row by guessing an id.
//
// NEVER-WRITE COLUMNS (Phase 6 sign-off): twilio_sid, delivery_status, sent_at,
// fail_attempts, last_failed_at, nudge_count, followup_started_at, recurring_pattern,
// is_recurring, telegram_id, chat_id, whatsapp_to, timezone. These carry delivery
// truth, the cron's recurrence/follow-up state, or identity/routing. deleteReminderById
// and updateReminderById only ever write `message`, `remind_at`, and `sent`.
//
// EXCEPTION — stopReminderSeriesById (below) DELIBERATELY writes is_recurring/
// recurring_pattern, via the shared stop-series primitive. That is the whole point of
// a "Stop" action: a recurring reminder's Stop must end the series (clear the
// recurrence), not just blank one occurrence. skipReminderOccurrenceById writes only
// remind_at + sent, advancing the pending occurrence so the series keeps regenerating.

export type DeleteReminderResult = { ok: true } | { ok: false; reason: 'not_found' | 'error' }

// Hard-delete one reminder the signed-in user owns. Hard delete (not sent=true) so
// the row leaves the Today thread rather than lingering as a struck-through "done"
// node. Then stops any follow-up nudge chain: cancelFollowupChain is a no-op for
// non-follow-up patterns, so it's safe to always call.
//
// NOTE (recurring): deleting an UPCOMING recurring occurrence stops the series — the
// cron only spawns the next occurrence when the current one FIRES, and a deleted row
// never fires. That is the accepted behaviour; the UI offers delete (not "skip one")
// on recurring rows precisely because there is no per-occurrence skip primitive.
export async function deleteReminderById(
  telegramId: number,
  id: string,
): Promise<DeleteReminderResult> {
  const { data: row, error } = await supabaseAdmin
    .from('reminders')
    .select('id, recurring_pattern')
    .eq('id', id)
    .eq('telegram_id', telegramId)
    .maybeSingle()
  if (error) return { ok: false, reason: 'error' }
  if (!row) return { ok: false, reason: 'not_found' }

  const { error: delErr } = await supabaseAdmin
    .from('reminders')
    .delete()
    .eq('id', id)
    .eq('telegram_id', telegramId)
  if (delErr) return { ok: false, reason: 'error' }

  // Stop a follow-up's queued next nudge. Best-effort — the delete already succeeded;
  // a chain-cancel failure is logged inside cancelFollowupChain, not surfaced.
  await cancelFollowupChain(telegramId, row.recurring_pattern)
  return { ok: true }
}

export type SeriesActionResult =
  | { ok: true }
  | { ok: false; reason: 'not_found' | 'error' | 'not_recurring' }

// STOP a whole recurring series from the dashboard — the "Stop" action's write path,
// shared with the WhatsApp cancel via stopReminderSeries. Resolves the row on
// id+telegram_id first (identity boundary), then ends the series. For a one-off it
// simply marks the row sent (stopReminderSeries handles both).
export async function stopReminderSeriesById(telegramId: number, id: string): Promise<SeriesActionResult> {
  const { data: row, error } = await supabaseAdmin
    .from('reminders')
    .select('id, message, is_recurring, recurring_pattern')
    .eq('id', id)
    .eq('telegram_id', telegramId)
    .maybeSingle()
  if (error) return { ok: false, reason: 'error' }
  if (!row) return { ok: false, reason: 'not_found' }

  const res = await stopReminderSeries(telegramId, row)
  return res.ok ? { ok: true } : { ok: false, reason: 'error' }
}

// SKIP one occurrence from the dashboard — advances the pending row to its next
// occurrence so the series keeps going. Only valid for recurring rows (returns
// not_recurring otherwise, so the UI can explain).
export async function skipReminderOccurrenceById(telegramId: number, id: string): Promise<SeriesActionResult> {
  const { data: row, error } = await supabaseAdmin
    .from('reminders')
    .select('id, remind_at, is_recurring, recurring_pattern')
    .eq('id', id)
    .eq('telegram_id', telegramId)
    .maybeSingle()
  if (error) return { ok: false, reason: 'error' }
  if (!row) return { ok: false, reason: 'not_found' }

  const res = await skipReminderOccurrence(telegramId, row)
  if (res.notRecurring) return { ok: false, reason: 'not_recurring' }
  return res.ok ? { ok: true } : { ok: false, reason: 'error' }
}

export type UpdateReminderResult =
  | { ok: true }
  | { ok: false; reason: 'not_found' | 'recurring' | 'error' }

// Edit one reminder's text and/or time. `remindAt` is a fully-resolved UTC ISO string
// (the route converts the user's chosen wall-clock time under the AUTHORITATIVE stored
// timezone — never a client-supplied tz). Editing the time re-arms the row (sent=false)
// so a moved reminder fires again, mirroring the bot's move semantics.
//
// REFUSES recurring rows (defense in depth — the UI already hides edit on them): editing
// a recurring child's message/time can desync the cron's dedupe guard and stack a
// duplicate occurrence. Delete is the only mutation allowed on recurring rows.
export async function updateReminderById(
  telegramId: number,
  id: string,
  changes: { message?: string; remindAt?: string },
): Promise<UpdateReminderResult> {
  const { data: row, error } = await supabaseAdmin
    .from('reminders')
    .select('id, is_recurring')
    .eq('id', id)
    .eq('telegram_id', telegramId)
    .maybeSingle()
  if (error) return { ok: false, reason: 'error' }
  if (!row) return { ok: false, reason: 'not_found' }
  if (row.is_recurring === true) return { ok: false, reason: 'recurring' }

  const update: { message?: string; remind_at?: string; sent?: boolean } = {}
  if (changes.message !== undefined) update.message = changes.message
  if (changes.remindAt !== undefined) {
    update.remind_at = changes.remindAt
    update.sent = false // re-arm: a moved reminder should fire at the new time
  }
  if (Object.keys(update).length === 0) return { ok: true } // nothing asked

  const { error: upErr } = await supabaseAdmin
    .from('reminders')
    .update(update)
    .eq('id', id)
    .eq('telegram_id', telegramId)
  if (upErr) return { ok: false, reason: 'error' }
  return { ok: true }
}
