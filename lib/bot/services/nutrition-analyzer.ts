/**
 * AskGogo Nutrition Analyzer
 * World-class food intelligence powered by GPT-4o vision + text
 * 
 * Best features from:
 * - MyFitnessPal: large food database awareness
 * - Cronometer: micronutrient accuracy
 * - Noom: behavioral language, no guilt
 * - Healthify Me: Indian food first
 */

import OpenAI from 'openai'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export type FoodItem = {
  name: string
  quantity: string
  unit: string
  calories: number
  protein: number  // grams
  carbs: number    // grams
  fat: number      // grams
  fiber: number    // grams
  notes?: string
}

export type NutritionAnalysis = {
  mealType: 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'drink' | 'unknown'
  foodItems: FoodItem[]
  totalCalories: number
  totalProtein: number
  totalCarbs: number
  totalFat: number
  totalFiber: number
  confidence: 'high' | 'medium' | 'low'
  analysisNote: string  // e.g. "Estimated as home-style dal, varies by recipe"
  rawDescription: string
}

export type GoalType = 'weight_loss' | 'muscle' | 'balanced' | 'maintenance'

export type NutritionGoals = {
  dailyCalories: number
  dailyProtein: number
  dailyCarbs: number
  dailyFat: number
  dailyFiber: number
  goalType: GoalType
}

const SYSTEM_PROMPT = `You are AskGogo Nutrition AI — the most accurate Indian food nutrition analyzer.

CRITICAL RULES:
1. You are an EXPERT in Indian food: dal, sabzi, roti, rice, idli, dosa, sambar, poha, upma, biryani, curry, paratha, lassi, chai, etc.
2. Use REALISTIC portion sizes for Indian meals — not US serving sizes
3. Standard Indian portions: 1 roti = 70-90 cal, 1 cup cooked rice = 200 cal, 1 medium bowl dal = 150-180 cal
4. When quantity is unclear, assume a standard Indian meal portion
5. Be ACCURATE with protein — Indian vegetarian meals are typically low protein
6. NEVER guilt the user — be warm and encouraging
7. Account for oil/ghee in cooking — most Indian dishes use 1-2 tsp oil per serving
8. For restaurant food, add 20-30% more calories (more oil, butter, cream used)

OUTPUT: Return ONLY valid JSON, no other text.`

const USER_PROMPT_TEXT = (input: string) => `Analyze this food/meal and return nutrition data:

Input: "${input}"

Return this exact JSON structure:
{
  "mealType": "breakfast|lunch|dinner|snack|drink|unknown",
  "foodItems": [
    {
      "name": "food name",
      "quantity": "2",
      "unit": "rotis",
      "calories": 160,
      "protein": 5,
      "carbs": 28,
      "fat": 3,
      "fiber": 2,
      "notes": "home-style, estimated"
    }
  ],
  "totalCalories": 0,
  "totalProtein": 0,
  "totalCarbs": 0,
  "totalFat": 0,
  "totalFiber": 0,
  "confidence": "high|medium|low",
  "analysisNote": "brief note about estimation accuracy"
}

Calculate totals from all food items. Be realistic for Indian home cooking.`

const USER_PROMPT_IMAGE = (caption: string) => `Analyze the food in this image and return accurate nutrition data.
${caption ? `User caption: "${caption}"` : ''}

Identify all visible food items, estimate portions based on plate/bowl size, and calculate nutrition.
Return this exact JSON structure:
{
  "mealType": "breakfast|lunch|dinner|snack|drink|unknown",
  "foodItems": [
    {
      "name": "food name",
      "quantity": "1",
      "unit": "bowl",
      "calories": 0,
      "protein": 0,
      "carbs": 0,
      "fat": 0,
      "fiber": 0,
      "notes": "estimated from image"
    }
  ],
  "totalCalories": 0,
  "totalProtein": 0,
  "totalCarbs": 0,
  "totalFat": 0,
  "totalFiber": 0,
  "confidence": "high|medium|low",
  "analysisNote": "what you saw and how you estimated"
}`

export async function analyzeNutritionFromText(input: string): Promise<NutritionAnalysis> {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 800,
    temperature: 0.1,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: USER_PROMPT_TEXT(input) }
    ]
  })

  const raw = response.choices[0]?.message?.content?.trim() || ''
  const json = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()

  try {
    const parsed = JSON.parse(json)
    return { ...parsed, rawDescription: input }
  } catch {
    // Fallback
    return buildFallbackAnalysis(input)
  }
}

export async function analyzeNutritionFromImage(params: {
  mediaUrl: string
  contentType: string
  caption?: string
}): Promise<NutritionAnalysis> {
  // Download image
  const sid = process.env.TWILIO_ACCOUNT_SID
  const tok = process.env.TWILIO_AUTH_TOKEN
  let imageDataUrl: string | null = null

  if (sid && tok) {
    try {
      const res = await fetch(params.mediaUrl, {
        headers: { Authorization: `Basic ${btoa(`${sid}:${tok}`)}` }
      })
      if (res.ok) {
        const buf = await res.arrayBuffer()
        const bytes = new Uint8Array(buf)
        let b = ''
        bytes.forEach(x => b += String.fromCharCode(x))
        imageDataUrl = `data:${params.contentType};base64,${btoa(b)}`
      }
    } catch { /* fall through to text */ }
  }

  if (!imageDataUrl) {
    return analyzeNutritionFromText(params.caption || 'unknown meal from photo')
  }

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 800,
    temperature: 0.1,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: imageDataUrl, detail: 'high' } },
          { type: 'text', text: USER_PROMPT_IMAGE(params.caption || '') }
        ]
      }
    ]
  })

  const raw = response.choices[0]?.message?.content?.trim() || ''
  const json = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()

  try {
    const parsed = JSON.parse(json)
    return { ...parsed, rawDescription: params.caption || 'photo log' }
  } catch {
    return buildFallbackAnalysis(params.caption || 'meal from photo')
  }
}

function buildFallbackAnalysis(input: string): NutritionAnalysis {
  return {
    mealType: 'unknown',
    foodItems: [{ name: input, quantity: '1', unit: 'serving', calories: 300, protein: 10, carbs: 40, fat: 10, fiber: 3 }],
    totalCalories: 300,
    totalProtein: 10,
    totalCarbs: 40,
    totalFat: 10,
    totalFiber: 3,
    confidence: 'low',
    analysisNote: 'Estimated — try describing your meal in more detail for accuracy',
    rawDescription: input
  }
}

export function calculateGoals(params: {
  goalType: GoalType
  weightKg?: number
  heightCm?: number
  age?: number
  gender?: string
  activityLevel?: string
}): NutritionGoals {
  // Mifflin-St Jeor BMR
  const w = params.weightKg || 70
  const h = params.heightCm || 165
  const a = params.age || 30
  const isMale = (params.gender || 'other').toLowerCase() === 'male'

  const bmr = isMale
    ? (10 * w) + (6.25 * h) - (5 * a) + 5
    : (10 * w) + (6.25 * h) - (5 * a) - 161

  const activityMultipliers: Record<string, number> = {
    sedentary: 1.2,
    light: 1.375,
    moderate: 1.55,
    active: 1.725,
    very_active: 1.9
  }

  const tdee = bmr * (activityMultipliers[params.activityLevel || 'moderate'] || 1.55)

  const goals: Record<GoalType, NutritionGoals> = {
    weight_loss: {
      goalType: 'weight_loss',
      dailyCalories: Math.round(tdee * 0.8),  // 20% deficit
      dailyProtein: Math.round(w * 1.6),       // high protein to preserve muscle
      dailyCarbs: Math.round((tdee * 0.8 * 0.4) / 4),
      dailyFat: Math.round((tdee * 0.8 * 0.3) / 9),
      dailyFiber: 30
    },
    muscle: {
      goalType: 'muscle',
      dailyCalories: Math.round(tdee * 1.1),  // slight surplus
      dailyProtein: Math.round(w * 2.0),       // very high protein
      dailyCarbs: Math.round((tdee * 1.1 * 0.45) / 4),
      dailyFat: Math.round((tdee * 1.1 * 0.25) / 9),
      dailyFiber: 25
    },
    balanced: {
      goalType: 'balanced',
      dailyCalories: Math.round(tdee),
      dailyProtein: Math.round(w * 1.2),
      dailyCarbs: Math.round((tdee * 0.5) / 4),
      dailyFat: Math.round((tdee * 0.3) / 9),
      dailyFiber: 28
    },
    maintenance: {
      goalType: 'maintenance',
      dailyCalories: Math.round(tdee),
      dailyProtein: Math.round(w * 1.0),
      dailyCarbs: Math.round((tdee * 0.5) / 4),
      dailyFat: Math.round((tdee * 0.3) / 9),
      dailyFiber: 25
    }
  }

  return goals[params.goalType]
}

export function buildNutritionLogReply(params: {
  analysis: NutritionAnalysis
  todayTotal: { calories: number; protein: number; carbs: number; fat: number }
  goals: NutritionGoals
  mealCount: number
}): string {
  const { analysis, todayTotal, goals, mealCount } = params
  const remaining = goals.dailyCalories - todayTotal.calories
  const pct = Math.round((todayTotal.calories / goals.dailyCalories) * 100)

  // Build food items summary
  const foodList = analysis.foodItems
    .slice(0, 5)
    .map(f => `  • ${f.quantity} ${f.unit} ${f.name} — ${f.calories} kcal`)
    .join('\n')

  // Progress bar (10 blocks)
  const filled = Math.min(10, Math.round(pct / 10))
  const bar = '█'.repeat(filled) + '░'.repeat(10 - filled)

  // Behavioral message (Noom-style, no guilt)
  const behavMsg = getBehavioralMessage(pct, analysis.mealType, analysis.totalProtein, mealCount)

  // Confidence caveat
  const caveat = analysis.confidence === 'low' ? '\n_⚠️ Estimates may vary — describe meals in detail for accuracy_' : ''

  return (
    `🥗 *Meal logged!*\n\n` +
    `${foodList}\n\n` +
    `*This meal:* ${analysis.totalCalories} kcal · ${analysis.totalProtein}g protein · ${analysis.totalCarbs}g carbs · ${analysis.totalFat}g fat\n\n` +
    `*Today so far:* ${todayTotal.calories} / ${goals.dailyCalories} kcal\n` +
    `${bar} ${pct}%\n\n` +
    `${behavMsg}${caveat}\n\n` +
    `_Say *nutrition today* for full breakdown · *nutrition report* for your week_`
  )
}

function getBehavioralMessage(pct: number, mealType: string, protein: number, mealCount: number): string {
  if (pct < 30) return `You're off to a great start. Plenty of room for nourishing meals ahead. 💪`
  if (pct < 60) return `You're nicely on track. ${protein < 15 ? 'A protein-rich snack like eggs, paneer, or dal would balance this meal.' : 'Good protein balance!'}`
  if (pct < 85) return `Getting close to your goal — a light dinner will keep you in a great range today. ✨`
  if (pct < 100) return `Almost at your target. A light meal or just fruits/salad for the rest of the day would be perfect. 🌿`
  if (pct < 120) return `Slightly over today — and that's completely okay. One meal doesn't define your progress. Stay hydrated and enjoy tomorrow fresh. 🙏`
  return `You went over today. No judgment — every day is a new start. Try logging breakfast tomorrow and see how it sets the tone. 🌅`
}
