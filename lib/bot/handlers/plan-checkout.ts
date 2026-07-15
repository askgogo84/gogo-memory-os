import { createSubscription } from '@/lib/services/razorpay-subscriptions'
import { supabaseAdmin } from '@/lib/supabase-admin'

export type CheckoutPlanKey = 'lite' | 'starter' | 'pro' | 'pro_annual'

const PLAN_LABELS: Record<CheckoutPlanKey, string> = {
  lite: 'AskGogo Lite (\u20b999/month)',
  starter: 'AskGogo Starter (\u20b9149/month)',
  pro: 'AskGogo Pro (\u20b9199/month)',
  pro_annual: 'AskGogo Pro Annual (\u20b91,499/year)',
}

// Detects a plan choice from a chat message.
// Accepts: "lite" / "starter" / "pro" / "pro annual" / "1".."4",
// and verb forms like "subscribe pro", "get lite", "buy starter".
export function parsePlanSelection(text: string): CheckoutPlanKey | null {
  const t = (text || '').toLowerCase().trim()
  if (!t) return null
  if (/\b(pro\s*annual|annual\s*pro|pro\s*yearly|yearly\s*pro)\b/.test(t)) return 'pro_annual'
  const cleaned = t.replace(/^(subscribe|get|choose|select|start|buy|upgrade to|go with)\s+/i, '').trim()
  if (cleaned === 'lite' || cleaned === '1') return 'lite'
  if (cleaned === 'starter' || cleaned === '2') return 'starter'
  if (cleaned === 'pro' || cleaned === '3') return 'pro'
  if (cleaned === 'pro annual' || cleaned === '4') return 'pro_annual'
  return null
}

// True if the user already has a live paid subscription (prevents duplicate mandates).
async function hasActiveSubscription(telegramId: number, whatsappId: string | null): Promise<boolean> {
  const digits = String(whatsappId || '').replace(/\D/g, '').slice(-10)
  const clauses: string[] = [`telegram_id.eq.${telegramId}`]
  if (digits.length === 10) clauses.push(`whatsapp_id.ilike.*${digits}*`)

  const { data } = await supabaseAdmin
    .from('users')
    .select('tier, tier_expires_at, subscription_status')
    .or(clauses.join(','))
    .limit(5)

  const now = Date.now()
  return (data || []).some((u: any) =>
    (u.subscription_status === 'active' || u.subscription_status === 'authenticated') &&
    u.tier && u.tier !== 'free' &&
    (!u.tier_expires_at || new Date(u.tier_expires_at).getTime() > now)
  )
}

export async function buildPlanCheckoutReply(
  user: { telegramId: number; whatsappId: string | null; name: string },
  planKey: CheckoutPlanKey
): Promise<string> {
  const label = PLAN_LABELS[planKey] || PLAN_LABELS.pro

  try {
    if (await hasActiveSubscription(user.telegramId, user.whatsappId)) {
      return `You're already on an active AskGogo plan. \ud83c\udf89\n\nReply *usage* to see your limits, or *cancel* if you'd like to stop.`
    }
  } catch (err) {
    console.error('plan-checkout: active-sub check failed:', err)
  }

  const phone = user.whatsappId || ''
  if (!phone.replace(/\D/g, '')) {
    return `I couldn't read your number to set up the subscription. Please try again from WhatsApp.`
  }

  try {
    const result = await createSubscription({
      planKey,
      phone,
      whatsappId: user.whatsappId,
      telegramId: user.telegramId,
      name: user.name,
    })

    const trialDays = Number(process.env.RAZORPAY_TRIAL_DAYS ?? '7')
    const trialLine = trialDays > 0
      ? `First ${trialDays} days free \u2014 you won't be charged until then.`
      : ''

    return [
      `Great choice! Here's your ${label} setup link:`,
      '',
      result.shortUrl,
      '',
      trialLine,
      `Tap it, authorize once, and your plan activates automatically. Cancel anytime by replying *cancel*.`,
    ].filter(Boolean).join('\n')
  } catch (err) {
    console.error('plan-checkout: createSubscription failed:', err)
    return `Something went wrong creating your subscription link. Please try again in a moment, or reply *upgrade* to restart.`
  }
}
