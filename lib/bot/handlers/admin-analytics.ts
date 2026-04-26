import { supabaseAdmin } from '@/lib/supabase-admin'

export type AdminAnalytics = {
  totals: {
    users: number
    whatsappUsers: number
    telegramUsers: number
    freeUsers: number
    starterUsers: number
    proUsers: number
    founderProUsers: number
    unknownTierUsers: number
    activeReminders: number
    paymentIntents: number
    referrals: number
  }
  usersByPlatform: Record<string, number>
  usersByTier: Record<string, number>
  paymentByPlan: Record<string, number>
  recentUsers: any[]
  recentPaymentIntents: any[]
}

function normalizePhone(value: string | null | undefined) {
  return (value || '').replace(/^whatsapp:/, '').replace(/\D/g, '').slice(-10)
}

export function isAdminPhone(phone: string | null | undefined) {
  const allowed = (process.env.ADMIN_WHATSAPP_NUMBERS || process.env.ADMIN_WHATSAPP_NUMBER || '')
    .split(',')
    .map((x) => normalizePhone(x))
    .filter(Boolean)

  if (!allowed.length) return false
  return allowed.includes(normalizePhone(phone))
}

export function isAdminCommand(text: string) {
  const lower = (text || '').toLowerCase().trim()
  return (
    lower === 'admin' ||
    lower === 'admin dashboard' ||
    lower === 'admin users' ||
    lower === 'admin payment intents' ||
    lower === 'admin payments' ||
    lower === 'admin referrals' ||
    lower === 'admin stats' ||
    lower === 'admin analytics'
  )
}

function countBy<T extends Record<string, any>>(rows: T[], field: string) {
  return rows.reduce((acc: Record<string, number>, row) => {
    const key = String(row[field] || 'unknown').toLowerCase()
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {})
}

function planFromPaymentMemory(content: string) {
  const match = content.match(/^ASKGOGO_PAYMENT_INTENT:([^:]+):/)
  return match?.[1] || 'unknown'
}

function parsePaymentIntent(row: any) {
  const plan = planFromPaymentMemory(row.content || '')
  const jsonStart = (row.content || '').indexOf('{')
  let parsed: any = {}
  if (jsonStart >= 0) {
    try {
      parsed = JSON.parse(row.content.slice(jsonStart))
    } catch {
      parsed = {}
    }
  }

  return {
    telegram_id: row.telegram_id,
    plan,
    rawText: parsed.rawText || '',
    userName: parsed.userName || '',
    created_at: row.created_at,
  }
}

export async function getAdminAnalytics(): Promise<AdminAnalytics> {
  const { data: usersRaw } = await supabaseAdmin
    .from('users')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(5000)

  const users = usersRaw || []

  const { count: activeReminders } = await supabaseAdmin
    .from('reminders')
    .select('id', { count: 'exact', head: true })
    .eq('sent', false)

  const { data: paymentRowsRaw, count: paymentIntents } = await supabaseAdmin
    .from('memories')
    .select('telegram_id, content, created_at', { count: 'exact' })
    .like('content', 'ASKGOGO_PAYMENT_INTENT:%')
    .order('created_at', { ascending: false })
    .limit(100)

  const paymentRows = paymentRowsRaw || []
  const recentPaymentIntents = paymentRows.map(parsePaymentIntent)

  const { count: referrals } = await supabaseAdmin
    .from('memories')
    .select('id', { count: 'exact', head: true })
    .like('content', 'ASKGOGO_REFERRAL_JOINED:%')

  const usersByPlatform = countBy(users, 'platform')
  const usersByTier = countBy(users, 'tier')

  const paymentByPlan = recentPaymentIntents.reduce((acc: Record<string, number>, item: any) => {
    acc[item.plan] = (acc[item.plan] || 0) + 1
    return acc
  }, {})

  return {
    totals: {
      users: users.length,
      whatsappUsers: usersByPlatform.whatsapp || 0,
      telegramUsers: usersByPlatform.telegram || 0,
      freeUsers: usersByTier.free || 0,
      starterUsers: usersByTier.starter || 0,
      proUsers: usersByTier.pro || 0,
      founderProUsers: usersByTier.founder_pro || usersByTier.founder || 0,
      unknownTierUsers: usersByTier.unknown || 0,
      activeReminders: activeReminders || 0,
      paymentIntents: paymentIntents || 0,
      referrals: referrals || 0,
    },
    usersByPlatform,
    usersByTier,
    paymentByPlan,
    recentUsers: users.slice(0, 25),
    recentPaymentIntents,
  }
}

function moneyPlanLabel(plan: string) {
  if (plan === 'starter') return 'Starter'
  if (plan === 'pro') return 'Pro'
  if (plan === 'founder_pro') return 'Founder Pro'
  return 'Unknown'
}

export async function buildAdminWhatsAppReply(text: string) {
  const lower = (text || '').toLowerCase().trim()
  const analytics = await getAdminAnalytics()

  if (lower === 'admin payment intents' || lower === 'admin payments') {
    if (!analytics.recentPaymentIntents.length) return `💳 *Payment intents*\n\nNo payment intents captured yet.`
    return (
      `💳 *Payment intents*\n\n` +
      `Total: *${analytics.totals.paymentIntents}*\n` +
      `Starter: ${analytics.paymentByPlan.starter || 0}\n` +
      `Pro: ${analytics.paymentByPlan.pro || 0}\n` +
      `Founder Pro: ${analytics.paymentByPlan.founder_pro || 0}\n\n` +
      analytics.recentPaymentIntents
        .slice(0, 8)
        .map((item: any, idx: number) => `${idx + 1}. ${moneyPlanLabel(item.plan)} — ${item.userName || item.telegram_id}\n   “${item.rawText || 'payment intent'}”`)
        .join('\n')
    )
  }

  if (lower === 'admin users') {
    return (
      `👥 *Users*\n\n` +
      `Total: *${analytics.totals.users}*\n` +
      `WhatsApp: ${analytics.totals.whatsappUsers}\n` +
      `Telegram: ${analytics.totals.telegramUsers}\n\n` +
      `*Plans*\n` +
      `Free: ${analytics.totals.freeUsers}\n` +
      `Starter: ${analytics.totals.starterUsers}\n` +
      `Pro: ${analytics.totals.proUsers}\n` +
      `Founder Pro: ${analytics.totals.founderProUsers}`
    )
  }

  if (lower === 'admin referrals') {
    return `🎁 *Referrals*\n\nTotal joined via referral: *${analytics.totals.referrals}*`
  }

  return (
    `📊 *AskGogo Admin Dashboard*\n\n` +
    `Users: *${analytics.totals.users}*\n` +
    `WhatsApp: ${analytics.totals.whatsappUsers} • Telegram: ${analytics.totals.telegramUsers}\n\n` +
    `Plans:\n` +
    `Free ${analytics.totals.freeUsers} • Starter ${analytics.totals.starterUsers} • Pro ${analytics.totals.proUsers} • Founder Pro ${analytics.totals.founderProUsers}\n\n` +
    `Active reminders: ${analytics.totals.activeReminders}\n` +
    `Payment intents: ${analytics.totals.paymentIntents}\n` +
    `Referrals: ${analytics.totals.referrals}\n\n` +
    `Commands:\n` +
    `• admin users\n` +
    `• admin payment intents\n` +
    `• admin referrals`
  )
}
