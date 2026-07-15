import { NextRequest, NextResponse } from 'next/server'
import { createSubscription } from '@/lib/services/razorpay-subscriptions'

export const dynamic = 'force-dynamic'

type CreateSubscriptionBody = {
  plan?: string // 'lite' | 'starter' | 'pro' | 'pro_annual'
  phone?: string
  whatsappId?: string
  telegramId?: number
  userId?: string
  name?: string
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as CreateSubscriptionBody

    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
      return NextResponse.json(
        { success: false, error: 'Missing RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET in Vercel' },
        { status: 500 },
      )
    }

    const phone = body.phone || body.whatsappId || null
    if (!phone && !body.telegramId && !body.userId) {
      return NextResponse.json(
        { success: false, error: 'phone, whatsappId, telegramId or userId is required' },
        { status: 400 },
      )
    }

    const result = await createSubscription({
      planKey: body.plan || 'pro',
      phone,
      whatsappId: body.whatsappId,
      telegramId: body.telegramId,
      userId: body.userId,
      name: body.name,
    })

    return NextResponse.json({
      success: true,
      subscription_id: result.subscriptionId,
      status: result.status,
      plan: result.planKey,
      entitlement: result.entitlement,
      short_url: result.shortUrl,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create subscription'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
