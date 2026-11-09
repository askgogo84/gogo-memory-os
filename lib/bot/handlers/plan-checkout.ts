import { createSubscription } from '@/lib/services/razorpay-subscriptions'
import { supabaseAdmin } from '@/lib/supabase-admin'

export type CheckoutPlanKey = 'essential' | 'plus' | 'pro'

const PLAN_LABELS: Record<CheckoutPlanKey, string> = {
  essential: 'Gogo Essential (₹249/month)',
  plus: 'Gogo Plus (₹499/month)',
  pro: 'Gogo Pro (₹999/month)',
}

// Detect current paid-plan choices while preserving old reply words as aliases.
export function parsePlanSelection(text: string): CheckoutPlanKey | null {
  const t = (text || '').toLowerCase().trim()
  if (!t) return null
  const cleaned = t.replace(/^(subscribe|get|choose|select|start|buy|upgrade to|go with)\s+/i, '').trim()
  if (cleaned === 'essential' || cleaned === 'lite' || cleaned === '1') return 'essential'
  if (cleaned === 'plus' || cleaned === 'gogo plus' || cleaned === '2') return 'plus'
  if (cleaned === 'pro' || cleaned === 'gogo pro' || cleaned === 'power' || cleaned === '3' || cleaned === 'founder' || cleaned === 'founder pro') return 'pro'
  return null
}

// A payment entitlement is bound to the resolved bot actor, never an approximate phone.
// Two independent international accounts can share the last ten digits.
async function hasActiveSubscription(telegramId: number): Promise<boolean> {
  if (!Number.isSafeInteger(telegramId) || telegramId === 0) {
    throw new Error('invalid_checkout_owner')
  }

  const { data, error } = await supabaseAdmin
    .from('users')
    .select('tier, tier_expires_at, subscription_status')
    .eq('telegram_id', telegramId)
    .limit(2)

  // Unknown status is not proof that a new subscription is safe to create.
  if (error || !Array.isArray(data) || data.length > 1) {
    throw new Error('subscription_status_unverified')
  }
  const now = Date.now()
  return data.some((u: any) =>
    (u.subscription_status === 'active' || u.subscription_status === 'authenticated') &&
    u.tier && u.tier !== 'free' &&
    (!u.tier_expires_at || new Date(u.tier_expires_at).getTime() > now)
  )
}
export async function buildPlanCheckoutReply(
  user: { telegramId: number; whatsappId: string | null; name: string },
  planKey: CheckoutPlanKey
): Promise<string> {
  const label = PLAN_LABELS[planKey] || PLAN_LABELS.plus

  try {
    if (await hasActiveSubscription(user.telegramId)) {
      return `You're already on an active Gogo plan. 🎉\n\nReply *usage* to see your capacity, or *cancel* if you'd like to stop.`
    }
  } catch (err) {
    console.error('plan-checkout: subscription status unavailable')
    return `I couldn't verify your current subscription status, so I haven't created another checkout link. Please try again later.`
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
      ? `First ${trialDays} days free — you won't be charged until then.`
      : ''

    return [
      `Here's your ${label} setup link:`,
      '',
      result.shortUrl,
      '',
      trialLine,
      `Tap it, authorize once, and Gogo unlocks automatically. Cancel anytime by replying *cancel*.`,
    ].filter(Boolean).join('\n')
  } catch (err) {
    console.error('plan-checkout: createSubscription failed:', err)
    return `Something went wrong creating your subscription link. Please try again in a moment, or reply *upgrade* to restart.`
  }
}
