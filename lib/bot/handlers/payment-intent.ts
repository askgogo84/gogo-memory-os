import { supabaseAdmin } from '@/lib/supabase-admin'

type PlanKey = 'starter' | 'pro' | 'founder_pro' | 'unknown'

const PLANS: Record<Exclude<PlanKey, 'unknown'>, { label: string; price: string; actions: string }> = {
  starter: { label: 'Starter', price: '₹149/month', actions: '100 AI actions/month' },
  pro: { label: 'Pro', price: '₹299/month', actions: '250 AI actions/month' },
  founder_pro: { label: 'Founder Pro', price: '₹499/month', actions: '600 AI actions/month' },
}

function firstName(name?: string) {
  const clean = (name || '').trim()
  if (!clean || clean.toLowerCase() === 'friend') return 'there'
  return clean.split(' ')[0]
}

function detectPlan(text: string): PlanKey {
  const lower = (text || '').toLowerCase()

  if (lower.includes('founder pro') || lower.includes('founder plan') || lower.includes('499') || lower.includes('highest plan')) {
    return 'founder_pro'
  }

  if (lower.includes('starter') || lower.includes('149')) return 'starter'

  if (
    lower.includes('pro') ||
    lower.includes('299') ||
    lower.includes('most popular') ||
    lower.includes('upgrade me') ||
    lower.includes('subscribe') ||
    lower.includes('paid plan')
  ) {
    return 'pro'
  }

  return 'unknown'
}

export function isPaymentIntentCommand(text: string) {
  const lower = (text || '').toLowerCase().trim()

  return (
    lower === 'i want pro' ||
    lower === 'want pro' ||
    lower === 'pro plan' ||
    lower === 'i want starter' ||
    lower === 'starter plan' ||
    lower === 'i want founder pro' ||
    lower === 'founder pro' ||
    lower === 'founder pro plan' ||
    lower === 'upgrade me' ||
    lower === 'subscribe' ||
    lower === 'i want to subscribe' ||
    lower === 'paid plan' ||
    lower === 'payment link' ||
    lower === 'send payment link' ||
    lower === 'checkout' ||
    lower.includes('i want to pay') ||
    lower.includes('ready to pay') ||
    lower.includes('send me payment') ||
    lower.includes('razorpay link') ||
    lower.includes('activate pro') ||
    lower.includes('activate founder') ||
    lower.includes('activate starter')
  )
}

async function savePaymentIntent(params: {
  telegramId: number
  plan: PlanKey
  rawText: string
  userName?: string
}) {
  const marker = `ASKGOGO_PAYMENT_INTENT:${params.plan}:${new Date().toISOString()}:`

  await supabaseAdmin.from('memories').insert({
    telegram_id: params.telegramId,
    content:
      marker +
      JSON.stringify({
        plan: params.plan,
        rawText: params.rawText,
        userName: params.userName || null,
        status: 'waitlist',
      }),
  })
}

export async function buildPaymentIntentReply(params: {
  telegramId: number
  text: string
  userName?: string
}) {
  const plan = detectPlan(params.text)
  await savePaymentIntent({ telegramId: params.telegramId, plan, rawText: params.text, userName: params.userName })

  const name = firstName(params.userName)

  if (plan === 'unknown') {
    return (
      `💚 *Upgrade interest saved, ${name}*\n\n` +
      `Razorpay checkout is being enabled.\n\n` +
      `Choose a plan so I can tag you correctly:\n` +
      `• Starter — ₹149/month\n` +
      `• Pro — ₹299/month\n` +
      `• Founder Pro — ₹499/month\n\n` +
      `Reply *I want Pro* or *I want Founder Pro*.`
    )
  }

  const selected = PLANS[plan]

  return (
    `💚 *You’re on the ${selected.label} waitlist, ${name}*\n\n` +
    `Plan selected:\n` +
    `*${selected.label}* — ${selected.price}\n` +
    `${selected.actions}\n\n` +
    `Razorpay checkout is being enabled.\n` +
    `You’ll get the payment link first when it goes live.\n\n` +
    `Meanwhile, keep using founder beta access.\n\n` +
    `Want to unlock Founder Pro trial priority?\n` +
    `Reply *invite friends*.`
  )
}

export async function buildPaymentIntentAdminSummary() {
  const { data } = await supabaseAdmin
    .from('memories')
    .select('telegram_id, content, created_at')
    .like('content', 'ASKGOGO_PAYMENT_INTENT:%')
    .order('created_at', { ascending: false })
    .limit(25)

  const rows = data || []

  if (!rows.length) {
    return `💳 *Payment intent dashboard*\n\nNo payment intents captured yet.`
  }

  const counts: Record<string, number> = {}
  for (const row of rows) {
    const match = row.content.match(/^ASKGOGO_PAYMENT_INTENT:([^:]+):/)
    const plan = match?.[1] || 'unknown'
    counts[plan] = (counts[plan] || 0) + 1
  }

  return (
    `💳 *Payment intent dashboard*\n\n` +
    `Latest captured intents: ${rows.length}\n\n` +
    `*By plan*\n` +
    `• Starter: ${counts.starter || 0}\n` +
    `• Pro: ${counts.pro || 0}\n` +
    `• Founder Pro: ${counts.founder_pro || 0}\n` +
    `• Unknown: ${counts.unknown || 0}\n\n` +
    `Use this to follow up once Razorpay is live.`
  )
}
