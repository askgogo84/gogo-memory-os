import { NextRequest, NextResponse } from 'next/server'
import { verifyWebhookSignature, getPlan } from '@/lib/razorpay'
import { createClient } from '@supabase/supabase-js'
import { sendWhatsApp } from '@/lib/whatsapp'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

async function activateUserPlan(params: {
  phone: string | null
  telegramId?: string | null
  whatsappId?: string | null
  userId?: string | null
  planKey: string
  paymentId?: string
  paymentLinkId?: string
  rawPayload?: unknown
}) {
  const plan = getPlan(params.planKey)
  const now = new Date()
  const expiry = new Date(now.getTime() + plan.validityDays * 24 * 60 * 60 * 1000)

  const orClauses: string[] = []
  if (params.phone) orClauses.push(`phone.eq.${params.phone}`, `whatsapp_id.eq.${params.phone}`)
  if (params.whatsappId && params.whatsappId !== params.phone) {
    orClauses.push(`whatsapp_id.eq.${params.whatsappId}`)
  }
  if (params.telegramId) orClauses.push(`telegram_id.eq.${params.telegramId}`)
  if (params.userId) orClauses.push(`id.eq.${params.userId}`)

  if (orClauses.length > 0) {
    await supabase
      .from('users')
      .update({
        plan: plan.key,
        plan_name: plan.name,
        plan_active: true,
        plan_started_at: now.toISOString(),
        plan_expires_at: expiry.toISOString(),
      })
      .or(orClauses.join(','))
  }

  await supabase.from('payment_records').upsert({
    whatsapp_id: params.phone || params.whatsappId || null,
    telegram_id: params.telegramId ? Number(params.telegramId) : null,
    plan: plan.key,
    amount: plan.amountInPaise,
    currency: 'INR',
    status: 'paid',
    razorpay_payment_link_id: params.paymentLinkId || null,
    razorpay_payment_id: params.paymentId || null,
    raw_payload: params.rawPayload as any || null,
    paid_at: now.toISOString(),
    updated_at: now.toISOString(),
  }, { onConflict: 'razorpay_payment_link_id', ignoreDuplicates: false })

  return { plan, expiry }
}

function buildConfirmationMessage(plan: ReturnType<typeof getPlan>, name?: string): string {
  const greeting = name && name !== 'AskGogo User' ? `Hey ${name.split(' ')[0]}! ` : 'Hey! '
  const featuresByPlan: Record<string, string> = {
    lite: '• 60 AI actions/month\n• 5 active reminders\n• 10 voice notes/month\n• Weather & sports updates',
    starter: '• 100 AI actions/month\n• 10 active reminders\n• 30 voice notes/month\n• Basic memory',
    pro: '• 250 AI actions/month\n• 50 active reminders\n• Calendar integration\n• Daily briefing & planning\n• 100 voice notes/month\n• Web search: 30/month',
    founder: '• 600 AI actions/month\n• 200 active reminders\n• All Pro features + priority access\n• 300 voice notes/month\n• Web search: 100/month',
  }
  const features = featuresByPlan[plan.key] || featuresByPlan.pro
  return `✅ *Payment confirmed!*

${greeting}You're now on *${plan.name}* (₹${plan.amountInRupees}/month). 🎉

*What's unlocked:*
${features}

Your plan is active right now — just keep chatting here as usual.

Type *menu* to see everything I can do, or just ask me anything! 🧘`
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const signature = req.headers.get('x-razorpay-signature') || ''

  try {
    const isValid = verifyWebhookSignature(rawBody, signature)
    if (!isValid) {
      console.error('Webhook: invalid signature')
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
    }
  } catch (err) {
    console.error('Webhook: signature check error:', err)
    return NextResponse.json({ error: 'Signature check failed' }, { status: 400 })
  }

  let body: any
  try { body = JSON.parse(rawBody) } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const event: string = body.event || ''
  console.log('Webhook event:', event)

  try {
    if (event === 'payment_link.paid') {
      const entity = body.payload?.payment_link?.entity
      const paymentEntity = body.payload?.payment?.entity
      if (!entity) return NextResponse.json({ ok: true })

      const notes = entity.notes || {}
      const phone = entity.customer?.contact || notes.whatsapp_id || notes.phone || null
      const planKey = notes.plan || 'pro'
      const name = entity.customer?.name || notes.name || 'AskGogo User'

      const { plan } = await activateUserPlan({
        phone,
        whatsappId: notes.whatsapp_id || phone,
        telegramId: notes.telegram_id || null,
        userId: notes.user_id || null,
        planKey,
        paymentId: paymentEntity?.id,
        paymentLinkId: entity.id,
        rawPayload: body.payload,
      })

      if (phone) {
        const waPhone = phone.startsWith('+') ? phone : `+${phone.replace(/\D/g, '')}`
        try { await sendWhatsApp(waPhone, buildConfirmationMessage(plan, name)) }
        catch (waErr) { console.error('Webhook: WhatsApp confirmation failed:', waErr) }
      }

      return NextResponse.json({ ok: true, event, plan: planKey })
    }

    if (event === 'payment.captured') {
      const payment = body.payload?.payment?.entity
      if (!payment) return NextResponse.json({ ok: true })

      const notes = payment.notes || {}
      const phone = payment.contact || notes.whatsapp_id || notes.phone || null
      const planKey = notes.plan || 'pro'
      const name = notes.name || 'AskGogo User'

      if (phone || notes.telegram_id || notes.user_id) {
        const { plan } = await activateUserPlan({
          phone, whatsappId: notes.whatsapp_id || phone,
          telegramId: notes.telegram_id || null, userId: notes.user_id || null,
          planKey, paymentId: payment.id, rawPayload: body.payload,
        })
        if (phone) {
          const waPhone = phone.startsWith('+') ? phone : `+${phone.replace(/\D/g, '')}`
          try { await sendWhatsApp(waPhone, buildConfirmationMessage(plan, name)) }
          catch (waErr) { console.error('Webhook payment.captured: WA failed:', waErr) }
        }
      }
      return NextResponse.json({ ok: true, event })
    }

    if (event === 'payment.failed') {
      const payment = body.payload?.payment?.entity
      const notes = payment?.notes || {}
      const phone = payment?.contact || notes.whatsapp_id || null
      console.warn('Webhook payment.failed:', { id: payment?.id, phone, reason: payment?.error_description })

      if (phone) {
        const waPhone = phone.startsWith('+') ? phone : `+${phone.replace(/\D/g, '')}`
        try {
          await sendWhatsApp(waPhone,
            `⚠️ Your payment didn't go through.\n\nPlease try again — type *upgrade* and I'll send you a fresh payment link. If the issue persists, just reply here and we'll sort it out. 🙏`
          )
        } catch (waErr) { console.error('Webhook payment.failed: WA failed:', waErr) }
      }
      return NextResponse.json({ ok: true, event })
    }

    return NextResponse.json({ ok: true, event, ignored: true })
  } catch (err) {
    console.error('Webhook processing error:', err)
    return NextResponse.json({ ok: true, error: String(err) })
  }
    }
