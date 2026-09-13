import { supabaseAdmin } from '../supabase-admin'
import { getPlan } from './meter'
import { istMonthStartMs } from './meter-core'
import { publicPlanForInternalCode } from '@/lib/pricing/gogo-plans'
import { marginBudgetForPlan } from './margin-policy'

export type CostCategory =
  | 'web_search_basic'
  | 'llm_routine'
  | 'llm_haiku'
  | 'llm_sonnet'
  | 'whatsapp_outbound'
  | 'secure_compute_minute'
  | 'creditiq_travel_search'
  | 'voice_minute'
  | 'document_parse'
  | 'vision_image'

/**
 * Conservative launch estimates, deliberately rounded UP. These are budget
 * reservations, not accounting invoices. Actual provider billing can later be
 * reconciled into the ledger without weakening the hard ceiling.
 */
export const COST_ESTIMATES_PAISE: Record<CostCategory, number> = {
  web_search_basic: 100,
  llm_routine: 20,
  llm_haiku: 100,
  llm_sonnet: 500,
  // One delivered WhatsApp reply reserves a full conversational-turn allowance
  // (Twilio inbound + outbound plus headroom for Meta AI-provider/service fees).
  whatsapp_outbound: 125,
  secure_compute_minute: 100,
  creditiq_travel_search: 300,
  voice_minute: 200,
  document_parse: 300,
  vision_image: 300,
}

export type CostBudget = {
  planCode: string
  publicPlanCode: string
  priceInrMonthly: number
  configuredMonthlyBudgetPaise: number
  monthlyBudgetPaise: number
  targetMarginPercent: number
  projectedContributionMarginPercent: number | null
  estimatedNetRevenueInr: number
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
  essential: 'essential',
  starter: 'plus',
  plus: 'plus',
  power: 'pro',
  founder: 'pro',
  founder_pro: 'pro',
  gogo_pro: 'pro',
  pro_annual: 'pro',
}

type RawBudget = {
  configuredMonthlyBudgetPaise:number
  warningPercent:number
  hardStopPercent:number
  activeWebWatchersMax:number
  baseWatcherCadenceMinutes:number
  maxWatcherCadenceMinutes:number
  burstWatcherCadenceMinutes:number
  burstHours:number
}

function rowToRawBudget(row: any): RawBudget {
  return {
    configuredMonthlyBudgetPaise: Math.max(0, Number(row?.monthly_budget_paise || 0)),
    warningPercent: Math.max(1, Number(row?.warning_percent || 80)),
    hardStopPercent: Math.max(1, Number(row?.hard_stop_percent || 100)),
    activeWebWatchersMax: Math.max(0, Number(row?.active_web_watchers_max || 0)),
    baseWatcherCadenceMinutes: Math.max(15, Number(row?.base_watcher_cadence_minutes || 1440)),
    maxWatcherCadenceMinutes: Math.max(15, Number(row?.max_watcher_cadence_minutes || 1440)),
    burstWatcherCadenceMinutes: Math.max(15, Number(row?.burst_watcher_cadence_minutes || 1440)),
    burstHours: Math.max(0, Number(row?.burst_hours || 0)),
  }
}

async function readRawBudget(planCode: string) {
  const publicCode = publicPlanForInternalCode(planCode).code
  // Read the exact legacy row when it exists so existing watcher/cadence policy is
  // retained, but cap its rupee budget below using the canonical public economics.
  const candidates = Array.from(new Set([
    planCode,
    LEGACY_ALIAS[planCode],
    publicCode,
    publicCode === 'essential' ? 'lite' : null,
    publicCode === 'plus' ? 'starter' : null,
    publicCode === 'pro' ? 'pro' : null,
    'free',
  ].filter(Boolean) as string[]))
  for (const code of candidates) {
    const { data, error } = await supabaseAdmin
      .from('gogo_cost_budgets')
      .select('plan_code,monthly_budget_paise,warning_percent,hard_stop_percent,active_web_watchers_max,base_watcher_cadence_minutes,max_watcher_cadence_minutes,burst_watcher_cadence_minutes,burst_hours')
      .eq('plan_code', code)
      .maybeSingle()
    if (error) throw new Error(`cost_budget_read_failed:${error.message}`)
    if (data) return rowToRawBudget(data)
  }
  throw new Error('cost_budget_missing')
}

export async function getCostBudget(telegramId: string | number): Promise<CostBudget> {
  const plan = await getPlan(telegramId)
  const planCode = String(plan.plan_code || 'free').toLowerCase()
  const raw = await readRawBudget(planCode)
  const economics = marginBudgetForPlan({
    internalPlanCode: planCode,
    configuredBudgetPaise: raw.configuredMonthlyBudgetPaise,
  })
  return {
    planCode,
    publicPlanCode:economics.publicPlanCode,
    priceInrMonthly:economics.priceInrMonthly,
    configuredMonthlyBudgetPaise:raw.configuredMonthlyBudgetPaise,
    monthlyBudgetPaise:Math.max(0,Math.floor(economics.effectiveBudgetInr*100)),
    targetMarginPercent:economics.targetMarginPercent,
    projectedContributionMarginPercent:economics.projectedContributionMarginPercent,
    estimatedNetRevenueInr:economics.estimatedNetRevenueInr,
    warningPercent:raw.warningPercent,
    hardStopPercent:Math.min(100,raw.hardStopPercent),
    activeWebWatchersMax:raw.activeWebWatchersMax,
    baseWatcherCadenceMinutes:raw.baseWatcherCadenceMinutes,
    maxWatcherCadenceMinutes:raw.maxWatcherCadenceMinutes,
    burstWatcherCadenceMinutes:raw.burstWatcherCadenceMinutes,
    burstHours:raw.burstHours,
  }
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
    return { allowed: false, state: null, reason: 'cost_guard_unavailable' }
  }
}

/**
 * Atomically reserve spend BEFORE an external provider call. The database takes
 * a per-user/month advisory lock, checks the hard margin-aware ceiling, and only
 * then writes the cost event. Concurrent requests therefore cannot both pass a
 * stale read and overshoot the monthly wallet.
 */
export async function reserveCostEvent(params: {
  telegramId: string | number
  category: CostCategory
  estimatedCostPaise?: number
  units?: number
  metadata?: Record<string, unknown>
}):Promise<{allowed:boolean;estimatedCostPaise:number;spentPaise:number;projectedPaise:number;reason?:string;state?:CostState|null}>{
  const units = Number.isFinite(Number(params.units)) ? Math.max(0, Number(params.units)) : 1
  const base = params.estimatedCostPaise ?? COST_ESTIMATES_PAISE[params.category]
  const estimatedCostPaise = Math.max(0, Math.round(base * units))
  try {
    const budget=await getCostBudget(params.telegramId)
    const now=new Date()
    const since=new Date(istMonthStartMs(now.getTime())).toISOString()
    const hardCeilingPaise=Math.floor(budget.monthlyBudgetPaise*budget.hardStopPercent/100)
    const {data,error}=await supabaseAdmin.rpc('gogo_reserve_cost_paise',{
      p_telegram_id:String(params.telegramId),
      p_plan_code:budget.planCode,
      p_category:params.category,
      p_estimated_cost_paise:estimatedCostPaise,
      p_units:units,
      p_metadata:params.metadata||{},
      p_since:since,
      p_hard_ceiling_paise:hardCeilingPaise,
    })
    if(error)throw new Error(error.message)
    const row=Array.isArray(data)?data[0]:data
    const allowed=Boolean(row?.allowed)
    return {
      allowed,
      estimatedCostPaise,
      spentPaise:Math.max(0,Number(row?.spent_paise||0)),
      projectedPaise:Math.max(0,Number(row?.projected_paise||0)),
      reason:allowed?undefined:'monthly_cogs_budget_reached',
    }
  }catch(error:any){
    console.error('COST_RESERVATION_FAILED:',error?.message||error)
    return {allowed:false,estimatedCostPaise,spentPaise:0,projectedPaise:0,reason:'cost_guard_unavailable'}
  }
}

/** Record cost that has already happened (e.g. a delivered transport message). */
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
