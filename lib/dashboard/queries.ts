import { supabaseAdmin } from '@/lib/supabase-admin'
import { istDayWindow } from '@/lib/ist'
import type { ListItem } from '@/lib/data/lists'

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

// The dashboard's view of a list: the stored name (lower-cased, trimmed — the
// same string the bot renders in WhatsApp) and its items. The `lists` table has
// NO item table — items are a JSONB array on the row — so the count the page
// shows is items.length in app code, never a SQL count.
export type DashboardList = {
  id: number | string
  name: string
  items: ListItem[]
}

// Same discriminated shape as TodayReminders: an empty account (ok, no lists) is
// never confused with a failed read (not ok).
export type Lists = { ok: true; lists: DashboardList[] } | { ok: false }

/**
 * Every list the signed-in user owns, newest-touched first. The row the user
 * just changed sits on top (order by updated_at desc). Read-only: ticking items
 * and creating lists arrive in a later phase.
 *
 * The DB column is `list_name`; we map it to `name` here so the render layer
 * never sees the storage column. items comes back as the raw JSONB array.
 */
export async function getLists(telegramId: string): Promise<Lists> {
  const tgNum = parseInt(telegramId, 10)
  // lists.telegram_id is numeric; a non-numeric session id can't own any list —
  // that's an empty account, not a failure. (Failures are actual read errors.)
  if (!Number.isFinite(tgNum)) return { ok: true, lists: [] }

  const { data, error } = await supabaseAdmin
    .from('lists')
    .select('id, list_name, items, updated_at')
    .eq('telegram_id', tgNum)
    .order('updated_at', { ascending: false })

  if (error) {
    console.error('DASHBOARD_LISTS_FAILED:', error)
    return { ok: false }
  }

  const lists: DashboardList[] = (data ?? []).map((row) => ({
    id: row.id,
    name: row.list_name,
    items: (row.items as ListItem[]) ?? [],
  }))
  return { ok: true, lists }
}
