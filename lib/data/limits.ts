import { supabaseAdmin } from './supabase-admin'

type PlanKey = 'free' | 'starter' | 'pro' | 'founder_pro'

const LIMITS: Record<PlanKey, { monthly: number; label: string }> = {
  free: {
    monthly: 25,
    label: 'Free Beta',
  },
  starter: {
    monthly: 100,
    label: 'Starter',
  },
  pro: {
    monthly: 250,
    label: 'Pro',
  },
  founder_pro: {
    monthly: 600,
    label: 'Founder Pro',
  },
}

function currentMonthKey() {
  return new Date().toLocaleDateString('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
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

function buildLimitReachedMessage(planLabel: string, monthlyLimit: number) {
  return (
    `⚡ *Monthly AI action limit reached*\n\n` +
    `You’ve used your ${monthlyLimit} AI actions for this month on the *${planLabel}* plan.\n\n` +
    `AskGogo is currently in founder beta. Razorpay checkout is being enabled soon.\n\n` +
    `Plans going live:\n` +
    `• Starter — ₹149/month — 100 AI actions/month\n` +
    `• Pro — ₹299/month — 250 AI actions/month\n` +
    `• Founder Pro — ₹499/month — 600 AI actions/month\n\n` +
    `Reply *notify me* and I’ll mark you for early founder pricing.`
  )
}

export async function checkAndIncrementLimit(telegramId: number): Promise<{
  allowed: boolean
  tier: string
  remaining: number
  monthlyLimit: number
  usedThisMonth: number
  upgradeMessage?: string
}> {
  const { data: user } = await supabaseAdmin
    .from('users')
    .select('tier, daily_count, last_reset, tier_expires_at')
    .eq('telegram_id', telegramId)
    .single()

  if (!user) {
    return {
      allowed: true,
      tier: 'free',
      remaining: LIMITS.free.monthly - 1,
      monthlyLimit: LIMITS.free.monthly,
      usedThisMonth: 1,
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

  const monthKey = currentMonthKey()
  let usedCount = user.daily_count || 0

  // Reuse existing columns:
  // daily_count = monthly AI action usage
  // last_reset = YYYY-MM month key
  if (user.last_reset !== monthKey) {
    usedCount = 0

    await supabaseAdmin
      .from('users')
      .update({ daily_count: 0, last_reset: monthKey })
      .eq('telegram_id', telegramId)
  }

  const plan = LIMITS[tier] || LIMITS.free
  const remainingBeforeThisAction = plan.monthly - usedCount

  if (remainingBeforeThisAction <= 0) {
    return {
      allowed: false,
      tier,
      remaining: 0,
      monthlyLimit: plan.monthly,
      usedThisMonth: usedCount,
      upgradeMessage: buildLimitReachedMessage(plan.label, plan.monthly),
    }
  }

  const newUsedCount = usedCount + 1

  await supabaseAdmin
    .from('users')
    .update({ daily_count: newUsedCount })
    .eq('telegram_id', telegramId)

  return {
    allowed: true,
    tier,
    remaining: Math.max(plan.monthly - newUsedCount, 0),
    monthlyLimit: plan.monthly,
    usedThisMonth: newUsedCount,
  }
}

export function getPlanLimits() {
  return LIMITS
}
