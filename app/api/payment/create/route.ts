import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { createPaymentLink } from '@/lib/razorpay'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  // Retired one-time checkout. Production uses /api/subscription/create so
  // Lite, Pro and Power all receive the same recurring + trial semantics.
  if (process.env.VERCEL_ENV === 'production') {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })
  }

  try {
    const { telegramId, whatsappId, plan } = await req.json()
    const plans: Record<string, { amount: number; name: string }> = {
      lite: { amount: 99, name: 'AskGogo Lite' },
      pro: { amount: 299, name: 'AskGogo Pro' },
      power: { amount: 499, name: 'AskGogo Power' },
    }

    const selected = plans[plan]
    if (!selected) return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })

    let userName = 'AskGogo User'
    if (telegramId) {
      const { data } = await supabaseAdmin.from('users').select('name').eq('telegram_id', telegramId).single()
      if (data?.name) userName = data.name
    }

    const url = await createPaymentLink({
      amount: selected.amount,
      description: selected.name,
      customerName: userName,
      telegramId,
      whatsappId,
      plan,
    })

    if (!url) return NextResponse.json({ error: 'Payment link creation failed' }, { status: 500 })

    await supabaseAdmin.from('payments').insert({
      telegram_id: telegramId || null,
      whatsapp_id: whatsappId || null,
      plan_id: plan,
      amount_inr: selected.amount,
      status: 'pending',
    })

    return NextResponse.json({ url })
  } catch (error) {
    console.error('Payment create error:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
