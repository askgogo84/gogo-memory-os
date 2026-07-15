import { NextRequest, NextResponse } from 'next/server'
import { verifyWebhookSignature, getPlan } from '@/lib/razorpay'
import { createClient } from '@supabase/supabase-js'
import { sendWhatsApp } from '@/lib/whatsapp'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// The bot's limit gate (lib/data/limits.ts) reads `tier` + `tier_expires_at`.
// `tier` must be one of: free | lite | starter | pro | founder_pro.
function tierFromEntitlement(planKey?: string | null): string {
  const k = String(planKey || 'pro').toLowerCase().replace(/[\s-]+/g, '_')
  if (k === 'founder' || k === 'founder_pro') return 'founder_pro'
  if (k === 'lite' || k === 'starter' || k === 'pro') return k
  return 'pro'
}

// Tolerant matching: phone digits (ignores +, spaces, "whatsapp:"), telegram_id,
// user id, or the subscription id. Handles the "whatsapp:+91..." vs "+91..." rows.
function buildMatchClauses(p: {
  phone?: string | null
  whatsappId?: string | null
  telegramId?: string | number | null
  userId?: string | null
  subscriptionId?: string | null
}): string[] {
  const clauses: string[] = []
  const digits = String(p.phone || p.whatsappId || '').replace(/\D/g, '')
  const last10 = digits.slice(-10)
  if (last10.length === 10) {
    clauses.push(`phone.ilike.*${last10}*`, `whatsapp_id.ilike.*${last10}*`)
  }
  const tg = p.telegramId != null ? String(p.telegramId).replace(/[^\d-]/g, '') : ''
  if (tg && tg !== '0') clauses.push(`telegram_id.eq.${tg}`)
  if (p.userId) clauses.push(`id.eq.${p.userId}`)
  if (p.subscriptionId) clauses.push(`razorpay_subscription_id.eq.${p.subscriptionId}`)
  return clauses
}

// One-time payment-link activation (existing flow, now also sets tier).
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
  const tier = tierFromEntitlement(params.planKey)
  const now = new Date()
  const expiry = new Date(now.getTime() + plan.validityDays * 24 * 60 * 60 * 1000)

  const orClauses = buildMatchClauses({
    phone: params.phone,
    whatsappId: params.whatsappId,
    telegramId: params.telegramId,
    userId: params.userId,
  })

  if (orClauses.length > 0) {
    await supabase
      .from('users')
      .update({
        tier,
        tier_expires_at: expiry.toISOString(),
        plan: plan.key,
        plan_name: plan.name,
        plan_active: true,
        plan_status: 'active',
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
    raw_payload: (params.rawPayload as any) || null,
    paid_at: now.toISOString(),
    updated_at: now.toISOString(),
  }, { onConflict: 'razorpay_payment_link_id', ignoreDuplicates: false })

  return { plan, expiry }
}

// Subscription activation: writes tier + tier_expires_at (what the gate reads).
async function activateSubscription(entity: any, rawPayload: unknown) {
  const notes = entity?.notes || {}
  const plan = getPlan(notes.plan || 'pro') // entitlement tier: lite / starter / pro
  const tier = tierFromEntitlement(notes.plan || 'pro')
  const now = new Date()
  // Use Razorpay's own period end; fall back to +validityDays. This also keeps
  // tier_expires_at in the future so the gate's auto-downgrade won't fire.
  const expiry = entity?.current_end
    ? new Date(entity.current_end * 1000)
    : new Date(now.getTime() + plan.validityDays * 24 * 60 * 60 * 1000)

  const orClauses = buildMatchClauses({
    phone: notes.whatsapp_id || notes.phone,
    whatsappId: notes.whatsapp_id,
    telegramId: notes.telegram_id,
    userId: notes.user_id,
    subscriptionId: entity.id,
  })

  if (orClauses.length > 0) {
    await supabase
      .from('users')
      .update({
        tier,
        tier_expires_at: expiry.toISOString(),
        plan: plan.key,
        plan_name: plan.name,
        plan_active: true,
        plan_status: 'active',
        plan_started_at: now.toISOString(),
        plan_expires_at: expiry.toISOString(),
        razorpay_subscription_id: entity.id,
        subscription_id: entity.id,
        subscription_status: entity.status,
      })
      .or(orClauses.join(','))
  }

  await supabase.from('payment_records').insert({
    whatsapp_id: notes.whatsapp_id || null,
    telegram_id: notes.telegram_id ? Number(notes.telegram_id) : null,
    plan: plan.key,
    amount: plan.amountInPaise,
    currency: 'INR',
    status: 'paid',
    razorpay_subscription_id: entity.id,
    subscription_status: entity.status,
    raw_payload: (rawPayload as any) || null,
    paid_at: now.toISOString(),
    updated_at: now.toISOString(),
  })

  const phone = notes.whatsapp_id || notes.phone || null
  return { plan, phone }
}

async function updateSubscriptionStatus(entity: any, opts: { revokeNow: boolean }) {
  const notes = entity?.notes || {}
  const orClauses = buildMatchClauses({
    phone: notes.whatsapp_id || notes.phone,
    whatsappId: notes.whatsapp_id,
    telegramId: notes.telegram_id,
    userId: notes.user_id,
    subscriptionId: entity.id,
  })
  if (orClauses.length === 0) return

  const update: Record<string, any> = { subscription_status: entity.status }
  if (opts.revokeNow) {
    // Payments permanently failed (halted): downgrade to free immediately.
    update.tier = 'free'
    update.tier_expires_at = new Date().toISOString()
    update.plan = 'free'
    update.plan_active = false
    update.plan_status = 'inactive'
  } else {
    update.plan_status = entity.status
  }
  // On plain cancellation we leave tier + tier_expires_at intact — the user keeps
  // access until the paid period ends, then the gate downgrades them automatically.
  await supabase.from('users').update(update).or(orClauses.join(','))
}

function buildConfirmationMessage(plan: ReturnType<typeof getPlan>, name?: string): string {
  const greeting = name && name !== 'AskGogo User' ? `Hey ${name.split(' ')[0]}! ` : 'Hey! '
  const featuresByPlan: Record<string, string> = {
    lite: '\u2022 60 AI actions/month\n\u2022 5 active reminders\n\u2022 10 voice notes/month\n\u2022 Weather & sports updates',
    starter: '\u2022 100 AI actions/month\n\u2022 10 active reminders\n\u2022 30 voice notes/month\n\u2022 Basic memory',
    pro: '\u2022 250 AI actions/month\n\u2022 50 active reminders\n\u2022 Calendar integration\n\u2022 Daily briefing & planning\n\u2022 100 voice notes/month\n\u2022 Web search: 30/month',
    founder: '\u2022 600 AI actions/month\n\u2022 200 active reminders\n\u2022 All Pro features + priority access\n\u2022 300 voice notes/month\n\u2022 Web search: 100/month',
  }
  const features = featuresByPlan[plan.key] || featuresByPlan.pro
  return `\u2705 *Payment confirmed!*

${greeting}You're now on *${plan.name}* (\u20b9${plan.amountInRupees}/month). \ud83c\udf89

*What's unlocked:*
${features}

Your plan is active right now \u2014 just keep chatting here as usual.

Type *menu* to see everything I can do, or just ask me anything! \ud83e\uddd8`
}

async function notifyWhatsApp(phone: string | null, message: string, tag: string) {
  if (!phone) return
  const waPhone = phone.startsWith('+') ? phone : `+${phone.replace(/\D/g, '')}`
  try {
    await sendWhatsApp(waPhone, message)
  } catch (waErr) {
    console.error(`Webhook ${tag}: WhatsApp send failed:`, waErr)
  }
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
  try {
    body = JSON.parse(rawBody)
  } catch {
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

      await notifyWhatsApp(phone, buildConfirmationMessage(plan, name), 'payment_link.paid')
      return NextResponse.json({ ok: true, event, plan: planKey })
    }

    if (event === 'subscription.activated' || event === 'subscription.authenticated') {
      const entity = body.payload?.subscription?.entity
      if (!entity) return NextResponse.json({ ok: true })
      const { plan, phone } = await activateSubscription(entity, body.payload)
      await notifyWhatsApp(phone, buildConfirmationMessage(plan), 'subscription.activated')
      return NextResponse.json({ ok: true, event, plan: plan.key })
    }

    if (event === 'subscription.charged') {
      const entity = body.payload?.subscription?.entity
      if (!entity) return NextResponse.json({ ok: true })
      const { plan } = await activateSubscription(entity, body.payload)
      return NextResponse.json({ ok: true, event, plan: plan.key })
    }

    if (event === 'subscription.cancelled' || event === 'subscription.completed') {
      const entity = body.payload?.subscription?.entity
      if (entity) await updateSubscriptionStatus(entity, { revokeNow: false })
      return NextResponse.json({ ok: true, event })
    }

    if (event === 'subscription.halted') {
      const entity = body.payload?.subscription?.entity
      if (entity) {
        await updateSubscriptionStatus(entity, { revokeNow: true })
        const phone = entity?.notes?.whatsapp_id || null
        await notifyWhatsApp(
          phone,
          `\u26a0\ufe0f We couldn't renew your AskGogo subscription after a few tries, so it's paused.\n\nReply *upgrade* to set it up again. \ud83d\ude4f`,
          'subscription.halted',
        )
      }
      return NextResponse.json({ ok: true, event })
    }

    if (event === 'subscription.pending') {
      const entity = body.payload?.subscription?.entity
      if (entity) await updateSubscriptionStatus(entity, { revokeNow: false })
      return NextResponse.json({ ok: true, event })
    }

    if (event === 'payment.captured') {
      const payment = body.payload?.payment?.entity
      if (!payment) return NextResponse.json({ ok: true })

      const notes = payment.notes || {}
      const phone = payment.contact || notes.whatsapp_id || notes.phone || null
      const planKey = notes.plan || 'pro'
      const name = notes.name || 'AskGogo User'

      // Skip subscription-driven payments here - handled by subscription.charged.
      if ((phone || notes.telegram_id || notes.user_id) && !payment.invoice_id) {
        const { plan } = await activateUserPlan({
          phone,
          whatsappId: notes.whatsapp_id || phone,
          telegramId: notes.telegram_id || null,
          userId: notes.user_id || null,
          planKey,
          paymentId: payment.id,
          rawPayload: body.payload,
        })
        await notifyWhatsApp(phone, buildConfirmationMessage(plan, name), 'payment.captured')
      }
      return NextResponse.json({ ok: true, event })
    }

    if (event === 'payment.failed') {
      const payment = body.payload?.payment?.entity
      const notes = payment?.notes || {}
      const phone = payment?.contact || notes.whatsapp_id || null
      console.warn('Webhook payment.failed:', { id: payment?.id, phone, reason: payment?.error_description })

      await notifyWhatsApp(
        phone,
        `\u26a0\ufe0f Your payment didn't go through.\n\nPlease try again - type *upgrade* and I'll send you a fresh link. If the issue persists, just reply here and we'll sort it out. \ud83d\ude4f`,
        'payment.failed',
      )
      return NextResponse.json({ ok: true, event })
    }

    return NextResponse.json({ ok: true, event, ignored: true })
  } catch (err) {
    console.error('Webhook processing error:', err)
    return NextResponse.json({ ok: true, error: String(err) })
  }
}
