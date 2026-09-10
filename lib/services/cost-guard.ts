import { supabaseAdmin } from '../supabase-admin'
import { getPlan } from './meter'
import { istMonthStartMs } from './meter-core'

export type CostCategory =
  | 'web_search_basic'
  | 'llm_haiku'
  | 'llm_sonnet'
  | 'whatsapp_outbound'
  | 'secure_compute_minute'
  | 'creditiq_travel_search'
  | 'voice_minute'
  | 'document_parse'

export const COST_ESTIMATES_PAISE: Record<CostCategory, number> = {
  web_search_basic: 100,
  llm_haiku: 100,
  llm_sonnet: 500,
  whatsapp_outbound: 100,
  secure_compute_minute: 100,
  creditiq_travel_search: 300,
  voice_minute: 200,
  document_parse: 300,
}

export type CostBudget = {
  planCode: string
  monthlyBudgetPaise: number
  warningPercent: number
  hardStopPercent: number
  activeWebWatchersMax: number
  baseWatcherCadenceMinutes: number
  maxWatcherCadenceMinutes: number
  burstWatcherCadenceMinutes: number
  burstHours: number
}

export type CostState = CostBudget & {
  spentPaise: number
  remainingPaise: number
  usageRatio: number
  warning: boolean
  blocked: boolean
}

const LEGACY_ALIAS: Record<string, string> = {
  lite: 'essential',
  starter: 'plus',
  power: 'pro',
}

function rowToBudget(row: any, requestedPlan: string): CostBudget {
  return {
    planCode: requestedPlan,
    monthlyBudgetPaise: Math.max(0, Number(row?.monthly_budget_paise || 0)),
    warningPercent: Math.max(1, Number(row?.warning_percent || 80)),
    hardStopPercent: Math.max(1, Number(row?.hard_stop_percent || 100)),
    activeWebWatchersMax: Math.max(0, Number(row?.active_web_watchers_max || 0)),
    baseWatcherCadenceMinutes: Math.max(15, Number(row?.base_watcher_cadence_minutes || 1440)),
    maxWatcherCadenceMinutes: Math.max(15, Number(row?.max_watcher_cadence_minutes || 1440)),
    burstWatcherCadenceMinutes: Math.max(15, Number(row?.burst_watcher_cadence_minutes || 1440)),
    burstHours: Math.max(0, Number(row?.burst_hours || 0)),
  }
}

async function readBudget(planCode: string) {
  const candidates = Array.from(new Set([planCode, LEGACY_ALIAS[planCode], 'free'].filter(Boolean)))
  for (const code of candidates) {
    const { data, error } = await supabaseAdmin
      .from('gogo_cost_budgets')
      .select('plan_code,monthly_budget_paise,warning_percent,hard_stop_percent,active_web_watchers_max,base_watcher_cadence_minutes,max_watcher_cadence_minutes,burst_watcher_cadence_minutes,burst_hours')
      .eq('plan_code', code)
      .maybeSingle()
    if (error) throw new Error(`cost_budget_read_failed:${error.message}`)
    if (data) return rowToBudget(data, planCode)
  }
  throw new Error('cost_budget_missing')
}

export async function getCostBudget(telegramId: string | number): Promise<CostBudget> {
  const plan = await getPlan(telegramId)
  return readBudget(String(plan.plan_code || 'free'))
}

export async function getCostState(telegramId: string | number, now = new Date()): Promise<CostState> {
  const budget = await getCostBudget(telegramId)
  const since = new Date(istMonthStartMs(now.getTime())).toISOString()
  const { data, error } = await supabaseAdmin.rpc('gogo_monthly_cost_paise', {
    p_telegram_id: String(telegramId),
    p_since: since,
  })
  if (error) throw new Error(`cost_usage_read_failed:${error.message}`)
  const spentPaise = Math.max(0, Number(data || 0))
  const denominator = Math.max(1, budget.monthlyBudgetPaise)
  const usageRatio = spentPaise / denominator
  return {
    ...budget,
    spentPaise,
    remainingPaise: Math.max(0, budget.monthlyBudgetPaise - spentPaise),
    usageRatio,
    warning: usageRatio >= budget.warningPercent / 100,
    blocked: usageRatio >= budget.hardStopPercent / 100,
  }
}

export async function checkCostAllowance(
  telegramId: string | number,
  estimatedCostPaise: number,
): Promise<{ allowed: boolean; state: CostState | null; reason?: string }> {
  try {
    const state = await getCostState(telegramId)
    const projected = state.spentPaise + Math.max(0, Math.round(estimatedCostPaise))
    const hardCeiling = state.monthlyBudgetPaise * state.hardStopPercent / 100
    return projected <= hardCeiling
      ? { allowed: true, state }
      : { allowed: false, state, reason: 'monthly_cogs_budget_reached' }
  } catch (error: any) {
    console.error('COST_GUARD_CHECK_FAILED:', error?.message || error)
    // Paid/background work fails cost-safe: if we cannot verify the budget, do not
    // spend on another external call. The caller can reschedule rather than fail.
    return { allowed: false, state: null, reason: 'cost_guard_unavailable' }
  }
}

export async function recordCostEvent(params: {
  telegramId: string | number
  category: CostCategory
  estimatedCostPaise?: number
  units?: number
  metadata?: Record<string, unknown>
}) {
  try {
    const plan = await getPlan(params.telegramId)
    const units = Number.isFinite(Number(params.units)) ? Math.max(0, Number(params.units)) : 1
    const base = params.estimatedCostPaise ?? COST_ESTIMATES_PAISE[params.category]
    const estimatedCostPaise = Math.max(0, Math.round(base * units))
    const { error } = await supabaseAdmin.from('gogo_cost_events').insert({
      telegram_id: String(params.telegramId),
      plan_code: String(plan.plan_code || 'free'),
      category: params.category,
      estimated_cost_paise: estimatedCostPaise,
      units,
      metadata_json: params.metadata || {},
    })
    if (error) throw error
    return { recorded: true, estimatedCostPaise }
  } catch (error: any) {
    console.error('COST_EVENT_RECORD_FAILED:', error?.message || error)
    return { recorded: false, estimatedCostPaise: 0 }
  }
}
