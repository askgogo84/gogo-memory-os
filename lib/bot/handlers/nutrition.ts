/**
 * AskGogo Nutrition Handler
 * Entry point for all nutrition commands from WhatsApp
 */

import { analyzeNutritionFromText, analyzeNutritionFromImage, calculateGoals, buildNutritionLogReply } from '@/lib/bot/services/nutrition-analyzer'
import { saveNutritionLog, getTodayNutrition, getWeekNutrition, getUserGoals, saveUserGoals, DEFAULT_GOALS } from '@/lib/bot/services/nutrition-storage'

// ── Intent detection ──────────────────────────────────────────────────────────

export function isNutritionLogText(text: string): boolean {
  const lower = text.toLowerCase().trim()
  // Food logging triggers
  const foodWords = ['ate', 'had', 'ate', 'breakfast', 'lunch', 'dinner', 'snack', 'drank', 'drank', 'ate', 'roti', 'rice', 'dal', 'dosa', 'idli', 'sambar', 'biryani', 'chai', 'coffee', 'paratha', 'poha', 'upma', 'sabzi', 'curry', 'chicken', 'egg', 'paneer', 'milk', 'fruit', 'banana', 'apple', 'curd', 'yogurt', 'oats', 'bread', 'pizza', 'burger', 'noodles', 'pasta']
  const hasFoodWord = foodWords.some(w => lower.includes(w))
  const hasCalPrefix = /^(log|ate|had|just had|just ate|breakfast:|lunch:|dinner:|snack:)/i.test(lower)
  return hasCalPrefix || (hasFoodWord && lower.length < 200 && !lower.includes('remind'))
}

export function isNutritionCommand(text: string): boolean {
  const lower = text.toLowerCase().trim()
  return (
    lower === 'nutrition today' || lower === 'nutrition' || lower === 'calories today' ||
    lower === 'my calories' || lower === 'food today' || lower === 'what did i eat' ||
    lower === 'nutrition report' || lower === 'nutrition week' || lower === 'weekly nutrition' ||
    lower === 'nutrition summary' || lower === 'my nutrition' ||
    lower === 'set nutrition goal' || lower === 'nutrition goal' || lower === 'set calorie goal' ||
    lower === 'nutrition help' || lower === 'calorie help' || lower === 'food help' ||
    lower.startsWith('log ') || lower.startsWith('track ')
  )
}

export function isNutritionPhotoCaption(caption: string): boolean {
  const lower = (caption || '').toLowerCase().trim()
  return (
    lower === '' || // blank caption on food photo = log it
    lower.includes('log') || lower.includes('track') || lower.includes('calories') ||
    lower.includes('food') || lower.includes('meal') || lower.includes('ate') ||
    lower.includes('lunch') || lower.includes('breakfast') || lower.includes('dinner') ||
    lower.includes('nutrition')
  )
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function handleNutritionText(params: {
  telegramId: number
  text: string
}): Promise<string> {
  const lower = params.text.toLowerCase().trim()

  // Today's summary
  if (lower === 'nutrition today' || lower === 'calories today' || lower === 'food today' ||
      lower === 'my calories' || lower === 'what did i eat' || lower === 'nutrition') {
    return buildTodaySummary(params.telegramId)
  }

  // Weekly report
  if (lower === 'nutrition report' || lower === 'nutrition week' || lower === 'weekly nutrition' || lower === 'nutrition summary') {
    return buildWeeklySummary(params.telegramId)
  }

  // Goal setting
  if (lower === 'set nutrition goal' || lower === 'nutrition goal' || lower === 'set calorie goal') {
    return buildGoalSetupMessage()
  }

  // Goal replies
  if (/^(1|weight loss|lose weight|fat loss)$/.test(lower)) return handleGoalSelection(params.telegramId, 'weight_loss')
  if (/^(2|muscle|build muscle|gain muscle|bulk)$/.test(lower)) return handleGoalSelection(params.telegramId, 'muscle')
  if (/^(3|balanced|balance|healthy)$/.test(lower)) return handleGoalSelection(params.telegramId, 'balanced')
  if (/^(4|maintenance|maintain|stay same)$/.test(lower)) return handleGoalSelection(params.telegramId, 'maintenance')

  // Help
  if (lower === 'nutrition help' || lower === 'calorie help' || lower === 'food help') {
    return buildHelpMessage()
  }

  // Remove "log " or "track " prefix and analyze as food
  const foodText = params.text
    .replace(/^(log|track)\s+/i, '')
    .trim()

  return logMealFromText(params.telegramId, foodText)
}

export async function handleNutritionPhoto(params: {
  telegramId: number
  mediaUrl: string
  contentType: string
  caption?: string
}): Promise<string> {
  const goals = await getUserGoals(params.telegramId) || DEFAULT_GOALS
  const todayData = await getTodayNutrition(params.telegramId)
  const todayTotals = todayData?.totals || { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 }

  const analysis = await analyzeNutritionFromImage({
    mediaUrl: params.mediaUrl,
    contentType: params.contentType,
    caption: params.caption
  })

  await saveNutritionLog({
    telegramId: params.telegramId,
    analysis,
    imageUrl: params.mediaUrl,
    source: 'photo'
  })

  const newTotals = {
    calories: todayTotals.calories + analysis.totalCalories,
    protein: todayTotals.protein + analysis.totalProtein,
    carbs: todayTotals.carbs + analysis.totalCarbs,
    fat: todayTotals.fat + analysis.totalFat
  }

  return buildNutritionLogReply({
    analysis,
    todayTotal: newTotals,
    goals,
    mealCount: (todayData?.mealCount || 0) + 1
  })
}

// ── Private helpers ───────────────────────────────────────────────────────────

async function logMealFromText(telegramId: number, foodText: string): Promise<string> {
  const goals = await getUserGoals(telegramId) || DEFAULT_GOALS
  const todayData = await getTodayNutrition(telegramId)
  const todayTotals = todayData?.totals || { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 }

  const analysis = await analyzeNutritionFromText(foodText)

  await saveNutritionLog({ telegramId, analysis, source: 'text' })

  const newTotals = {
    calories: todayTotals.calories + analysis.totalCalories,
    protein: todayTotals.protein + analysis.totalProtein,
    carbs: todayTotals.carbs + analysis.totalCarbs,
    fat: todayTotals.fat + analysis.totalFat
  }

  return buildNutritionLogReply({
    analysis,
    todayTotal: newTotals,
    goals,
    mealCount: (todayData?.mealCount || 0) + 1
  })
}

async function buildTodaySummary(telegramId: number): Promise<string> {
  const goals = await getUserGoals(telegramId) || DEFAULT_GOALS
  const todayData = await getTodayNutrition(telegramId)

  if (!todayData || todayData.mealCount === 0) {
    return (
      `🥗 *Nutrition Today*\n\n` +
      `Nothing logged yet today.\n\n` +
      `Log your first meal:\n` +
      `• Type: _"had 2 rotis with dal and sabzi"_\n` +
      `• Or send a 📷 photo of your plate\n\n` +
      `_Your daily goal: ${goals.dailyCalories} kcal · ${goals.dailyProtein}g protein_`
    )
  }

  const { totals, logs } = todayData
  const pct = Math.round((totals.calories / goals.dailyCalories) * 100)
  const remaining = goals.dailyCalories - totals.calories
  const filled = Math.min(10, Math.round(pct / 10))
  const bar = '█'.repeat(filled) + '░'.repeat(10 - filled)

  const mealLines = logs.slice(0, 6).map((l: any) => {
    const time = new Date(l.logged_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
    const mealEmoji = { breakfast: '☀️', lunch: '🌞', dinner: '🌙', snack: '🍎', drink: '💧', unknown: '🍽' }[l.meal_type as string] || '🍽'
    return `${mealEmoji} ${time} — ${l.description.slice(0, 35)} · ${Math.round(l.total_calories)} kcal`
  }).join('\n')

  const proteinPct = Math.round((totals.protein / goals.dailyProtein) * 100)
  const proteinBar = Math.min(10, Math.round(proteinPct / 10))

  return (
    `🥗 *Nutrition Today*\n\n` +
    `${mealLines}\n\n` +
    `*Calories:* ${totals.calories} / ${goals.dailyCalories} kcal\n` +
    `${bar} ${pct}%\n\n` +
    `*Protein:* ${totals.protein}g / ${goals.dailyProtein}g\n` +
    `${'█'.repeat(proteinBar)}${'░'.repeat(10 - proteinBar)} ${proteinPct}%\n\n` +
    `*Carbs:* ${totals.carbs}g · *Fat:* ${totals.fat}g · *Fiber:* ${totals.fiber}g\n\n` +
    (remaining > 0
      ? `✅ *${remaining} kcal remaining* — ${remaining > 500 ? 'room for a proper meal' : remaining > 200 ? 'room for a light meal' : 'just a small snack'}`
      : `⚡ *${Math.abs(remaining)} kcal over* — consider a light walk later`
    ) +
    `\n\n_Say *nutrition report* for your weekly card_`
  )
}

async function buildWeeklySummary(telegramId: number): Promise<string> {
  const goals = await getUserGoals(telegramId) || DEFAULT_GOALS
  const weekData = await getWeekNutrition(telegramId)

  if (!weekData || weekData.loggedDays === 0) {
    return `📊 *Weekly Nutrition*\n\nNo meals logged this week yet.\n\nStart by typing what you ate — _"had idli sambar for breakfast"_\n\nOr send a 📷 photo of any meal.`
  }

  const { byDay, loggedDays, avgCalories, avgProtein, bestDay } = weekData
  const goalPct = Math.round((avgCalories / goals.dailyCalories) * 100)

  const dayLines = Object.entries(byDay).map(([day, data]) => {
    const pct = Math.round((data.calories / goals.dailyCalories) * 100)
    const bar = '▓'.repeat(Math.min(5, Math.round(pct / 20))) + '░'.repeat(Math.max(0, 5 - Math.round(pct / 20)))
    return `${day}: ${bar} ${data.calories} kcal (${data.count} meals)`
  }).join('\n')

  const streakMsg = loggedDays >= 5 ? `🔥 ${loggedDays}-day logging streak! Amazing consistency.`
    : loggedDays >= 3 ? `⚡ ${loggedDays} days logged this week — building a great habit!`
    : `💡 ${loggedDays} days logged — try to hit 5+ days for best results.`

  return (
    `📊 *This Week's Nutrition*\n\n` +
    `${dayLines}\n\n` +
    `*Avg daily:* ${avgCalories} kcal · ${avgProtein}g protein\n` +
    `*Goal:* ${goals.dailyCalories} kcal · ${goalPct}% on target\n` +
    (bestDay ? `*Most active logging day:* ${bestDay}\n` : '') +
    `\n${streakMsg}\n\n` +
    `_Say *nutrition report card* for your visual weekly card (coming soon!)_`
  )
}

function buildGoalSetupMessage(): string {
  return (
    `🎯 *Set Your Nutrition Goal*\n\n` +
    `What are you working towards?\n\n` +
    `1️⃣ *Lose weight* — calorie deficit, high protein\n` +
    `2️⃣ *Build muscle* — calorie surplus, very high protein\n` +
    `3️⃣ *Balanced & healthy* — eat well, feel great\n` +
    `4️⃣ *Maintenance* — stay where you are\n\n` +
    `Reply with a number (1, 2, 3, or 4)`
  )
}

export async function handleGoalSelection(telegramId: number, goalType: 'weight_loss' | 'muscle' | 'balanced' | 'maintenance'): Promise<string> {
  const goals = calculateGoals({ goalType })
  await saveUserGoals(telegramId, goals)

  const labels = {
    weight_loss: '🔥 Weight Loss',
    muscle: '💪 Muscle Building',
    balanced: '🌿 Balanced & Healthy',
    maintenance: '⚖️ Maintenance'
  }

  return (
    `✅ *Goal set: ${labels[goalType]}*\n\n` +
    `*Your daily targets:*\n` +
    `• Calories: ${goals.dailyCalories} kcal\n` +
    `• Protein: ${goals.dailyProtein}g\n` +
    `• Carbs: ${goals.dailyCarbs}g\n` +
    `• Fat: ${goals.dailyFat}g\n\n` +
    `Now start logging! Type what you ate or send a 📷 photo of your plate.\n\n` +
    `_Example: "had 2 rotis, dal, and sabzi for lunch"_`
  )
}

function buildHelpMessage(): string {
  return (
    `🥗 *AskGogo Nutrition — How to use*\n\n` +
    `*Log meals (just type naturally):*\n` +
    `• _"Had 2 rotis with dal and sabzi"_\n` +
    `• _"Breakfast was poha and chai"_\n` +
    `• _"Ate chicken biryani for lunch"_\n` +
    `• 📷 Send any photo of your meal\n\n` +
    `*Check your progress:*\n` +
    `• *nutrition today* — today's calories & meals\n` +
    `• *nutrition report* — this week's summary\n\n` +
    `*Set your goal:*\n` +
    `• *nutrition goal* — choose weight loss / muscle / balanced\n\n` +
    `💡 *Tip:* Be specific for accuracy — "2 medium rotis with 1 bowl dal" is better than "lunch"`
  )
}

// Called directly from webhook when digit is sent after nutrition goal menu
export async function handleNutritionGoalSelection(telegramId: number, text: string): Promise<string> {
  const lower = text.trim()
  if (lower === '1') return handleGoalSelection(telegramId, 'weight_loss')
  if (lower === '2') return handleGoalSelection(telegramId, 'muscle')
  if (lower === '3') return handleGoalSelection(telegramId, 'balanced')
  if (lower === '4') return handleGoalSelection(telegramId, 'maintenance')
  return buildGoalSetupMessage()
}
