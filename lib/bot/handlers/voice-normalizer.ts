const NUMBER_WORDS: Record<string, string> = {
  zero: '0',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
  ten: '10',
  eleven: '11',
  twelve: '12',
  fifteen: '15',
  twenty: '20',
  thirty: '30',
  forty: '40',
  fifty: '50',
  sixty: '60',
}

function normalizeNumberWords(text: string) {
  let out = text

  for (const [word, digit] of Object.entries(NUMBER_WORDS)) {
    out = out.replace(new RegExp(`\\b${word}\\b`, 'gi'), digit)
  }

  return out
}

function normalizeCommonTimeWords(text: string) {
  return text
    .replace(/\btwo minutes\b/gi, '2 minutes')
    .replace(/\bfive minutes\b/gi, '5 minutes')
    .replace(/\bten minutes\b/gi, '10 minutes')
    .replace(/\bfifteen minutes\b/gi, '15 minutes')
    .replace(/\bthirty minutes\b/gi, '30 minutes')
    .replace(/\bone hour\b/gi, '1 hour')
    .replace(/\btwo hours\b/gi, '2 hours')
    .replace(/\bhalf an hour\b/gi, '30 minutes')
}

function normalizeIndianDateWords(text: string) {
  return text
    .replace(/\bkal subah\b/gi, 'tomorrow morning')
    .replace(/\bkal\b/gi, 'tomorrow')
    .replace(/\baaj\b/gi, 'today')
    .replace(/\braat\b/gi, 'night')
    .replace(/\bsubah\b/gi, 'morning')
    .replace(/\bshaam\b/gi, 'evening')
    .replace(/\bnaalaikku\b/gi, 'tomorrow')
    .replace(/\bnaale\b/gi, 'tomorrow')
    .replace(/\brepu\b/gi, 'tomorrow')
    .replace(/\bravile\b/gi, 'morning')
}

function normalizeReminderWords(text: string) {
  return text
    .replace(/\byaad dilana\b/gi, 'remind me')
    .replace(/\byaad dilaana\b/gi, 'remind me')
    .replace(/\breminder madi\b/gi, 'remind me')
    .replace(/\bremind maadi\b/gi, 'remind me')
    .replace(/\bremind ಮಾಡಿ\b/gi, 'remind me')
    .replace(/\bರಿಮೈಂಡ್ ಮಾಡಿ\b/gi, 'remind me')
    .replace(/\bரிமைண்ட் பண்ணுங்க\b/gi, 'remind me')
    .replace(/\bremind pannunga\b/gi, 'remind me')
    .replace(/\breminder petti\b/gi, 'remind me')
    .replace(/\bremind cheyyu\b/gi, 'remind me')
}

function cleanupVoiceText(text: string) {
  return text
    .replace(/[“”]/g, '"')
    .replace(/[.]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function looksLikeReminder(text: string) {
  const lower = text.toLowerCase()

  return (
    lower.includes('remind') ||
    lower.includes('reminder') ||
    lower.includes('yaad') ||
    lower.includes('ಯಾದ') ||
    lower.includes('ರಿಮೈಂಡ್') ||
    lower.includes('ரிமைண்ட்') ||
    lower.includes('remind me') ||
    lower.includes('call karna') ||
    lower.includes('gym') ||
    lower.includes('meeting')
  )
}

function moveInTimeBeforeTask(text: string) {
  // "remind me to drink water in 2 minutes" -> "remind me in 2 minutes to drink water"
  const match = text.match(/^remind me to (.+?) in (\d+)\s+(minute|minutes|min|mins|hour|hours)$/i)

  if (!match) return text

  return `Remind me in ${match[2]} ${match[3]} to ${match[1]}`
}

function normalizeTomorrowMorning(text: string) {
  let out = text

  // "tomorrow morning 9 am meeting remind me" -> "Remind me tomorrow at 9 am to meeting"
  let m = out.match(/tomorrow morning\s+(\d{1,2})\s*(am|pm)?\s+(.+?)\s+remind me/i)
  if (m) {
    return `Remind me tomorrow at ${m[1]} ${m[2] || 'am'} to ${m[3]}`
  }

  // "tomorrow morning at 9 am remind me to call"
  m = out.match(/tomorrow morning\s+(?:at\s+)?(\d{1,2})\s*(am|pm)?\s+remind me(?: to)?\s+(.+)/i)
  if (m) {
    return `Remind me tomorrow at ${m[1]} ${m[2] || 'am'} to ${m[3]}`
  }

  // "tomorrow morning 9 am call remind me"
  m = out.match(/tomorrow morning\s+(\d{1,2})\s*(am|pm)?\s+(.+)/i)
  if (m && /remind/i.test(out)) {
    const task = m[3].replace(/\bremind me\b/gi, '').trim()
    return `Remind me tomorrow at ${m[1]} ${m[2] || 'am'} to ${task}`
  }

  return out
}

function normalizeTodayNight(text: string) {
  let out = text

  const m = out.match(/today night\s+(\d{1,2})\s*(am|pm)?\s+(.+?)\s+remind me/i)
  if (m) {
    return `Remind me today at ${m[1]} ${m[2] || 'pm'} to ${m[3]}`
  }

  return out
}

export function normalizeVoicePromptForBot(transcript: string) {
  let text = cleanupVoiceText(transcript)

  text = normalizeIndianDateWords(text)
  text = normalizeReminderWords(text)
  text = normalizeCommonTimeWords(text)
  text = normalizeNumberWords(text)
  text = cleanupVoiceText(text)

  if (!looksLikeReminder(text)) {
    return text
  }

  text = moveInTimeBeforeTask(text)
  text = normalizeTomorrowMorning(text)
  text = normalizeTodayNight(text)
  text = cleanupVoiceText(text)

  // If it contains a time phrase but does not start with remind, make it explicit.
  if (!/^remind/i.test(text) && /\b(in \d+|tomorrow|today|at \d+)/i.test(text)) {
    text = `Remind me ${text}`
  }

  return text
}
