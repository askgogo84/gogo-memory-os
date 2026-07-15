import { getPlan, type AskGogoPlanKey } from './razorpay'

// Subscription plan keys the checkout can offer.
// 'pro_annual' bills yearly but grants the same entitlement as 'pro'.
export type SubscriptionPlanKey = 'lite' | 'starter' | 'pro' | 'pro_annual'

// Maps each subscription key -> the Vercel env var that holds the LIVE Razorpay plan_ id.
// Set these in Vercel (values copied from the Razorpay Plans screen):
//   RAZORPAY_PLAN_LITE, RAZORPAY_PLAN_STARTER, RAZORPAY_PLAN_PRO, RAZORPAY_PLAN_PRO_ANNUAL
const PLAN_ID_ENV: Record<SubscriptionPlanKey, string> = {
  lite: 'RAZORPAY_PLAN_LITE',
  starter: 'RAZORPAY_PLAN_STARTER',
  pro: 'RAZORPAY_PLAN_PRO',
  pro_annual: 'RAZORPAY_PLAN_PRO_ANNUAL',
}

// Razorpay caps billing cycles by frequency (monthly max 120, yearly max 100).
// These values mean "runs until the customer cancels" in practice.
const TOTAL_COUNT: Record<SubscriptionPlanKey, number> = {
  lite: 120, // 10 years of monthly
  starter: 120,
  pro: 120,
  pro_annual: 10, // 10 years of yearly
}

function normalizeSubKey(planKey?: string | null): SubscriptionPlanKey {
  const clean = String(planKey || 'pro').toLowerCase().replace(/[\s-]+/g, '_')
  if (clean === 'pro_annual' || clean === 'annual' || clean === 'yearly') return 'pro_annual'
  if (clean === 'lite' || clean === 'starter' || clean === 'pro') return clean as SubscriptionPlanKey
  return 'pro'
}

// The entitlement tier granted for a given subscription (pro_annual -> pro).
export function entitlementKeyFor(planKey?: string | null): AskGogoPlanKey {
  const sub = normalizeSubKey(planKey)
  return sub === 'pro_annual' ? 'pro' : (sub as AskGogoPlanKey)
}

function getAuthHeader() {
  const keyId = process.env.RAZORPAY_KEY_ID
  const keySecret = process.env.RAZORPAY_KEY_SECRET
  if (!keyId || !keySecret) {
    throw new Error('Missing RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET')
  }
  return 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64')
}

export function getPlanId(planKey?: string | null): string {
  const sub = normalizeSubKey(planKey)
  const envName = PLAN_ID_ENV[sub]
  const planId = process.env[envName]
  if (!planId) {
    throw new Error(`Missing plan ID env var ${envName} in Vercel (for plan "${sub}")`)
  }
  return planId
}

export type CreateSubscriptionResult = {
  subscriptionId: string
  shortUrl: string
  status: string
  planKey: SubscriptionPlanKey
  entitlement: AskGogoPlanKey
}

/**
 * Creates a Razorpay Subscription (recurring auto-debit) and returns its
 * short_url — the link the customer opens to authorize the mandate.
 *
 * Free trial: controlled by env RAZORPAY_TRIAL_DAYS (default 7). When > 0,
 * the mandate is authorized now and the first debit lands `trialDays` later.
 * Set RAZORPAY_TRIAL_DAYS=0 to charge immediately.
 */
export async function createSubscription(options: {
  planKey: string
  phone?: string | null
  whatsappId?: string | null
  telegramId?: number | string | null
  userId?: string | null
  name?: string | null
}): Promise<CreateSubscriptionResult> {
  const sub = normalizeSubKey(options.planKey)
  const planId = getPlanId(sub)
  const entitlement = entitlementKeyFor(sub)

  const trialDays = Number(process.env.RAZORPAY_TRIAL_DAYS ?? '7')
  const nowSec = Math.floor(Date.now() / 1000)
  const startAt = Number.isFinite(trialDays) && trialDays > 0 ? nowSec + trialDays * 86400 : undefined

  const rawPhone = String(options.phone || options.whatsappId || '')
    .replace(/^whatsapp:/i, '')
    .replace(/\D/g, '')

  const notes: Record<string, string> = {
    source: 'askgogo_whatsapp',
    plan: entitlement, // entitlement tier the webhook grants (lite/starter/pro)
    sub_plan: sub, // exact plan chosen (incl. pro_annual)
    whatsapp_id: rawPhone || '',
    telegram_id: String(options.telegramId || ''),
    user_id: String(options.userId || ''),
  }

  const body: Record<string, unknown> = {
    plan_id: planId,
    total_count: TOTAL_COUNT[sub],
    quantity: 1,
    customer_notify: 1,
    notes,
  }
  if (startAt) body.start_at = startAt
  if (rawPhone) body.notify_info = { notify_phone: rawPhone }

  const response = await fetch('https://api.razorpay.com/v1/subscriptions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: getAuthHeader(),
    },
    body: JSON.stringify(body),
  })

  const data = await response.json()

  if (!response.ok) {
    // Surface Razorpay's real error so failures aren't silent.
    console.error('Razorpay subscription error:', JSON.stringify(data))
    throw new Error(data?.error?.description || 'Razorpay subscription creation failed')
  }

  return {
    subscriptionId: data.id,
    shortUrl: data.short_url,
    status: data.status,
    planKey: sub,
    entitlement,
  }
}

/** Convenience for building a WhatsApp message with the subscription link. */
export function formatSubscriptionMessage(options: {
  planName: string
  shortUrl: string
  amountLine: string
  trialDays: number
}) {
  const trialLine =
    options.trialDays > 0
      ? `First ${options.trialDays} days free — you won't be charged until then.`
      : ''
  return [
    `Your ${options.planName} subscription is ready.`,
    '',
    options.amountLine,
    trialLine,
    '',
    `Set it up here (one-time authorization): ${options.shortUrl}`,
    '',
    'After you authorize, your AskGogo access unlocks automatically and renews each cycle. Cancel anytime.',
    '',
    '- AskGogo',
  ]
    .filter(Boolean)
    .join('\n')
}
