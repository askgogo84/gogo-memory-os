import { supabaseAdmin } from '@/lib/supabase-admin'
import { istDayWindow } from '@/lib/ist'
import type { ListItem } from '@/lib/data/lists'
import { getPlan, getLimits, getUsage } from '@/lib/services/meter'
import { getPlanLimits } from '@/lib/data/limits'
import { refreshAccessToken } from '@/lib/services/google-calendar'

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

// ── Phase 5b shared helpers ───────────────────────────────────────────────────

// Plan DISPLAY name + monthly price. plan_limits (the meter table) holds only
// functional limits — the human label and ₹ price live in lib/data/limits.ts
// (Free ₹0 · Lite ₹99 · Starter ₹149 · Pro ₹199 · Founder Pro ₹499). We map the
// meter's plan_code onto that table so Usage and You always name the plan the same
// way; an unknown/imported code falls back to free rather than inventing a name.
type PlanDisplay = { label: string; priceInr: number }
function planDisplayFor(planCode: string): PlanDisplay {
  const table = getPlanLimits() as Record<string, { label: string; priceInr: number }>
  const key = (planCode || 'free').toLowerCase().replace(/[\s-]+/g, '_')
  const row = table[key] ?? table.free
  return { label: row.label, priceInr: row.priceInr }
}

// Two-letter initials for a contact avatar: first letters of the first two words,
// or the first two letters of a single-word name.
function initialsOf(name: string): string {
  const words = (name || '').trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '·'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

// h:mm with a tight lowercase period ("9:00am") — same shape the thread uses, in
// the user's zone.
function formatClock(iso: string, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(new Date(iso))
  const hour = parts.find((p) => p.type === 'hour')?.value ?? ''
  const minute = parts.find((p) => p.type === 'minute')?.value ?? ''
  const period = (parts.find((p) => p.type === 'dayPeriod')?.value ?? '').toLowerCase()
  return `${hour}:${minute}${period}`
}

// ── Usage summary (meter-backed) ──────────────────────────────────────────────
// Today's AI actions, this month's documents, and friend-contact count against the
// plan's allowances — all from lib/services/meter.ts, never hardcoded. The meter
// FAILS CLOSED (any DB error throws MeterUnavailableError), so the whole read is
// wrapped: on failure it degrades to { ok:false } and the page shows a soft retry,
// never fabricated zeros. `calendarsConnected` is read straight off the users row
// (0 or 1) for the "calendars connected" bar.
export type UsageSummary =
  | {
      ok: true
      planLabel: string
      planPriceInr: number
      usage: { aiToday: number; docsThisMonth: number; friendContacts: number }
      limits: {
        aiPerDay: number
        docsPerMonth: number
        friendContactsMax: number
        remindersFairUse: number
        calendarsMax: number
      }
      calendarsConnected: number
    }
  | { ok: false }

export async function getUsageSummary(telegramId: string): Promise<UsageSummary> {
  const tgNum = parseInt(telegramId, 10)
  try {
    const plan = await getPlan(telegramId)
    const [limits, usage] = await Promise.all([getLimits(plan.plan_code), getUsage(telegramId)])

    let calendarsConnected = 0
    if (Number.isFinite(tgNum)) {
      const { data: u } = await supabaseAdmin
        .from('users')
        .select('google_calendar_connected')
        .eq('telegram_id', tgNum)
        .maybeSingle()
      calendarsConnected = u?.google_calendar_connected ? 1 : 0
    }

    const display = planDisplayFor(plan.plan_code)
    return {
      ok: true,
      planLabel: display.label,
      planPriceInr: display.priceInr,
      usage,
      limits: {
        aiPerDay: limits.ai_actions_per_day,
        docsPerMonth: limits.documents_per_month,
        friendContactsMax: limits.friend_contacts_max,
        remindersFairUse: limits.reminders_per_day_fair_use,
        calendarsMax: limits.calendars_max,
      },
      calendarsConnected,
    }
  } catch (err) {
    console.error('DASHBOARD_USAGE_FAILED:', err)
    return { ok: false }
  }
}

// ── Profile (the "You" surface) ───────────────────────────────────────────────
// Name, phone, account age, plan, and connection status for the three linked
// accounts. All reads; nothing is written. A meter failure only costs the plan
// label (it degrades to free), never the whole page.
export type Profile =
  | {
      ok: true
      name: string | null
      whatsappId: string | null
      createdAt: string | null
      planLabel: string
      planPriceInr: number
      planExpiresAt: string | null
      connections: { googleCalendar: boolean; gmail: boolean; creditiq: boolean }
    }
  | { ok: false }

export async function getProfile(telegramId: string): Promise<Profile> {
  const tgNum = parseInt(telegramId, 10)
  if (!Number.isFinite(tgNum)) return { ok: false }
  try {
    const { data: user, error } = await supabaseAdmin
      .from('users')
      .select('name, whatsapp_id, created_at, google_calendar_connected, gmail_connected, plan_expires_at')
      .eq('telegram_id', tgNum)
      .maybeSingle()
    if (error) {
      console.error('DASHBOARD_PROFILE_FAILED:', error)
      return { ok: false }
    }

    // Plan is a nice-to-have here, not load-bearing: if the meter is down, fall
    // back to the free label so the rest of the profile still renders.
    let display = planDisplayFor('free')
    try {
      const plan = await getPlan(telegramId)
      display = planDisplayFor(plan.plan_code)
    } catch (planErr) {
      console.error('DASHBOARD_PROFILE_PLAN_FAILED:', planErr)
    }

    // CreditIQ linkage lives in wa_creditiq_links (sender → consumer_user_id),
    // keyed on the WhatsApp sender. Best-effort match on whatsapp_id: on any error
    // or a differently-normalized key we show "Not connected" — a false negative,
    // never a claimed link that isn't there.
    let creditiq = false
    if (user?.whatsapp_id) {
      try {
        const { data: link } = await supabaseAdmin
          .from('wa_creditiq_links')
          .select('consumer_user_id')
          .eq('sender', user.whatsapp_id)
          .maybeSingle()
        creditiq = !!link?.consumer_user_id
      } catch {
        creditiq = false
      }
    }

    return {
      ok: true,
      name: user?.name ?? null,
      whatsappId: user?.whatsapp_id ?? null,
      createdAt: user?.created_at ?? null,
      planLabel: display.label,
      planPriceInr: display.priceInr,
      planExpiresAt: user?.plan_expires_at ?? null,
      connections: {
        googleCalendar: !!user?.google_calendar_connected,
        gmail: !!user?.gmail_connected,
        creditiq,
      },
    }
  } catch (err) {
    console.error('DASHBOARD_PROFILE_FAILED:', err)
    return { ok: false }
  }
}

// ── Friend contacts (the Friends section on You) ──────────────────────────────
// A user's saved contacts, oldest first. friend_contacts has NO note/schedule
// column, so a row carries a name (and derived initials) only — never a fabricated
// "daily 9 PM" line. Read-only: no add/remove this phase.
export type FriendContact = { name: string; initials: string }
export type FriendContacts = { ok: true; contacts: FriendContact[]; count: number } | { ok: false }

export async function getFriendContacts(telegramId: string): Promise<FriendContacts> {
  const tgNum = parseInt(telegramId, 10)
  if (!Number.isFinite(tgNum)) return { ok: true, contacts: [], count: 0 }
  const { data, error } = await supabaseAdmin
    .from('friend_contacts')
    .select('name, created_at')
    .eq('owner_telegram_id', tgNum)
    .order('created_at', { ascending: true })
  if (error) {
    console.error('DASHBOARD_FRIENDS_FAILED:', error)
    return { ok: false }
  }
  const contacts = (data ?? []).map((r: { name: string }) => ({ name: r.name, initials: initialsOf(r.name) }))
  return { ok: true, contacts, count: contacts.length }
}

// ── Today's calendar (Calendar surface + the Today "rest of today" row) ───────
// READ-ONLY end to end. Reads the connect flag + refresh token off the users row;
// on a missing flag/token OR a failed refresh, returns the not-connected state and
// writes NOTHING — flipping google_calendar_connected on failure is owned by the
// briefing job (see stash@{0} / lib/bot/morning-briefing), never the dashboard.
export type CalendarEvent = { id: string; title: string; time: string | null }
export type TodayCalendar =
  | { ok: true; connected: false }
  | { ok: true; connected: true; events: CalendarEvent[] }
  | { ok: false }

export async function getTodayCalendar(telegramId: string): Promise<TodayCalendar> {
  const tgNum = parseInt(telegramId, 10)
  if (!Number.isFinite(tgNum)) return { ok: true, connected: false }
  try {
    const { data: user, error } = await supabaseAdmin
      .from('users')
      .select('google_calendar_connected, google_refresh_token, timezone')
      .eq('telegram_id', tgNum)
      .maybeSingle()
    if (error) {
      console.error('DASHBOARD_CALENDAR_FAILED:', error)
      return { ok: false }
    }
    if (!user?.google_calendar_connected || !user?.google_refresh_token) {
      return { ok: true, connected: false }
    }

    const accessToken = await refreshAccessToken(user.google_refresh_token)
    if (!accessToken) return { ok: true, connected: false } // refresh failed → treat as not connected, write nothing

    // Read-only events fetch, bounded to the user's IST day — NOT the UTC day the
    // shared getTodayEvents assumes. India-first: an event at 00:30 IST belongs to
    // today, not yesterday. Same istDayWindow the reminders query + friend cron use.
    const { startUtc, endUtc } = istDayWindow()
    const params = new URLSearchParams({
      timeMin: startUtc.toISOString(),
      timeMax: endUtc.toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime',
    })
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    )
    const data = await res.json()
    const items: Array<{ id?: string; summary?: string; start?: { dateTime?: string } }> = Array.isArray(data?.items)
      ? data.items
      : []

    const zone = user.timezone || 'Asia/Kolkata'
    const events: CalendarEvent[] = items.map((it, i) => ({
      id: String(it?.id ?? i),
      title: (typeof it?.summary === 'string' && it.summary.trim()) || 'Untitled',
      time: it?.start?.dateTime ? formatClock(it.start.dateTime, zone) : null,
    }))
    return { ok: true, connected: true, events }
  } catch (err) {
    console.error('DASHBOARD_CALENDAR_FAILED:', err)
    return { ok: false }
  }
}
