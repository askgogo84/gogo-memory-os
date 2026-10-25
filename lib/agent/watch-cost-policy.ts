import type { CostBudget } from '@/lib/services/cost-guard'

export function watcherPlanLabel(planCode: string) {
  const code = String(planCode || 'free').toLowerCase()
  if (code === 'founder_pro') return 'Founder Pro'
  if (code === 'pro' || code === 'pro_annual' || code === 'power') return 'Gogo Pro'
  if (code === 'starter' || code === 'plus') return 'Gogo Plus'
  if (code === 'lite' || code === 'essential') return 'Gogo Essential'
  return 'Gogo Free'
}

export function isUrgentWatchRequest(text: string) {
  return /\b(urgent|watch closely|keep a close eye|as soon as|immediately|every 15(?:\s+minutes?|m)?|frequently|very closely)\b/i.test(String(text || ''))
}

export function initialWatcherCadence(params: {
  budget: CostBudget
  urgent?: boolean
  activeWatcherCount?: number
}) {
  const active = Math.max(1, Number(params.activeWatcherCount || 1))
  if (params.urgent && params.budget.burstHours > 0) {
    return Math.max(15, Math.min(params.budget.burstWatcherCadenceMinutes, params.budget.maxWatcherCadenceMinutes))
  }
  // Share a plan's search budget across active watches instead of letting every
  // watch consume the full headline cadence independently.
  return Math.max(15, Math.min(
    params.budget.maxWatcherCadenceMinutes,
    params.budget.baseWatcherCadenceMinutes * active,
  ))
}

export function adaptiveWatcherCadence(params: {
  budget: CostBudget
  activeWatcherCount?: number
  quietChecks?: number
  material?: boolean
  usageRatio?: number
  burstUntil?: string | null
  now?: Date
}) {
  const now = params.now || new Date()
  const active = Math.max(1, Number(params.activeWatcherCount || 1))
  const quiet = Math.max(0, Number(params.quietChecks || 0))
  const usageRatio = Math.max(0, Number(params.usageRatio || 0))
  const burstActive = Boolean(
    params.budget.burstHours > 0 &&
    params.burstUntil &&
    new Date(params.burstUntil).getTime() > now.getTime(),
  )

  if (params.material && burstActive) {
    return Math.max(15, Math.min(params.budget.burstWatcherCadenceMinutes, params.budget.maxWatcherCadenceMinutes))
  }

  let cadence = params.budget.baseWatcherCadenceMinutes * active

  // Quiet watches progressively back off. Two unchanged checks keep the base pace;
  // repeated silence doubles and then quadruples the interval, capped by plan.
  if (quiet >= 4) cadence *= 4
  else if (quiet >= 2) cadence *= 2

  // Margin guard: when a user approaches the plan's monthly COGS budget, use the
  // slowest allowed cadence before hard-stopping paid checks.
  if (usageRatio >= 0.95) cadence = params.budget.maxWatcherCadenceMinutes
  else if (usageRatio >= 0.8) cadence *= 2

  if (burstActive && quiet < 2 && usageRatio < 0.8) {
    cadence = Math.min(cadence, params.budget.burstWatcherCadenceMinutes)
  }

  return Math.max(15, Math.min(params.budget.maxWatcherCadenceMinutes, Math.round(cadence)))
}

export function watcherUpgradeMessage(planCode: string) {
  const label = watcherPlanLabel(planCode)
  if (label === 'Gogo Free') {
    return 'Background web watching is a paid Gogo capability. Gogo Essential starts at ₹249/month.'
  }
  return `${label} has reached its active Background Gogo watch allowance. Stop an existing watch or move to a higher plan.`
}
