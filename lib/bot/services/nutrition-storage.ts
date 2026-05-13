import { supabaseAdmin } from '@/lib/supabase-admin'
import type { NutritionAnalysis, NutritionGoals, GoalType } from './nutrition-analyzer'

// ── Log a meal ────────────────────────────────────────────────────────────────
export async function saveNutritionLog(params: {
  telegramId: number
  analysis: NutritionAnalysis
  imageUrl?: string
  source?: 'text' | 'photo' | 'voice'
}) {
  const { analysis } = params
  const { error, data } = await supabaseAdmin
    .from('nutrition_logs')
    .insert({
      telegram_id: params.telegramId,
      meal_type: analysis.mealType,
      description: analysis.rawDescription,
      food_items: analysis.foodItems,
      total_calories: analysis.totalCalories,
      total_protein: analysis.totalProtein,
      total_carbs: analysis.totalCarbs,
      total_fat: analysis.totalFat,
      total_fiber: analysis.totalFiber,
      image_url: params.imageUrl || null,
      source: params.source || 'text',
      raw_ai_response: JSON.stringify(analysis)
    })
    .select('id')
    .single()

  if (error) console.error('[nutrition-storage] save failed:', error.message)
  return data
}

// ── Get today's totals ────────────────────────────────────────────────────────
export async function getTodayNutrition(telegramId: number) {
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  const { data, error } = await supabaseAdmin
    .from('nutrition_logs')
    .select('total_calories, total_protein, total_carbs, total_fat, total_fiber, meal_type, description, food_items, logged_at')
    .eq('telegram_id', telegramId)
    .gte('logged_at', todayStart.toISOString())
    .order('logged_at', { ascending: true })

  if (error) { console.error('[nutrition-storage] today fetch failed:', error.message); return null }

  const logs = data || []
  return {
    logs,
    totals: {
      calories: Math.round(logs.reduce((s, l) => s + Number(l.total_calories), 0)),
      protein: Math.round(logs.reduce((s, l) => s + Number(l.total_protein), 0)),
      carbs: Math.round(logs.reduce((s, l) => s + Number(l.total_carbs), 0)),
      fat: Math.round(logs.reduce((s, l) => s + Number(l.total_fat), 0)),
      fiber: Math.round(logs.reduce((s, l) => s + Number(l.total_fiber), 0)),
    },
    mealCount: logs.length
  }
}

// ── Get weekly data ───────────────────────────────────────────────────────────
export async function getWeekNutrition(telegramId: number) {
  const weekStart = new Date()
  weekStart.setDate(weekStart.getDate() - 6)
  weekStart.setHours(0, 0, 0, 0)

  const { data, error } = await supabaseAdmin
    .from('nutrition_logs')
    .select('total_calories, total_protein, total_carbs, total_fat, logged_at')
    .eq('telegram_id', telegramId)
    .gte('logged_at', weekStart.toISOString())
    .order('logged_at', { ascending: true })

  if (error) return null

  // Group by day
  const byDay: Record<string, { calories: number; protein: number; carbs: number; fat: number; count: number }> = {}
  for (const log of data || []) {
    const day = new Date(log.logged_at).toLocaleDateString('en-IN', { weekday: 'short' })
    if (!byDay[day]) byDay[day] = { calories: 0, protein: 0, carbs: 0, fat: 0, count: 0 }
    byDay[day].calories += Number(log.total_calories)
    byDay[day].protein += Number(log.total_protein)
    byDay[day].carbs += Number(log.total_carbs)
    byDay[day].fat += Number(log.total_fat)
    byDay[day].count++
  }

  const days = Object.values(byDay)
  const loggedDays = Object.keys(byDay).length
  const avgCalories = loggedDays > 0 ? Math.round(days.reduce((s, d) => s + d.calories, 0) / loggedDays) : 0
  const avgProtein = loggedDays > 0 ? Math.round(days.reduce((s, d) => s + d.protein, 0) / loggedDays) : 0
  const bestDay = Object.entries(byDay).sort(([, a], [, b]) => b.count - a.count)[0]?.[0] || null

  return { byDay, loggedDays, avgCalories, avgProtein, bestDay }
}

// ── Goals ─────────────────────────────────────────────────────────────────────
export async function getUserGoals(telegramId: number): Promise<NutritionGoals | null> {
  const { data } = await supabaseAdmin
    .from('nutrition_goals')
    .select('*')
    .eq('telegram_id', telegramId)
    .single()

  if (!data) return null

  return {
    goalType: data.goal_type as GoalType,
    dailyCalories: data.daily_calories,
    dailyProtein: data.daily_protein,
    dailyCarbs: data.daily_carbs,
    dailyFat: data.daily_fat,
    dailyFiber: data.daily_fiber
  }
}

export async function saveUserGoals(telegramId: number, goals: NutritionGoals, meta?: {
  weightKg?: number
  targetWeightKg?: number
  heightCm?: number
  age?: number
  gender?: string
  activityLevel?: string
}) {
  const { error } = await supabaseAdmin
    .from('nutrition_goals')
    .upsert({
      telegram_id: telegramId,
      goal_type: goals.goalType,
      daily_calories: goals.dailyCalories,
      daily_protein: goals.dailyProtein,
      daily_carbs: goals.dailyCarbs,
      daily_fat: goals.dailyFat,
      daily_fiber: goals.dailyFiber,
      weight_kg: meta?.weightKg,
      target_weight_kg: meta?.targetWeightKg,
      height_cm: meta?.heightCm,
      age: meta?.age,
      gender: meta?.gender,
      activity_level: meta?.activityLevel,
      updated_at: new Date().toISOString()
    }, { onConflict: 'telegram_id' })

  if (error) console.error('[nutrition-storage] goals save failed:', error.message)
}

export const DEFAULT_GOALS: NutritionGoals = {
  goalType: 'balanced',
  dailyCalories: 2000,
  dailyProtein: 60,
  dailyCarbs: 250,
  dailyFat: 65,
  dailyFiber: 28
}
