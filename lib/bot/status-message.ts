import type { IntentType } from './detect-intent'

export function getStatusText(intent: IntentType, messageType?: string) {
  if (messageType === 'voice') return '🎙️ Transcribing your voice note...'

  switch (intent) {
    case 'sports_schedule':
      return '🏏 Checking IPL match details...'
    case 'sports_standings':
      return '📊 Checking the IPL table...'
    case 'weather_live':
      return '🌦️ Checking the weather...'
    case 'gold_live':
      return '🪙 Checking the latest price...'
    case 'web_search':
      return '🔎 Checking the latest info...'
    case 'connect_gmail':
      return '📬 Preparing Gmail connect...'
    case 'read_gmail':
      return '📨 Checking your latest emails...'
    case 'connect_calendar':
      return '📅 Preparing Calendar connect...'
    case 'set_reminder':
      return '⏰ Setting your reminder...'
    case 'list_show':
    case 'list_show_all':
    case 'list_add':
    case 'list_check':
    case 'list_clear':
      return '📝 Updating your list...'
    default:
      return '🧠 Thinking...'
  }
}

export function shouldUseAnimation(intent: IntentType, messageType?: string) {
  if (messageType === 'voice') return true
  return intent === 'web_search' || intent === 'sports_schedule' || intent === 'sports_standings' || intent === 'weather_live' || intent === 'gold_live' || intent === 'connect_gmail'
}






