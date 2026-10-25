// Verifies feature-router decision (routeFeatureIntent order) for the milk/list
// bug. Models the two gates that matter — the NEW "add X to Y" list route and the
// nutrition gate — with OLD vs NEW matcher logic copied verbatim from the source.
// Downstream (detectIntent) resolution is annotated for fall-through phrases.

// ── OLD logic (pre-fix, verbatim from git history) ──────────────────────────
function old_isNutritionLogText(text) {
  const lower = text.toLowerCase().trim()
  const foodWords = ['roti','rice','dal','dosa','idli','idly','sambar','biryani',
    'chai','coffee','paratha','poha','upma','sabzi','curry','chicken','egg',
    'paneer','milk','fruit','banana','apple','curd','yogurt','oats','bread',
    'pizza','burger','noodles','pasta','vada','uttapam','puri','chapati',
    'rajma','chole','aloo','gobi','palak','methi']
  const hasFoodWord = foodWords.some(w => lower.includes(w))
  const hasEatingPrefix = /^(log|ate|had|i had|i ate|just had|just ate|i just|breakfast:|lunch:|dinner:|snack:|for breakfast|for lunch|for dinner)/i.test(lower)
  const hasCalorieWord = /calorie|calori|kcal|protein|carb|macro/i.test(lower)
  return hasEatingPrefix || hasCalorieWord || (hasFoodWord && lower.length < 200 && !lower.includes('remind') && !lower.includes('recipe'))
}
function old_isNutritionCommand(text) {
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

// ── NEW logic (post-fix, verbatim from lib/bot/handlers/nutrition.ts) ────────
const FOOD_WORDS = ['roti','rice','dal','dosa','idli','idly','sambar','biryani',
  'chai','coffee','paratha','poha','upma','sabzi','curry','chicken','egg','eggs',
  'paneer','milk','fruit','banana','apple','curd','yogurt','oats','bread',
  'pizza','burger','noodles','pasta','vada','uttapam','puri','chapati',
  'rajma','chole','aloo','gobi','palak','methi']
const FOOD_RE = new RegExp(`\\b(?:${FOOD_WORDS.join('|')})s?\\b`, 'i')
const ADD_TO_LIST_RE = /^\s*(?:gogo[,!\s]+)?add\b.+\b(?:to|into)\b/i

function new_isNutritionLogText(text) {
  const lower = text.toLowerCase().trim()
  if (ADD_TO_LIST_RE.test(lower)) return false
  if (lower.includes('remind') || lower.includes('recipe')) return false
  const logTrack = lower.match(/^(?:log|track)\s+(.+)/i)
  if (logTrack) {
    const rest = logTrack[1]
    if (/^(this|that|it|meal|my (meal|food|breakfast|lunch|dinner|snack))\b/i.test(rest)) return true
    if (/\b(meal|breakfast|lunch|dinner|snack|food)\b/i.test(rest)) return true
    return FOOD_RE.test(rest)
  }
  if (/^(breakfast|lunch|dinner|snack)\s*:/i.test(lower)) return true
  if (/\b(calories?|kcal|protein|carbs?|macros?)\b/i.test(lower)) return true
  const hasEatingVerb =
    /^(?:i\s+)?(?:just\s+)?(?:had|ate)\b/i.test(lower) ||
    /^(?:i\s+)?(?:am\s+)?eating\b/i.test(lower) ||
    /^for\s+(?:breakfast|lunch|dinner|snack)\b/i.test(lower)
  if (!hasEatingVerb) return false
  return FOOD_RE.test(lower) && lower.length < 200
}
function new_isNutritionCommand(text) {
  const lower = text.toLowerCase().trim()
  return (
    lower === 'nutrition today' || lower === 'nutrition' || lower === 'calories today' ||
    lower === 'my calories' || lower === 'food today' || lower === 'what did i eat' ||
    lower === 'nutrition report' || lower === 'nutrition week' || lower === 'weekly nutrition' ||
    lower === 'nutrition summary' || lower === 'my nutrition' ||
    lower === 'set nutrition goal' || lower === 'nutrition goal' || lower === 'set calorie goal' ||
    lower === 'nutrition help' || lower === 'calorie help' || lower === 'food help'
  )
}

// NEW list-add gate (feature-intents.ts, runs BEFORE nutrition)
const LIST_ADD_RE = /^\s*(?:gogo[,!\s]+)?add\s+(.+?)\s+(?:to|into)\s+(?:my\s+)?(.+?)\s*$/i

// Models handleNutritionText's log-vs-query decision. `withGuard` = the NEW
// interrogative guard (questions never call logMealFromText).
function nutritionOutcome(text, withGuard) {
  const lower = text.toLowerCase().trim()
  const QUERY_CMDS = ['nutrition today','calories today','food today','my calories','what did i eat','nutrition',
    'nutrition card','daily card','nutrition daily card','nutrition report card','weekly card','nutrition weekly card',
    'nutrition report','nutrition week','weekly nutrition','nutrition summary',
    'set nutrition goal','nutrition goal','set calorie goal','nutrition help','calorie help','food help']
  if (QUERY_CMDS.includes(lower)) return 'query'
  if (/^(this|that|it|review|check|later|end of day|end of the day)[\.\s]*$/i.test(lower)
      || /i want to review/i.test(lower) || /review at the end/i.test(lower)) return 'query'
  if (withGuard) {
    const isQuestion = lower.endsWith('?') || /^(how|what|which|is|are|does|do|can|should|when|why|where)\b/i.test(lower)
    if (isQuestion) return 'query'
  }
  return 'log'
}

// Model routeFeatureIntent's decision (text path, telegramId present) for the
// gates under test. "fallthrough" ⇒ goes to processIncomingMessage/detectIntent.
// Nutrition is annotated log|query so we can prove questions don't write a meal.
function route(text, mode) {
  if (mode === 'new') {
    const la = text.match(LIST_ADD_RE)
    if (la) {
      const item = la[1].trim()
      const isReminderShape = /^(a |an )?(reminder|alarm|alert)$/i.test(item) || /\badd\s+(?:a |an )?(?:reminder|alarm)\b/i.test(text)
      if (item && !isReminderShape) return 'lists'
    }
  }
  const isNut = mode === 'old'
    ? (old_isNutritionLogText(text) || old_isNutritionCommand(text))
    : (new_isNutritionLogText(text) || new_isNutritionCommand(text))
  if (isNut) return 'nutrition/' + nutritionOutcome(text, mode === 'new')
  return 'fallthrough'
}

// [phrase, expected-new-route, note]
const cases = [
  ['Gogo, add milk to my groceries',        'lists',            'chip'],
  ['add paneer to my weekend list',         'lists',            'arbitrary list noun'],
  ['add eggs to my grocery list',           'lists',            'egg ⊂ veggie substring'],
  ['add sunscreen to my Goa list',          'lists',            'non-food item'],
  ['add a reminder to call mom',            'fallthrough',      '→ reminder, not lists'],
  ['current gold price in India today',     'fallthrough',      '→ gold_live'],
  ['latest petrol price in Bengaluru today','fallthrough',      '→ web_search'],
  ['remind me to buy milk',                 'fallthrough',      '→ set_reminder'],
  ['had a meeting at 4',                     'fallthrough',      'NOT nutrition'],
  ['track my order',                         'fallthrough',      'NOT nutrition'],
  ['2 idlis and sambar',                     'fallthrough',      '→ general_chat/Claude'],
  ['how many calories in an apple',         'nutrition/query',  'query, no meal logged'],
  ['how many calories did I eat today',     'nutrition/query',  'query, no meal logged'],
  ['had 2 idlis and sambar for breakfast',  'nutrition/log',    'real log'],
  ['i ate chicken biryani for lunch',       'nutrition/log',    'real log'],
  ['log 2 rotis',                            'nutrition/log',    'guard must not over-fire'],
  ['log meal',                               'nutrition/log',    'explicit log command'],
  ['breakfast: poha and chai',              'nutrition/log',    'explicit meal declaration'],
]

const pad = (s, n) => (s + ' '.repeat(n)).slice(0, n)
console.log(pad('PHRASE', 42), pad('OLD', 15), pad('NEW', 17), 'EXPECTED / note')
console.log('-'.repeat(120))
let fails = 0
for (const [phrase, want, note] of cases) {
  const oldR = route(phrase, 'old')
  const newR = route(phrase, 'new')
  const ok = newR === want
  if (!ok) fails++
  console.log(pad(phrase, 42), pad(oldR, 15), pad(newR + (ok ? ' ✓' : ' ✗'), 17), `${want}  (${note})`)
}
console.log('-'.repeat(120))
console.log(fails === 0 ? 'ALL NEW ROUTES MATCH EXPECTED ✓' : `${fails} MISMATCH(ES) ✗`)
process.exit(fails === 0 ? 0 : 1)
