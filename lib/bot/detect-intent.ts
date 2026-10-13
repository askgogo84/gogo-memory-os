import { isDriveWriteRequest } from './drive-write-request'
import { isTimeFirstReminder } from './reminder-command'
import { isFoodComparisonRequest } from '@/lib/agent/food-comparison-intent'
import { classifyCheckVerb } from '@/lib/data/lists-core'
import { CALENDAR_WORD_RE } from '@/lib/bot/handlers/calendar-actions'
import { hasConcreteFlightCode } from '@/lib/bot/flight-codes'
import { isNutritionLogText } from '@/lib/bot/nutrition-text'

// "google calendar" (+ misspellings) â†’ connect intent, derived from the shared spelling
// set rather than re-encoding the vowel-swaps by hand. Hoisted out of the per-message
// detectIntent hot path.
const GOOGLE_CALENDAR_RE = new RegExp(`\\bgoogle\\s+${CALENDAR_WORD_RE.source}`)

export type IntentType =
  | 'food_comparison'
  | 'connect_gmail'
  | 'read_gmail'
  | 'email_action'
  | 'connect_calendar'
  | 'sports_schedule'
  | 'sports_standings'
  | 'weather_live'
  | 'gold_live'
  | 'list_show_all'
  | 'list_show'
  | 'list_add'
  | 'list_check'
  | 'list_uncheck'
  | 'list_clear'
  | 'set_reminder'
  | 'edit_reminder'
  | 'morning_briefing'
  | 'set_briefing_time'
  | 'notify_me'
  | 'referral_flow'
  | 'help_menu'
  | 'welcome_menu'
  | 'upgrade_plan'
  | 'dashboard'
  | 'save_memory'
  | 'web_search'
  | 'nutrition_log'
  | 'nutrition_query'
  | 'media_memory'
  | 'creditiq_link'
  | 'creditiq_cards'
  | 'general_chat'

export type DetectedIntent = {
  type: IntentType
  confidence: 'high' | 'medium' | 'low'
  meta?: Record<string, any>
}

const SEARCH_HINTS = ['latest', 'news', 'current', 'score', 'stock', 'price']
const SEARCH_HINT_RE = new RegExp(`\\b(?:${SEARCH_HINTS.join('|')})\\b`)
// "today" alone is a statement about the day ("today I met the team"); it hints at a lookup only inside a question.
const QUESTION_SHAPE_RE = /\?|^\s*(?:what|who|which|when|where|how|is|are|does|do|did|will|can|could|should|tell me|show me)\b/i

/**
 * Sentence-shape guards. Each rule below used to fire on a word or on the first word of the sentence;
 * these decide from the whole sentence whether the rule's meaning is actually what was said.
 */

// "Remind me what Srini told me about the launch" asks to recall something. "Remind me to call mom" schedules.
// "what/who/how to ..." is still a reminder ("remind me what to buy at 5pm" keeps its reminder shape).
const RECALL_REMIND_RE = /\bremind me\s+(?:again\s+)?(?:what|who|whom|where|which|why|how|whether)\b(?!\s+to\b)/i
export function isRecallQuestion(lower: string): boolean {
  return RECALL_REMIND_RE.test(lower)
}

// "cancel / delete / remove / skip" open the reminder editor only when the sentence is about a reminder.
// A list, a draft, a subscription or a booking is another capability's object, and a first-person reason
// ("skip lunch today, I'm fasting") is a statement, not a command.
const REMINDER_WORD_RE = /\b(?:reminders?|alarms?|nudges?|alerts?)\b/
const NON_REMINDER_OBJECT_RE = /\b(?:lists?|grocer(?:y|ies)|shopping|duplicates?|dupes?|subscriptions?|memberships?|accounts?|drafts?|e-?mails?|mails?|orders?|bookings?|tickets?|expenses?|notes?)\b/
const STATEMENT_CLAUSE_RE = /,\s*(?:i|we)\b|\b(?:because|since|as i|i'm|i am|i'll|i will|i have|i've|we're|we are)\b/
export function leadingVerbEditsReminder(lower: string): boolean {
  if (REMINDER_WORD_RE.test(lower)) return true
  if (STATEMENT_CLAUSE_RE.test(lower)) return false
  if (NON_REMINDER_OBJECT_RE.test(lower)) return false
  return true
}

// "What reminders do I have tomorrow?" asks to read existing reminders; it must not be claimed by the
// weekday/time fallback that creates one.
export function isReminderReadQuestion(lower: string): boolean {
  const t = lower.trim().replace(/[?.!]+$/g, '')
  if (!/\breminders?\b/.test(t)) return false
  if ((/\b(?:set|create|make|add|schedule)\b/.test(t) && !/\b(?:are|is|already|got)\s+(?:set|scheduled)\b/.test(t)) || /\bremind\s+me\b/.test(t)) return false
  return /^(?:what|which)\s+(?:are\s+my\s+)?reminders?\b/.test(t) || /^(?:do\s+i\s+have|are\s+there)\s+(?:any\s+)?reminders?\b/.test(t) || /^how\s+many\s+reminders?\b/.test(t)
}

// A weather word is a weather question only when the sentence asks for weather. "Rain or shine, I'll be at the
// gym at 6am" uses the word as an idiom inside a statement about the user's own plans.
const WEATHER_WORD_RE = /\b(?:weather|temperature|temp|rain|raining|rainfall|forecast)\b/
const WEATHER_IDIOM_RE = /\b(?:rain or shine|rain check|come rain|rain,? hail|come hell)\b/
const PLAN_STATEMENT_RE = /\b(?:i'll|i will|i am|i'm|we'll|we will|we're|we are|i have|i've|i plan|i'd)\b/
const WEATHER_ASK_RE = /\?|^(?:what|how|is|are|will|does|do|should|can|could|check|show|tell|give|get)\b|\b(?:how'?s|what'?s|how is|what is|how are|is it|will it|does it|do i need|should i (?:carry|take|bring))\b/
export function asksAboutWeather(lower: string): boolean {
  if (!WEATHER_WORD_RE.test(lower)) return false
  if (WEATHER_IDIOM_RE.test(lower)) return false
  if (PLAN_STATEMENT_RE.test(lower) && !WEATHER_ASK_RE.test(lower)) return false
  return true
}

// Reading mail is a read verb applied to the user's own mail. "Read my latest password reset email" and
// "what needs my attention in my inbox?" read Gmail; "email Rahul saying hi" sends and is not matched.
const GMAIL_READ_VERB_RE = /^(?:please\s+)?(?:(?:can|could)\s+you\s+)?(?:read|show|open|check|find|get|fetch|pull\s+up|summari[sz]e|look\s+at|go\s+through)\s+(?:me\s+)?(?:my|the)\s+(?:(?:latest|last|newest|most\s+recent|recent|unread|new|important|urgent)\s+)?(?:[\w'&-]+\s+){0,4}?(?:e-?mails?|mails?|inbox|gmail)\b/
const GMAIL_ASK_RE = /^(?:what|which|who|anything|any|do\s+i\s+have\s+(?:any|anything))\b[^?]*\b(?:my\s+inbox|in\s+my\s+(?:gmail|e-?mails?)|my\s+unread)\b/
export function isGmailReadRequest(lower: string): boolean {
  const t = lower.trim()
  return GMAIL_READ_VERB_RE.test(t) || GMAIL_ASK_RE.test(t)
}

function isReferralIntent(lower: string) {
  return (
    lower === 'invite' || lower === 'invite friends' || lower === 'invite frnds' || lower === 'invite frnd' ||
    lower === 'invite friend' || lower === 'refer' || lower === 'referral' || lower === 'share' ||
    lower === 'my referral' || lower === 'referral status' || lower === 'my referral status' ||
    lower.includes('invite my friends') || lower.includes('invite my frnds') || lower.includes('refer friends') || lower.includes('refer frnds')
  )
}

function isBriefingSettingsIntent(lower: string) {
  return (
    /set (my )?(daily |morning )?briefing (to|at)/i.test(lower) ||
    /briefing at \d/i.test(lower) ||
    /send (my )?(daily |morning )?briefing at/i.test(lower) ||
    lower === 'briefing status' || lower === 'daily briefing status' || lower === 'morning briefing status' ||
    lower === 'turn off daily briefing' || lower === 'turn off morning briefing' ||
    lower === 'stop daily briefing' || lower === 'stop morning briefing' ||
    lower === 'disable daily briefing' || lower === 'disable morning briefing' ||
    // Enable phrasings. Without these, "turn on daily briefing" fell through and
    // sent ONE briefing without ever setting briefing_enabled, so the user believed
    // it was on and never heard from us again.
    /^(turn on|enable|start|switch on)\s+(the\s+)?(daily|morning)\s+brief(ing)?$/.test(lower) ||
    /^(daily|morning)\s+brief(ing)?\s+(on|please)$/.test(lower) ||
    lower === 'briefing on' || lower === 'brief me daily' || lower === 'send me daily briefing'
  )
}

export function detectIntent(text: string): DetectedIntent {
  const t = (text || '').trim()
  const lower = t.toLowerCase()

  if (!lower) return { type: 'general_chat', confidence: 'low' }
  if (isFoodComparisonRequest(t)) return { type: 'food_comparison', confidence: 'high' }
  if (/^(hi|hello|hey|start|\/start)$/i.test(lower)) return { type: 'welcome_menu', confidence: 'high' }
  if (/^(?:help|\/help|menu|commands|what can you do)[?!.]*$/i.test(lower)) return { type: 'help_menu', confidence: 'high' }

  // CreditIQ account linking â€” high-priority, PREFIXED 6-digit code only (never a bare number).
  {
    const cq = lower.match(/^link\s+creditiq\s+(\d{6})$/) || lower.match(/^creditiq\s+(?:link\s+)?(\d{6})$/)
    if (cq) return { type: 'creditiq_link', confidence: 'high', meta: { code: cq[1] } }
  }

  // CreditIQ portfolio. Two ways to match:
  //   (a) the original anchored commands (kept verbatim), OR
  //   (b) natural phrasings ("how many points do I have", "what cards do I
  //       have", "my card balance") â€” each anchored to a query/possessive
  //       SHAPE so a mid-sentence "my card" in an unrelated message ("pay my
  //       credit card bill", "remind me to renew my card") can NOT steal this
  //       intent. Every pattern requires a rewards/card noun (cards/points/
  //       miles/card balance) together with a first-person marker (my / do I /
  //       I have). \b boundaries only â€” never substring matching, so "what's
  //       the point" (no plural noun), "bank balance" / "work-life balance"
  //       (no card/points/miles noun) and a bare "points" never fire.
  if (
    /^(show\s+)?my\s+(credit\s+)?cards$/.test(lower) ||
    /^show\s+cards$/.test(lower) ||
    /^(show\s+)?my\s+portfolio$/.test(lower) ||
    /^(show\s+)?my\s+(reward\s+)?points$/.test(lower) ||
    /^(show\s+)?my\s+creditiq$/.test(lower) ||
    /^creditiq\s+(cards|portfolio|points)$/.test(lower) ||
    // (b1) possessive: "my points", "my reward points", "my miles",
    //      "show my cards", "what's my card balance", "check my miles"
    /^(?:show\s+(?:me\s+)?|check\s+|what(?:'?s|\s+is|\s+are)\s+)?my\s+(?:credit\s+|reward\s+)?(?:cards?|points|miles|card\s+balance)\b/.test(lower) ||
    // (b2) count question: "how many points do I have", "how many miles have I earned"
    /^how\s+many\s+(?:credit\s+|reward\s+)?(?:cards?|points|miles)\b.*\b(?:do\s+i|i\s+have|have\s+i|i've)\b/.test(lower) ||
    // (b3) which-do-I-have question: "what cards do I have", "what points do I have"
    /^what\s+(?:credit\s+|reward\s+)?(?:cards?|points|miles)\s+(?:do\s+i\s+have|have\s+i)\b/.test(lower)
  ) return { type: 'creditiq_cards', confidence: 'high' }

  // Dashboard magic-link request. Deterministic command â€” an exact-match set so
  // it can't shadow ordinary chat, and so it stops the LLM freeform path (which
  // has surfaced stored credentials) from firing on the word "dashboard".
  if (lower === 'dashboard' || lower === '/dashboard' || lower === 'my dashboard' || lower === 'open dashboard' || lower === 'web dashboard' || lower === 'dashboard link' || lower === 'my dashboard link') return { type: 'dashboard', confidence: 'high' }

  if (lower === 'pricing' || lower === 'price' || lower === 'plans' || lower === 'plan' || lower === 'upgrade' || lower === '/upgrade' || lower === 'payment' || lower === 'payments' || lower === 'subscribe' || lower === 'razorpay' || lower === 'paid plan') return { type: 'upgrade_plan', confidence: 'high' }

  if (lower === 'notify me' || lower === 'notify' || lower === 'notify me when live' || lower === 'notify me when payment is live' || lower === 'founder offer' || lower === 'founder pricing' || lower.includes('early access') || /\bi want (?:the )?(?:pro|lite|starter|founder)(?: plan| pricing| tier)?\s*[.!]*$/.test(lower) || lower.includes('want paid plan') || lower.includes('want to subscribe') || lower.includes('interested in paid')) return { type: 'notify_me', confidence: 'high' }

  if (isReferralIntent(lower)) return { type: 'referral_flow', confidence: 'high' }

  if (lower === 'show reminders' || lower === 'show my reminders' || lower === 'my reminders' || lower === 'pending reminders' || lower === 'active reminders' || lower === 'list reminders' || lower === 'what are my reminders' || lower === 'what reminders do i have' || lower.includes('show pending reminders') || (/^(?:cancel|delete|remove)\b/i.test(lower) && leadingVerbEditsReminder(lower)) || /^clear reminder\b/i.test(lower) || /^stop reminder\b/i.test(lower) || /^done\s+\d+\b/i.test(lower) || /^complete\s+\d+\b/i.test(lower) || /^mark\s+\d+\s+done\b/i.test(lower) || /^snooze\s+\d+\s+(for\s+)?\d+\s*(minute|minutes|min|mins|hour|hours)\b/i.test(lower) || lower === 'done' || lower === 'mark done' || lower === 'completed' || lower === 'complete' || lower === 'finished' || lower === 'mark as done' || /^snooze\b/i.test(lower) || /^move it\b/i.test(lower) || /^move reminder\b/i.test(lower) || /^reschedule\b/i.test(lower) || /^tomorrow instead$/i.test(lower) || /^change it to\b/i.test(lower) || (/^skip\b/i.test(lower) && leadingVerbEditsReminder(lower)) || lower === 'not today') return { type: 'edit_reminder', confidence: 'high' }

  if (isBriefingSettingsIntent(lower)) return { type: 'set_briefing_time', confidence: 'high' }

  if (lower === 'today' || lower === 'today summary' || lower === 'today briefing' || lower === 'what is today' || lower === 'morning briefing' || lower === 'daily briefing' || lower === 'good morning' || lower === 'brief me' || lower === "what's my day today" || lower === 'whats my day today' || lower === "what's my day" || lower === 'my day today' || lower === 'my briefing' || lower === 'my day') return { type: 'morning_briefing', confidence: 'high' }

  if (lower.includes('connect my gmail') || lower.includes('connect to my gmail') || lower.includes('connect gmail') || lower.includes('connect to gmail') || lower.includes('link gmail') || lower.includes('gmail connect')) return { type: 'connect_gmail', confidence: 'high' }

  // Muse case 18 (11 Oct): "Draft replies to my unread work emails from today" went to web search.
  if (/\bdraft\s+(?:some\s+)?repl(?:y|ies)\s+(?:to|for)\s+(?:all\s+)?(?:my\s+)?(?:unread|new|latest|today'?s|work)\b[^.?!]{0,30}\b(?:e-?mails?|mails?|inbox)\b/i.test(lower)) return { type: 'read_gmail', confidence: 'high' }
  if (isGmailReadRequest(lower)) return { type: 'read_gmail', confidence: 'high' }
  if (lower.includes('draft a reply') || lower.includes('reply to this email') || lower.includes('reply to this mail') || lower.includes('reply to the latest mail') || lower.includes('reply to latest email') || lower.includes('reply to the vercel email') || lower.includes('reply to the latest unread email') || lower.includes('reply to latest unread email') || lower.includes('reply to the latest unread mail') || lower.includes('reply to latest unread mail') || lower.includes('draft reply to') || lower.includes('write a reply to this email')) return { type: 'email_action', confidence: 'high' }

  if (lower.includes('check my mail') || lower.includes('check my mails') || lower.includes('check my email') || lower.includes('check my emails') || lower.includes('check my latest mail') || lower.includes('check my latest mails') || lower.includes('latest mail') || lower.includes('latest mails') || lower.includes('latest email') || lower.includes('latest emails') || lower.includes('show my unread emails') || lower.includes('show unread emails') || lower.includes('check unread emails') || lower.includes('any new mails') || lower.includes('any new mail') || lower.includes('check my inbox') || lower.includes('mail summary') || lower.includes('mails summary') || lower.includes('email summary') || lower.includes('emails summary') || lower.includes('top 3 mails') || lower.includes('top 3 mail') || lower.includes('top 3 emails') || lower.includes('top 3 email') || lower.includes('check my top 3 mail') || lower.includes('check my top 3 email') || lower.includes('show me my top 3 mails') || lower.includes('show me my top 3 email') || lower.includes('summarize my mails') || lower.includes('summarize my emails') || lower.includes('summarize top 3 mails') || lower.includes('summarize top 3 emails') || lower.includes('top 3 mails summary') || lower.includes('top 3 emails summary')) return { type: 'read_gmail', confidence: 'high' }

  // Tolerant of common "calendar" misspellings (calender/calandar/calenders/â€¦) via
  // CALENDAR_WORD_RE â€” "connect calender" used to miss and fall to the freeform LLM.
  if (((lower.includes('connect') || lower.includes('link')) && CALENDAR_WORD_RE.test(lower)) || GOOGLE_CALENDAR_RE.test(lower)) return { type: 'connect_calendar', confidence: 'high' }
  // Check "remind me" BEFORE weather - marathon/training reminders must not go to weather
  if (isReminderReadQuestion(lower)) return { type: 'edit_reminder', confidence: 'high', meta: { show: true } }
  // "Can you remind me what Srini told me" is a question about memory, not a reminder to create.
  if (isRecallQuestion(lower)) return { type: 'general_chat', confidence: 'low', meta: { recallQuestion: true } }
  if (lower.includes('remind me') || lower.includes('remind to') || lower.startsWith('remind ')) return { type: 'set_reminder', confidence: 'high' }

  // Time-first noun directive must schedule, not search for the appointment provider.
  if (isTimeFirstReminder(text)) return { type: 'set_reminder', confidence: 'high' }

  // Handle time/date-only follow-ups after a reminder conversation (e.g. "6am", "on 28th june", "change time to 6am")
  if (/^(change time to|change it to|make it|set it to|update to|change to)\s+/i.test(lower)) return { type: 'set_reminder', confidence: 'high' }
  if (/^(at\s+)?\d{1,2}(:\d{2})?\s*(am|pm)$/i.test(lower)) return { type: 'set_reminder', confidence: 'high' }
  if (/^(on\s+)?\d{1,2}(st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(lower)) return { type: 'set_reminder', confidence: 'high' }
  if (/^(tomorrow|tmrw|tmr)\s*(morning|evening|noon|afternoon|night)?$/i.test(lower)) return { type: 'set_reminder', confidence: 'high' }

  // Live flight status ("has EY1 landed?", "status of AI 505", "is 6E203 delayed due to
  // weather?") must attempt an actual lookup, not be delegated to the user. This runs BEFORE
  // both the generic weather matcher (which would otherwise claim "...due to weather?" as a
  // general forecast) and the broad reminder matcher (which would claim it on "tomorrow"/a
  // weekday/a time). Only a message that (a) names a concrete flight, (b) asks about
  // status/landing, and (c) is NOT an explicit reminder/watch-creation request routes here; a
  // pronoun-only "has it landed?" stays on the recall path, which already refuses to claim a
  // landing from schedule alone.
  // Require a GENUINE airline flight code (not a date preposition like "on 28") plus a status
  // verb, and not an explicit reminder/watch request. hasConcreteFlightCode filters out date
  // fragments so a codeless "did my flight land on 28 September?" is NOT sent to the dedicated
  // status handler (where an empty flight list would let any dated result be summarised).
  if (!/\b(remind me|remind to|set (?:a )?reminder|reminder for|alert me|notify me|let me know when|keep me posted|keep (?:me )?tracking|watch (?:this|the|my))\b/i.test(lower) &&
      hasConcreteFlightCode(lower) &&
      /\b(land(?:s|ed|ing)?|arriv(?:e|ed|es|al|ing)|(?:flight )?status|delay(?:ed|s)?|on[- ]time|diverted|departed|take[n]?\s?off|tracker|track(?:ing)?)\b/i.test(lower))
    // Tag as flight status so the executor runs a tracker-scoped STATUS lookup and never a
    // generic web search (which ranks airfare/OTA pages and turns status into shopping).
    return { type: 'web_search', confidence: 'high', meta: { flightStatus: true } }

  // Word-boundary matching, never raw substring. includes('rain') matched "trains",
  // routing "direct trains from Bangalore to Mysuru" to weather at high confidence.
  if (asksAboutWeather(lower)) return { type: 'weather_live', confidence: 'high' }
  if (lower.includes('gold price') || lower.includes('gold rate') || lower.includes('silver price') || lower.includes('silver rate')) return { type: 'gold_live', confidence: 'high' }
  if (lower.includes('ipl table') || lower.includes('points table') || lower.includes('table toppers') || lower.includes('ipl standings') || lower.includes('ipl topper')) return { type: 'sports_standings', confidence: 'high' }
  if ((lower.includes('rcb') && lower.includes('match')) || (lower.includes('ipl') && lower.includes('match')) || lower.includes('next rcb match') || lower.includes('when is the next rcb match')) return { type: 'sports_schedule', confidence: 'high' }

  // Muse case 26 (10 Oct): "From my saved notes, prep a 30-minute plan for Sunday's cricket
  // coaching session" became a reminder only because it named a weekday. A request that starts
  // with another task verb is that task unless it explicitly asks for a reminder.
  const otherTaskFirst = /^(?:(?:please|can you|could you)\s+)?(?:from\s+my\s+[^,]{1,40},\s*)?(?:prep|prepare|plan|make|create|write|draft|research|find|search|compare|summari[sz]e|build|show|give|tell|explain|analy[sz]e|list|suggest|recommend|book|order|buy|watch|track|monitor|check|which|what|when|where|who|how|every\s+(?:mon|tues|wednes|thurs|fri|satur|sun)day,?\s+(?:draft|reply|post|write|check|send))\b/i.test(lower)
  const asksReminder = /\bremind|\breminder|\balert me\b|\bping me\b|\bnudge me\b/i.test(lower)
  // A question or request for advice that merely mentions a day or time ("my sister's birthday is on Sunday, what should I gift") is not a reminder.
  const asksForAnswer = !asksReminder && (/\?/.test(lower) || /\b(?:what should|which should|should i|can you|could you|how do i|how can i)\b/.test(lower))
  // "Rain or shine, I'll be at the gym at 6am tomorrow" tells Gogo a plan; it does not ask for a reminder.
  const statesOwnPlan = !asksReminder && /\b(?:i'll|i will|we'll|we will|i'm going to|i am going to|we're going to|we are going to)\b/.test(lower)
  if (!(otherTaskFirst && !asksReminder) && !asksForAnswer && !statesOwnPlan && (lower.includes('remind me') || lower.includes('remind to') || lower.startsWith('remind ') || lower.includes('set a reminder') || lower.includes('set reminder') || lower.includes('reminder for') || /\b(on\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(lower) || /\b(tomorrow|tmrw|tmr)\b/i.test(lower) || /\bin\s+\d+\s+(minute|minutes|min|mins|hour|hours|day|days)\b/i.test(lower) || /\bat\s+\d{1,2}(:\d{2})?\s*(am|pm)\b/i.test(lower))) return { type: 'set_reminder', confidence: 'high' }

  if (lower === 'show all lists' || lower === 'list all' || lower === 'show my lists') return { type: 'list_show_all', confidence: 'high' }
  if ((lower.startsWith('show ') || lower.startsWith('open ') || lower.startsWith('view ')) && lower.includes(' list')) return { type: 'list_show', confidence: 'medium' }
  if (lower.startsWith('add ') && (lower.includes(' to ') || lower.includes(' into ')) && !isDriveWriteRequest(lower)) return { type: 'list_add', confidence: 'medium' }
  // uncheck/untick/undone/unmark â†’ list_uncheck; check/tick/mark â†’ list_check. Ordered
  // uncheck-first and check kept PREFIX-anchored inside classifyCheckVerb so "uncheck X"
  // can never be claimed by the check branch (it CONTAINS "check").
  const checkVerb = classifyCheckVerb(lower)
  if (checkVerb) return { type: checkVerb, confidence: 'medium' }
  if (/^clear\s+(?:my\s+|the\s+)?[a-z0-9-]+(?:\s+list)?$/.test(lower) || lower.startsWith('delete list ') || lower.startsWith('remove list ')) return { type: 'list_clear', confidence: 'medium' }
  if (lower.startsWith('remember ') || lower.includes('remember that ') || lower.includes('save this memory')) return { type: 'save_memory', confidence: 'high' }
  // Whole words only: "newsletter", "scored", "currently" and "stockholm" are not search requests.
  if (SEARCH_HINT_RE.test(lower) || (/\btoday\b/.test(lower) && QUESTION_SHAPE_RE.test(lower))) return { type: 'web_search', confidence: 'medium' }

  // Media memory commands
  if (/^my (instagram|facebook|youtube|linkedin|twitter|tiktok|social) (saves|notes|reels|videos|posts)$/i.test(lower)) return { type: 'media_memory', confidence: 'high' }
  if (/^(instagram|facebook|youtube|linkedin|twitter|tiktok) (saves|memory|notes|reels|videos|posts)$/i.test(lower)) return { type: 'media_memory', confidence: 'high' }
  if (/^find (reel|video|post|content) (about|on) .+/i.test(lower)) return { type: 'media_memory', confidence: 'high' }
  if (/^search (instagram|facebook|youtube|linkedin|twitter|tiktok|my saves|my reels)/i.test(lower)) return { type: 'media_memory', confidence: 'high' }
  if (/^my (saves|reels|social saves)$/i.test(lower)) return { type: 'media_memory', confidence: 'high' }

  // Nutrition commands
  if (/^(nutrition|nutrition today|calories today|my calories|food today|what did i eat|nutrition report|nutrition week|nutrition summary|nutrition goal|set nutrition goal|set calorie goal|nutrition help|calorie help|food help|nutrition card|daily card|nutrition daily card|nutrition report card|weekly card|nutrition weekly card)$/i.test(lower)) return { type: 'nutrition_query', confidence: 'high' }
  // "log"/"track" is a meal command only when a food or meal follows: "track divya flight", "track my order" are not.
  if (/^(log|track)\s/i.test(lower) && isNutritionLogText(lower)) return { type: 'nutrition_log', confidence: 'high' }
  if (/^(log this|log that|log it|track this|save this meal|log meal)/i.test(lower)) return { type: 'nutrition_log', confidence: 'high' }
  // An eating verb alone ("I ate too much today", "had a meeting") is not a meal; a food has to be named.
  if (/^(had |ate |just had |just ate |i had |i ate |i just had |i just ate |breakfast:|lunch:|dinner:|snack:)/i.test(lower) && isNutritionLogText(lower)) return { type: 'nutrition_log', confidence: 'high' }
  if (/^(for (breakfast|lunch|dinner|snack) (i |i've |we )?had|for (breakfast|lunch|dinner|snack):)/i.test(lower) && isNutritionLogText(lower)) return { type: 'nutrition_log', confidence: 'high' }

  return { type: 'general_chat', confidence: 'low' }
}
