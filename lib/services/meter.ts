// AskGogo usage meter — public API (Phase 2).
//
// Thin facade over `meter-core.ts`: it binds the real Supabase admin client and
// exposes the exact API the meter callers use. All logic lives in the core so it
// stays unit-testable offline with an injected fake DB. NOTHING imports this
// module yet — Phase 2 wires no call sites.
//
// Client import matches lib/data/limits.ts (relative `../supabase-admin`).

import { supabaseAdmin } from '../supabase-admin'
import * as core from './meter-core'

export { MeterUnavailableError, ACTION_COUNTER } from './meter-core'
export type {
  Counter,
  AiAction,
  DocumentAction,
  MeterAction,
  UserPlan,
  PlanLimits,
  Usage,
  AllowanceResult,
  RecordMeta,
  RecordResult,
} from './meter-core'

const db = supabaseAdmin as unknown as core.MeterDb

/** Resolve a user's plan: user_plans → users.tier → 'free'. */
export function getPlan(telegramId: string | number): Promise<core.UserPlan> {
  return core.getPlan(db, telegramId)
}

/** Read allowances from plan_limits (cached ~5 min); unmapped codes fall back to 'free'. */
export function getLimits(planCode: string): Promise<core.PlanLimits> {
  return core.getLimits(db, planCode)
}

/** Current usage: { aiToday, docsThisMonth, friendContacts }. */
export function getUsage(telegramId: string | number, now?: Date): Promise<core.Usage> {
  return core.getUsage(db, telegramId, now)
}

/**
 * Check an allowance. FAILS CLOSED — throws MeterUnavailableError on any DB error
 * so callers say "couldn't verify your allowance", never "limit reached".
 */
export function checkAllowance(
  telegramId: string | number,
  counter: core.Counter,
  now?: Date,
): Promise<core.AllowanceResult> {
  return core.checkAllowance(db, telegramId, counter, now)
}

/**
 * Record one billable action. NEVER throws upward. Idempotent on
 * (telegram_id, counter, meta.message_id) — one unit per inbound message per counter.
 */
export function recordUsage(
  telegramId: string | number,
  counter: core.Counter,
  action: core.MeterAction | string,
  meta?: core.RecordMeta,
): Promise<core.RecordResult> {
  return core.recordUsage(db, telegramId, counter, action, meta)
}
