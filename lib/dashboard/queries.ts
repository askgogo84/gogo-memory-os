import { supabaseAdmin } from '@/lib/supabase-admin'
import { istDayWindow } from '@/lib/ist'

// ── The dashboard's read layer ────────────────────────────────────────────────
// Every Supabase read the dashboard does lives here, one function per surface,
// each taking the session's telegramId and returning exactly what the page
// renders (TRD §3). Keeping the reads in one file makes the identity boundary —
// "is this scoped to the signed-in user?" — auditable in a single place. No
// Supabase call ever lives inline in a component.
//
// dashboard_sessions.telegram_id is TEXT; reminders.telegram_id is numeric. The
// cast happens HERE, at the boundary, and nowhere else.

export type ReminderRow = {
  id: number | string
  message: string | null
  remind_at: string
  timezone: string | null
  recurring_pattern: string | null
  is_recurring: boolean | null
  sent: boolean | null
  sent_at: string | null
}

// Discriminated so the page can tell "nothing today" (ok, empty) from "the read
// failed" (not ok) — never letting a failed read masquerade as an empty day.
export type TodayReminders = { ok: true; reminders: ReminderRow[] } | { ok: false }

/**
 * Everything firing within the user's IST day — recurring or not — ordered by
 * remind_at. Recurring rows are single per-occurrence rows (the cron inserts the
 * next occurrence as a fresh row after each fire), so a plain remind_at window
 * catches today's occurrence with no occurrence maths needed.
 *
 * Both fired (sent=true) and pending (sent=false) rows come back; the render
 * layer splits them into past/upcoming around the now-marker.
 */
export async function getTodayReminders(telegramId: string): Promise<TodayReminders> {
  const tgNum = parseInt(telegramId, 10)
  // A non-numeric session id can't own numeric-keyed reminders — that's an empty
  // day, not a failure. (Failures are reserved for actual read errors below.)
  if (!Number.isFinite(tgNum)) return { ok: true, reminders: [] }

  const { startUtc, endUtc } = istDayWindow()
  const { data, error } = await supabaseAdmin
    .from('reminders')
    .select('id, message, remind_at, timezone, recurring_pattern, is_recurring, sent, sent_at')
    .eq('telegram_id', tgNum)
    .gte('remind_at', startUtc.toISOString())
    .lt('remind_at', endUtc.toISOString())
    .order('remind_at', { ascending: true })

  if (error) {
    console.error('DASHBOARD_TODAY_REMINDERS_FAILED:', error)
    return { ok: false }
  }
  return { ok: true, reminders: (data as ReminderRow[]) ?? [] }
}
