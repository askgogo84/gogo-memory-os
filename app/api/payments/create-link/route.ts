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

    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
      return NextResponse.json(
        { success: false, error: 'Missing Razorpay env vars in Vercel: RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET' },
        { status: 500 },
      )
    }

    if (!phone && !body.telegramId && !body.userId) {
      return NextResponse.json(
        { success: false, error: 'phone, whatsappId, telegramId or userId is required' },
        { status: 400 },
      )
    }

    // Call Razorpay directly here to capture the exact error
    const keyId = process.env.RAZORPAY_KEY_ID
    const keySecret = process.env.RAZORPAY_KEY_SECRET
    const authHeader = 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64')

    const cleanPhone = phone.replace(/^whatsapp:/i, '')
    const referenceId = `ag_${plan.key}_${Date.now().toString(36)}`.slice(0, 40)

    const rzpBody = {
      amount: plan.amountInPaise,
      currency: 'INR',
      accept_partial: false,
      description: plan.description,
      reference_id: referenceId,
      customer: { name: body.name || 'AskGogo User', contact: cleanPhone },
      notify: { sms: false, email: false },
      reminder_enable: true,
      notes: { source: 'askgogo_whatsapp', plan: plan.key, plan_name: plan.name },
      expire_by: Math.floor(Date.now() / 1000) + 86400,
    }

    const rzpResponse = await fetch('https://api.razorpay.com/v1/payment_links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      body: JSON.stringify(rzpBody),
    })

    const rzpData = await rzpResponse.json()

    if (!rzpResponse.ok) {
      // Return the ACTUAL Razorpay error
      console.error('Razorpay API error:', JSON.stringify(rzpData))
      return NextResponse.json(
        {
          success: false,
          razorpay_error: rzpData,
          razorpay_status: rzpResponse.status,
          plan: plan.key,
          amount: plan.amountInRupees,
          key_id_prefix: keyId?.slice(0, 12) + '...',
        },
        { status: 500 },
      )
    }

    const paymentUrl = rzpData.short_url || null

    return NextResponse.json({
      success: true,
      plan: plan.key,
      plan_name: plan.name,
      amount: plan.amountInRupees,
      payment_url: paymentUrl,
      whatsapp_message: formatPaymentLinkMessage({
        planName: plan.name,
        amountInRupees: plan.amountInRupees,
        paymentUrl: paymentUrl || '',
      }),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create payment link'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
      }
