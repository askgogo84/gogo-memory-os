import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

const GOAL_WHATSAPP_USERS = 1000
const SPRINT_DAYS = 10

function getIstDateKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function getIstStartIso(daysAgo = 0) {
  const now = new Date()
  const istDateKey = getIstDateKey(now)
  const [year, month, day] = istDateKey.split('-').map(Number)
  const utcForIstMidnight = new Date(Date.UTC(year, month - 1, day, -5, -30, 0, 0))
  utcForIstMidnight.setUTCDate(utcForIstMidnight.getUTCDate() - daysAgo)
  return utcForIstMidnight.toISOString()
}

function sourceFromUser(user: any) {
  const raw =
    user?.source ||
    user?.utm_source ||
    user?.acquisition_source ||
    user?.signup_source ||
    user?.referral_source ||
    user?.campaign_source ||
    user?.channel ||
    user?.origin ||
    ''

  const clean = String(raw || '').trim().toLowerCase()
  if (!clean) return 'direct / unknown'
  if (clean.includes('linkedin')) return 'linkedin'
  if (clean.includes('instagram') || clean.includes('ig')) return 'instagram'
  if (clean.includes('twitter') || clean === 'x') return 'x'
  if (clean.includes('producthunt') || clean.includes('product hunt')) return 'product hunt'
  if (clean.includes('whatsapp')) return 'whatsapp groups'
  if (clean.includes('referral')) return 'referral'
  return clean
}

function countBySource(users: any[]) {
  return users.reduce((acc: Record<string, number>, user: any) => {
    const source = sourceFromUser(user)
    acc[source] = (acc[source] || 0) + 1
    return acc
  }, {})
}

function countDaily(users: any[]) {
  const daily: Record<string, { total: number; whatsapp: number }> = {}

  for (const user of users) {
    const key = user?.created_at ? getIstDateKey(new Date(user.created_at)) : 'unknown'
    if (!daily[key]) daily[key] = { total: 0, whatsapp: 0 }
    daily[key].total += 1
    if (String(user?.platform || '').toLowerCase() === 'whatsapp') daily[key].whatsapp += 1
  }

  return Object.entries(daily)
    .map(([date, value]) => ({ date, ...value }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token') || ''
  const expected = process.env.ADMIN_DASHBOARD_TOKEN || ''

  if (!expected || token !== expected) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  const todayStartIso = getIstStartIso(0)
  const sevenDaysStartIso = getIstStartIso(6)

  const { data: usersRaw, error } = await supabaseAdmin
    .from('users')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(10000)

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  const users = usersRaw || []
  const whatsappUsers = users.filter((u: any) => String(u.platform || '').toLowerCase() === 'whatsapp')
  const todayUsers = users.filter((u: any) => u.created_at && new Date(u.created_at) >= new Date(todayStartIso))
  const todayWhatsappUsers = todayUsers.filter((u: any) => String(u.platform || '').toLowerCase() === 'whatsapp')
  const last7Users = users.filter((u: any) => u.created_at && new Date(u.created_at) >= new Date(sevenDaysStartIso))
  const last7WhatsappUsers = last7Users.filter((u: any) => String(u.platform || '').toLowerCase() === 'whatsapp')

  const currentWhatsappUsers = whatsappUsers.length
  const remaining = Math.max(0, GOAL_WHATSAPP_USERS - currentWhatsappUsers)
  const requiredPerDay = Math.ceil(remaining / SPRINT_DAYS)
  const progressPercent = Math.min(100, Math.round((currentWhatsappUsers / GOAL_WHATSAPP_USERS) * 100))
  const avgWhatsappPerDay7 = Math.round((last7WhatsappUsers.length / 7) * 10) / 10

  return NextResponse.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    sprint: {
      goalWhatsappUsers: GOAL_WHATSAPP_USERS,
      sprintDays: SPRINT_DAYS,
      currentWhatsappUsers,
      remaining,
      requiredPerDay,
      progressPercent,
      todayTotalUsers: todayUsers.length,
      todayWhatsappUsers: todayWhatsappUsers.length,
      last7TotalUsers: last7Users.length,
      last7WhatsappUsers: last7WhatsappUsers.length,
      avgWhatsappPerDay7,
    },
    acquisition: {
      allSources: countBySource(users),
      last7Sources: countBySource(last7Users),
      todaySources: countBySource(todayUsers),
    },
    dailyGrowth: countDaily(last7Users),
  })
}
