import { getPlan, type AskGogoPlanKey } from './razorpay'

// Public recurring plans. Database entitlements remain legacy-stable via
// entitlementKeyFor(), while Razorpay products use the new public names/prices.
export type SubscriptionPlanKey = 'essential' | 'plus' | 'pro'

const TOTAL_COUNT: Record<SubscriptionPlanKey, number> = {
  essential: 120,
  plus: 120,
  pro: 120,
}

const EXPECTED_AMOUNT_PAISE: Record<SubscriptionPlanKey, number> = {
  essential: 24900,
  plus: 49900,
  pro: 99900,
}

function normalizeSubKey(planKey?: string | null): SubscriptionPlanKey {
  const clean = String(planKey || 'plus').toLowerCase().trim().replace(/[\s-]+/g, '_')
  if (clean === 'essential' || clean === 'lite') return 'essential'
  if (clean === 'pro' || clean === 'gogo_pro' || clean === 'power' || clean === 'founder' || clean === 'founder_pro') return 'pro'
  return 'plus'
}

export function entitlementKeyFor(planKey?: string | null): AskGogoPlanKey {
  const sub = normalizeSubKey(planKey)
  if (sub === 'essential') return 'lite'
  if (sub === 'pro') return 'founder'
  return 'pro'
}

function getAuthHeader() {
  const keyId = process.env.RAZORPAY_KEY_ID
  const keySecret = process.env.RAZORPAY_KEY_SECRET
  if (!keyId || !keySecret) {
    throw new Error('Missing RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET')
  }
  return 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64')
}

function configuredPlanCandidates(sub: SubscriptionPlanKey) {
  if (sub === 'essential') return [process.env.RAZORPAY_PLAN_ESSENTIAL, process.env.RAZORPAY_PLAN_LITE]
  if (sub === 'plus') return [process.env.RAZORPAY_PLAN_PLUS]
  return [process.env.RAZORPAY_PLAN_GOGO_PRO, process.env.RAZORPAY_PLAN_POWER, process.env.RAZORPAY_PLAN_FOUNDER]
}

function isExactPlan(plan: any, sub: SubscriptionPlanKey) {
  return Boolean(
    plan?.id &&
    plan?.period === 'monthly' &&
    Number(plan?.interval) === 1 &&
    String(plan?.item?.currency || '').toUpperCase() === 'INR' &&
    Number(plan?.item?.amount ?? plan?.item?.unit_amount) === EXPECTED_AMOUNT_PAISE[sub]
  )
}

async function fetchRazorpayPlan(planId: string) {
  const response = await fetch(`https://api.razorpay.com/v1/plans/${encodeURIComponent(planId)}`, {
    headers: { Authorization: getAuthHeader() },
    cache: 'no-store',
  })
  if (!response.ok) return null
  return response.json()
}

/**
 * Returns a LIVE Razorpay plan with the exact public price. Stale configured IDs
 * are validated before use; when no exact plan exists, Razorpay is asked to create
 * the canonical plan once. This makes the code migration itself update Razorpay
 * safely on the first real checkout without editing old customer mandates.
 */
export async function ensureRazorpayPlanId(planKey?: string | null): Promise<string> {
  const sub = normalizeSubKey(planKey)

  for (const candidate of configuredPlanCandidates(sub)) {
    if (!candidate) continue
    const plan = await fetchRazorpayPlan(candidate)
    if (isExactPlan(plan, sub)) return plan.id
  }

  const listResponse = await fetch('https://api.razorpay.com/v1/plans?count=100', {
    headers: { Authorization: getAuthHeader() },
    cache: 'no-store',
  })

  if (listResponse.ok) {
    const collection = await listResponse.json()
    const existing = (collection?.items || []).find((plan: any) => {
      if (!isExactPlan(plan, sub)) return false
      const key = String(plan?.notes?.askgogo_public_plan || plan?.notes?.askgogo_plan || '').toLowerCase()
      const name = String(plan?.item?.name || '').toLowerCase()
      return key === sub || name === `gogo ${sub}` || name === `askgogo ${sub}`
    })
    if (existing?.id) return existing.id
  }

  const entitlement = entitlementKeyFor(sub)
  const publicPlan = getPlan(entitlement)
  const createResponse = await fetch('https://api.razorpay.com/v1/plans', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: getAuthHeader(),
    },
    body: JSON.stringify({
      period: 'monthly',
      interval: 1,
      item: {
        name: `Gogo ${sub[0].toUpperCase() + sub.slice(1)}`,
        amount: EXPECTED_AMOUNT_PAISE[sub],
        currency: 'INR',
        description: publicPlan.description,
      },
      notes: {
        source: 'askgogo',
        product: 'askgogo',
        askgogo_public_plan: sub,
        entitlement,
        canonical_price_inr: String(EXPECTED_AMOUNT_PAISE[sub] / 100),
      },
    }),
  })

  const created = await createResponse.json()
  if (!createResponse.ok || !isExactPlan(created, sub)) {
    console.error('Razorpay plan ensure failed:', JSON.stringify(created))
    throw new Error(created?.error?.description || `Could not create exact Razorpay ${sub} plan`)
  }
  return created.id
}

export type CreateSubscriptionResult = {
  subscriptionId: string
  shortUrl: string
  status: string
  planKey: SubscriptionPlanKey
  entitlement: AskGogoPlanKey
}

export async function createSubscription(options: {
  planKey: string
  phone?: string | null
  whatsappId?: string | null
  telegramId?: number | string | null
  userId?: string | null
  name?: string | null
}): Promise<CreateSubscriptionResult> {
  const sub = normalizeSubKey(options.planKey)
  const planId = await ensureRazorpayPlanId(sub)
  const entitlement = entitlementKeyFor(sub)

  const trialDays = Number(process.env.RAZORPAY_TRIAL_DAYS ?? '7')
  const nowSec = Math.floor(Date.now() / 1000)
  const startAt = Number.isFinite(trialDays) && trialDays > 0 ? nowSec + trialDays * 86400 : undefined

  const rawPhone = String(options.phone || options.whatsappId || '')
    .replace(/^whatsapp:/i, '')
    .replace(/\D/g, '')

  const notes: Record<string, string> = {
    source: 'askgogo_whatsapp',
    product: 'askgogo',
    plan: entitlement,
    public_plan: sub,
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
    'After you authorize, your Gogo access unlocks automatically and renews each cycle. Cancel anytime.',
    '',
    '- AskGogo',
  ].filter(Boolean).join('\n')
}
