function compact(text: string) {
  return (text || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\*\*/g, '*')
    .trim()
}

function titleCaseFirst(text: string) {
  const clean = text.trim()
  if (!clean) return clean
  return clean.charAt(0).toUpperCase() + clean.slice(1)
}

function cleanTask(text: string) {
  return (text || 'Reminder').replace(/^to\s+/i, '').trim()
}

export function styleReminderConfirmation(message: string) {
  const text = compact(message)

  const m =
    text.match(/^Done\s*—\s*I'll remind you to \*(.+?)\* (.+)$/i) ||
    text.match(/^Done\s*—\s*I'll remind you to (.+?) (today at .+)$/i) ||
    text.match(/^Done\s*—\s*I'll remind you to (.+?) (tomorrow at .+)$/i)

  if (m) {
    return `✅ *Reminder set*\n\n${titleCaseFirst(cleanTask(m[1]))}\n${m[2]}`
  }

  return text
    .replace(/^Done\s*—\s*/i, '✅ *Reminder set*\n\n')
    .replace(/^I'll remind you to\s*/i, '')
    .replace(/^I’ll remind you to\s*/i, '')
}

export function styleReminderEditReply(message: string) {
  return compact(message)
}

export function styleWeatherReply(message: string) {
  const text = compact(message)

  const tomorrow = text.match(
    /^\*?Tomorrow in ([^:*]+):\*?\s*\n(.+), avg ([\d.]+°C), high ([\d.]+°C) \/ low ([\d.]+°C)\s*\nRain chance (\d+%) • Wind up to ([\d.]+ km\/h)$/i
  )

  if (tomorrow) {
    return `🌤️ *${tomorrow[1].trim()} tomorrow*\n\n${titleCaseFirst(tomorrow[2].toLowerCase())}\nHigh: ${tomorrow[4]} • Low: ${tomorrow[5]}\nRain chance: ${tomorrow[6]}\nWind: up to ${tomorrow[7]}`
  }

  const current = text.match(
    /^\*?Current weather in ([^:*]+):\*?\s*\n(.+), ([\d.]+°C), feels like ([\d.]+°C)\s*\nHumidity (\d+%) • Wind ([\d.]+ km\/h)$/i
  )

  if (current) {
    return `🌤️ *${current[1].trim()} now*\n\n${titleCaseFirst(current[2].toLowerCase())}\n${current[3]} • Feels like ${current[4]}\nHumidity: ${current[5]}\nWind: ${current[6]}`
  }

  return text
    .replace(/\*Current weather in ([^:*]+):\*/i, '🌤️ *$1 now*')
    .replace(/\*Tomorrow in ([^:*]+):\*/i, '🌤️ *$1 tomorrow*')
}

export function styleSportsReply(message: string) {
  let text = compact(message)

  const rcb = text.match(/RCB's next match is (.+?) on (.+?)\./i)

  if (rcb) {
    return `🏏 *Next RCB match*\n\n${rcb[1]}\n${rcb[2]}\n\nReply “Yes” and I’ll remind you 1 hour before.`
  }

  text = text.replace(/\n\nWant me to set a reminder for it\?/i, '\n\nReply “Yes” and I’ll remind you 1 hour before.')

  if (!/Reply “Yes”/i.test(text) && /match/i.test(text) && /next/i.test(text)) {
    text += '\n\nReply “Yes” and I’ll remind you 1 hour before.'
  }

  return text
}

export function styleEmailListReply(message: string) {
  let text = compact(message)

  text = text
    .replace(/^Top 3 latest emails/i, '📬 *Latest emails*')
    .replace(/^Top 3 unread emails/i, '📬 *Unread emails*')
    .replace(/^Top 3 latest email summaries/i, '📬 *Latest email summaries*')
    .replace(/^Top 3 unread email summaries/i, '📬 *Unread email summaries*')
    .replace(/^Here are your top 3 latest emails/i, '📬 *Latest emails*')
    .replace(/^Here are your top 3 unread emails/i, '📬 *Unread emails*')
    .replace(/^I couldn't fetch your emails right now\./i, '📬 *Gmail needs reconnecting*')

  if (/📬/.test(text) && !/Reply:/i.test(text) && !/connect/i.test(text)) {
    text += `\n\nReply:\n• summarize emails\n• reply to latest mail`
  }

  return text
}

export function styleEmailDraftReply(message: string) {
  return compact(message)
    .replace(/^Draft reply suggestion/i, '✍️ *Reply draft*')
    .replace(/^Here’s a reply draft:/i, '✍️ *Reply draft*')
}

export function styleMorningBriefing(message: string) {
  return compact(message)
    .replace(/^Good morning, ([^.]+)\./i, '☀️ *Today for $1*')
    .replace(/\*Today's weather\*/i, '🌤️ *Weather*')
    .replace(/\*Today's reminders\*/i, '⏰ *Reminders*')
    .replace(/\*Top unread emails\*/i, '📬 *Unread emails*')
}

export function styleGenericReply(message: string) {
  const text = compact(message)
  const lower = text.toLowerCase()

  if (/^(hi|hello|hey|start|\/start)$/i.test(lower)) {
    return `Hey, I’m *AskGogo* 👋\n\nYour AI assistant inside WhatsApp.\n\nTry:\n• Remind me in 10 mins to call Rahul\n• Bangalore weather tomorrow\n• Show my unread emails\n• Today`
  }

  return text
}

export function styleReplyByIntent(intentType: string, message: string) {
  let text = message

  if (intentType === 'set_reminder') {
    text = styleReminderConfirmation(text)
  } else if (intentType === 'edit_reminder') {
    text = styleReminderEditReply(text)
  } else if (intentType === 'weather_live') {
    text = styleWeatherReply(text)
  } else if (intentType === 'sports_schedule') {
    text = styleSportsReply(text)
  } else if (intentType === 'read_gmail') {
    text = styleEmailListReply(text)
  } else if (intentType === 'email_action') {
    text = styleEmailDraftReply(text)
  } else if (intentType === 'morning_briefing') {
    text = styleMorningBriefing(text)
  } else {
    text = styleGenericReply(text)
  }

  return compact(text)
}
