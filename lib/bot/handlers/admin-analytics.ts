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

type PlanKey = 'free' | 'starter' | 'pro' | 'founder_pro'

const PLAN_LABELS: Record<PlanKey, string> = {
  free: 'Free Beta',
  starter: 'Starter',
  pro: 'Pro',
  founder_pro: 'Founder Pro',
}

const PLAN_LIMITS: Record<PlanKey, string> = {
  free: '25 AI actions/month',
  starter: '100 AI actions/month',
  pro: '250 AI actions/month',
  founder_pro: '600 AI actions/month',
}

function normalizePhone(value: string | null | undefined) {
  return (value || '').replace(/^whatsapp:/, '').replace(/\D/g, '').slice(-10)
}

function normalizePlan(value: string | null | undefined): PlanKey | null {
  const clean = (value || '').toLowerCase().trim().replace(/-/g, '_').replace(/\s+/g, '_')
  if (clean === 'free' || clean === 'free_beta') return 'free'
  if (clean === 'starter') return 'starter'
  if (clean === 'pro') return 'pro'
  if (clean === 'founder' || clean === 'founder_pro') return 'founder_pro'
  return null
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
    lower === 'admin analytics' ||
    /^admin\s+find\s+/i.test(lower) ||
    /^admin\s+upgrade\s+/i.test(lower) ||
    /^admin\s+downgrade\s+/i.test(lower)
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
    try { parsed = JSON.parse(row.content.slice(jsonStart)) } catch { parsed = {} }
  }

  return {
    telegram_id: row.telegram_id,
    plan,
    rawText: parsed.rawText || '',
    userName: parsed.userName || '',
    created_at: row.created_at,
  }
}

async function findUserByPhone(phone: string) {
  const digits = normalizePhone(phone)
  if (!digits) return null

  const { data } = await supabaseAdmin
    .from('users')
    .select('*')
    .ilike('whatsapp_id', `%${digits}%`)
    .limit(1)

  return data?.[0] || null
}

function formatUserCard(user: any) {
  const phone = user?.whatsapp_id ? normalizePhone(user.whatsapp_id) : '-'
  const tier = String(user?.tier || 'free')
  const plan = normalizePlan(tier) || 'free'

  return (
    `👤 *User found*\n\n` +
    `Name: *${user?.name || 'Friend'}*\n` +
    `Phone: *${phone}*\n` +
    `Platform: *${user?.platform || 'unknown'}*\n` +
    `Plan: *${PLAN_LABELS[plan]}*\n` +
    `Limit: ${PLAN_LIMITS[plan]}\n` +
    `Telegram ID: ${user?.telegram_id || '-'}\n\n` +
    `Commands:\n` +
    `• admin upgrade ${phone} pro\n` +
    `• admin upgrade ${phone} founder_pro\n` +
    `• admin downgrade ${phone} free`
  )
}

async function buildAdminFindReply(text: string) {
  const match = text.match(/^admin\s+find\s+(.+)$/i)
  const phone = match?.[1]?.trim() || ''
  const user = await findUserByPhone(phone)

  if (!user) {
    return `I couldn’t find a user with phone *${normalizePhone(phone) || phone}*.\n\nTry: *admin users*`
  }

  return formatUserCard(user)
}

async function buildAdminPlanChangeReply(text: string) {
  const upgradeMatch = text.match(/^admin\s+upgrade\s+(\S+)\s+(\S+)$/i)
  const downgradeMatch = text.match(/^admin\s+downgrade\s+(\S+)\s+(\S+)$/i)
  const match = upgradeMatch || downgradeMatch

  if (!match) {
    return (
      `Usage:\n` +
      `• admin upgrade 8884501501 starter\n` +
      `• admin upgrade 8884501501 pro\n` +
      `• admin upgrade 8884501501 founder_pro\n` +
      `• admin downgrade 8884501501 free`
    )
  }

  const phone = match[1]
  const plan = normalizePlan(match[2])

  if (!plan) {
    return `Invalid plan. Use *free*, *starter*, *pro*, or *founder_pro*.`
  }

  const user = await findUserByPhone(phone)
  if (!user) return `I couldn’t find a user with phone *${normalizePhone(phone) || phone}*.`

  const { error } = await supabaseAdmin
    .from('users')
    .update({ tier: plan })
    .eq('id', user.id)

  if (error) return `Plan update failed: ${error.message}`

  await supabaseAdmin.from('memories').insert({
    telegram_id: user.telegram_id,
    content: `ASKGOGO_ADMIN_PLAN_CHANGE:${plan}:` + JSON.stringify({
      phone: normalizePhone(phone),
      oldPlan: user.tier || 'free',
      newPlan: plan,
      changed_at: new Date().toISOString(),
    }),
  })

  return (
    `✅ *User plan updated*\n\n` +
    `Name: *${user.name || 'Friend'}*\n` +
    `Phone: *${normalizePhone(user.whatsapp_id || phone)}*\n` +
    `Old plan: ${PLAN_LABELS[normalizePlan(user.tier) || 'free']}\n` +
    `New plan: *${PLAN_LABELS[plan]}*\n` +
    `Limit: ${PLAN_LIMITS[plan]}\n\n` +
    `Ask the user to type *usage* to confirm.`
  )
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

  if (/^admin\s+find\s+/i.test(lower)) return await buildAdminFindReply(text)
  if (/^admin\s+upgrade\s+/i.test(lower) || /^admin\s+downgrade\s+/i.test(lower)) return await buildAdminPlanChangeReply(text)

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

  if (lower === 'admin referrals') return `🎁 *Referrals*\n\nTotal joined via referral: *${analytics.totals.referrals}*`

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
    `• admin referrals\n` +
    `• admin find 8884501501\n` +
    `• admin upgrade 8884501501 founder_pro\n` +
    `• admin downgrade 8884501501 free`
  )
}
