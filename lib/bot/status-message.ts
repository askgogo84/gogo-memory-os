import type { IntentType } from './detect-intent'

export function getStatusText(intent: IntentType, messageType?: string) {
  if (messageType === 'voice') return 'Listening…'

  switch (intent) {
    case 'read_gmail':
    case 'email_action':
      return 'Fetching your inbox…'
    case 'web_search':
      return 'Checking that for you…'
    case 'sports_standings':
      return 'Pulling the latest match update…'
    default:
      return 'Working on it…'
  }
}

export function shouldUseAnimation(intent: IntentType, messageType?: string) {
  if (messageType === 'voice') return true

  return (
    intent === 'read_gmail' ||
    intent === 'email_action' ||
    intent === 'web_search' ||
    intent === 'sports_standings'
  )
}
