import { getPlan, type AskGogoPlanKey } from './razorpay'

// Public recurring plans. Legacy Starter/annual plans are no longer sold.
export type SubscriptionPlanKey = 'lite' | 'pro' | 'power'

const TOTAL_COUNT: Record<SubscriptionPlanKey, number> = {
  lite: 120,
  pro: 120,
  power: 120,
}

const EXPECTED_AMOUNT_PAISE: Record<SubscriptionPlanKey, number> = {
  lite: 9900,
  pro: 29900,
  power: 49900,
}

function normalizeSubKey(planKey?: string | null): SubscriptionPlanKey {
  const clean = String(planKey || 'pro').toLowerCase().trim().replace(/[\s-]+/g, '_')
  if (clean === 'lite') return 'lite'
  if (clean === 'power' || clean === 'founder' || clean === 'founder_pro') return 'power'
  return 'pro'
}

// Power uses the existing founder entitlement key internally so no user migration is required.
export function entitlementKeyFor(planKey?: string | null): AskGogoPlanKey {
  const sub = normalizeSubKey(planKey)
  return sub === 'power' ? 'founder' : sub
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
  if (sub === 'lite') return [process.env.RAZORPAY_PLAN_LITE]
  if (sub === 'pro') return [process.env.RAZORPAY_PLAN_PRO_299, process.env.RAZORPAY_PLAN_PRO]
  return [process.env.RAZORPAY_PLAN_POWER, process.env.RAZORPAY_PLAN_FOUNDER]
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
 * Returns a LIVE Razorpay plan with the exact price we advertise.
 * Old configured plan ids are validated before use, so an old ₹199 Pro plan can
 * never accidentally charge a customer after the public price moved to ₹299.
 * If configuration is stale, reuse an exact existing plan or create one once.
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
      const key = String(plan?.notes?.askgogo_plan || '').toLowerCase()
      const name = String(plan?.item?.name || '').toLowerCase()
      return key === sub || name === `askgogo ${sub}` || (sub === 'power' && name === 'askgogo power')
    })
    if (existing?.id) return existing.id
  }

  const publicPlan = getPlan(sub)
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
        name: `AskGogo ${sub === 'power' ? 'Power' : sub[0].toUpperCase() + sub.slice(1)}`,
        amount: EXPECTED_AMOUNT_PAISE[sub],
        currency: 'INR',
        description: publicPlan.description,
      },
      notes: {
        source: 'askgogo',
        askgogo_plan: sub,
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
    plan: entitlement,
    sub_plan: sub,
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
    'After you authorize, your AskGogo access unlocks automatically and renews each cycle. Cancel anytime.',
    '',
    '- AskGogo',
  ].filter(Boolean).join('\n')
}
