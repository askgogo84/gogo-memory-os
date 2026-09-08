import { NextRequest, NextResponse } from 'next/server'
import { createSubscription } from '@/lib/services/razorpay-subscriptions'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

type PublicPlan = 'lite' | 'pro' | 'power'

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
  if (plan === 'lite') return 'lite'
  if (plan === 'pro') return 'pro'
  if (plan === 'power' || plan === 'founder' || plan === 'founder_pro') return 'power'
  return null
}

function normalizePhone(value: unknown) {
  const digits = String(value || '').replace(/\D/g, '')
  if (digits.length === 10) return `91${digits}`
  if (digits.length === 12 && digits.startsWith('91')) return digits
  return null
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

    const last10 = phoneDigits.slice(-10)
    const { data: users } = await supabaseAdmin
      .from('users')
      .select('telegram_id, whatsapp_id, name, tier, tier_expires_at, subscription_status')
      .ilike('whatsapp_id', `%${last10}%`)
      .limit(3)

    const now = Date.now()
    const active = (users || []).find((user: any) =>
      (user.subscription_status === 'active' || user.subscription_status === 'authenticated') &&
      user.tier && user.tier !== 'free' &&
      (!user.tier_expires_at || new Date(user.tier_expires_at).getTime() > now)
    )

    if (active) {
      return NextResponse.json({ success: false, error: 'already_subscribed' }, { status: 409 })
    }

    const user = (users || [])[0] as any
    const whatsappId = `+${phoneDigits}`
    const result = await createSubscription({
      planKey: plan,
      phone: whatsappId,
      whatsappId: user?.whatsapp_id || whatsappId,
      telegramId: user?.telegram_id || null,
      name: user?.name || 'AskGogo User',
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
