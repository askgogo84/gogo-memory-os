// A time-first reminder directive, observed in WhatsApp on 1 Oct 2026.
// Require both a leading explicit clock and the trailing command word; merely
// mentioning an appointment or a reminder is not a scheduling instruction.
export function isTimeFirstReminder(text: string): boolean {
  return /^\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)\b.+\breminder[.!]*\s*$/i.test(text.trim())
}

/**
 * A bare day/time with no reminder verb and nothing to be reminded about ("This Saturday 8pm",
 * "tomorrow 10am") is not a reminder request. 19 Oct live: it was the answer to a restaurant
 * question and became a reminder titled "This". Pending reminder follow-ups ("at what time?") are
 * resolved earlier from saved follow-up state, so they never reach this check.
 */
const REMINDER_ASK=/\b(?:remind|reminder|reminders|alarm|wake\s+me|alert\s+me|notify\s+me|ping\s+me|don['’]?t\s+let\s+me\s+forget)\b/i
const TIME_ONLY_WORDS=/\b(?:this|next|coming|on|at|by|in|the|a|an|for|around|about|evening|morning|night|afternoon|noon|midnight|tonight|today|tomorrow|tmrw|tmr|day|after|week|weekend|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun|jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december|am|pm|o['’]?clock|ist|please|pls|ok|okay|then|it|that|same|time|hrs?|hours?|mins?|minutes?)\b/gi
export function isContentlessReminderRequest(text: string): boolean {
  const t = String(text || '').trim()
  if (!t || REMINDER_ASK.test(t)) return false
  // Ordinals first: the clock pattern would otherwise eat "28" of "28th" and leave "th" behind.
  const leftover = t.replace(/\d+(?:st|nd|rd|th)\b/gi, ' ').replace(/\d{1,2}(?::\d{2})?\s*(?:am|pm)?/gi, ' ').replace(/\d+(?:st|nd|rd|th)?/gi, ' ').replace(TIME_ONLY_WORDS, ' ').replace(/[^\p{L}]+/gu, ' ').trim()
  return leftover.length === 0
}
