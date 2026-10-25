import { NextRequest, NextResponse } from 'next/server'
import { createSubscription } from '@/lib/services/razorpay-subscriptions'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

type PublicPlan = 'essential' | 'plus' | 'pro'

function sameOrigin(req: NextRequest) {
  const origin = req.headers.get('origin')
  if (!origin) return false
  try {
    return new URL(origin).host === req.nextUrl.host
  } catch {
    return false
  }
}

function normalizePlan(value: unknown): PublicPlan | null {
  const plan = String(value || '').toLowerCase().trim().replace(/[\s-]+/g, '_')
  if (plan === 'essential' || plan === 'lite') return 'essential'
  if (plan === 'plus' || plan === 'gogo_plus') return 'plus'
  if (plan === 'pro' || plan === 'gogo_pro' || plan === 'power' || plan === 'founder' || plan === 'founder_pro') return 'pro'
  return null
}

function normalizePhone(value: unknown) {
  const digits = String(value || '').replace(/\D/g, '')
  if (digits.length === 10) return `91${digits}`
  if (digits.length === 12 && digits.startsWith('91')) return digits
  return null
}

/** An unverified public phone is a lookup key, never proof of an account owner. */
function exactWhatsAppForms(internationalDigits: string): string[] {
  return [
    `+${internationalDigits}`,
    `whatsapp:+${internationalDigits}`,
    internationalDigits,
    `whatsapp:${internationalDigits}`,
  ]
}

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) {
    return NextResponse.json({ success: false, error: 'forbidden' }, { status: 403 })
  }

  try {
    const body = await req.json().catch(() => null) as any
    const plan = normalizePlan(body?.plan)
    const phoneDigits = normalizePhone(body?.phone || body?.whatsappId)

    if (!plan) {
      return NextResponse.json({ success: false, error: 'invalid_plan' }, { status: 400 })
    }
    if (!phoneDigits) {
      return NextResponse.json({ success: false, error: 'invalid_phone' }, { status: 400 })
    }

    // The public form supplies no verified session/WhatsApp ownership. Match only
    // complete saved international numbers to avoid blocking another-country users,
    // and NEVER attach any selected users row to the resulting provider subscription.
    const { data: users, error: lookupError } = await supabaseAdmin
      .from('users')
      .select('tier, tier_expires_at, subscription_status')
      .in('whatsapp_id', exactWhatsAppForms(phoneDigits))
      .limit(25)

    // Cannot safely check for an existing paid subscription when the service-role
    // lookup fails or might have been truncated. Fail closed: no new provider link.
    if (lookupError || !Array.isArray(users) || users.length >= 25) {
      console.error('subscription/create: exact plan-status lookup unavailable')
      return NextResponse.json({ success: false, error: 'checkout_unavailable' }, { status: 503 })
    }

    const now = Date.now()
    const active = users.find((user: any) =>
      (user.subscription_status === 'active' || user.subscription_status === 'authenticated') &&
      user.tier && user.tier !== 'free' &&
      (!user.tier_expires_at || new Date(user.tier_expires_at).getTime() > now)
    )
    if (active) {
      return NextResponse.json({ success: false, error: 'already_subscribed' }, { status: 409 })
    }

    // NEVER trust a phone typed into a public form as proof of a persisted owner.
    // A future, separately verified account-link flow can bind the resulting
    // subscription. In particular, do not persist another row's telegram_id/name.
    const whatsappId = `+${phoneDigits}`
    const result = await createSubscription({
      planKey: plan,
      phone: whatsappId,
      whatsappId,
      telegramId: null,
      name: 'AskGogo User',
    })

    const trialDays = Number(process.env.RAZORPAY_TRIAL_DAYS ?? '7')
    return NextResponse.json({
      success: true,
      plan: result.planKey,
      entitlement: result.entitlement,
      subscription_id: result.subscriptionId,
      status: result.status,
      short_url: result.shortUrl,
      trial_days: Number.isFinite(trialDays) && trialDays > 0 ? trialDays : 0,
    })
  } catch (error) {
    console.error('subscription/create failed:', error)
    return NextResponse.json({ success: false, error: 'checkout_unavailable' }, { status: 500 })
  }
}
