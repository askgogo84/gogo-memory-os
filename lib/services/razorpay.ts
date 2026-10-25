import crypto from 'crypto'

// Database entitlement keys are intentionally stable. Public names/prices have
// changed, but existing users/webhook records continue to resolve safely.
export type AskGogoPlanKey = 'lite' | 'starter' | 'pro' | 'founder'

export type AskGogoPlan = {
  key: AskGogoPlanKey
  name: string
  amountInRupees: number
  amountInPaise: number
  description: string
  validityDays: number
  limits: {
    aiActionsPerMonth: number
    activeReminders: number
    voiceNotesPerMonth: number
    webSearchPerMonth?: number
    calendarIntegration?: boolean
    priorityAccess?: boolean
  }
}

export const ASKGOGO_PLANS: Record<AskGogoPlanKey, AskGogoPlan> = {
  // lite is the stable entitlement behind public Gogo Essential.
  lite: {
    key: 'lite',
    name: 'Gogo Essential',
    amountInRupees: 249,
    amountInPaise: 24900,
    description: 'Gogo Essential - let Gogo help with everyday memory, calendar, connected work and light Agent missions',
    validityDays: 30,
    limits: {
      aiActionsPerMonth: 120,
      activeReminders: 20,
      voiceNotesPerMonth: 20,
      webSearchPerMonth: 15,
      calendarIntegration: true,
    },
  },
  // Legacy Starter is retained only for existing historical records.
  starter: {
    key: 'starter',
    name: 'AskGogo Starter (legacy)',
    amountInRupees: 149,
    amountInPaise: 14900,
    description: 'Legacy AskGogo Starter entitlement',
    validityDays: 30,
    limits: {
      aiActionsPerMonth: 100,
      activeReminders: 10,
      voiceNotesPerMonth: 30,
    },
  },
  // pro is the stable entitlement behind public Gogo Plus.
  pro: {
    key: 'pro',
    name: 'Gogo Plus',
    amountInRupees: 499,
    amountInPaise: 49900,
    description: 'Gogo Plus - let Gogo handle multi-step missions, connected apps, background work and travel intelligence',
    validityDays: 30,
    limits: {
      aiActionsPerMonth: 300,
      activeReminders: 75,
      voiceNotesPerMonth: 120,
      webSearchPerMonth: 45,
      calendarIntegration: true,
    },
  },
  // founder is the stable entitlement behind public Gogo Pro.
  founder: {
    key: 'founder',
    name: 'Gogo Pro',
    amountInRupees: 999,
    amountInPaise: 99900,
    description: 'Gogo Pro - highest Agent, background, voice and Secure Computer capacity with priority capabilities',
    validityDays: 30,
    limits: {
      aiActionsPerMonth: 750,
      activeReminders: 250,
      voiceNotesPerMonth: 350,
      webSearchPerMonth: 120,
      calendarIntegration: true,
      priorityAccess: true,
    },
  },
}

export function getPlan(planKey?: string | null): AskGogoPlan {
  const raw = String(planKey || 'pro').toLowerCase().trim().replace(/[\s-]+/g, '_')
  const aliases: Record<string, AskGogoPlanKey> = {
    essential: 'lite',
    lite: 'lite',
    starter: 'starter',
    plus: 'pro',
    gogo_plus: 'pro',
    pro: 'pro', // legacy entitlement key; public Gogo Pro uses gogo_pro/founder
    gogo_pro: 'founder',
    power: 'founder',
    founder: 'founder',
    founder_pro: 'founder',
  }
  return ASKGOGO_PLANS[aliases[raw] || 'pro']
}

function getAuthHeader() {
  const keyId = process.env.RAZORPAY_KEY_ID
  const keySecret = process.env.RAZORPAY_KEY_SECRET

  if (!keyId || !keySecret) {
    throw new Error('Missing RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET')
  }

  return 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64')
}

export function createPaymentReference(options: {
  phone?: string | null
  whatsappId?: string | null
  telegramId?: number | string | null
  userId?: string | null
  plan: string
}) {
  const rawPhone = options.phone || options.whatsappId || ''
  const cleanPhone = rawPhone.replace(/^whatsapp:/i, '').replace(/\D/g, '')
  const userPart = options.userId ? String(options.userId).slice(0, 8) : String(options.telegramId || 'guest').slice(0, 8)
  const timestamp = Date.now().toString(36)
  return `ag_${options.plan}_${userPart}_${cleanPhone.slice(-6)}_${timestamp}`.slice(0, 40)
}

export async function createPaymentLink(options: {
  amount?: number
  description?: string
  customerName?: string
  customerPhone?: string
  customerEmail?: string
  telegramId?: number
  whatsappId?: string
  userId?: string
  plan: string
}): Promise<string | null> {
  try {
    const plan = getPlan(options.plan)
    const amountInPaise = options.amount ? options.amount * 100 : plan.amountInPaise
    const referenceId = createPaymentReference({
      phone: options.customerPhone,
      whatsappId: options.whatsappId,
      telegramId: options.telegramId,
      userId: options.userId,
      plan: plan.key,
    })

    const customer: Record<string, string> = {
      name: options.customerName || 'AskGogo User',
    }

    if (options.customerPhone || options.whatsappId) {
      customer.contact = String(options.customerPhone || options.whatsappId || '').replace(/^whatsapp:/i, '')
    }

    if (options.customerEmail) customer.email = options.customerEmail

    const response = await fetch('https://api.razorpay.com/v1/payment_links', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: getAuthHeader(),
      },
      body: JSON.stringify({
        amount: amountInPaise,
        currency: 'INR',
        accept_partial: false,
        description: options.description || plan.description,
        reference_id: referenceId,
        customer,
        notify: { sms: false, email: false },
        reminder_enable: true,
        notes: {
          source: 'askgogo_whatsapp',
          telegram_id: String(options.telegramId || ''),
          whatsapp_id: options.whatsappId || '',
          user_id: options.userId || '',
          plan: plan.key,
          plan_name: plan.name,
        },
        expire_by: Math.floor(Date.now() / 1000) + 86400,
      }),
    })

    const data = await response.json()

    if (!response.ok) {
      throw new Error(data?.error?.description || 'Razorpay payment link creation failed')
    }

    return data.short_url || null
  } catch (err) {
    console.error('Razorpay link creation failed:', err)
    return null
  }
}

export function verifySignature(paymentLinkId: string, paymentId: string, signature: string): boolean {
  const keySecret = process.env.RAZORPAY_KEY_SECRET
  if (!keySecret) throw new Error('Missing RAZORPAY_KEY_SECRET')

  const payload = `${paymentLinkId}|${paymentId}`
  const expected = crypto.createHmac('sha256', keySecret).update(payload).digest('hex')
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
}

export function verifyWebhookSignature(rawBody: string, signature: string): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET
  if (!secret) throw new Error('Missing RAZORPAY_WEBHOOK_SECRET')
  if (!signature) return false

  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
}

export function formatPaymentLinkMessage(options: {
  planName: string
  amountInRupees: number
  paymentUrl: string
}) {
  return [
    `Your ${options.planName} payment link is ready.`,
    '',
    `Amount: Rs.${options.amountInRupees}/month`,
    `Pay here: ${options.paymentUrl}`,
    '',
    'Once payment is complete, your Gogo access will be updated automatically.',
    '',
    '- AskGogo',
  ].join('\n')
}
