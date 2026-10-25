import { NextRequest, NextResponse } from 'next/server'
import { createPaymentLink, formatPaymentLinkMessage, getPlan } from '@/lib/razorpay'

export const dynamic = 'force-dynamic'

type CreatePaymentBody = {
  phone?: string
  whatsappId?: string
  telegramId?: number
  userId?: string
  name?: string
  email?: string
  plan?: string
}

export async function POST(req: NextRequest) {
  // Kept only for preview compatibility with older QA pages. Production checkout
  // is recurring subscriptions through /api/subscription/create.
  if (process.env.VERCEL_ENV === 'production') {
    return NextResponse.json({ success: false, error: 'not_found' }, { status: 404 })
  }

  try {
    const body = (await req.json()) as CreatePaymentBody
    const plan = getPlan(body.plan || 'pro')
    const phone = body.phone || body.whatsappId || ''

    if (!phone && !body.telegramId && !body.userId) {
      return NextResponse.json({ success: false, error: 'phone, whatsappId, telegramId or userId is required' }, { status: 400 })
    }

    const paymentUrl = await createPaymentLink({
      customerName: body.name || 'AskGogo User',
      customerPhone: phone,
      customerEmail: body.email,
      telegramId: body.telegramId,
      whatsappId: body.whatsappId,
      userId: body.userId,
      plan: plan.key,
    })

    if (!paymentUrl) {
      return NextResponse.json({ success: false, error: 'payment_link_unavailable' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      plan: plan.key,
      plan_name: plan.name,
      amount: plan.amountInRupees,
      payment_url: paymentUrl,
      whatsapp_message: formatPaymentLinkMessage({
        planName: plan.name,
        amountInRupees: plan.amountInRupees,
        paymentUrl,
      }),
    })
  } catch (err) {
    console.error('payments/create-link failed:', err)
    return NextResponse.json({ success: false, error: 'payment_link_unavailable' }, { status: 500 })
  }
}
