export function styleSuccess(message: string) {
  return message
    .replace(/^Done\s*—\s*/i, 'Done — ')
    .replace(/^Perfect!\s*/i, '')
    .replace(/^All set!\s*/i, '')
    .trim()
}

export function styleReminderConfirmation(message: string) {
  let text = message.trim()

  text = text.replace(/^Done\s*—\s*I'll remind you to\s*/i, "Locked in — ")
  text = text.replace(/^Done\s*—\s*I'll remind you\s*/i, "Locked in — ")
  text = text.replace(/^Done\s*—\s*I've set a recurring reminder to\s*/i, "Recurring reminder set — ")
  text = text.replace(/\*\*/g, '*')

  return text
}

export function styleWeatherReply(message: string) {
  return message.trim()
}

export function styleSportsReply(message: string) {
  return message
    .replace(/\n\nWant me to set a reminder for it\?/i, '\n\nWant a reminder 1 hour before?')
    .trim()
}

export function styleEmailReply(message: string) {
  return message
    .replace(/^Top 3 latest emails/i, 'Here are your top 3 latest emails')
    .replace(/^Top 3 unread emails/i, 'Here are your top 3 unread emails')
    .replace(/^Top 3 latest email summaries/i, 'Here are your top 3 latest email summaries')
    .replace(/^Top 3 unread email summaries/i, 'Here are your top 3 unread email summaries')
    .replace(/^Draft reply suggestion/i, 'Here’s a reply draft')
    .trim()
}

export function styleGenericReply(message: string) {
  return message
    .replace(/^Got it!\s*/i, 'Got it — ')
    .replace(/^Sure!\s*/i, '')
    .replace(/^Absolutely!\s*/i, '')
    .trim()
}

export function addSmartPrompt(intentType: string, message: string) {
  if (intentType === 'sports_schedule' && !/Want a reminder/i.test(message)) {
    return `${message}\n\nWant a reminder 1 hour before?`
  }

  if (intentType === 'weather_live' && !/Want a rain alert/i.test(message)) {
    return `${message}\n\nWant a rain alert tomorrow morning too?`
  }

  if (intentType === 'email_action' && !/Want a shorter reply draft/i.test(message)) {
    return `${message}\n\nWant a shorter reply draft or a more formal one?`
  }

  if (intentType === 'read_gmail' && /summary|emails/i.test(message) && !/Want a reply draft/i.test(message)) {
    return `${message}\n\nWant a reply draft for any of these?`
  }

  return message
}

export function styleReplyByIntent(intentType: string, message: string) {
  let text = message

  if (intentType === 'set_reminder') {
    text = styleReminderConfirmation(text)
  } else if (intentType === 'weather_live') {
    text = styleWeatherReply(text)
  } else if (intentType === 'sports_schedule') {
    text = styleSportsReply(text)
  } else if (intentType === 'read_gmail' || intentType === 'email_action') {
    text = styleEmailReply(text)
  } else {
    text = styleGenericReply(text)
  }

  text = addSmartPrompt(intentType, text)
  return text.trim()
}
