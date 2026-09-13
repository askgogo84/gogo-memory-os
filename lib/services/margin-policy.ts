import { publicPlanForInternalCode, type PublicGogoPlanCode } from '@/lib/pricing/gogo-plans'

/**
 * Conservative realized-revenue factor for India subscription pricing.
 *
 * Public prices are customer-facing sticker prices. We do not allow the cost
 * engine to spend against the full sticker price because GST and collection
 * fees reduce what is actually available to fund variable COGS. 0.82 is a
 * deliberately conservative launch default and can be lowered without a code
 * change through GOGO_NET_REVENUE_FACTOR.
 */
export const DEFAULT_NET_REVENUE_FACTOR = 0.82
export const MIN_CONTRIBUTION_MARGIN_PERCENT = 30

function clamp(value:number,min:number,max:number){return Math.min(max,Math.max(min,value))}

export function configuredNetRevenueFactor() {
  const raw = Number(process.env.GOGO_NET_REVENUE_FACTOR || DEFAULT_NET_REVENUE_FACTOR)
  return Number.isFinite(raw) ? clamp(raw,0.65,0.9) : DEFAULT_NET_REVENUE_FACTOR
}

export type MarginBudget = {
  internalPlanCode:string
  publicPlanCode:PublicGogoPlanCode
  priceInrMonthly:number
  netRevenueFactor:number
  estimatedNetRevenueInr:number
  targetMarginPercent:number
  marginCeilingInr:number
  catalogCogsBudgetInr:number
  configuredBudgetInr:number
  effectiveBudgetInr:number
  projectedContributionMarginPercent:number | null
}

/**
 * Hard COGS ceiling for a user.
 *
 * Paid plans use the STRICTEST of:
 *   1. configured DB budget,
 *   2. canonical plan COGS budget,
 *   3. the maximum COGS compatible with the minimum contribution margin.
 *
 * Free has no revenue, so its small acquisition subsidy remains an absolute cap.
 * This also prevents legacy/internal tiers (e.g. founder_pro) from accidentally
 * inheriting a test budget that violates the public plan's economics.
 */
export function marginBudgetForPlan(params:{
  internalPlanCode:string
  configuredBudgetPaise:number
  netRevenueFactor?:number
}):MarginBudget{
  const internalPlanCode=String(params.internalPlanCode||'free').toLowerCase()
  const plan=publicPlanForInternalCode(internalPlanCode)
  const factor=clamp(Number(params.netRevenueFactor ?? configuredNetRevenueFactor()),0.65,0.9)
  const configuredBudgetInr=Math.max(0,Number(params.configuredBudgetPaise||0)/100)
  const catalogCogsBudgetInr=Math.max(0,Number(plan.cogsBudgetInr||0))
  const targetMarginPercent=Math.max(MIN_CONTRIBUTION_MARGIN_PERCENT,Number(plan.targetHeavyUserMarginPercent||MIN_CONTRIBUTION_MARGIN_PERCENT))
  const estimatedNetRevenueInr=Math.max(0,plan.priceInrMonthly*factor)

  if(plan.code==='free'||plan.priceInrMonthly<=0){
    const effectiveBudgetInr=Math.min(configuredBudgetInr||catalogCogsBudgetInr,catalogCogsBudgetInr)
    return {
      internalPlanCode,publicPlanCode:plan.code,priceInrMonthly:plan.priceInrMonthly,
      netRevenueFactor:factor,estimatedNetRevenueInr,targetMarginPercent,
      marginCeilingInr:effectiveBudgetInr,catalogCogsBudgetInr,configuredBudgetInr,
      effectiveBudgetInr,projectedContributionMarginPercent:null,
    }
  }

  const marginCeilingInr=estimatedNetRevenueInr*(1-targetMarginPercent/100)
  const effectiveBudgetInr=Math.max(0,Math.min(
    configuredBudgetInr || Number.POSITIVE_INFINITY,
    catalogCogsBudgetInr || Number.POSITIVE_INFINITY,
    marginCeilingInr,
  ))
  const projectedContributionMarginPercent=estimatedNetRevenueInr>0
    ? ((estimatedNetRevenueInr-effectiveBudgetInr)/estimatedNetRevenueInr)*100
    : null

  return {
    internalPlanCode,publicPlanCode:plan.code,priceInrMonthly:plan.priceInrMonthly,
    netRevenueFactor:factor,estimatedNetRevenueInr,targetMarginPercent,
    marginCeilingInr,catalogCogsBudgetInr,configuredBudgetInr,effectiveBudgetInr,
    projectedContributionMarginPercent,
  }
}

export function effectiveBudgetPaise(params:{internalPlanCode:string;configuredBudgetPaise:number;netRevenueFactor?:number}){
  return Math.floor(marginBudgetForPlan(params).effectiveBudgetInr*100)
}
