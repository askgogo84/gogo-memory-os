export type IntentType =
  | 'connect_gmail'
  | 'read_gmail'
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
  | 'save_memory'
  | 'web_search'
  | 'general_chat'

export type DetectedIntent = {
  type: IntentType
  confidence: 'high' | 'medium' | 'low'
  meta?: Record<string, any>
}

const SEARCH_HINTS = [
  'latest', 'news', 'today', 'current',
  'score', 'stock', 'price',
]

export function detectIntent(text: string): DetectedIntent {
  const t = (text || '').trim()
  const lower = t.toLowerCase()

  if (!lower) return { type: 'general_chat', confidence: 'low' }

  if (
    lower.includes('connect my gmail') ||
    lower.includes('connect to my gmail') ||
    lower.includes('connect gmail') ||
    lower.includes('connect to gmail') ||
    lower.includes('link gmail') ||
    lower.includes('gmail connect')
  ) {
    return { type: 'connect_gmail', confidence: 'high' }
  }

  if (
    lower.includes('check my latest mail') ||
    lower.includes('check my latest mails') ||
    lower.includes('latest mail') ||
    lower.includes('latest mails') ||
    lower.includes('latest email') ||
    lower.includes('latest emails') ||
    lower.includes('show my unread emails') ||
    lower.includes('show unread emails') ||
    lower.includes('check unread emails') ||
    lower.includes('any new mails') ||
    lower.includes('any new mail') ||
    lower.includes('check my inbox') ||
    lower.includes('mail summary') ||
    lower.includes('mails summary') ||
    lower.includes('email summary') ||
    lower.includes('emails summary') ||
    lower.includes('top 3 mails') ||
    lower.includes('top 3 mail') ||
    lower.includes('top 3 emails') ||
    lower.includes('top 3 email') ||
    lower.includes('check my top 3 mail') ||
    lower.includes('check my top 3 email') ||
    lower.includes('show me my top 3 mails') ||
    lower.includes('show me my top 3 email') ||
    lower.includes('summarize my mails') ||
    lower.includes('summarize my emails')
  ) {
    return { type: 'read_gmail', confidence: 'high' }
  }

  if (
    lower.includes('connect calendar') ||
    lower.includes('connect my calendar') ||
    lower.includes('connect to my calendar') ||
    lower.includes('link calendar') ||
    lower.includes('google calendar')
  ) {
    return { type: 'connect_calendar', confidence: 'high' }
  }

  if (
    lower.includes('weather') ||
    lower.includes('temperature') ||
    lower.includes('rain')
  ) {
    return { type: 'weather_live', confidence: 'high' }
  }

  if (
    lower.includes('gold price') ||
    lower.includes('gold rate') ||
    lower.includes('silver price') ||
    lower.includes('silver rate')
  ) {
    return { type: 'gold_live', confidence: 'high' }
  }

  if (
    lower.includes('ipl table') ||
    lower.includes('points table') ||
    lower.includes('table toppers') ||
    lower.includes('ipl standings') ||
    lower.includes('ipl topper')
  ) {
    return { type: 'sports_standings', confidence: 'high' }
  }

  if (
    (lower.includes('rcb') && lower.includes('match')) ||
    (lower.includes('ipl') && lower.includes('match')) ||
    lower.includes('next rcb match') ||
    lower.includes('when is the next rcb match')
  ) {
    return { type: 'sports_schedule', confidence: 'high' }
  }

  if (lower === 'show all lists' || lower === 'list all' || lower === 'show my lists') {
    return { type: 'list_show_all', confidence: 'high' }
  }

  if (
    lower.startsWith('show ') ||
    lower.startsWith('open ') ||
    lower.startsWith('view ')
  ) {
    if (lower.includes(' list')) return { type: 'list_show', confidence: 'medium' }
  }

  if (
    lower.startsWith('add ') &&
    (lower.includes(' to ') || lower.includes(' into '))
  ) {
    return { type: 'list_add', confidence: 'medium' }
  }

  if (
    lower.startsWith('check ') ||
    lower.startsWith('tick ') ||
    lower.startsWith('mark ')
  ) {
    return { type: 'list_check', confidence: 'medium' }
  }

  if (
    lower.startsWith('clear ') ||
    lower.startsWith('delete list ') ||
    lower.startsWith('remove list ')
  ) {
    return { type: 'list_clear', confidence: 'medium' }
  }

  if (
    lower.includes('remind me') ||
    lower.includes('remind to') ||
    lower.startsWith('remind ') ||
    lower.includes('set reminder') ||
    lower.includes('reminder for') ||
    lower.includes('রিমাইন্ডার') ||
    lower.includes('মনে করিয়ে')
  ) {
    return { type: 'set_reminder', confidence: 'high' }
  }

  if (
    lower.startsWith('remember ') ||
    lower.includes('remember that ') ||
    lower.includes('save this memory')
  ) {
    return { type: 'save_memory', confidence: 'high' }
  }

  if (SEARCH_HINTS.some((k) => lower.includes(k))) {
    return { type: 'web_search', confidence: 'medium' }
  }

  return { type: 'general_chat', confidence: 'low' }
}
