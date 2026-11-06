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

type CheckoutOwnerStatus = 'active' | 'eligible' | 'blocked'

/** Identity checks for a financial action must never infer an owner from a phone suffix. */
function exactSafeOwnerId(value: unknown): string | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value !== 0 ? String(value) : null
  if (typeof value !== 'string' || !/^-?[1-9]\d*$/.test(value)) return null
  const numeric = Number(value)
  return Number.isSafeInteger(numeric) && String(numeric) === value ? value : null
}

function internationalWhatsAppPhone(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const raw = value.trim().replace(/^whatsapp:\s*/i, '').trim()
  if (!/^\+?[0-9][0-9\s()\-]*$/.test(raw)) return null
  const digits = raw.replace(/\D/g, '')
  // Full country code is required. A ten-digit local phone never authorizes billing.
  return /^[1-9]\d{10,14}$/.test(digits) ? digits : null
}

/**
 * Read one persisted, exact sender account before either relying on a paid
 * entitlement or creating a new Razorpay authorization link. Database errors,
 * ambiguous rows and mismatched stored phones are not evidence of ownership.
 */
async function verifiedOwnerCheckoutStatus(telegramId: number, whatsappId: string | null): Promise<CheckoutOwnerStatus> {
  const owner = exactSafeOwnerId(telegramId)
  const senderPhone = internationalWhatsAppPhone(whatsappId)
  if (!owner || !senderPhone) return 'blocked'

  const { data: row, error } = await supabaseAdmin
    .from('users')
    .select('telegram_id, whatsapp_id, tier, tier_expires_at, subscription_status')
    .eq('telegram_id', owner)
    .maybeSingle()
  if (error || !row) return 'blocked'
  if (exactSafeOwnerId(row.telegram_id) !== owner) return 'blocked'
  if (internationalWhatsAppPhone(row.whatsapp_id) !== senderPhone) return 'blocked'

  const expiration = row.tier_expires_at ? Date.parse(String(row.tier_expires_at)) : null
  if (expiration !== null && !Number.isFinite(expiration)) return 'blocked'
  const active = (row.subscription_status === 'active' || row.subscription_status === 'authenticated') &&
    Boolean(row.tier && row.tier !== 'free') &&
    (expiration === null || expiration > Date.now())
  return active ? 'active' : 'eligible'
}

export async function buildPlanCheckoutReply(
  user: { telegramId: number; whatsappId: string | null; name: string },
  planKey: CheckoutPlanKey
): Promise<string> {
  const label = PLAN_LABELS[planKey] || PLAN_LABELS.plus

  let checkoutStatus: CheckoutOwnerStatus = 'blocked'
  try {
    checkoutStatus = await verifiedOwnerCheckoutStatus(user.telegramId, user.whatsappId)
  } catch (err) {
    console.error('plan-checkout: owner verification failed:', err)
  }
  if (checkoutStatus === 'blocked') {
    return "I couldn't verify that this WhatsApp number belongs to your billing account. No subscription link was created. Please check the connected number before trying again."
  }
  if (checkoutStatus === 'active') {
    return `You're already on an active Gogo plan. 🎉\n\nReply *usage* to see your capacity, or *cancel* if you'd like to stop.`
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
