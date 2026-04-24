import { supabaseAdmin } from './supabase-admin'

const LIMITS = {
  free: { daily: 20, memories: 10 },
  starter: { daily: 100, memories: 50 },
  pro: { daily: 999, memories: 500 },
}

export async function checkAndIncrementLimit(telegramId: number): Promise<{
  allowed: boolean
  tier: string
  remaining: number
  upgradeMessage?: string
}> {
  const { data: user } = await supabaseAdmin
    .from('users')
    .select('tier, daily_count, last_reset, tier_expires_at')
    .eq('telegram_id', telegramId)
    .single()

  if (!user) return { allowed: true, tier: 'free', remaining: 20 }

  let tier = user.tier || 'free'

  if (user.tier_expires_at && new Date(user.tier_expires_at) < new Date()) {
    tier = 'free'

    await supabaseAdmin
      .from('users')
      .update({ tier: 'free' })
      .eq('telegram_id', telegramId)
  }

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
  let dailyCount = user.daily_count || 0

  if (user.last_reset !== today) {
    dailyCount = 0

    await supabaseAdmin
      .from('users')
      .update({ daily_count: 0, last_reset: today })
      .eq('telegram_id', telegramId)
  }

  const limit = LIMITS[tier as keyof typeof LIMITS] || LIMITS.free
  const remaining = limit.daily - dailyCount

  if (remaining <= 0) {
    return {
      allowed: false,
      tier,
      remaining: 0,
      upgradeMessage:
        `⚡ *Daily free limit reached*\n\n` +
        `You’ve used your ${limit.daily} messages for today on the *${tier}* plan.\n\n` +
        `AskGogo is currently in founder beta. Payments are not live yet.\n\n` +
        `Paid plans coming soon:\n` +
        `• Starter — ₹299/month\n` +
        `• Pro — ₹999/month\n\n` +
        `Your data and reminders are safe. Your limit resets tomorrow.`,
    }
  }

  await supabaseAdmin
    .from('users')
    .update({ daily_count: dailyCount + 1 })
    .eq('telegram_id', telegramId)

  return { allowed: true, tier, remaining: remaining - 1 }
}
