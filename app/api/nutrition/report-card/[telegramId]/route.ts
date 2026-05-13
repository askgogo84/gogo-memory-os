import { ImageResponse } from 'next/og'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const runtime = 'edge'

const W = 1080
const H = 1620

function db() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

// ── Design tokens ─────────────────────────────────────────────
const BG     = '#f5f0e8'
const HERO   = '#0f1e12'
const CARD   = '#fdfaf5'
const GREEN  = '#1a3d2e'
const TEAL   = '#2a9d6f'
const GOLD   = '#c8a84b'
const LGOLD  = '#e5c87a'
const MUTED  = '#8a7d68'
const LMUTED = '#b5a898'
const LINE   = '#e4ddd0'
const RED    = '#c0392b'
const ORANGE = '#e67e22'
const BLUE   = '#2980b9'

function d(style: any, children?: any): any {
  return { type: 'div', props: { style: { display: 'flex', ...style }, children } }
}
function t(content: any, style: any = {}): any {
  return d({ fontSize: 15, color: GREEN, fontWeight: 500, lineHeight: 1.35, ...style }, content)
}
function row(children: any, style: any = {}): any {
  return d({ flexDirection: 'row', alignItems: 'center', ...style }, children)
}
function col(children: any, style: any = {}): any {
  return d({ flexDirection: 'column', ...style }, children)
}
function hr(style: any = {}): any {
  return d({ width: '100%', height: 1, background: LINE, flexShrink: 0, ...style }, null)
}

function macroBar(label: string, val: number, goal: number, color: string): any {
  const pct = Math.min(100, Math.round((val / Math.max(1, goal)) * 100))
  const filled = Math.max(4, Math.round((pct / 100) * 360))
  return col([
    row([
      t(label, { fontSize: 13, fontWeight: 700, flex: 1, color: GREEN }),
      t(`${val}g`, { fontSize: 18, fontWeight: 900, color }),
      t(` / ${goal}g`, { fontSize: 12, color: MUTED })
    ], { marginBottom: 5 }),
    d({ width: 360, height: 8, borderRadius: 999, background: '#e8e0d4', flexShrink: 0 }, [
      d({ width: filled, height: 8, borderRadius: 999, background: color }, null)
    ])
  ], { marginBottom: 16 })
}

function dayBar(day: string, calories: number, goal: number, isToday: boolean): any {
  const pct = Math.min(100, Math.round((calories / Math.max(1, goal)) * 100))
  const barH = Math.max(4, Math.round((pct / 100) * 120))
  const color = calories === 0 ? '#e8e0d4' : pct > 110 ? ORANGE : pct > 90 ? TEAL : GOLD
  return col([
    d({ width: 60, alignItems: 'center', justifyContent: 'flex-end', height: 130 }, [
      d({ width: 32, height: barH, borderRadius: 6, background: color }, null)
    ]),
    t(calories > 0 ? String(calories) : '-', { fontSize: 10, fontWeight: 700, color: calories > 0 ? GREEN : LMUTED, textAlign: 'center', marginTop: 4 }),
    t(day, { fontSize: 11, fontWeight: isToday ? 900 : 500, color: isToday ? TEAL : MUTED, textAlign: 'center', marginTop: 2 })
  ], { alignItems: 'center', width: 68 })
}

function statBox(label: string, value: string, sub: string, color: string): any {
  return col([
    t(value, { fontSize: 32, fontWeight: 900, color, lineHeight: 1 }),
    t(label, { fontSize: 10, fontWeight: 900, color: MUTED, letterSpacing: 1.5, textTransform: 'uppercase', marginTop: 4 }),
    t(sub, { fontSize: 11, fontWeight: 500, color: LMUTED, marginTop: 2 })
  ], { flex: 1, alignItems: 'center', background: CARD, border: `1px solid ${LINE}`, borderRadius: 16, padding: '18px 12px' })
}

function mealRow(emoji: string, label: string, calories: number, time: string): any {
  return row([
    t(emoji, { fontSize: 22, width: 32, flexShrink: 0 }),
    col([
      t(label, { fontSize: 14, fontWeight: 700, color: GREEN }),
      t(time, { fontSize: 11, color: MUTED })
    ], { flex: 1 }),
    col([
      t(`${calories}`, { fontSize: 18, fontWeight: 900, color: TEAL }),
      t('kcal', { fontSize: 9, color: MUTED, marginTop: 1 })
    ], { alignItems: 'flex-end' })
  ], { marginBottom: 14, alignItems: 'flex-start' })
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ telegramId: string }> }) {
  try {
    const { telegramId } = await ctx.params
    const tgId = parseInt(telegramId)

    // Get today's logs
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)

    const { data: todayLogs } = await db()
      .from('nutrition_logs')
      .select('*')
      .eq('telegram_id', tgId)
      .gte('logged_at', todayStart.toISOString())
      .order('logged_at', { ascending: true })

    // Get week logs
    const weekStart = new Date()
    weekStart.setDate(weekStart.getDate() - 6)
    weekStart.setHours(0, 0, 0, 0)

    const { data: weekLogs } = await db()
      .from('nutrition_logs')
      .select('total_calories, total_protein, total_carbs, total_fat, logged_at')
      .eq('telegram_id', tgId)
      .gte('logged_at', weekStart.toISOString())
      .order('logged_at', { ascending: true })

    // Get goals
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
      goalType: goalsData?.goal_type || 'balanced'
    }

    // Compute today totals
    const today = todayLogs || []
    const todayTotals = {
      calories: Math.round(today.reduce((s: number, l: any) => s + Number(l.total_calories), 0)),
      protein: Math.round(today.reduce((s: number, l: any) => s + Number(l.total_protein), 0)),
      carbs: Math.round(today.reduce((s: number, l: any) => s + Number(l.total_carbs), 0)),
      fat: Math.round(today.reduce((s: number, l: any) => s + Number(l.total_fat), 0))
    }

    // Compute week day bars
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const weekByDay: Record<string, number> = {}
    for (const log of weekLogs || []) {
      const d = dayNames[new Date(log.logged_at).getDay()]
      weekByDay[d] = (weekByDay[d] || 0) + Number(log.total_calories)
    }
    const todayName = dayNames[new Date().getDay()]

    // Last 7 days in order
    const last7: { day: string; calories: number }[] = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      const name = dayNames[d.getDay()]
      last7.push({ day: name, calories: Math.round(weekByDay[name] || 0) })
    }

    const avgCalories = last7.filter(d => d.calories > 0).length > 0
      ? Math.round(last7.filter(d => d.calories > 0).reduce((s, d) => s + d.calories, 0) / last7.filter(d => d.calories > 0).length)
      : 0

    const loggedDays = last7.filter(d => d.calories > 0).length
    const calPct = Math.round((todayTotals.calories / goals.calories) * 100)
    const remaining = goals.calories - todayTotals.calories
    const dateStr = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })

    const goalLabel = { weight_loss: 'Weight Loss', muscle: 'Muscle Gain', balanced: 'Balanced', maintenance: 'Maintenance' }[goals.goalType] || 'Balanced'

    // Meal list (max 4)
    const mealEmojis: Record<string, string> = { breakfast: '☀️', lunch: '🌞', dinner: '🌙', snack: '🍎', drink: '💧', unknown: '🍽' }
    const mealItems = today.slice(0, 4).map((l: any) => ({
      emoji: mealEmojis[l.meal_type] || '🍽',
      label: (l.description || '').slice(0, 28),
      calories: Math.round(l.total_calories),
      time: new Date(l.logged_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
    }))

    const tree = d({ flexDirection: 'column', width: W, height: H, background: BG }, [

      // ── HERO: 400px ─────────────────────────────────────────
      d({ flexDirection: 'column', width: W, height: 400, background: HERO, flexShrink: 0, padding: '52px 64px 40px 64px' }, [
        // top row
        row([
          row([
            d({ width: 10, height: 10, borderRadius: 999, background: TEAL, marginRight: 10 }, null),
            t('ASKGOGO NUTRITION', { fontSize: 11, fontWeight: 900, color: TEAL, letterSpacing: 3 })
          ], {}),
          t(dateStr, { fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.3)' })
        ], { justifyContent: 'space-between', marginBottom: 32 }),

        // big title
        col([
          t('Nutrition', { fontSize: 62, fontWeight: 900, color: '#f5efe3', letterSpacing: -1.5, lineHeight: 1 }),
          t('Report Card', { fontSize: 62, fontWeight: 200, color: '#f5efe3', letterSpacing: -1.5, lineHeight: 1, fontStyle: 'italic', marginBottom: 10 }),
          t(`Goal: ${goalLabel}`, { fontSize: 13, fontWeight: 600, color: 'rgba(200,168,75,0.6)', letterSpacing: 0.5 })
        ], { marginBottom: 28 }),

        // stat chips
        row([
          col([
            t(`${todayTotals.calories}`, { fontSize: 40, fontWeight: 900, color: LGOLD, lineHeight: 1 }),
            t('TODAY KCAL', { fontSize: 9, fontWeight: 800, color: 'rgba(200,168,75,0.5)', letterSpacing: 2.5, marginTop: 5 })
          ], { marginRight: 36 }),
          d({ width: 1, height: 44, background: 'rgba(200,168,75,0.15)', marginRight: 36 }, null),
          col([
            t(`${todayTotals.protein}g`, { fontSize: 40, fontWeight: 900, color: LGOLD, lineHeight: 1 }),
            t('PROTEIN', { fontSize: 9, fontWeight: 800, color: 'rgba(200,168,75,0.5)', letterSpacing: 2.5, marginTop: 5 })
          ], { marginRight: 36 }),
          d({ width: 1, height: 44, background: 'rgba(200,168,75,0.15)', marginRight: 36 }, null),
          col([
            t(`${loggedDays}/7`, { fontSize: 40, fontWeight: 900, color: LGOLD, lineHeight: 1 }),
            t('DAYS LOGGED', { fontSize: 9, fontWeight: 800, color: 'rgba(200,168,75,0.5)', letterSpacing: 2.5, marginTop: 5 })
          ], {})
        ], {})
      ]),

      // ── CALORIE RING + MEALS: 340px ─────────────────────────
      d({ flexDirection: 'row', width: W, height: 340, flexShrink: 0, padding: '28px 56px 0 56px', gap: 24 }, [
        // Left: calorie summary
        d({ flexDirection: 'column', flex: 1, background: CARD, border: `1px solid ${LINE}`, borderRadius: 22, padding: '24px 28px' }, [
          row([
            d({ width: 4, height: 22, borderRadius: 2, background: TEAL, marginRight: 12, flexShrink: 0 }, null),
            t('TODAY AT A GLANCE', { fontSize: 11, fontWeight: 900, color: GREEN, letterSpacing: 2 })
          ], { marginBottom: 18 }),
          // Big calorie display
          row([
            col([
              t(String(todayTotals.calories), { fontSize: 52, fontWeight: 900, color: calPct > 110 ? ORANGE : TEAL, lineHeight: 1 }),
              t('kcal eaten', { fontSize: 12, color: MUTED, marginTop: 4 })
            ], { marginRight: 24 }),
            col([
              t(`/ ${goals.calories}`, { fontSize: 22, fontWeight: 700, color: MUTED, lineHeight: 1 }),
              t('kcal goal', { fontSize: 11, color: LMUTED, marginTop: 4 }),
              d({ marginTop: 10, width: 120, height: 10, borderRadius: 999, background: '#e8e0d4' }, [
                d({ width: Math.max(4, Math.round((calPct / 100) * 120)), height: 10, borderRadius: 999, background: calPct > 110 ? ORANGE : calPct > 90 ? TEAL : GOLD }, null)
              ])
            ], {})
          ], { alignItems: 'flex-start', marginBottom: 18 }),
          hr({ marginBottom: 16 }),
          // Remaining
          remaining > 0
            ? t(`✅  ${remaining} kcal remaining today`, { fontSize: 14, fontWeight: 700, color: TEAL })
            : t(`⚡  ${Math.abs(remaining)} kcal over goal`, { fontSize: 14, fontWeight: 700, color: ORANGE })
        ]),

        // Right: today's meals
        d({ flexDirection: 'column', flex: 1, background: CARD, border: `1px solid ${LINE}`, borderRadius: 22, padding: '24px 28px' }, [
          row([
            d({ width: 4, height: 22, borderRadius: 2, background: GOLD, marginRight: 12, flexShrink: 0 }, null),
            t("TODAY'S MEALS", { fontSize: 11, fontWeight: 900, color: GREEN, letterSpacing: 2 })
          ], { marginBottom: 18 }),
          mealItems.length > 0
            ? d({ flexDirection: 'column' }, mealItems.map((m: any) => mealRow(m.emoji, m.label, m.calories, m.time)))
            : t('No meals logged yet today.\nSend a photo or type what you ate.', { fontSize: 13, color: MUTED, lineHeight: 1.6 })
        ])
      ]),

      // ── MACROS: 220px ────────────────────────────────────────
      d({ flexDirection: 'column', width: W, height: 220, flexShrink: 0, padding: '20px 56px 0 56px' }, [
        d({ flexDirection: 'column', background: CARD, border: `1px solid ${LINE}`, borderRadius: 22, padding: '24px 28px' }, [
          row([
            d({ width: 4, height: 22, borderRadius: 2, background: GOLD, marginRight: 12, flexShrink: 0 }, null),
            t('MACRONUTRIENTS', { fontSize: 11, fontWeight: 900, color: GREEN, letterSpacing: 2 })
          ], { marginBottom: 18 }),
          row([
            col([
              macroBar('Protein', todayTotals.protein, goals.protein, TEAL),
              macroBar('Carbs', todayTotals.carbs, goals.carbs, BLUE)
            ], { flex: 1, marginRight: 40 }),
            col([
              macroBar('Fat', todayTotals.fat, goals.fat, ORANGE),
              macroBar('Fiber', 0, 28, GREEN)
            ], { flex: 1 })
          ])
        ])
      ]),

      // ── WEEK BARS: 280px ──────────────────────────────────────
      d({ flexDirection: 'column', width: W, height: 280, flexShrink: 0, padding: '20px 56px 0 56px' }, [
        d({ flexDirection: 'column', background: CARD, border: `1px solid ${LINE}`, borderRadius: 22, padding: '24px 28px' }, [
          row([
            d({ width: 4, height: 22, borderRadius: 2, background: GREEN, marginRight: 12, flexShrink: 0 }, null),
            t('THIS WEEK', { fontSize: 11, fontWeight: 900, color: GREEN, letterSpacing: 2, flex: 1 }),
            t(`Avg: ${avgCalories} kcal/day`, { fontSize: 12, fontWeight: 700, color: MUTED })
          ], { marginBottom: 20 }),
          row(
            last7.map((d: any) => dayBar(d.day, d.calories, goals.calories, d.day === todayName)),
            { justifyContent: 'space-between', alignItems: 'flex-end' }
          )
        ])
      ]),

      // ── BEHAVIORAL / INSIGHT: 170px ───────────────────────────
      d({ flexDirection: 'row', width: W, height: 170, flexShrink: 0, padding: '20px 56px 0 56px', gap: 18 }, [
        // Streak card
        d({ flexDirection: 'column', flex: 1, background: loggedDays >= 5 ? '#f0faf5' : CARD, border: `1px solid ${loggedDays >= 5 ? '#a8d4b8' : LINE}`, borderRadius: 18, padding: '20px 22px', justifyContent: 'space-between' }, [
          t(loggedDays >= 5 ? '🔥' : loggedDays >= 3 ? '⚡' : '💡', { fontSize: 28 }),
          col([
            t(loggedDays >= 5 ? `${loggedDays}-day streak!` : loggedDays >= 3 ? `${loggedDays} days logged` : 'Build your streak', { fontSize: 16, fontWeight: 800, color: GREEN }),
            t(loggedDays >= 5 ? 'Incredible consistency. Keep it up!' : loggedDays >= 3 ? 'Great progress this week' : 'Log daily for best results', { fontSize: 12, color: MUTED, marginTop: 3 })
          ], {})
        ]),
        // Insight card
        d({ flexDirection: 'column', flex: 1, background: CARD, border: `1px solid ${LINE}`, borderRadius: 18, padding: '20px 22px', justifyContent: 'space-between' }, [
          t('🎯', { fontSize: 28 }),
          col([
            t(todayTotals.protein < goals.protein * 0.5 ? 'Boost your protein' : todayTotals.calories > goals.calories * 0.9 ? 'Light dinner today' : 'On track today!', { fontSize: 16, fontWeight: 800, color: GREEN }),
            t(todayTotals.protein < goals.protein * 0.5 ? 'Add dal, paneer, or eggs to hit your protein goal'
              : todayTotals.calories > goals.calories * 0.9 ? 'A salad or soup would keep you in range'
              : 'Great balance. Keep logging to finish strong', { fontSize: 12, color: MUTED, marginTop: 3, lineHeight: 1.4 })
          ], {})
        ])
      ]),

      // ── FOOTER ───────────────────────────────────────────────
      d({ flexDirection: 'column', width: W, height: 80, flexShrink: 0, padding: '16px 64px 0 64px' }, [
        hr({ marginBottom: 16 }),
        row([
          t('AskGogo Nutrition', { fontSize: 13, fontWeight: 900, color: GREEN }),
          t(' · app.askgogo.in · Not medical advice', { fontSize: 11, color: MUTED })
        ], {})
      ])
    ])

    return new ImageResponse(tree as any, {
      width: W, height: H,
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=60' }
    })
  } catch (err: any) {
    console.error('[nutrition-report-card] failed:', err?.message)
    return new NextResponse('Failed: ' + err?.message, { status: 500 })
  }
}
