import { ImageResponse } from 'next/og'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const runtime = 'edge'

const W = 1080, H = 1080

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

function pct(val: number, goal: number) { return Math.min(100, Math.round((val / Math.max(1, goal)) * 100)) }
function bar(filled: number, total = 20) {
  const f = Math.max(0, Math.min(total, Math.round((filled / 100) * total)))
  return '█'.repeat(f) + '░'.repeat(total - f)
}
function mealEmoji(type: string) {
  return { breakfast: '☀️', lunch: '🌞', dinner: '🌙', snack: '🍎', drink: '💧', unknown: '🍽' }[type] || '🍽'
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ telegramId: string }> }) {
  try {
    const { telegramId } = await ctx.params
    const tgId = parseInt(telegramId)

    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)

    const { data: logs } = await db()
      .from('nutrition_logs')
      .select('*')
      .eq('telegram_id', tgId)
      .gte('logged_at', todayStart.toISOString())
      .order('logged_at', { ascending: true })

    const { data: goalsData } = await db()
      .from('nutrition_goals')
      .select('*')
      .eq('telegram_id', tgId)
      .maybeSingle()

    const goals = {
      calories: goalsData?.daily_calories || 2000,
      protein: goalsData?.daily_protein || 60,
      carbs: goalsData?.daily_carbs || 250,
      fat: goalsData?.daily_fat || 65,
    }

    const today = logs || []
    const totals = {
      calories: Math.round(today.reduce((s: number, l: any) => s + Number(l.total_calories), 0)),
      protein: Math.round(today.reduce((s: number, l: any) => s + Number(l.total_protein), 0)),
      carbs: Math.round(today.reduce((s: number, l: any) => s + Number(l.total_carbs), 0)),
      fat: Math.round(today.reduce((s: number, l: any) => s + Number(l.total_fat), 0)),
    }

    const calPct = pct(totals.calories, goals.calories)
    const proPct = pct(totals.protein, goals.protein)
    const remaining = goals.calories - totals.calories
    const barColor = calPct > 110 ? ORANGE : calPct > 90 ? TEAL : LIME
    const dateStr = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })

    const meals = today.slice(0, 5).map((l: any) => ({
      emoji: mealEmoji(l.meal_type),
      desc: (l.description || '').slice(0, 30),
      cal: Math.round(l.total_calories),
      time: new Date(l.logged_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }),
    }))

    const d = (style: any, children?: any): any => ({ type: 'div', props: { style: { display: 'flex', ...style }, children } })
    const t = (text: any, style: any = {}): any => d({ fontSize: 16, color: GREEN, fontWeight: 500, lineHeight: 1.3, ...style }, text)

    const tree = d({ flexDirection: 'column', width: W, height: H, background: BG }, [

      // HERO
      d({ flexDirection: 'column', background: GREEN, padding: '52px 60px 44px', flexShrink: 0 }, [
        d({ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32 }, [
          d({ flexDirection: 'column' }, [
            t('AskGogo', { fontSize: 18, fontWeight: 900, color: LIME, letterSpacing: 2 }),
            t('Nutrition', { fontSize: 56, fontWeight: 900, color: LIGHT, letterSpacing: -2, lineHeight: 1 }),
            t('Daily Report', { fontSize: 28, fontWeight: 300, color: 'rgba(240,253,244,0.6)', fontStyle: 'italic' }),
          ]),
          d({ flexDirection: 'column', alignItems: 'flex-end' }, [
            t(String(totals.calories), { fontSize: 80, fontWeight: 900, color: barColor, lineHeight: 1 }),
            t('kcal today', { fontSize: 14, color: 'rgba(255,255,255,0.4)', letterSpacing: 1 }),
          ])
        ]),
        t(dateStr, { fontSize: 14, color: 'rgba(255,255,255,0.35)', letterSpacing: 1, marginBottom: 24 }),
        // Big calorie bar
        d({ flexDirection: 'column', gap: 10 }, [
          d({ flexDirection: 'row', justifyContent: 'space-between' }, [
            t('Calories', { fontSize: 13, color: 'rgba(255,255,255,0.5)', letterSpacing: 1 }),
            t(`${totals.calories} / ${goals.calories} kcal · ${calPct}%`, { fontSize: 13, color: LIME, fontWeight: 700 }),
          ]),
          d({ width: '100%', height: 12, borderRadius: 999, background: 'rgba(255,255,255,0.1)', flexShrink: 0 }, [
            d({ width: `${calPct}%`, height: 12, borderRadius: 999, background: barColor }, null)
          ]),
        ]),
      ]),

      // MACROS ROW
      d({ flexDirection: 'row', gap: 0, margin: '24px 24px 0', flexShrink: 0 }, [
        ...[
          { label: 'Protein', val: totals.protein, goal: goals.protein, unit: 'g', color: TEAL },
          { label: 'Carbs', val: totals.carbs, goal: goals.carbs, unit: 'g', color: GOLD },
          { label: 'Fat', val: totals.fat, goal: goals.fat, unit: 'g', color: ORANGE },
        ].map((m, i) => {
          const p = pct(m.val, m.goal)
          return d({ flex: 1, flexDirection: 'column', background: CARD, borderRadius: 16, padding: '18px 16px', margin: i === 1 ? '0 12px' : 0, alignItems: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }, [
            t(String(m.val) + m.unit, { fontSize: 32, fontWeight: 900, color: m.color, lineHeight: 1 }),
            t(m.label, { fontSize: 11, color: MUTED, letterSpacing: 1.5, textTransform: 'uppercase', marginTop: 4, marginBottom: 10 }),
            d({ width: '100%', height: 6, borderRadius: 999, background: '#f0f0f0', flexShrink: 0 }, [
              d({ width: `${p}%`, height: 6, borderRadius: 999, background: m.color }, null)
            ]),
            t(`${p}% of ${m.goal}${m.unit}`, { fontSize: 10, color: MUTED, marginTop: 6 }),
          ])
        })
      ]),

      // MEALS LIST
      d({ flexDirection: 'column', margin: '20px 24px 0', background: CARD, borderRadius: 20, padding: '24px 28px', flexShrink: 0, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }, [
        d({ flexDirection: 'row', alignItems: 'center', marginBottom: 20 }, [
          d({ width: 4, height: 22, borderRadius: 2, background: TEAL, marginRight: 12, flexShrink: 0 }, null),
          t("Today's Meals", { fontSize: 15, fontWeight: 800, letterSpacing: 0.5 }),
          d({ flex: 1 }, null),
          t(`${meals.length} logged`, { fontSize: 12, color: MUTED }),
        ]),
        ...meals.length > 0
          ? meals.map((m: any) => d({ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }, [
              t(m.emoji, { fontSize: 28, width: 36, flexShrink: 0 }),
              d({ flex: 1, flexDirection: 'column', marginLeft: 12 }, [
                t(m.desc, { fontSize: 14, fontWeight: 600, color: GREEN }),
                t(m.time, { fontSize: 11, color: MUTED, marginTop: 2 }),
              ]),
              t(String(m.cal), { fontSize: 22, fontWeight: 900, color: TEAL }),
              t(' kcal', { fontSize: 11, color: MUTED, marginTop: 4 }),
            ]))
          : [t('No meals logged yet today.\nSend a photo or type what you ate!', { fontSize: 14, color: MUTED, lineHeight: 1.6 })]
      ]),

      // STATUS FOOTER
      d({ flexDirection: 'row', margin: '20px 24px', gap: 12, flexShrink: 0 }, [
        d({ flex: 1, background: remaining > 0 ? '#f0fdf4' : '#fff7ed', border: `1px solid ${remaining > 0 ? '#bbf7d0' : '#fed7aa'}`, borderRadius: 16, padding: '18px 20px', flexDirection: 'column' }, [
          t(remaining > 0 ? `✅ ${remaining} kcal` : `⚡ ${Math.abs(remaining)} kcal`, { fontSize: 26, fontWeight: 900, color: remaining > 0 ? TEAL : ORANGE, lineHeight: 1 }),
          t(remaining > 0 ? 'remaining today' : 'over goal', { fontSize: 11, color: MUTED, marginTop: 4, letterSpacing: 1 }),
        ]),
        d({ flex: 1, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 16, padding: '18px 20px', flexDirection: 'column' }, [
          t(`${proPct}%`, { fontSize: 26, fontWeight: 900, color: TEAL, lineHeight: 1 }),
          t('protein goal hit', { fontSize: 11, color: MUTED, marginTop: 4, letterSpacing: 1 }),
        ]),
      ]),

      // BRAND FOOTER
      d({ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: '0 32px 36px', marginTop: 'auto', flexShrink: 0 }, [
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
