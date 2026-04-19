import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { createPaymentLink } from '@/lib/razorpay'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const { telegramId, whatsappId, plan } = await req.json()

    const plans: Record<string, { amount: number; name: string }> = {
      starter: { amount: 149, name: 'AskGogo Starter' },
      pro: { amount: 299, name: 'AskGogo Pro' },
      lifetime: { amount: 9999, name: 'AskGogo Lifetime' },
    }

    const selected = plans[plan]
    if (!selected) {
      return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })
    }

    // Get user name
    let userName = 'AskGogo User'
    if (telegramId) {
      const { data } = await supabaseAdmin
        .from('users')
        .select('name')
        .eq('telegram_id', telegramId)
        .single()
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

    if (!url) {
      return NextResponse.json({ error: 'Payment link creation failed' }, { status: 500 })
    }

    // Log pending payment
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