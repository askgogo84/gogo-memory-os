import { ImageResponse } from 'next/og'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const runtime = 'edge'

const W = 1080, H = 1350

function db() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

const BG = '#0c1410'
const CARD = '#ffffff'
const GREEN = '#1a3d2e'
const TEAL = '#2a9d6f'
const LIME = '#4ade80'
const GOLD = '#f59e0b'
const ORANGE = '#f97316'
const MUTED = '#6b7280'
const LIGHT = '#f0fdf4'
const DAY_COLORS: Record<string, string> = {}

function pct(val: number, goal: number) { return Math.min(100, Math.round((val / Math.max(1, goal)) * 100)) }

export async function GET(_req: NextRequest, ctx: { params: Promise<{ telegramId: string }> }) {
  try {
    const { telegramId } = await ctx.params
    const tgId = parseInt(telegramId)

    const weekStart = new Date()
    weekStart.setDate(weekStart.getDate() - 6)
    weekStart.setHours(0, 0, 0, 0)

    const { data: logs } = await db()
      .from('nutrition_logs')
      .select('total_calories, total_protein, total_carbs, total_fat, logged_at')
      .eq('telegram_id', tgId)
      .gte('logged_at', weekStart.toISOString())
      .order('logged_at', { ascending: true })

    const { data: goalsData } = await db()
      .from('nutrition_goals')
      .select('*')
      .eq('telegram_id', tgId)
      .maybeSingle()

    const goals = {
      calories: goalsData?.daily_calories || 2000,
      protein: goalsData?.daily_protein || 60,
      goalType: goalsData?.goal_type || 'balanced',
    }

    // Build 7-day data
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const byDay: Record<string, { cal: number; pro: number; count: number }> = {}

    for (const log of logs || []) {
      const d = new Date(log.logged_at)
      const key = dayNames[d.getDay()] + '-' + d.toLocaleDateString('en-CA')
      if (!byDay[key]) byDay[key] = { cal: 0, pro: 0, count: 0 }
      byDay[key].cal += Number(log.total_calories)
      byDay[key].pro += Number(log.total_protein)
      byDay[key].count++
    }

    // Build last 7 days in order
    const days: { label: string; cal: number; pro: number; count: number; isToday: boolean }[] = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      const name = dayNames[d.getDay()]
      const key = name + '-' + d.toLocaleDateString('en-CA')
      const data = byDay[key] || { cal: 0, pro: 0, count: 0 }
      days.push({ label: name, cal: Math.round(data.cal), pro: Math.round(data.pro), count: data.count, isToday: i === 0 })
    }

    const loggedDays = days.filter(d => d.cal > 0).length
    const totalCal = days.reduce((s, d) => s + d.cal, 0)
    const avgCal = loggedDays > 0 ? Math.round(totalCal / loggedDays) : 0
    const avgPro = loggedDays > 0 ? Math.round(days.reduce((s, d) => s + d.pro, 0) / loggedDays) : 0
    const streak = (() => { let s = 0; for (let i = days.length - 1; i >= 0; i--) { if (days[i].cal > 0) s++; else break; } return s })()
    const maxCal = Math.max(...days.map(d => d.cal), goals.calories)
    const goalLabel = ({ weight_loss: '🔥 Weight Loss', muscle: '💪 Muscle Gain', balanced: '🌿 Balanced', maintenance: '⚖️ Maintenance' } as Record<string,string>)[String(goals.goalType)] || '🌿 Balanced'

    const d = (style: any, children?: any): any => ({ type: 'div', props: { style: { display: 'flex', ...style }, children } })
    const t = (text: any, style: any = {}): any => d({ fontSize: 16, color: GREEN, fontWeight: 500, lineHeight: 1.3, ...style }, text)

    const BAR_MAX_H = 140

    const tree = d({ flexDirection: 'column', width: W, height: H, background: BG }, [

      // HERO
      d({ flexDirection: 'column', background: GREEN, padding: '48px 60px 40px', flexShrink: 0 }, [
        d({ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }, [
          d({ flexDirection: 'column' }, [
            t('AskGogo', { fontSize: 16, fontWeight: 900, color: LIME, letterSpacing: 2 }),
            t('Weekly', { fontSize: 62, fontWeight: 900, color: LIGHT, letterSpacing: -2, lineHeight: 1 }),
            t('Nutrition Report', { fontSize: 24, fontWeight: 300, color: 'rgba(240,253,244,0.5)', fontStyle: 'italic' }),
          ]),
          d({ flexDirection: 'column', alignItems: 'flex-end', gap: 6 }, [
            d({ background: 'rgba(74,222,128,0.12)', border: '1px solid rgba(74,222,128,0.2)', borderRadius: 100, padding: '8px 18px' }, [
              t(goalLabel, { fontSize: 13, fontWeight: 700, color: LIME }),
            ]),
          ])
        ]),
      ]),

      // 3 STATS
      d({ flexDirection: 'row', margin: '24px 24px 0', gap: 12, flexShrink: 0 }, [
        ...[
          { label: 'Days Logged', val: `${loggedDays}/7`, sub: loggedDays >= 5 ? '🔥 Great!' : 'Keep going', color: TEAL },
          { label: 'Avg Daily', val: `${avgCal}`, sub: 'kcal/day', color: LIME },
          { label: 'Avg Protein', val: `${avgPro}g`, sub: 'per day', color: GOLD },
        ].map(s => d({ flex: 1, background: CARD, borderRadius: 16, padding: '18px 16px', flexDirection: 'column', alignItems: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }, [
          t(s.val, { fontSize: 34, fontWeight: 900, color: s.color, lineHeight: 1 }),
          t(s.label, { fontSize: 10, color: MUTED, letterSpacing: 1.5, textTransform: 'uppercase', marginTop: 6, marginBottom: 4 }),
          t(s.sub, { fontSize: 11, color: MUTED }),
        ]))
      ]),

      // 7-DAY BAR CHART
      d({ flexDirection: 'column', margin: '20px 24px 0', background: CARD, borderRadius: 20, padding: '24px 24px 20px', flexShrink: 0, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }, [
        d({ flexDirection: 'row', alignItems: 'center', marginBottom: 24 }, [
          d({ width: 4, height: 22, borderRadius: 2, background: TEAL, marginRight: 12, flexShrink: 0 }, null),
          t('7-Day Calories', { fontSize: 15, fontWeight: 800 }),
          d({ flex: 1 }, null),
          t(`Goal: ${goals.calories} kcal`, { fontSize: 12, color: MUTED }),
        ]),
        d({ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', height: BAR_MAX_H + 50 }, [
          ...days.map(day => {
            const barH = day.cal > 0 ? Math.max(8, Math.round((day.cal / maxCal) * BAR_MAX_H)) : 4
            const p = pct(day.cal, goals.calories)
            const color = day.cal === 0 ? '#e5e7eb' : p > 110 ? ORANGE : p > 90 ? TEAL : LIME
            return d({ flexDirection: 'column', alignItems: 'center', flex: 1, gap: 0 }, [
              t(day.cal > 0 ? (day.cal >= 1000 ? Math.round(day.cal / 100) / 10 + 'K' : String(day.cal)) : '', {
                fontSize: 10, fontWeight: 700, color: day.cal > 0 ? GREEN : MUTED, marginBottom: 4
              }),
              d({ width: 44, height: barH, borderRadius: 8, background: color, flexShrink: 0,
                  boxShadow: day.isToday ? `0 0 12px ${color}88` : 'none' }, null),
              t(day.label, { fontSize: 12, fontWeight: day.isToday ? 900 : 500, color: day.isToday ? TEAL : MUTED, marginTop: 8 }),
              day.isToday ? t('●', { fontSize: 8, color: TEAL, marginTop: 2 }) : d({ height: 10 }, null),
            ])
          })
        ]),
      ]),

      // STREAK + INSIGHT
      d({ flexDirection: 'row', margin: '20px 24px 0', gap: 12, flexShrink: 0 }, [
        d({ flex: 1, background: streak >= 3 ? '#f0fdf4' : CARD, border: `1px solid ${streak >= 3 ? '#bbf7d0' : '#e5e7eb'}`, borderRadius: 16, padding: '20px', flexDirection: 'column', gap: 8 }, [
          t(streak >= 5 ? '🔥' : streak >= 3 ? '⚡' : '💡', { fontSize: 32 }),
          t(streak >= 5 ? `${streak}-day streak!` : streak >= 3 ? `${streak} days strong` : 'Start your streak', { fontSize: 17, fontWeight: 800, color: GREEN }),
          t(streak >= 5 ? 'Incredible consistency. Keep it up!' : streak >= 3 ? 'Great week, keep logging!' : 'Log daily for best results.', { fontSize: 12, color: MUTED, lineHeight: 1.5 }),
        ]),
        d({ flex: 1, background: CARD, border: '1px solid #e5e7eb', borderRadius: 16, padding: '20px', flexDirection: 'column', gap: 8 }, [
          t('🎯', { fontSize: 32 }),
          t(avgCal > goals.calories * 1.1 ? 'Watch portions' : avgCal > 0 ? 'On track!' : 'Start logging', { fontSize: 17, fontWeight: 800, color: GREEN }),
          t(avgCal > goals.calories * 1.1 ? 'Avg slightly high. Try lighter dinners.'
            : avgCal > 0 ? `${Math.abs(goals.calories - avgCal)} kcal from goal on avg. Solid week!`
            : 'Type what you ate or send a food photo.', { fontSize: 12, color: MUTED, lineHeight: 1.5 }),
        ]),
      ]),

      // FOOTER
      d({ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: '0 32px 32px', marginTop: 'auto', flexShrink: 0 }, [
        t('AskGogo Nutrition · app.askgogo.in', { fontSize: 12, color: 'rgba(255,255,255,0.2)' }),
        t('Not medical advice', { fontSize: 11, color: 'rgba(255,255,255,0.15)' }),
      ]),
    ])

    return new ImageResponse(tree as any, {
      width: W, height: H,
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=60' }
    })
  } catch (err: any) {
    return new NextResponse('Error: ' + err?.message, { status: 500 })
  }
}
