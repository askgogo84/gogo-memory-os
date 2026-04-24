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

function removeAssistantNoise(text: string) {
  return text
    .replace(/^Sure[!.]?\s*/i, '')
    .replace(/^Absolutely[!.]?\s*/i, '')
    .replace(/^Okay[!.]?\s*/i, '')
    .replace(/^Got it[!.]?\s*/i, 'Got it — ')
    .replace(/I hope this helps\.?/gi, '')
    .trim()
}

export function styleReminderConfirmation(message: string) {
  let text = compact(message)

  const m =
    text.match(/^Done\s*—\s*I'll remind you to \*(.+?)\* (.+)$/i) ||
    text.match(/^Done\s*—\s*I'll remind you to (.+?) (today at .+)$/i) ||
    text.match(/^Done\s*—\s*I'll remind you to (.+?) (tomorrow at .+)$/i) ||
    text.match(/^Done\s*—\s*I'll remind you (today at .+)$/i)

  if (m) {
    if (m.length === 3) {
      const task = titleCaseFirst(m[1].replace(/^to\s+/i, '').trim())
      const when = m[2].trim()

      return `✅ *Reminder set*\n\n${task}\n${when}`
    }

    return `✅ *Reminder set*\n\n${m[1]}`
  }

  text = text
    .replace(/^Done\s*—\s*/i, '')
    .replace(/^I'll remind you to\s*/i, '')
    .replace(/^I’ll remind you to\s*/i, '')
    .replace(/^to\s+/i, '')

  return `✅ *Reminder set*\n\n${titleCaseFirst(text)}`
}

export function styleReminderEditReply(message: string) {
  const text = compact(message)

  if (/updated your reminder to/i.test(text)) {
    return text
      .replace(/^Done\s*—\s*/i, '✅ *Reminder updated*\n\n')
      .replace(/I’ve updated your reminder to/i, 'New time:')
      .replace(/I've updated your reminder to/i, 'New time:')
      .trim()
  }

  if (/couldn't find any pending reminder/i.test(text)) {
    return `No pending reminder found.\n\nCreate one first, then say “snooze 10 mins” or “move it to 8 pm”.`
  }

  return text
}

export function styleWeatherReply(message: string) {
  const text = compact(message)

  const tomorrow = text.match(
    /^Tomorrow in ([^:]+):\s*\n(.+), avg ([\d.]+°C), high ([\d.]+°C) \/ low ([\d.]+°C)\s*\nRain chance (\d+%) • Wind up to ([\d.]+ km\/h)$/i
  )

  if (tomorrow) {
    return `🌤️ *${tomorrow[1]} tomorrow*\n\n${titleCaseFirst(tomorrow[2].toLowerCase())}\nHigh: ${tomorrow[4]} • Low: ${tomorrow[5]}\nRain chance: ${tomorrow[6]}`
  }

  const current = text.match(
    /^Current weather in ([^:]+):\s*\n(.+), ([\d.]+°C), feels like ([\d.]+°C)\s*\nHumidity (\d+%) • Wind ([\d.]+ km\/h)$/i
  )

  if (current) {
    return `🌤️ *${current[1]} now*\n\n${titleCaseFirst(current[2].toLowerCase())}\n${current[3]} • Feels like ${current[4]}\nHumidity: ${current[5]}`
  }

  return text
}

export function styleSportsReply(message: string) {
  let text = compact(message)
    .replace(/\n\nWant me to set a reminder for it\?/i, '\n\nReply “Yes” and I’ll remind you 1 hour before.')
    .replace(/^Next match:/i, '🏏 *Next match*')

  if (!/remind you/i.test(text) && !/Reply “Yes”/i.test(text)) {
    text += '\n\nReply “Yes” and I’ll remind you 1 hour before.'
  }

  return text
}

export function styleEmailListReply(message: string) {
  return compact(message)
    .replace(/^Top 3 latest emails/i, '📬 *Latest emails*')
    .replace(/^Top 3 unread emails/i, '📬 *Unread emails*')
    .replace(/^Top 3 latest email summaries/i, '📬 *Latest email summaries*')
    .replace(/^Top 3 unread email summaries/i, '📬 *Unread email summaries*')
    .replace(/^Here are your top 3 latest emails/i, '📬 *Latest emails*')
    .replace(/^Here are your top 3 unread emails/i, '📬 *Unread emails*')
}

export function styleEmailDraftReply(message: string) {
  return compact(message)
    .replace(/^Draft reply suggestion/i, '✍️ *Reply draft*')
    .replace(/^Here’s a reply draft:/i, '✍️ *Reply draft*')
    .trim()
}

export function styleMorningBriefing(message: string) {
  return compact(message)
    .replace(/^Good morning, ([^.]+)\./i, '☀️ *Morning briefing for $1*')
    .replace(/\*Today's weather\*/i, '🌤️ *Weather*')
    .replace(/\*Today's reminders\*/i, '⏰ *Today’s reminders*')
    .replace(/\*Top unread emails\*/i, '📬 *Unread emails*')
}

export function styleUpgradeReply(message: string) {
  return compact(message)
}

export function styleGenericReply(message: string) {
  let text = compact(message)
  const lower = text.toLowerCase()
  text = removeAssistantNoise(text)

  if (/^(hi|hello|hey|start|\/start)$/i.test(lower)) {
    return `Hey, I’m *AskGogo* 👋\n\nYour personal AI assistant on WhatsApp.\n\nTry:\n• Remind me in 10 mins to call Rahul\n• Bangalore weather tomorrow\n• Show my unread emails\n• Morning briefing\n• Next RCB match\n\nI’ll keep it short and useful.`
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
  } else if (intentType === 'upgrade_plan') {
    text = styleUpgradeReply(text)
  } else {
    text = styleGenericReply(text)
  }

  return compact(text)
}
