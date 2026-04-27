import { buildReminderConfirmation, getAmbiguousReminderTime, parseReminderIntent } from './reminders'

export function isAmPmChoice(text: string) {
  const lower = (text || '').toLowerCase().trim()
  return /^(am|a\.m\.?|morning|pm|p\.m\.?|evening|night)$/.test(lower)
}

export function buildReminderFromAmPmChoice(originalText: string, choiceText: string) {
  const ambiguous = getAmbiguousReminderTime(originalText)
  if (!ambiguous) return null

  const lower = (choiceText || '').toLowerCase().replace(/\s+/g, '').trim()
  let suffix: 'am' | 'pm' | null = null

  if (lower === 'am' || lower === 'a.m.' || lower === 'morning') suffix = 'am'
  if (lower === 'pm' || lower === 'p.m.' || lower === 'evening' || lower === 'night') suffix = 'pm'
  if (!suffix) return null

  const fullTime = `${ambiguous.label} ${suffix}`
  let resolvedText = originalText

  const compact = originalText.match(/\b\d{3,4}\b/)
  if (compact) resolvedText = originalText.replace(compact[0], fullTime)
  else resolvedText = originalText.replace(/\bat\s+\d{1,2}\b/i, `at ${fullTime}`)

  return parseReminderIntent(resolvedText)
}

export function buildAmPmReminderSetReply(parsed: NonNullable<ReturnType<typeof parseReminderIntent>>) {
  return buildReminderConfirmation(parsed)
}
