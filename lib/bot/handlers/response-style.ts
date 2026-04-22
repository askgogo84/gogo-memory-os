function titleLine(text: string) {
  return text.trim()
}

export function styleReminderConfirmation(message: string) {
  let text = message.trim()

  text = text.replace(
    /^Done\s*—\s*I'll remind you to (.+?) (today|tomorrow|[A-Za-z]+,\s+\d+\s+[A-Za-z]+ at .+|[A-Za-z]+,\s+\d+\s+[A-Za-z]+\s+at\s+.+)$/i,
    'Locked in — $2 for $1.'
  )

  text = text.replace(
    /^Done\s*—\s*I'll remind you to (.+?) ([A-Za-z]+,\s+\d+\s+[A-Za-z]+ at .+)$/i,
    'Locked in — $2 for $1.'
  )

  text = text.replace(
    /^Done\s*—\s*I'll remind you (today at .+|tomorrow at .+|[A-Za-z]+,\s+\d+\s+[A-Za-z]+ at .+)$/i,
    'Locked in — $1.'
  )

  text = text.replace(/^Done\s*—\s*/i, 'Locked in — ')
  text = text.replace(/\*\*/g, '*')

  return titleLine(text)
}

export function styleWeatherReply(message: string) {
  const text = message.trim()

  const tomorrow = text.match(/^Tomorrow in ([^:]+):\s*\n(.+), avg ([\d.]+°C), high ([\d.]+°C) \/ low ([\d.]+°C)\s*\nRain chance (\d+%) • Wind up to ([\d.]+ km\/h)$/i)
  if (tomorrow) {
    return `Tomorrow in ${tomorrow[1]} looks ${tomorrow[2].toLowerCase()}: ${tomorrow[6]} rain chance, ${tomorrow[4]} high, ${tomorrow[5]} low.`
  }

  const current = text.match(/^Current weather in ([^:]+):\s*\n(.+), ([\d.]+°C), feels like ([\d.]+°C)\s*\nHumidity (\d+%) • Wind ([\d.]+ km\/h)$/i)
  if (current) {
    return `${current[1]} right now: ${current[2].toLowerCase()}, ${current[3]}, feels like ${current[4]}.`
  }

  return titleLine(text)
}

export function styleSportsReply(message: string) {
  return titleLine(
    message.replace(/\n\nWant me to set a reminder for it\?/i, '\n\nWant a reminder 1 hour before?')
  )
}

export function styleEmailListReply(message: string) {
  let text = message.trim()
  text = text.replace(/^Top 3 latest emails/i, 'Here are your top 3 latest emails')
  text = text.replace(/^Top 3 unread emails/i, 'Here are your top 3 unread emails')
  text = text.replace(/^Top 3 latest email summaries/i, 'Here are your top 3 latest email summaries')
  text = text.replace(/^Top 3 unread email summaries/i, 'Here are your top 3 unread email summaries')
  return titleLine(text)
}

export function styleEmailDraftReply(message: string) {
  let text = message.trim()
  text = text.replace(/^Draft reply suggestion/i, 'Here’s a reply draft')
  return titleLine(text)
}

export function styleGenericReply(message: string) {
  return titleLine(
    message
      .replace(/^Got it!\s*/i, 'Got it — ')
      .replace(/^Sure!\s*/i, '')
      .replace(/^Absolutely!\s*/i, '')
  )
}

export function addSmartPrompt(intentType: string, message: string) {
  if (intentType === 'sports_schedule' && !/Want a reminder/i.test(message)) {
    return `${message}\n\nWant a reminder 1 hour before?`
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
  } else if (intentType === 'read_gmail') {
    text = styleEmailListReply(text)
  } else if (intentType === 'email_action') {
    text = styleEmailDraftReply(text)
  } else {
    text = styleGenericReply(text)
  }

  text = addSmartPrompt(intentType, text)
  return text.trim()
}
