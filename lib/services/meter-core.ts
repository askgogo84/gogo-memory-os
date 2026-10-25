// AskGogo usage meter — pure, dependency-injected core (Phase 2).
//
// This file holds ALL meter logic and imports NOTHING (no Supabase client, no
// path aliases). The DB handle is injected as `db`, so the whole module is
// unit-testable offline with a fake. `lib/services/meter.ts` is the thin public
// facade that binds the real `supabaseAdmin` to these functions.
//
// Target DB: qenhjcooyecmatwducpu ("Whatsapp Bot"). Tables: user_plans,
// plan_limits, usage_events (all telegram_id/whatsapp_id are TEXT); friend_contacts
// keys on owner_telegram_id BIGINT.
//
// Non-negotiable semantics:
//  - checkAllowance FAILS CLOSED: any DB error throws MeterUnavailableError, so
//    callers say "couldn't verify your allowance", never "limit reached".
//  - recordUsage NEVER throws upward: on failure it logs USAGE_RECORD_FAILED and
//    returns { recorded:false }.
//  - ONE UNIT PER INBOUND MESSAGE PER COUNTER: recordUsage is idempotent on
//    (telegram_id, counter, meta.message_id).
//  - Allowances come from the plan_limits TABLE, never hardcoded.

// ── Errors ──────────────────────────────────────────────────────────────────

export class MeterUnavailableError extends Error {
  constructor(message = 'Meter unavailable', options?: { cause?: unknown }) {
    super(message)
    this.name = 'MeterUnavailableError'
    // Set cause manually (lib target ES2017 has no Error `cause` option).
    if (options?.cause !== undefined) (this as { cause?: unknown }).cause = options.cause
  }
}

// ── Counters & actions ──────────────────────────────────────────────────────
//
// Final action enum (per Phase 2 spec):
//   ai_action -> web_search | translate | ask | image_classify | skin_check | nutrition
//   document  -> ticket_parse | receipt_parse | meeting_notes
// NOT metered (no action value exists for them): voice transcription, briefings,
// reminders, CreditIQ portfolio reads.

export type Counter = 'ai_action' | 'document' | 'friend_contacts'
export type AiAction = 'web_search' | 'translate' | 'ask' | 'image_classify' | 'skin_check' | 'nutrition'
export type DocumentAction = 'ticket_parse' | 'receipt_parse' | 'meeting_notes' | 'document_save'
export type MeterAction = AiAction | DocumentAction

// Which counter each action belongs to. Reference for the wiring phase.
//
// WIRING RULE (caveat 2): meter the user-visible OUTCOME, not the internal step.
// When an inbound message produces a DOCUMENT outcome (ticket_parse / receipt_parse
// / meeting_notes), do NOT also record an ai_action for the classification step
// that led to it — the classifier is a means, not an outcome. An image records an
// ai_action ONLY when its outcome is not a document (image_classify note summary,
// translate, skin_check, nutrition).
export const ACTION_COUNTER: Record<MeterAction, Exclude<Counter, 'friend_contacts'>> = {
  web_search: 'ai_action',
  translate: 'ai_action',
  ask: 'ai_action',
  image_classify: 'ai_action',
  skin_check: 'ai_action',
  nutrition: 'ai_action',
  ticket_parse: 'document',
  receipt_parse: 'document',
  meeting_notes: 'document',
  document_save: 'document',
}

// ── Row shapes ──────────────────────────────────────────────────────────────

export type UserPlan = { telegram_id: string; plan_code: string; status: string }

export type PlanLimits = {
  plan_code: string
  ai_actions_per_day: number
  documents_per_month: number
  friend_contacts_max: number
  reminders_per_day_fair_use: number
  calendars_max: number
}

export type Usage = { aiToday: number; docsThisMonth: number; friendContacts: number }

export type AllowanceResult = { allowed: boolean; used: number; limit: number; resets: string | null }

export type RecordMeta = {
  message_id?: string | number | null
  whatsapp_id?: string | null
  surface?: string
  [key: string]: unknown
}

export type RecordResult = { recorded: boolean; duplicate?: boolean; deduped?: boolean; error?: boolean }

// Minimal structural type for the injected Supabase client. Query results are
// intentionally `any` — there are no generated DB types in this repo.
export type MeterDb = { from: (table: string) => any }

// ── IST window helpers (ported from lib/bot/handlers/friend-reminders.ts:47-48) ──
// Asia/Kolkata is a fixed UTC+5:30 with no DST, so an IST wall-clock boundary is a
// simple offset of a UTC instant. Pure functions of `nowMs` → fully unit-testable.

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

/** Start of the current IST day, as a UTC epoch-ms instant. */
export function istDayStartMs(nowMs: number): number {
  return Math.floor((nowMs + IST_OFFSET_MS) / DAY_MS) * DAY_MS - IST_OFFSET_MS
}

/** Start of the next IST day (when the daily allowance resets). */
export function nextIstDayStartMs(nowMs: number): number {
  return istDayStartMs(nowMs) + DAY_MS
}

/** Start of the current IST month (1st, 00:00 IST), as a UTC epoch-ms instant. */
export function istMonthStartMs(nowMs: number): number {
  const shifted = new Date(nowMs + IST_OFFSET_MS) // UTC fields now read as IST wall-clock
  return Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), 1, 0, 0, 0) - IST_OFFSET_MS
}

/** Start of the next IST month (when the monthly allowance resets). Date.UTC
 *  handles month/year rollover (Dec -> Jan) automatically. */
export function nextIstMonthStartMs(nowMs: number): number {
  const shifted = new Date(nowMs + IST_OFFSET_MS)
  return Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, 1, 0, 0, 0) - IST_OFFSET_MS
}

// ── Plan resolution ─────────────────────────────────────────────────────────

// Resolution order (caveat: never blindly downgrade a paying user to free):
//   1. user_plans row for String(telegramId) -> its plan_code
//   2. no row -> users.tier for that telegram_id -> use as plan_code
//   3. still nothing / tier null -> 'free'
// A missing row at either step is NOT an error; only a query failure raises
// MeterUnavailableError.
export async function getPlan(db: MeterDb, telegramId: string | number): Promise<UserPlan> {
  const tid = String(telegramId)

  const { data: planRow, error: planErr } = await db
    .from('user_plans')
    .select('telegram_id, plan_code, status')
    .eq('telegram_id', tid)
    .maybeSingle()
  if (planErr) throw new MeterUnavailableError('Failed to read user_plans', { cause: planErr })
  if (planRow?.plan_code) {
    return { telegram_id: tid, plan_code: String(planRow.plan_code), status: String(planRow.status || 'active') }
  }

  // No plan row (e.g. a legacy WhatsApp user with no telegram_id at backfill
  // time). Fall back to the tier already recorded on the users row.
  const { data: userRow, error: userErr } = await db
    .from('users')
    .select('tier')
    .eq('telegram_id', tid)
    .maybeSingle()
  if (userErr) throw new MeterUnavailableError('Failed to read users.tier', { cause: userErr })
  if (userRow?.tier) {
    return { telegram_id: tid, plan_code: String(userRow.tier), status: 'active' }
  }

  return { telegram_id: tid, plan_code: 'free', status: 'active' }
}

// ── Limits (table-driven, cached ~5 min in-process) ─────────────────────────

const LIMITS_TTL_MS = 5 * 60 * 1000
const _limitsCache = new Map<string, { row: PlanLimits; expires: number }>()

/** Test-only: clear the in-process plan_limits cache. */
export function __resetMeterCacheForTests(): void {
  _limitsCache.clear()
}

const LIMITS_COLUMNS =
  'plan_code, ai_actions_per_day, documents_per_month, friend_contacts_max, reminders_per_day_fair_use, calendars_max'

async function fetchLimitsRow(db: MeterDb, planCode: string): Promise<PlanLimits | null> {
  const { data, error } = await db
    .from('plan_limits')
    .select(LIMITS_COLUMNS)
    .eq('plan_code', planCode)
    .maybeSingle()
  if (error) throw new MeterUnavailableError('Failed to read plan_limits', { cause: error })
  return (data as PlanLimits) || null
}

export async function getLimits(db: MeterDb, planCode: string): Promise<PlanLimits> {
  const now = Date.now()
  const cached = _limitsCache.get(planCode)
  if (cached && cached.expires > now) return cached.row

  let row = await fetchLimitsRow(db, planCode)
  // Unmapped plan_code (e.g. an unexpected tier) falls back to 'free' — the safe
  // minimum — rather than throwing. founder_pro / imported ARE in the table, so
  // they resolve directly; this only catches genuinely unknown codes.
  if (!row && planCode !== 'free') {
    // A silent fallback to free is exactly the failure we can't see in
    // production — leave one quiet breadcrumb naming the offending code.
    console.warn(`PLAN_CODE_UNMAPPED: ${planCode}`)
    row = await fetchLimitsRow(db, 'free')
  }
  if (!row) throw new MeterUnavailableError(`No plan_limits row for '${planCode}' or 'free'`)

  _limitsCache.set(planCode, { row, expires: now + LIMITS_TTL_MS })
  return row
}

// ── Usage counts ────────────────────────────────────────────────────────────

async function countUsage(
  db: MeterDb,
  tid: string,
  counter: 'ai_action' | 'document',
  sinceMs: number,
): Promise<number> {
  const { count, error } = await db
    .from('usage_events')
    .select('id', { count: 'exact', head: true })
    .eq('telegram_id', tid)
    .eq('counter', counter)
    .gte('created_at', new Date(sinceMs).toISOString())
  if (error) throw new MeterUnavailableError('Failed to count usage_events', { cause: error })
  return count || 0
}

async function countFriendContacts(db: MeterDb, tid: string): Promise<number> {
  // friend_contacts.owner_telegram_id is BIGINT — cast at the boundary only.
  // telegram_id values (real and negative synthesized) are within JS safe-int range.
  const { count, error } = await db
    .from('friend_contacts')
    .select('owner_telegram_id', { count: 'exact', head: true })
    .eq('owner_telegram_id', Number(tid))
  if (error) throw new MeterUnavailableError('Failed to count friend_contacts', { cause: error })
  return count || 0
}

export async function getUsage(
  db: MeterDb,
  telegramId: string | number,
  now: Date = new Date(),
): Promise<Usage> {
  const tid = String(telegramId)
  const nowMs = now.getTime()
  const [aiToday, docsThisMonth, friendContacts] = await Promise.all([
    countUsage(db, tid, 'ai_action', istDayStartMs(nowMs)),
    countUsage(db, tid, 'document', istMonthStartMs(nowMs)),
    countFriendContacts(db, tid),
  ])
  return { aiToday, docsThisMonth, friendContacts }
}

// ── Allowance check (fails closed) ──────────────────────────────────────────

export async function checkAllowance(
  db: MeterDb,
  telegramId: string | number,
  counter: Counter,
  now: Date = new Date(),
): Promise<AllowanceResult> {
  const tid = String(telegramId)
  const nowMs = now.getTime()

  // Any DB error inside getPlan / getLimits / count* throws MeterUnavailableError
  // and propagates — the check fails closed.
  const plan = await getPlan(db, tid)
  const limits = await getLimits(db, plan.plan_code)

  let used: number
  let limit: number
  let resets: string | null

  if (counter === 'ai_action') {
    used = await countUsage(db, tid, 'ai_action', istDayStartMs(nowMs))
    limit = limits.ai_actions_per_day
    resets = new Date(nextIstDayStartMs(nowMs)).toISOString()
  } else if (counter === 'document') {
    used = await countUsage(db, tid, 'document', istMonthStartMs(nowMs))
    limit = limits.documents_per_month
    resets = new Date(nextIstMonthStartMs(nowMs)).toISOString()
  } else if (counter === 'friend_contacts') {
    used = await countFriendContacts(db, tid)
    limit = limits.friend_contacts_max
    resets = null // standing ceiling, not a reset counter
  } else {
    // Unknown counter is a programming error; treat as unavailable (fail closed).
    throw new MeterUnavailableError(`Unknown counter: ${String(counter)}`)
  }

  return { allowed: used < limit, used, limit, resets }
}

// ── Record usage (never throws) ─────────────────────────────────────────────

export async function recordUsage(
  db: MeterDb,
  telegramId: string | number,
  counter: Counter,
  action: MeterAction | string,
  meta: RecordMeta = {},
): Promise<RecordResult> {
  const tid = String(telegramId)
  try {
    const messageId = meta.message_id != null ? String(meta.message_id) : null

    if (messageId) {
      // Idempotency: one unit per (telegram_id, counter, message_id). If a row
      // already exists for this inbound message + counter, no-op.
      const { data: existing, error: selErr } = await db
        .from('usage_events')
        .select('id')
        .eq('telegram_id', tid)
        .eq('counter', counter)
        .eq('meta->>message_id', messageId)
        .limit(1)
      if (selErr) throw selErr
      if (Array.isArray(existing) && existing.length > 0) {
        return { recorded: false, duplicate: true }
      }
    } else {
      // No message id → can't dedupe. Insert anyway (never lose the record), but
      // leave one quiet breadcrumb so Phase 4 wiring can find call sites that
      // forgot to pass it. One line, no stack.
      console.warn(`METER_NO_MESSAGE_ID: action=${action} counter=${counter}`)
    }

    const { error: insErr } = await db.from('usage_events').insert({
      telegram_id: tid,
      whatsapp_id: meta.whatsapp_id != null ? String(meta.whatsapp_id) : null,
      counter,
      action,
      surface: typeof meta.surface === 'string' && meta.surface ? meta.surface : 'whatsapp',
      meta,
    })
    if (insErr) throw insErr

    return { recorded: true }
  } catch (err) {
    // Unique-violation (Postgres 23505) from the partial index on
    // (telegram_id, counter, (meta->>'message_id')) means a concurrent insert
    // already recorded this outcome. That's the idempotency backstop doing its
    // job — a benign no-op, NOT a failure. Do not log USAGE_RECORD_FAILED.
    const code = err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : undefined
    if (code === '23505') {
      return { recorded: false, deduped: true }
    }
    // Supabase/PostgREST errors are plain objects with a `message`, not Error
    // instances — pull it out so the breadcrumb is actually useful.
    const msg =
      err instanceof Error
        ? err.message
        : err && typeof err === 'object' && 'message' in err
          ? String((err as { message: unknown }).message)
          : String(err)
    console.error(`USAGE_RECORD_FAILED: action=${action} counter=${counter} telegram_id=${tid} error=${msg}`)
    return { recorded: false, error: true }
  }
}
