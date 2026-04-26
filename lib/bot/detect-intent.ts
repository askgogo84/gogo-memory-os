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
  | 'save_memory'
  | 'web_search'
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
    lower === 'disable daily briefing' || lower === 'disable morning briefing'
  )
}

export function detectIntent(text: string): DetectedIntent {
  const t = (text || '').trim()
  const lower = t.toLowerCase()

  if (!lower) return { type: 'general_chat', confidence: 'low' }
  if (/^(hi|hello|hey|start|\/start)$/i.test(lower)) return { type: 'welcome_menu', confidence: 'high' }
  if (lower === 'help' || lower === '/help' || lower === 'menu' || lower === 'commands' || lower === 'what can you do') return { type: 'help_menu', confidence: 'high' }

  if (lower === 'pricing' || lower === 'price' || lower === 'plans' || lower === 'plan' || lower === 'upgrade' || lower === '/upgrade' || lower === 'payment' || lower === 'payments' || lower.includes('razorpay') || lower.includes('paid plan') || lower.includes('subscribe')) return { type: 'upgrade_plan', confidence: 'high' }

  if (lower === 'notify me' || lower === 'notify' || lower === 'notify me when live' || lower === 'notify me when payment is live' || lower === 'founder offer' || lower === 'founder pricing' || lower.includes('early access') || lower.includes('i want pro') || lower.includes('i want lite') || lower.includes('i want starter') || lower.includes('i want founder') || lower.includes('want paid plan') || lower.includes('want to subscribe') || lower.includes('interested in paid')) return { type: 'notify_me', confidence: 'high' }

  if (isReferralIntent(lower)) return { type: 'referral_flow', confidence: 'high' }

  if (lower === 'show reminders' || lower === 'show my reminders' || lower === 'my reminders' || lower === 'pending reminders' || lower === 'active reminders' || lower === 'list reminders' || lower === 'what are my reminders' || lower === 'what reminders do i have' || lower.includes('show pending reminders') || /^cancel\b/i.test(lower) || /^delete\b/i.test(lower) || /^remove\b/i.test(lower) || /^clear reminder\b/i.test(lower) || /^stop reminder\b/i.test(lower) || /^done\s+\d+\b/i.test(lower) || /^complete\s+\d+\b/i.test(lower) || /^mark\s+\d+\s+done\b/i.test(lower) || /^snooze\s+\d+\s+(for\s+)?\d+\s*(minute|minutes|min|mins|hour|hours)\b/i.test(lower) || lower === 'done' || lower === 'mark done' || lower === 'completed' || lower === 'complete' || lower === 'finished' || lower === 'mark as done' || /^snooze\b/i.test(lower) || /^move it\b/i.test(lower) || /^move reminder\b/i.test(lower) || /^reschedule\b/i.test(lower) || /^tomorrow instead$/i.test(lower) || /^change it to\b/i.test(lower)) return { type: 'edit_reminder', confidence: 'high' }

  if (isBriefingSettingsIntent(lower)) return { type: 'set_briefing_time', confidence: 'high' }

  if (lower === 'today' || lower === 'today summary' || lower === 'today briefing' || lower === 'what is today' || lower === 'morning briefing' || lower === 'daily briefing' || lower === 'good morning' || lower === 'brief me') return { type: 'morning_briefing', confidence: 'high' }

  if (lower.includes('connect my gmail') || lower.includes('connect to my gmail') || lower.includes('connect gmail') || lower.includes('connect to gmail') || lower.includes('link gmail') || lower.includes('gmail connect')) return { type: 'connect_gmail', confidence: 'high' }

  if (lower.includes('draft a reply') || lower.includes('reply to this email') || lower.includes('reply to this mail') || lower.includes('reply to the latest mail') || lower.includes('reply to latest email') || lower.includes('reply to the vercel email') || lower.includes('reply to the latest unread email') || lower.includes('reply to latest unread email') || lower.includes('reply to the latest unread mail') || lower.includes('reply to latest unread mail') || lower.includes('draft reply to') || lower.includes('write a reply to this email')) return { type: 'email_action', confidence: 'high' }

  if (lower.includes('check my latest mail') || lower.includes('check my latest mails') || lower.includes('latest mail') || lower.includes('latest mails') || lower.includes('latest email') || lower.includes('latest emails') || lower.includes('show my unread emails') || lower.includes('show unread emails') || lower.includes('check unread emails') || lower.includes('any new mails') || lower.includes('any new mail') || lower.includes('check my inbox') || lower.includes('mail summary') || lower.includes('mails summary') || lower.includes('email summary') || lower.includes('emails summary') || lower.includes('top 3 mails') || lower.includes('top 3 mail') || lower.includes('top 3 emails') || lower.includes('top 3 email') || lower.includes('check my top 3 mail') || lower.includes('check my top 3 email') || lower.includes('show me my top 3 mails') || lower.includes('show me my top 3 email') || lower.includes('summarize my mails') || lower.includes('summarize my emails') || lower.includes('summarize top 3 mails') || lower.includes('summarize top 3 emails') || lower.includes('top 3 mails summary') || lower.includes('top 3 emails summary')) return { type: 'read_gmail', confidence: 'high' }

  if (lower.includes('connect calendar') || lower.includes('connect my calendar') || lower.includes('connect to my calendar') || lower.includes('link calendar') || lower.includes('google calendar')) return { type: 'connect_calendar', confidence: 'high' }
  if (lower.includes('weather') || lower.includes('temperature') || lower.includes('rain')) return { type: 'weather_live', confidence: 'high' }
  if (lower.includes('gold price') || lower.includes('gold rate') || lower.includes('silver price') || lower.includes('silver rate')) return { type: 'gold_live', confidence: 'high' }
  if (lower.includes('ipl table') || lower.includes('points table') || lower.includes('table toppers') || lower.includes('ipl standings') || lower.includes('ipl topper')) return { type: 'sports_standings', confidence: 'high' }
  if ((lower.includes('rcb') && lower.includes('match')) || (lower.includes('ipl') && lower.includes('match')) || lower.includes('next rcb match') || lower.includes('when is the next rcb match')) return { type: 'sports_schedule', confidence: 'high' }

  if (lower.includes('remind me') || lower.includes('remind to') || lower.startsWith('remind ') || lower.includes('set a reminder') || lower.includes('set reminder') || lower.includes('reminder for') || /\b(on\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(lower) || /\b(tomorrow|tmrw|tmr)\b/i.test(lower) || /\bin\s+\d+\s+(minute|minutes|min|mins|hour|hours|day|days)\b/i.test(lower) || /\bat\s+\d{1,2}(:\d{2})?\s*(am|pm)\b/i.test(lower)) return { type: 'set_reminder', confidence: 'high' }

  if (lower === 'show all lists' || lower === 'list all' || lower === 'show my lists') return { type: 'list_show_all', confidence: 'high' }
  if ((lower.startsWith('show ') || lower.startsWith('open ') || lower.startsWith('view ')) && lower.includes(' list')) return { type: 'list_show', confidence: 'medium' }
  if (lower.startsWith('add ') && (lower.includes(' to ') || lower.includes(' into '))) return { type: 'list_add', confidence: 'medium' }
  if (lower.startsWith('check ') || lower.startsWith('tick ') || lower.startsWith('mark ')) return { type: 'list_check', confidence: 'medium' }
  if (lower.startsWith('clear ') || lower.startsWith('delete list ') || lower.startsWith('remove list ')) return { type: 'list_clear', confidence: 'medium' }
  if (lower.startsWith('remember ') || lower.includes('remember that ') || lower.includes('save this memory')) return { type: 'save_memory', confidence: 'high' }
  if (SEARCH_HINTS.some((k) => lower.includes(k))) return { type: 'web_search', confidence: 'medium' }

  return { type: 'general_chat', confidence: 'low' }
}
