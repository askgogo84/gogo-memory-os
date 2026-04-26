import { supabaseAdmin } from './supabase-admin'

type PlanKey = 'free' | 'starter' | 'pro' | 'founder_pro'

export type UsageKind =
  | 'ai_action'
  | 'voice_note'
  | 'web_search'
  | 'calendar_event'
  | 'reminder_create'

type PlanLimit = {
  label: string
  priceInr: number
  monthlyActions: number
  dailyActions: number
  activeReminders: number
  voiceNotesMonthly: number
  webSearchesMonthly: number
  calendarEventsMonthly: number
  costGuardrailInr: number
}

const LIMITS: Record<PlanKey, PlanLimit> = {
  free: {
    label: 'Free Beta',
    priceInr: 0,
    monthlyActions: 25,
    dailyActions: 10,
    activeReminders: 3,
    voiceNotesMonthly: 5,
    webSearchesMonthly: 3,
    calendarEventsMonthly: 3,
    costGuardrailInr: 25,
  },
  starter: {
    label: 'Starter',
    priceInr: 149,
    monthlyActions: 100,
    dailyActions: 25,
    activeReminders: 10,
    voiceNotesMonthly: 30,
    webSearchesMonthly: 10,
    calendarEventsMonthly: 20,
    costGuardrailInr: 95,
  },
  pro: {
    label: 'Pro',
    priceInr: 299,
    monthlyActions: 250,
    dailyActions: 60,
    activeReminders: 50,
    voiceNotesMonthly: 100,
    webSearchesMonthly: 30,
    calendarEventsMonthly: 100,
    costGuardrailInr: 210,
  },
  founder_pro: {
    label: 'Founder Pro',
    priceInr: 499,
    monthlyActions: 600,
    dailyActions: 150,
    activeReminders: 200,
    voiceNotesMonthly: 300,
    webSearchesMonthly: 100,
    calendarEventsMonthly: 300,
    costGuardrailInr: 375,
  },
}

function currentMonthKey() {
  return new Date().toLocaleDateString('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
  })
}

function currentDayKey() {
  return new Date().toLocaleDateString('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

function normalizeTier(tier?: string | null): PlanKey {
  const clean = (tier || 'free').toLowerCase().trim()

  if (clean === 'starter') return 'starter'
  if (clean === 'pro') return 'pro'
  if (clean === 'founder_pro') return 'founder_pro'
  if (clean === 'founder-pro') return 'founder_pro'
  if (clean === 'founder pro') return 'founder_pro'

  return 'free'
}

function usageMemoryPrefix(kind: UsageKind, periodKey: string) {
  return `ASKGOGO_USAGE:${kind}:${periodKey}:`
}

function buildLimitReachedMessage(params: {
  planLabel: string
  limitLabel: string
  limitValue: number
}) {
  return (
    `⚡ *Fair-use limit reached*\n\n` +
    `You’ve reached your ${params.limitLabel} limit of *${params.limitValue}* on the *${params.planLabel}* plan.\n\n` +
    `AskGogo is currently in founder beta. Razorpay checkout is being enabled soon.\n\n` +
    `Plans going live:\n` +
    `• Starter — ₹149/month — 100 AI actions/month\n` +
    `• Pro — ₹299/month — 250 AI actions/month\n` +
    `• Founder Pro — ₹499/month — 600 AI actions/month\n\n` +
    `Reply *notify me* and I’ll mark you for early founder pricing.`
  )
}

async function getUserPlan(telegramId: number) {
  const { data: user } = await supabaseAdmin
    .from('users')
    .select('tier, daily_count, last_reset, tier_expires_at')
    .eq('telegram_id', telegramId)
    .single()

  if (!user) {
    return {
      user: null,
      tier: 'free' as PlanKey,
      plan: LIMITS.free,
    }
  }

  let tier = normalizeTier(user.tier)

  if (user.tier_expires_at && new Date(user.tier_expires_at) < new Date()) {
    tier = 'free'

    await supabaseAdmin
      .from('users')
      .update({ tier: 'free' })
      .eq('telegram_id', telegramId)
  }

  return {
    user,
    tier,
    plan: LIMITS[tier],
  }
}

async function countUsageFromMemories(
  telegramId: number,
  kind: UsageKind,
  periodKey: string
) {
  const prefix = usageMemoryPrefix(kind, periodKey)

  const { count } = await supabaseAdmin
    .from('memories')
    .select('id', { count: 'exact', head: true })
    .eq('telegram_id', telegramId)
    .like('content', `${prefix}%`)

  return count || 0
}

export async function logUsage(
  telegramId: number,
  kind: UsageKind,
  meta?: Record<string, any>
) {
  const monthKey = currentMonthKey()
  const dayKey = currentDayKey()

  await supabaseAdmin.from('memories').insert({
    telegram_id: telegramId,
    content:
      usageMemoryPrefix(kind, monthKey) +
      JSON.stringify({
        kind,
        monthKey,
        dayKey,
        meta: meta || {},
        created_at: new Date().toISOString(),
      }),
  })

  if (kind === 'ai_action') {
    await supabaseAdmin.from('memories').insert({
      telegram_id: telegramId,
      content:
        usageMemoryPrefix(kind, dayKey) +
        JSON.stringify({
          kind,
          monthKey,
          dayKey,
          meta: meta || {},
          created_at: new Date().toISOString(),
        }),
    })
  }
}

async function getActiveReminderCount(telegramId: number) {
  const { count } = await supabaseAdmin
    .from('reminders')
    .select('id', { count: 'exact', head: true })
    .eq('telegram_id', telegramId)
    .eq('sent', false)

  return count || 0
}

export async function checkFeatureLimit(
  telegramId: number,
  kind: UsageKind
): Promise<{
  allowed: boolean
  tier: PlanKey
  plan: PlanLimit
  used: number
  limit: number
  upgradeMessage?: string
}> {
  const { tier, plan } = await getUserPlan(telegramId)
  const monthKey = currentMonthKey()

  if (kind === 'reminder_create') {
    const used = await getActiveReminderCount(telegramId)
    const limit = plan.activeReminders

    if (used >= limit) {
      return {
        allowed: false,
        tier,
        plan,
        used,
        limit,
        upgradeMessage: buildLimitReachedMessage({
          planLabel: plan.label,
          limitLabel: 'active reminders',
          limitValue: limit,
        }),
      }
    }

    return { allowed: true, tier, plan, used, limit }
  }

  let limit = 0

  if (kind === 'voice_note') limit = plan.voiceNotesMonthly
  if (kind === 'web_search') limit = plan.webSearchesMonthly
  if (kind === 'calendar_event') limit = plan.calendarEventsMonthly
  if (kind === 'ai_action') limit = plan.monthlyActions

  const used = await countUsageFromMemories(telegramId, kind, monthKey)

  if (used >= limit) {
    return {
      allowed: false,
      tier,
      plan,
      used,
      limit,
      upgradeMessage: buildLimitReachedMessage({
        planLabel: plan.label,
        limitLabel:
          kind === 'voice_note'
            ? 'monthly voice notes'
            : kind === 'web_search'
              ? 'monthly web searches'
              : kind === 'calendar_event'
                ? 'monthly calendar events'
                : 'monthly AI actions',
        limitValue: limit,
      }),
    }
  }

  return { allowed: true, tier, plan, used, limit }
}

export async function checkAndIncrementLimit(telegramId: number): Promise<{
  allowed: boolean
  tier: string
  remaining: number
  monthlyLimit: number
  usedThisMonth: number
  upgradeMessage?: string
}> {
  const { user, tier, plan } = await getUserPlan(telegramId)

  if (!user) {
    await logUsage(telegramId, 'ai_action')

    return {
      allowed: true,
      tier: 'free',
      remaining: plan.monthlyActions - 1,
      monthlyLimit: plan.monthlyActions,
      usedThisMonth: 1,
    }
  }

  const monthKey = currentMonthKey()
  const dayKey = currentDayKey()
  let usedCount = user.daily_count || 0

  if (user.last_reset !== monthKey) {
    usedCount = 0

    await supabaseAdmin
      .from('users')
      .update({ daily_count: 0, last_reset: monthKey })
      .eq('telegram_id', telegramId)
  }

  const dailyUsed = await countUsageFromMemories(telegramId, 'ai_action', dayKey)

  if (dailyUsed >= plan.dailyActions) {
    return {
      allowed: false,
      tier,
      remaining: Math.max(plan.monthlyActions - usedCount, 0),
      monthlyLimit: plan.monthlyActions,
      usedThisMonth: usedCount,
      upgradeMessage: buildLimitReachedMessage({
        planLabel: plan.label,
        limitLabel: 'daily AI actions',
        limitValue: plan.dailyActions,
      }),
    }
  }

  const remainingBeforeThisAction = plan.monthlyActions - usedCount

  if (remainingBeforeThisAction <= 0) {
    return {
      allowed: false,
      tier,
      remaining: 0,
      monthlyLimit: plan.monthlyActions,
      usedThisMonth: usedCount,
      upgradeMessage: buildLimitReachedMessage({
        planLabel: plan.label,
        limitLabel: 'monthly AI actions',
        limitValue: plan.monthlyActions,
      }),
    }
  }

  const newUsedCount = usedCount + 1

  await supabaseAdmin
    .from('users')
    .update({ daily_count: newUsedCount })
    .eq('telegram_id', telegramId)

  await logUsage(telegramId, 'ai_action')

  return {
    allowed: true,
    tier,
    remaining: Math.max(plan.monthlyActions - newUsedCount, 0),
    monthlyLimit: plan.monthlyActions,
    usedThisMonth: newUsedCount,
  }
}

export function getPlanLimits() {
  return LIMITS
}
