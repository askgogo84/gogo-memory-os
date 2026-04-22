import type { IntentType } from './detect-intent'

export function getStatusText(intent: IntentType, messageType?: string) {
  if (messageType === 'voice') return 'Listening…'

  switch (intent) {
    case 'read_gmail':
    case 'email_action':
      return 'Fetching your inbox…'
    case 'web_search':
      return 'Checking that for you…'
    case 'sports_schedule':
    case 'sports_standings':
      return 'Pulling the latest match update…'
    case 'weather_live':
      return 'Checking the latest forecast…'
    case 'gold_live':
      return 'Pulling the latest price…'
    case 'connect_gmail':
      return 'Preparing Gmail connect…'
    case 'connect_calendar':
      return 'Preparing Calendar connect…'
    default:
      return 'Working on it…'
  }
}

export function shouldUseAnimation(intent: IntentType, messageType?: string) {
  if (messageType === 'voice') return true

  return (
    intent === 'read_gmail' ||
    intent === 'email_action' ||
    intent === 'web_search'
  )
}
