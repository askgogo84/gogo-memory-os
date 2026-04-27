import { NextRequest, NextResponse } from 'next/server'
import { verifyWebhookSignature, getPlan } from '@/lib/razorpay'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const signature = req.headers.get('x-razorpay-signature') || ''

  try {
    const isValid = verifyWebhookSignature(rawBody, signature)

    if (!isValid) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
    }

    const body = JSON.parse(rawBody)

    if (body.event !== 'payment_link.paid') {
      return NextResponse.json({ ok: true })
    }

    const entity = body.payload?.payment_link?.entity

    if (!entity) {
      return NextResponse.json({ ok: true })
    }

    const notes = entity.notes || {}
    const phone = entity.customer?.contact || notes.whatsapp_id || null
    const planKey = notes.plan || 'pro'
    const plan = getPlan(planKey)

    if (!phone) {
      return NextResponse.json({ ok: true })
    }

    const now = new Date()
    const expiry = new Date(now.getTime() + plan.validityDays * 24 * 60 * 60 * 1000)

    await supabase
      .from('users')
      .update({
        plan: plan.key,
        plan_name: plan.name,
        plan_active: true,
        plan_started_at: now.toISOString(),
        plan_expires_at: expiry.toISOString(),
      })
      .or(`phone.eq.${phone},whatsapp_id.eq.${phone}`)

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Webhook error:', err)
    return NextResponse.json({ error: 'Webhook failed' }, { status: 500 })
  }
}
