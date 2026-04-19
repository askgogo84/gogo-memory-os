import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { verifySignature } from '@/lib/razorpay'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const paymentId = searchParams.get('razorpay_payment_id')
  const paymentLinkId = searchParams.get('razorpay_payment_link_id')
  const signature = searchParams.get('razorpay_signature')

  if (!paymentId || !paymentLinkId || !signature) {
    return NextResponse.redirect('https://bot.askgogo.in/?status=failed')
  }

  // Verify signature
  const isValid = verifySignature(paymentLinkId, paymentId, signature)
  if (!isValid) {
    return NextResponse.redirect('https://bot.askgogo.in/?status=failed')
  }

  // Fetch payment details from Razorpay
  const authHeader = 'Basic ' + Buffer.from(
    `${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`
  ).toString('base64')

  const response = await fetch(`https://api.razorpay.com/v1/payments/${paymentId}`, {
    headers: { 'Authorization': authHeader },
  })
  const payment = await response.json()

  const telegramId = payment.notes?.telegram_id ? parseInt(payment.notes.telegram_id) : null
  const whatsappId = payment.notes?.whatsapp_id || null
  const plan = payment.notes?.plan || 'pro'

  if (!telegramId && !whatsappId) {
    return NextResponse.redirect('https://bot.askgogo.in/?status=failed')
  }

  // Calculate expiry
  const expiresAt = new Date()
  if (plan === 'lifetime') {
    expiresAt.setFullYear(expiresAt.getFullYear() + 99) // lifetime = 99 years
  } else {
    expiresAt.setMonth(expiresAt.getMonth() + 1) // 1 month
  }

  // Upgrade user
  const updateData = {
    tier: plan === 'starter' ? 'starter' : 'pro',
    tier_expires_at: expiresAt.toISOString(),
    is_trial: false,
  }

  if (telegramId) {
    await supabaseAdmin
      .from('users')
      .update(updateData)
      .eq('telegram_id', telegramId)
  } else if (whatsappId) {
    await supabaseAdmin
      .from('users')
      .update(updateData)
      .eq('whatsapp_id', whatsappId)
  }

  // Update payment record
  await supabaseAdmin
    .from('payments')
    .update({ status: 'paid', razorpay_payment_id: paymentId })
    .eq('status', 'pending')
    .or(`telegram_id.eq.${telegramId},whatsapp_id.eq.${whatsappId}`)

  // Send confirmation via Telegram
  if (telegramId) {
    const planName = plan === 'lifetime' ? 'LIFETIME' : plan.toUpperCase()
    await fetch(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: telegramId,
          text:
            `Payment confirmed! You are now on the *${planName}* plan.\n\n` +
            `${plan === 'lifetime' ? 'All features unlocked forever!' : `Valid until ${expiresAt.toLocaleDateString('en-IN')}. Cancel anytime.`}\n\n` +
            `Enjoy unlimited messages, voice notes, lists, and more!`,
          parse_mode: 'Markdown',
        }),
      }
    )
  }

  // Send via WhatsApp if applicable
  if (whatsappId) {
    try {
      const twilio = require('twilio')
      const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
      await client.messages.create({
        body: `Payment confirmed! You are now on the ${plan.toUpperCase()} plan. Enjoy all features!`,
        from: process.env.TWILIO_WHATSAPP_NUMBER,
        to: `whatsapp:${whatsappId}`,
      })
    } catch (err) {
      console.error('WhatsApp confirmation failed:', err)
    }
  }

  return NextResponse.redirect('https://bot.askgogo.in/?status=success')
}