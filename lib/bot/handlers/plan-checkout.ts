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

/** Keep explicit +country identities even when the whole E.164 number is 10 digits. */
function completeInternationalWhatsAppDigits(value: string | null): string | null {
  const raw = String(value || '').trim().replace(/^whatsapp:\s*/i, '').trim()
  if (/^\+[1-9][0-9]{7,14}$/.test(raw)) return raw.slice(1)
  // Without '+', ten digits may be a local Indian number; never infer ownership.
  if (/^[1-9][0-9]{10,14}$/.test(raw)) return raw
  return null
}

/** Exact actor and complete international WhatsApp identity only: never a national suffix. */
async function hasActiveSubscription(telegramId: number, whatsappId: string | null): Promise<boolean> {
  // JS Number values outside the safe range can alias another persisted BIGINT.
  if (!Number.isSafeInteger(telegramId) || telegramId === 0) throw new Error('unsafe_plan_owner')

  const { data: ownRows, error: ownError } = await supabaseAdmin
    .from('users')
    .select('tier, tier_expires_at, subscription_status')
    .eq('telegram_id', telegramId)
    .limit(3)
  if (ownError || !Array.isArray(ownRows) || ownRows.length >= 3) {
    throw new Error('plan_owner_lookup_unavailable')
  }

  const rows: any[] = [...ownRows]
  const raw = String(whatsappId || '').trim().replace(/^whatsapp:\s*/i, '').trim()
  // Complete E.164 numbers can be 8–15 digits with an explicit + prefix.
  // For legacy unprefixed IDs, require 11+ digits to reject ambiguous
  // domestic-only ten-digit phone numbers.
  const full = completeInternationalWhatsAppDigits(raw)
  if (full) {
    const { data: exactRows, error: exactError } = await supabaseAdmin
      .from('users')
      .select('tier, tier_expires_at, subscription_status')
      .in('whatsapp_id', [
        `+${full}`, `whatsapp:+${full}`, full, `whatsapp:${full}`,
      ])
      .limit(25)
    if (exactError || !Array.isArray(exactRows) || exactRows.length >= 25) {
      throw new Error('plan_phone_lookup_unavailable')
    }
    rows.push(...exactRows)
  }

  const now = Date.now()
  return rows.some((u: any) =>
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
    if (await hasActiveSubscription(user.telegramId, user.whatsappId)) {
      return `You're already on an active Gogo plan. 🎉\n\nReply *usage* to see your capacity, or *cancel* if you'd like to stop.`
    }
  } catch (err) {
    console.error('plan-checkout: active-sub check failed:', err)
    // Cannot safely create another recurring mandate when existing subscription
    // state is unknown; do not turn an owner lookup outage into duplicate billing.
    return `I couldn't verify your current Gogo plan. Please try again later.`
  }

  const phone = user.whatsappId || ''
  if (!completeInternationalWhatsAppDigits(phone)) {
    return `I couldn't verify your full international WhatsApp number for a subscription. Please try again from WhatsApp.`
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
