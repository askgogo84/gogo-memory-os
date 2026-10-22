/**
 * Pure text rules for "is this message a meal log?". Kept free of database imports so the intent
 * detector can use the same rule as the nutrition handler.
 */

// Word-boundary food lexicon. The old `lower.includes(w)` substring test fired
// on "price" (⊂ rice), "veggie" (⊂ egg), "scandal" (⊂ dal), "balloon" (⊂ aloo) —
// the \b anchors below kill those false positives.
const FOOD_WORDS = ['roti', 'rice', 'dal', 'dosa', 'idli', 'idly', 'sambar', 'biryani',
  'chai', 'coffee', 'paratha', 'poha', 'upma', 'sabzi', 'curry', 'chicken', 'egg', 'eggs',
  'paneer', 'milk', 'fruit', 'banana', 'apple', 'curd', 'yogurt', 'oats', 'bread',
  'pizza', 'burger', 'noodles', 'pasta', 'vada', 'uttapam', 'puri', 'chapati',
  'rajma', 'chole', 'aloo', 'gobi', 'palak', 'methi']
// Trailing `s?` matches plurals ("rotis", "eggs") without dropping the \b anchor
// that kills the substring false positives ("price" ⊄ rice, "veggie" ⊄ egg).
const FOOD_RE = new RegExp(`\\b(?:${FOOD_WORDS.join('|')})s?\\b`, 'i')

// An explicit "add X to my <list>" command is never a food log, even when X is a
// food word ("add milk to my groceries"). Belt-and-braces: the feature router
// already intercepts this shape with a deterministic list route BEFORE nutrition.
const ADD_TO_LIST_RE = /^\s*(?:gogo[,!\s]+)?add\b.+\b(?:to|into)\b/i

export function isNutritionLogText(text: string): boolean {
  const lower = text.toLowerCase().trim()

  // Nutrition requires EXPLICIT food-logging intent — never a bare food mention.
  if (ADD_TO_LIST_RE.test(lower)) return false
  if (lower.includes('remind') || lower.includes('recipe')) return false

  // "log …" / "track …" — a meal command only when a food/meal actually follows.
  // "track my order", "log in", "log out" must fall through (NOT nutrition).
  const logTrack = lower.match(/^(?:log|track)\s+(.+)/i)
  if (logTrack) {
    const rest = logTrack[1]
    if (/^(this|that|it|meal|my (meal|food|breakfast|lunch|dinner|snack))\b/i.test(rest)) return true
    if (/\b(meal|breakfast|lunch|dinner|snack|food)\b/i.test(rest)) return true
    return FOOD_RE.test(rest)
  }

  // Explicit meal declarations: "breakfast: …", "for lunch i had …".
  if (/^(breakfast|lunch|dinner|snack)\s*:/i.test(lower)) return true

  // Calorie / macro vocabulary is a nutrition signal on its own (word-boundary,
  // so "carbon" ⊄ carb).
  // 17 Oct scorecard: "calories in 2 idlis and sambar" is a question, not a meal eaten; it logged a meal.
  // Questions about calories are answered, not logged.
  // 22 Oct launch run (R25i): "Estimate the calories in two plain idlis and one cup of sambar." logged a meal too.
  // Asking for an estimate, count or breakdown is a question, whatever verb it opens with.
  if (/^(?:how\s+many|how\s+much|what(?:'s|\s+is|\s+are)?|calories\s+in|kcal\s+in|protein\s+in|carbs\s+in|is\s+there|does|do)\b/i.test(lower) || /\?\s*$/.test(lower)) return false
  if (/^(?:(?:please|can\s+you|could\s+you)\s+)?(?:estimate|calculate|count|check|tell\s+me|show\s+me|give\s+me|find|guess|approximate)\b/i.test(lower)) return false
  if (/\b(calories?|kcal|protein|carbs?|macros?)\b/i.test(lower)) return true

  // Otherwise require an eating verb AND a recognised food word. An eating verb
  // alone ("had a meeting") or a food word alone ("gold price") is not a log.
  const hasEatingVerb =
    /^(?:i\s+)?(?:just\s+)?(?:had|ate)\b/i.test(lower) ||
    /^(?:i\s+)?(?:am\s+)?eating\b/i.test(lower) ||
    /^for\s+(?:breakfast|lunch|dinner|snack)\b/i.test(lower)
  if (!hasEatingVerb) return false
  return FOOD_RE.test(lower) && lower.length < 200
}

