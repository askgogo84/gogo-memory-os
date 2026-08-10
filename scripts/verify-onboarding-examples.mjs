// Proves every onboarding example in EXAMPLE_PHRASINGS routes to its intended
// handler in the REAL two-stage pipeline order: routeFeatureIntent (the feature
// router in lib/feature-intents.ts) runs FIRST; only phrases it does not claim
// fall through to detectIntent (lib/bot/detect-intent.ts).
//
// Modelled on verify-creditiq-routing.mjs. The matcher logic below is copied
// VERBATIM from source — the split parser, the nutrition gates, the feature
// router's ordered gates, and detectIntent — so a phrase claimed by an upstream
// matcher (e.g. "my card balance" hijacked by bill-split) is reported as reaching
// THAT handler, not its intended one. Claiming-by-the-wrong-matcher is a FAILURE.
//
// EXAMPLE_PHRASINGS is imported from the shipped copy module (Node 24 strips the
// TS types natively), so the strings tested here are exactly the strings sent.

import { EXAMPLE_PHRASINGS } from '../lib/bot/onboarding-copy.ts'

// ───────────────────────────────────────────────────────────────────────────
// VERBATIM: lib/splitwise/split-parser.ts (only the parts that decide non-null)
// ───────────────────────────────────────────────────────────────────────────
function normalizeMemberName(value) {
  const clean = String(value || '').trim().replace(/^@+/, '')
  if (!clean) return ''
  if (/^(me|myself|i)$/i.test(clean)) return 'Me'
  return clean.split(/\s+/).map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(' ')
}
function splitMembers(value) {
  return String(value || '').split(/,|\band\b|\+|&/i).map(normalizeMemberName).filter(Boolean)
}
function parseAmount(text) {
  const m = text.match(/(?:rs\.?|inr|₹)?\s*(\d+(?:\.\d+)?)/i)
  return m ? Number(m[1]) : null
}
function cleanGroupName(value) {
  const clean = String(value || '').trim()
    .replace(/^in\s+/i, '').replace(/^for\s+/i, '').replace(/^of\s+/i, '')
    .replace(/^trip\s+/i, '').replace(/^group\s+/i, '').replace(/\s+/g, ' ')
  return clean || undefined
}
// parseSplitIntent — returns non-null when the split router would claim the text.
function parseSplitIntent(input) {
  const text = String(input || '').trim()
  const lower = text.toLowerCase().trim()
  if (!text) return null
  if (text.match(/^(?:join|accept)\s+(?:split\s+)?([a-f0-9]{8,32})$/i)) return { type: 'join' }
  if (text.match(/^(?:create|start|new)\s+(?:group|trip|event)\s+(.+?)(?:\s+with\s+(.+))?$/i)) return { type: 'create_group' }
  if (text.match(/^invite\s+([a-zA-Z][\w\s]*?)(?:\s+(\+?\d{8,15}))?(?:\s+to\s+(.+))?$/i)) return { type: 'invite' }
  if (text.match(/^(?:settle\s+)?([a-zA-Z][\w\s]*?)\s+(?:paid|sent|gave)\s+([a-zA-Z][\w\s]*?)\s+(?:rs\.?|inr|₹)?\s*(\d+(?:\.\d+)?)(?:\s+in\s+(.+))?$/i)) return { type: 'settle' }
  if (/^(my splits?|past splits?|split history|recent splits?)$/i.test(lower)) return { type: 'history' }
  if (text.match(/^(?:show\s+)?(?:balance|balances|who owes who|who owes whom)(?:\s+(?:(?:for|in|of)\s+)?(.+))?$/i)) return { type: 'show_balance' }
  if (text.match(/^(.+?)\s+(?:balance|balances)$/i)) return { type: 'show_balance' } // reverse — "my card balance" hijack
  if (text.match(/^(?:simplify|settlement|settlements|simplify settlement|simplify debts)(?:\s+(?:(?:for|in|of)\s+)?(.+))?$/i)) return { type: 'simplify' }
  if (text.match(/^(.+?)\s+(?:settlement|settlements|simplify|simplified settlement)$/i)) return { type: 'simplify' }
  if (text.match(/^(?:share|show|create|generate)?\s*(?:expense\s*)?(?:chart|summary card|split chart)(?:\s+(?:(?:for|in|of)\s+)?(.+))?$/i)) return { type: 'share_chart' }
  if (text.match(/^(.+?)\s+(?:chart|summary card|split chart)$/i)) return { type: 'share_chart' }
  const amount = parseAmount(text)
  const expenseLike = /\b(split|expense|paid|spent|add expense|bill|cab|hotel|dinner|lunch|breakfast|fuel|stay|tickets?|rent)\b/i.test(text)
  if (amount && expenseLike) return { type: 'add_equal_expense' }
  if (/^(trip summary|expense summary|category breakdown|show categories|spending breakdown)(?:\s+(.+))?$/i.test(lower)) return { type: 'trip_summary' }
  if (/^(remind|nudge|ping)\s+(everyone|all|debtors|members)(?:\s+(?:in|for|about)\s+(.+))?$/i.test(lower)) return { type: 'remind_debtors' }
  if (lower.match(/^(?:set\s+)?budget\s+(?:rs\.?|inr|₹)?(\d+(?:\.\d+)?)(?:\s+(?:per\s+person)?)?(?:\s+(?:in|for)\s+(.+))?$/i)) return { type: 'set_budget' }
  if (/^(who owes me|my receivables?|owed to me)(?:\s+(?:in|for)\s+(.+))?$/i.test(lower)) return { type: 'who_owes_me' }
  if (/^(scan receipt|read receipt|add receipt)(?:\s+(?:in|for)\s+(.+))?$/i.test(lower)) return { type: 'scan_receipt' }
  return null
}

// ───────────────────────────────────────────────────────────────────────────
// VERBATIM: lib/bot/handlers/nutrition.ts — the two gates the router calls.
// ───────────────────────────────────────────────────────────────────────────
const FOOD_WORDS = ['roti', 'rice', 'dal', 'dosa', 'idli', 'idly', 'sambar', 'biryani',
  'chai', 'coffee', 'paratha', 'poha', 'upma', 'sabzi', 'curry', 'chicken', 'egg', 'eggs',
  'paneer', 'milk', 'fruit', 'banana', 'apple', 'curd', 'yogurt', 'oats', 'bread',
  'pizza', 'burger', 'noodles', 'pasta', 'vada', 'uttapam', 'puri', 'chapati',
  'rajma', 'chole', 'aloo', 'gobi', 'palak', 'methi']
const FOOD_RE = new RegExp(`\\b(?:${FOOD_WORDS.join('|')})s?\\b`, 'i')
const ADD_TO_LIST_RE = /^\s*(?:gogo[,!\s]+)?add\b.+\b(?:to|into)\b/i
function isNutritionLogText(text) {
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
function isNutritionCommand(text) {
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

// ───────────────────────────────────────────────────────────────────────────
// STAGE 1 — routeFeatureIntent (lib/feature-intents.ts), text-command path with
// telegramId present. Gates copied verbatim in source order. Returns the feature
// handler label that would claim the text, or 'fallthrough' to reach detectIntent.
// URL / media-card branches are omitted: no test phrase carries a URL or preview
// card, so they never fire here.
// ───────────────────────────────────────────────────────────────────────────
function normalizeListName(raw) {
  let n = raw.toLowerCase().trim().replace(/\s+/g, ' ').replace(/\s+list$/, '').trim()
  if (n === 'groceries' || n === 'grocery') return 'grocery'
  if (n === 'shopping') return 'shopping'
  if (n === 'to-do' || n === 'to do' || n === 'todo') return 'todo'
  if (n === 'note' || n === 'notes') return 'notes'
  return n || 'list'
}
function routeFeatureIntent(text) {
  const t = text.toLowerCase().trim()

  // SKIN CHECK FOLLOW-UP
  if (/\bremind\b/i.test(t) && /\bskin\s*check\b/i.test(t) &&
      (/\b2\s*weeks?\b/i.test(t) || /\btwo\s*weeks?\b/i.test(t) || /\b14\s*days?\b/i.test(t))) return 'skin_reminder'

  // DAILY BRIEFING
  if (/^(morning|good morning|daily briefing|my briefing|briefing|morning briefing|today briefing|today summary|plan my day|help me plan my day|today)$/i.test(t)) return 'briefing'

  // RECORD MEETING
  if (/^(record|start recording|record meeting|record the meeting|meeting record|start meeting|begin meeting|take notes|record call|record the call|record making|i.ll record|recording meeting|record a meeting|start record|record this meeting|wanna record|want to record|i want to record)$/i.test(t) ||
      (t.includes('record') && t.includes('meet')) ||
      (t.includes('record') && t.length < 25)) return 'record_meeting'
  if (/^(end meeting|stop recording|stop meeting|meeting ended|meeting done)$/i.test(t)) return 'record_meeting'

  // SAVED REELS QUERY — source returns null here (falls through to Claude/detectIntent)
  if (/^(my saved reels?|saved reels?|saved videos?|my reels?|my saved posts?|my linkedin saves?)$/.test(t)) return 'fallthrough'

  // ADD TO LIST ("add milk to my groceries") — deterministic, BEFORE nutrition
  const listAdd = text.match(/^\s*(?:gogo[,!\s]+)?add\s+(.+?)\s+(?:to|into)\s+(?:my\s+)?(.+?)\s*$/i)
  if (listAdd) {
    const item = listAdd[1].trim()
    const listName = normalizeListName(listAdd[2])
    const isReminderShape = /^(a |an )?(reminder|alarm|alert)$/i.test(item) || /\badd\s+(?:a |an )?(?:reminder|alarm)\b/i.test(text)
    if (item && listName && !isReminderShape) return 'lists'
  }

  // NUTRITION (before split)
  if (isNutritionLogText(text) || isNutritionCommand(text)) return 'nutrition'

  // ASK GOGO SPLIT (guarded by nutrition)
  if (!isNutritionLogText(text) && parseSplitIntent(text)) return 'split'

  // EXPENSES — log
  const isExpenseLog = (
    /^(spent|paid|expensed?|cost)\s/i.test(t) ||
    /^[₹]\s*\d/i.test(t) ||
    /^(rs|inr)\.?\s*\d/i.test(t) ||
    (/^\d+\s+(on|for)\s+/i.test(t)) ||
    (/^[a-z][\w\s]+\s+\d{2,5}$/i.test(t) && t.split(' ').length <= 4 && !/^(remind|set|add|show|my|get|how|what|when|tasks?|notes?)/i.test(t))
  )
  if (isExpenseLog) return 'expense'
  // EXPENSES — query
  if (/^(my expenses?|expenses? today|spending today|expense (report|insight|summary)|how much.*(spend|spent)|analyse.*spend)/i.test(t)) return 'expense'

  // TODOS
  if (/^(add task|new task|todo|task:)\s/i.test(t)) return 'todos'
  if (/^(tasks?|my tasks?|show tasks?|to-?do list?)$/i.test(t)) return 'todos'
  if (t.match(/^(done|completed?|finished?|did)\s+(.+)/)) return 'todos'
  if (/^clear (completed|done) tasks?$/i.test(t)) return 'todos'

  // CONTACT MEMORY
  const NON_CONTACT_LEADS = new Set(['my', 'the', 'a', 'an', 'this', 'that', 'these', 'those', 'his', 'her', 'its', 'their',
    'our', 'your', 'to', 'it', 'i', 'me', 'we', 'they', 'he', 'she', 'when', 'how', 'what', 'why', 'if'])
  const rememberMatch = text.match(/^remember\s+(\w+)\s+(.+)/i)
  const factText = rememberMatch ? rememberMatch[2] : ''
  const looksLikeContact = /\b\d{6,}\b/.test(factText) || /[\w.+-]+@[\w-]+\.[\w.-]+/.test(factText) ||
    /\b(number|phone|mobile|whatsapp|email|contact|birthday|bday|anniversary|address)\b/i.test(factText)
  if (rememberMatch && !/^remember\s+that\b/i.test(text) && !NON_CONTACT_LEADS.has(rememberMatch[1].toLowerCase()) && looksLikeContact) return 'contacts'
  if (text.match(/(?:what do i know about|tell me about|notes on)\s+(\w+)/i)) return 'contacts'
  if (/^(my contacts?|contact notes?)$/i.test(t)) return 'contacts'

  // FOLLOW-UPS
  if (text.match(/follow.?up with\s+(\w+)(?:.*?in\s+(\d+)\s+days?)?/i)) return 'followups'

  // NEWS
  if (/^(news|headlines?|digest)(\s+(tech|market|cricket|startup|world|politics))?$/i.test(t)) return 'news'

  return 'fallthrough'
}

// ───────────────────────────────────────────────────────────────────────────
// STAGE 2 — detectIntent (lib/bot/detect-intent.ts), copied verbatim.
// ───────────────────────────────────────────────────────────────────────────
const SEARCH_HINTS = ['latest', 'news', 'today', 'current', 'score', 'stock', 'price']
function isReferralIntent(lower) {
  return (
    lower === 'invite' || lower === 'invite friends' || lower === 'invite frnds' || lower === 'invite frnd' ||
    lower === 'invite friend' || lower === 'refer' || lower === 'referral' || lower === 'share' ||
    lower === 'my referral' || lower === 'referral status' || lower === 'my referral status' ||
    lower.includes('invite my friends') || lower.includes('invite my frnds') || lower.includes('refer friends') || lower.includes('refer frnds')
  )
}
function isBriefingSettingsIntent(lower) {
  return (
    /set (my )?(daily |morning )?briefing (to|at)/i.test(lower) ||
    /briefing at \d/i.test(lower) ||
    /send (my )?(daily |morning )?briefing at/i.test(lower) ||
    lower === 'briefing status' || lower === 'daily briefing status' || lower === 'morning briefing status' ||
    lower === 'turn off daily briefing' || lower === 'turn off morning briefing' ||
    lower === 'stop daily briefing' || lower === 'stop morning briefing' ||
    lower === 'disable daily briefing' || lower === 'disable morning briefing'
  )
}
function detectIntent(text) {
  const t = (text || '').trim()
  const lower = t.toLowerCase()
  if (!lower) return 'general_chat'
  if (/^(hi|hello|hey|start|\/start)$/i.test(lower)) return 'welcome_menu'
  if (lower === 'help' || lower === '/help' || lower === 'menu' || lower === 'commands' || lower === 'what can you do') return 'help_menu'
  {
    const cq = lower.match(/^link\s+creditiq\s+(\d{6})$/) || lower.match(/^creditiq\s+(?:link\s+)?(\d{6})$/)
    if (cq) return 'creditiq_link'
  }
  if (
    /^(show\s+)?my\s+(credit\s+)?cards$/.test(lower) ||
    /^show\s+cards$/.test(lower) ||
    /^(show\s+)?my\s+portfolio$/.test(lower) ||
    /^(show\s+)?my\s+(reward\s+)?points$/.test(lower) ||
    /^(show\s+)?my\s+creditiq$/.test(lower) ||
    /^creditiq\s+(cards|portfolio|points)$/.test(lower) ||
    /^(?:show\s+(?:me\s+)?|check\s+|what(?:'?s|\s+is|\s+are)\s+)?my\s+(?:credit\s+|reward\s+)?(?:cards?|points|miles|card\s+balance)\b/.test(lower) ||
    /^how\s+many\s+(?:credit\s+|reward\s+)?(?:cards?|points|miles)\b.*\b(?:do\s+i|i\s+have|have\s+i|i've)\b/.test(lower) ||
    /^what\s+(?:credit\s+|reward\s+)?(?:cards?|points|miles)\s+(?:do\s+i\s+have|have\s+i)\b/.test(lower)
  ) return 'creditiq_cards'
  if (lower === 'dashboard' || lower === '/dashboard' || lower === 'my dashboard' || lower === 'open dashboard' || lower === 'web dashboard' || lower === 'dashboard link' || lower === 'my dashboard link') return 'dashboard'
  if (lower === 'pricing' || lower === 'price' || lower === 'plans' || lower === 'plan' || lower === 'upgrade' || lower === '/upgrade' || lower === 'payment' || lower === 'payments' || lower === 'subscribe' || lower === 'razorpay' || lower === 'paid plan') return 'upgrade_plan'
  if (lower === 'notify me' || lower === 'notify' || lower === 'notify me when live' || lower === 'notify me when payment is live' || lower === 'founder offer' || lower === 'founder pricing' || lower.includes('early access') || lower.includes('i want pro') || lower.includes('i want lite') || lower.includes('i want starter') || lower.includes('i want founder') || lower.includes('want paid plan') || lower.includes('want to subscribe') || lower.includes('interested in paid')) return 'notify_me'
  if (isReferralIntent(lower)) return 'referral_flow'
  if (lower === 'show reminders' || lower === 'show my reminders' || lower === 'my reminders' || lower === 'pending reminders' || lower === 'active reminders' || lower === 'list reminders' || lower === 'what are my reminders' || lower === 'what reminders do i have' || lower.includes('show pending reminders') || /^cancel\b/i.test(lower) || /^delete\b/i.test(lower) || /^remove\b/i.test(lower) || /^clear reminder\b/i.test(lower) || /^stop reminder\b/i.test(lower) || /^done\s+\d+\b/i.test(lower) || /^complete\s+\d+\b/i.test(lower) || /^mark\s+\d+\s+done\b/i.test(lower) || /^snooze\s+\d+\s+(for\s+)?\d+\s*(minute|minutes|min|mins|hour|hours)\b/i.test(lower) || lower === 'done' || lower === 'mark done' || lower === 'completed' || lower === 'complete' || lower === 'finished' || lower === 'mark as done' || /^snooze\b/i.test(lower) || /^move it\b/i.test(lower) || /^move reminder\b/i.test(lower) || /^reschedule\b/i.test(lower) || /^tomorrow instead$/i.test(lower) || /^change it to\b/i.test(lower)) return 'edit_reminder'
  if (isBriefingSettingsIntent(lower)) return 'set_briefing_time'
  if (lower === 'today' || lower === 'today summary' || lower === 'today briefing' || lower === 'what is today' || lower === 'morning briefing' || lower === 'daily briefing' || lower === 'good morning' || lower === 'brief me' || lower === "what's my day today" || lower === 'whats my day today' || lower === "what's my day" || lower === 'my day today' || lower === 'my briefing' || lower === 'my day') return 'morning_briefing'
  if (lower.includes('connect my gmail') || lower.includes('connect to my gmail') || lower.includes('connect gmail') || lower.includes('connect to gmail') || lower.includes('link gmail') || lower.includes('gmail connect')) return 'connect_gmail'
  if (lower.includes('draft a reply') || lower.includes('reply to this email') || lower.includes('reply to this mail') || lower.includes('reply to the latest mail') || lower.includes('reply to latest email') || lower.includes('reply to the vercel email') || lower.includes('reply to the latest unread email') || lower.includes('reply to latest unread email') || lower.includes('reply to the latest unread mail') || lower.includes('reply to latest unread mail') || lower.includes('draft reply to') || lower.includes('write a reply to this email')) return 'email_action'
  if (lower.includes('check my latest mail') || lower.includes('check my latest mails') || lower.includes('latest mail') || lower.includes('latest mails') || lower.includes('latest email') || lower.includes('latest emails') || lower.includes('show my unread emails') || lower.includes('show unread emails') || lower.includes('check unread emails') || lower.includes('any new mails') || lower.includes('any new mail') || lower.includes('check my inbox') || lower.includes('mail summary') || lower.includes('mails summary') || lower.includes('email summary') || lower.includes('emails summary') || lower.includes('top 3 mails') || lower.includes('top 3 mail') || lower.includes('top 3 emails') || lower.includes('top 3 email') || lower.includes('check my top 3 mail') || lower.includes('check my top 3 email') || lower.includes('show me my top 3 mails') || lower.includes('show me my top 3 email') || lower.includes('summarize my mails') || lower.includes('summarize my emails') || lower.includes('summarize top 3 mails') || lower.includes('summarize top 3 emails') || lower.includes('top 3 mails summary') || lower.includes('top 3 emails summary')) return 'read_gmail'
  if (lower.includes('connect calendar') || lower.includes('connect my calendar') || lower.includes('connect to my calendar') || lower.includes('link calendar') || lower.includes('google calendar')) return 'connect_calendar'
  if (lower.includes('remind me') || lower.includes('remind to') || lower.startsWith('remind ')) return 'set_reminder'
  if (/^(change time to|change it to|make it|set it to|update to|change to)\s+/i.test(lower)) return 'set_reminder'
  if (/^(at\s+)?\d{1,2}(:\d{2})?\s*(am|pm)$/i.test(lower)) return 'set_reminder'
  if (/^(on\s+)?\d{1,2}(st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(lower)) return 'set_reminder'
  if (/^(tomorrow|tmrw|tmr)\s*(morning|evening|noon|afternoon|night)?$/i.test(lower)) return 'set_reminder'
  if (lower.includes('weather') || lower.includes('temperature') || lower.includes('rain')) return 'weather_live'
  if (lower.includes('gold price') || lower.includes('gold rate') || lower.includes('silver price') || lower.includes('silver rate')) return 'gold_live'
  if (lower.includes('ipl table') || lower.includes('points table') || lower.includes('table toppers') || lower.includes('ipl standings') || lower.includes('ipl topper')) return 'sports_standings'
  if ((lower.includes('rcb') && lower.includes('match')) || (lower.includes('ipl') && lower.includes('match')) || lower.includes('next rcb match') || lower.includes('when is the next rcb match')) return 'sports_schedule'
  if (lower.includes('remind me') || lower.includes('remind to') || lower.startsWith('remind ') || lower.includes('set a reminder') || lower.includes('set reminder') || lower.includes('reminder for') || /\b(on\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(lower) || /\b(tomorrow|tmrw|tmr)\b/i.test(lower) || /\bin\s+\d+\s+(minute|minutes|min|mins|hour|hours|day|days)\b/i.test(lower) || /\bat\s+\d{1,2}(:\d{2})?\s*(am|pm)\b/i.test(lower)) return 'set_reminder'
  if (lower === 'show all lists' || lower === 'list all' || lower === 'show my lists') return 'list_show_all'
  if ((lower.startsWith('show ') || lower.startsWith('open ') || lower.startsWith('view ')) && lower.includes(' list')) return 'list_show'
  if (lower.startsWith('add ') && (lower.includes(' to ') || lower.includes(' into '))) return 'list_add'
  if (lower.startsWith('check ') || lower.startsWith('tick ') || lower.startsWith('mark ')) return 'list_check'
  if (lower.startsWith('clear ') || lower.startsWith('delete list ') || lower.startsWith('remove list ')) return 'list_clear'
  if (lower.startsWith('remember ') || lower.includes('remember that ') || lower.includes('save this memory')) return 'save_memory'
  if (SEARCH_HINTS.some((k) => lower.includes(k))) return 'web_search'
  return 'general_chat'
}

// ───────────────────────────────────────────────────────────────────────────
// The real pipeline: STAGE 1 first, STAGE 2 only on fallthrough.
// ───────────────────────────────────────────────────────────────────────────
function pipeline(text) {
  const feat = routeFeatureIntent(text)
  if (feat !== 'fallthrough') return { stage: 'routeFeatureIntent', handler: feat }
  return { stage: 'detectIntent', handler: detectIntent(text) }
}

// Intended handler for each shipped example, and the must-NOT-match controls.
// `handler` is the destination the example is CLAIMED to reach; a phrase that
// lands anywhere else — including an upstream hijack — is a FAILURE.
const EXPECTED = {
  'remind me to drink water in 2 minutes': 'set_reminder',
  'remind me to take my meds every day at 9am': 'set_reminder',
  'add milk to shopping list': 'lists',
  'show my cards': 'creditiq_cards',
  'gold price': 'gold_live',
}

// Controls that must NOT reach an example handler.
//   "my card balance" — hijacked by bill-split today (§5 excludes it). Proving the
//                        hijack means asserting it lands on 'split', NOT creditiq.
//   "start" / "hey"   — onboarding triggers; must resolve to welcome_menu.
const CONTROLS = [
  { phrase: 'my card balance', want: 'split', note: 'hijacked by bill-split — NOT creditiq_cards' },
  { phrase: 'start', want: 'welcome_menu', note: 'onboarding trigger, not an example' },
  { phrase: 'hey', want: 'welcome_menu', note: 'onboarding trigger, not an example' },
]

const pad = (s, n) => (String(s) + ' '.repeat(n)).slice(0, n)
let fails = 0

console.log('\nONBOARDING EXAMPLE ROUTING — real pipeline (routeFeatureIntent → detectIntent)\n')
console.log(pad('PHRASE', 46), pad('STAGE', 20), pad('HANDLER', 18), 'EXPECTED')
console.log('-'.repeat(110))
for (const phrase of EXAMPLE_PHRASINGS) {
  const want = EXPECTED[phrase]
  const { stage, handler } = pipeline(phrase)
  const ok = handler === want
  if (!ok || want === undefined) fails++
  console.log(pad(`"${phrase}"`, 46), pad(stage, 20), pad(handler + (ok ? ' ✓' : ' ✗'), 18), want ?? '(no expectation!)')
}

console.log('\nMUST-NOT-MATCH CONTROLS\n')
console.log(pad('PHRASE', 46), pad('STAGE', 20), pad('HANDLER', 18), 'EXPECTED / note')
console.log('-'.repeat(110))
for (const { phrase, want, note } of CONTROLS) {
  const { stage, handler } = pipeline(phrase)
  const ok = handler === want
  if (!ok) fails++
  console.log(pad(`"${phrase}"`, 46), pad(stage, 20), pad(handler + (ok ? ' ✓' : ' ✗'), 18), `${want}  (${note})`)
}

// Guard: every shipped phrasing must carry an expectation (no silent gaps).
const missing = EXAMPLE_PHRASINGS.filter((p) => !(p in EXPECTED))
if (missing.length) {
  fails += missing.length
  console.log('\n⚠  EXAMPLE_PHRASINGS with no expectation (copy drifted from harness):')
  for (const m of missing) console.log('   - ' + JSON.stringify(m))
}

console.log('\n' + '-'.repeat(110))
console.log(fails === 0 ? 'ALL ONBOARDING EXAMPLES ROUTE AS INTENDED ✓' : `${fails} FAILURE(S) ✗`)
process.exit(fails === 0 ? 0 : 1)
