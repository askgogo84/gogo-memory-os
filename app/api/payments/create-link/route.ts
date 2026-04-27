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
  try {
    const body = (await req.json()) as CreatePaymentBody
    const plan = getPlan(body.plan || 'pro')
    const phone = body.phone || body.whatsappId || ''

    if (!phone && !body.telegramId && !body.userId) {
      return NextResponse.json(
        { success: false, error: 'phone, whatsappId, telegramId or userId is required' },
        { status: 400 },
      )
    }

    const paymentUrl = await createPaymentLink({
      plan: plan.key,
      customerName: body.name || 'AskGogo User',
      customerPhone: phone,
      customerEmail: body.email,
      whatsappId: body.whatsappId || body.phone,
      telegramId: body.telegramId,
      userId: body.userId,
    })

    if (!paymentUrl) {
      return NextResponse.json(
        { success: false, error: 'Could not create payment link' },
        { status: 500 },
      )
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
    const message = err instanceof Error ? err.message : 'Failed to create payment link'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
