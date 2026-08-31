import { classifyCheckVerb } from '@/lib/data/lists-core'
import { CALENDAR_WORD_RE } from '@/lib/bot/handlers/calendar-actions'

// "google calendar" (+ misspellings) → connect intent, derived from the shared spelling
// set rather than re-encoding the vowel-swaps by hand. Hoisted out of the per-message
// detectIntent hot path.
const GOOGLE_CALENDAR_RE = new RegExp(`\\bgoogle\\s+${CALENDAR_WORD_RE.source}`)

export type IntentType =
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

const SEARCH_HINTS = ['latest', 'news', 'today', 'current', 'score', 'stock', 'price']

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
  if (/^(hi|hello|hey|start|\/start)$/i.test(lower)) return { type: 'welcome_menu', confidence: 'high' }
  if (lower === 'help' || lower === '/help' || lower === 'menu' || lower === 'commands' || lower === 'what can you do') return { type: 'help_menu', confidence: 'high' }

  // CreditIQ account linking — high-priority, PREFIXED 6-digit code only (never a bare number).
  {
    const cq = lower.match(/^link\s+creditiq\s+(\d{6})$/) || lower.match(/^creditiq\s+(?:link\s+)?(\d{6})$/)
    if (cq) return { type: 'creditiq_link', confidence: 'high', meta: { code: cq[1] } }
  }

  // CreditIQ portfolio. Two ways to match:
  //   (a) the original anchored commands (kept verbatim), OR
  //   (b) natural phrasings ("how many points do I have", "what cards do I
  //       have", "my card balance") — each anchored to a query/possessive
  //       SHAPE so a mid-sentence "my card" in an unrelated message ("pay my
  //       credit card bill", "remind me to renew my card") can NOT steal this
  //       intent. Every pattern requires a rewards/card noun (cards/points/
  //       miles/card balance) together with a first-person marker (my / do I /
  //       I have). \b boundaries only — never substring matching, so "what's
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

  // Dashboard magic-link request. Deterministic command — an exact-match set so
  // it can't shadow ordinary chat, and so it stops the LLM freeform path (which
  // has surfaced stored credentials) from firing on the word "dashboard".
  if (lower === 'dashboard' || lower === '/dashboard' || lower === 'my dashboard' || lower === 'open dashboard' || lower === 'web dashboard' || lower === 'dashboard link' || lower === 'my dashboard link') return { type: 'dashboard', confidence: 'high' }

  if (lower === 'pricing' || lower === 'price' || lower === 'plans' || lower === 'plan' || lower === 'upgrade' || lower === '/upgrade' || lower === 'payment' || lower === 'payments' || lower === 'subscribe' || lower === 'razorpay' || lower === 'paid plan') return { type: 'upgrade_plan', confidence: 'high' }

  if (lower === 'notify me' || lower === 'notify' || lower === 'notify me when live' || lower === 'notify me when payment is live' || lower === 'founder offer' || lower === 'founder pricing' || lower.includes('early access') || lower.includes('i want pro') || lower.includes('i want lite') || lower.includes('i want starter') || lower.includes('i want founder') || lower.includes('want paid plan') || lower.includes('want to subscribe') || lower.includes('interested in paid')) return { type: 'notify_me', confidence: 'high' }

  if (isReferralIntent(lower)) return { type: 'referral_flow', confidence: 'high' }

  if (lower === 'show reminders' || lower === 'show my reminders' || lower === 'my reminders' || lower === 'pending reminders' || lower === 'active reminders' || lower === 'list reminders' || lower === 'what are my reminders' || lower === 'what reminders do i have' || lower.includes('show pending reminders') || /^cancel\b/i.test(lower) || /^delete\b/i.test(lower) || /^remove\b/i.test(lower) || /^clear reminder\b/i.test(lower) || /^stop reminder\b/i.test(lower) || /^done\s+\d+\b/i.test(lower) || /^complete\s+\d+\b/i.test(lower) || /^mark\s+\d+\s+done\b/i.test(lower) || /^snooze\s+\d+\s+(for\s+)?\d+\s*(minute|minutes|min|mins|hour|hours)\b/i.test(lower) || lower === 'done' || lower === 'mark done' || lower === 'completed' || lower === 'complete' || lower === 'finished' || lower === 'mark as done' || /^snooze\b/i.test(lower) || /^move it\b/i.test(lower) || /^move reminder\b/i.test(lower) || /^reschedule\b/i.test(lower) || /^tomorrow instead$/i.test(lower) || /^change it to\b/i.test(lower) || /^skip\b/i.test(lower) || lower === 'not today') return { type: 'edit_reminder', confidence: 'high' }

  if (isBriefingSettingsIntent(lower)) return { type: 'set_briefing_time', confidence: 'high' }

  if (lower === 'today' || lower === 'today summary' || lower === 'today briefing' || lower === 'what is today' || lower === 'morning briefing' || lower === 'daily briefing' || lower === 'good morning' || lower === 'brief me' || lower === "what's my day today" || lower === 'whats my day today' || lower === "what's my day" || lower === 'my day today' || lower === 'my briefing' || lower === 'my day') return { type: 'morning_briefing', confidence: 'high' }

  if (lower.includes('connect my gmail') || lower.includes('connect to my gmail') || lower.includes('connect gmail') || lower.includes('connect to gmail') || lower.includes('link gmail') || lower.includes('gmail connect')) return { type: 'connect_gmail', confidence: 'high' }

  if (lower.includes('draft a reply') || lower.includes('reply to this email') || lower.includes('reply to this mail') || lower.includes('reply to the latest mail') || lower.includes('reply to latest email') || lower.includes('reply to the vercel email') || lower.includes('reply to the latest unread email') || lower.includes('reply to latest unread email') || lower.includes('reply to the latest unread mail') || lower.includes('reply to latest unread mail') || lower.includes('draft reply to') || lower.includes('write a reply to this email')) return { type: 'email_action', confidence: 'high' }

  if (lower.includes('check my latest mail') || lower.includes('check my latest mails') || lower.includes('latest mail') || lower.includes('latest mails') || lower.includes('latest email') || lower.includes('latest emails') || lower.includes('show my unread emails') || lower.includes('show unread emails') || lower.includes('check unread emails') || lower.includes('any new mails') || lower.includes('any new mail') || lower.includes('check my inbox') || lower.includes('mail summary') || lower.includes('mails summary') || lower.includes('email summary') || lower.includes('emails summary') || lower.includes('top 3 mails') || lower.includes('top 3 mail') || lower.includes('top 3 emails') || lower.includes('top 3 email') || lower.includes('check my top 3 mail') || lower.includes('check my top 3 email') || lower.includes('show me my top 3 mails') || lower.includes('show me my top 3 email') || lower.includes('summarize my mails') || lower.includes('summarize my emails') || lower.includes('summarize top 3 mails') || lower.includes('summarize top 3 emails') || lower.includes('top 3 mails summary') || lower.includes('top 3 emails summary')) return { type: 'read_gmail', confidence: 'high' }

  // Tolerant of common "calendar" misspellings (calender/calandar/calenders/…) via
  // CALENDAR_WORD_RE — "connect calender" used to miss and fall to the freeform LLM.
  if (((lower.includes('connect') || lower.includes('link')) && CALENDAR_WORD_RE.test(lower)) || GOOGLE_CALENDAR_RE.test(lower)) return { type: 'connect_calendar', confidence: 'high' }
  // Check "remind me" BEFORE weather - marathon/training reminders must not go to weather
  if (lower.includes('remind me') || lower.includes('remind to') || lower.startsWith('remind ')) return { type: 'set_reminder', confidence: 'high' }

  // Handle time/date-only follow-ups after a reminder conversation (e.g. "6am", "on 28th june", "change time to 6am")
  if (/^(change time to|change it to|make it|set it to|update to|change to)\s+/i.test(lower)) return { type: 'set_reminder', confidence: 'high' }
  if (/^(at\s+)?\d{1,2}(:\d{2})?\s*(am|pm)$/i.test(lower)) return { type: 'set_reminder', confidence: 'high' }
  if (/^(on\s+)?\d{1,2}(st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(lower)) return { type: 'set_reminder', confidence: 'high' }
  if (/^(tomorrow|tmrw|tmr)\s*(morning|evening|noon|afternoon|night)?$/i.test(lower)) return { type: 'set_reminder', confidence: 'high' }

  if (lower.includes('weather') || lower.includes('temperature') || lower.includes('rain')) return { type: 'weather_live', confidence: 'high' }
  if (lower.includes('gold price') || lower.includes('gold rate') || lower.includes('silver price') || lower.includes('silver rate')) return { type: 'gold_live', confidence: 'high' }
  if (lower.includes('ipl table') || lower.includes('points table') || lower.includes('table toppers') || lower.includes('ipl standings') || lower.includes('ipl topper')) return { type: 'sports_standings', confidence: 'high' }
  if ((lower.includes('rcb') && lower.includes('match')) || (lower.includes('ipl') && lower.includes('match')) || lower.includes('next rcb match') || lower.includes('when is the next rcb match')) return { type: 'sports_schedule', confidence: 'high' }

  if (lower.includes('remind me') || lower.includes('remind to') || lower.startsWith('remind ') || lower.includes('set a reminder') || lower.includes('set reminder') || lower.includes('reminder for') || /\b(on\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(lower) || /\b(tomorrow|tmrw|tmr)\b/i.test(lower) || /\bin\s+\d+\s+(minute|minutes|min|mins|hour|hours|day|days)\b/i.test(lower) || /\bat\s+\d{1,2}(:\d{2})?\s*(am|pm)\b/i.test(lower)) return { type: 'set_reminder', confidence: 'high' }

  if (lower === 'show all lists' || lower === 'list all' || lower === 'show my lists') return { type: 'list_show_all', confidence: 'high' }
  if ((lower.startsWith('show ') || lower.startsWith('open ') || lower.startsWith('view ')) && lower.includes(' list')) return { type: 'list_show', confidence: 'medium' }
  if (lower.startsWith('add ') && (lower.includes(' to ') || lower.includes(' into '))) return { type: 'list_add', confidence: 'medium' }
  // uncheck/untick/undone/unmark → list_uncheck; check/tick/mark → list_check. Ordered
  // uncheck-first and check kept PREFIX-anchored inside classifyCheckVerb so "uncheck X"
  // can never be claimed by the check branch (it CONTAINS "check").
  const checkVerb = classifyCheckVerb(lower)
  if (checkVerb) return { type: checkVerb, confidence: 'medium' }
  if (lower.startsWith('clear ') || lower.startsWith('delete list ') || lower.startsWith('remove list ')) return { type: 'list_clear', confidence: 'medium' }
  if (lower.startsWith('remember ') || lower.includes('remember that ') || lower.includes('save this memory')) return { type: 'save_memory', confidence: 'high' }
  if (SEARCH_HINTS.some((k) => lower.includes(k))) return { type: 'web_search', confidence: 'medium' }

  // Media memory commands
  if (/^my (instagram|facebook|youtube|linkedin|twitter|tiktok|social) (saves|notes|reels|videos|posts)$/i.test(lower)) return { type: 'media_memory', confidence: 'high' }
  if (/^(instagram|facebook|youtube|linkedin|twitter|tiktok) (saves|memory|notes|reels|videos|posts)$/i.test(lower)) return { type: 'media_memory', confidence: 'high' }
  if (/^find (reel|video|post|content) (about|on) .+/i.test(lower)) return { type: 'media_memory', confidence: 'high' }
  if (/^search (instagram|facebook|youtube|linkedin|twitter|tiktok|my saves|my reels)/i.test(lower)) return { type: 'media_memory', confidence: 'high' }
  if (/^my (saves|reels|social saves)$/i.test(lower)) return { type: 'media_memory', confidence: 'high' }

  // Nutrition commands
  if (/^(nutrition|nutrition today|calories today|my calories|food today|what did i eat|nutrition report|nutrition week|nutrition summary|nutrition goal|set nutrition goal|set calorie goal|nutrition help|calorie help|food help|nutrition card|daily card|nutrition daily card|nutrition report card|weekly card|nutrition weekly card)$/i.test(lower)) return { type: 'nutrition_query', confidence: 'high' }
  if (/^(log |track )/i.test(lower)) return { type: 'nutrition_log', confidence: 'high' }
  if (/^(log this|log that|log it|track this|save this meal|log meal)/i.test(lower)) return { type: 'nutrition_log', confidence: 'high' }
  if (/^(had |ate |just had |just ate |i had |i ate |i just had |i just ate |breakfast:|lunch:|dinner:|snack:)/i.test(lower)) return { type: 'nutrition_log', confidence: 'high' }
  if (/^(for (breakfast|lunch|dinner|snack) (i |i've |we )?had|for (breakfast|lunch|dinner|snack):)/i.test(lower)) return { type: 'nutrition_log', confidence: 'high' }

  return { type: 'general_chat', confidence: 'low' }
}
