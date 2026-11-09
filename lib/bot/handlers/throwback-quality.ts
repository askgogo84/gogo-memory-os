/**
 * Only explicit saved notes qualify for an unsolicited "Throwback".
 * Filtering at read time preserves old records and keeps the user in control
 * of deletion. This is a negative-content guard, not a memory classifier.
 */
const INTERNAL_MARKER = /(?:followup_state|meeting_action_items|reminder_ampm|calendar_conflict|day_plan|askgogo_usage|founder pricing)/i
const NO_MEMORY_FACT = /(?:user wants to save something|no (?:specific|concrete|actual) (?:fact|detail|information|memory)|nothing (?:specific|concrete) (?:to|was) (?:save|remember)|no (?:information|detail) (?:was )?provided|did not provide (?:a|any) (?:fact|detail)|can't (?:save|remember) (?:without|because)|cannot (?:save|remember) (?:without|because)|not enough (?:detail|information) to (?:save|remember))/i
const PRIVATE_SECRET = /(?:\b(?:password|passcode|otp|one[- ]time (?:password|code)|api[_ -]?key|bearer token|recovery code|cvv|cvc)\b|\b[A-Z]{5}\d{4}[A-Z]\b|\b(?:\d[ -]?){13,19}\b)/i

export function eligibleThrowbackMemory(content: unknown, sourceTable: unknown): boolean {
  if (sourceTable !== 'memories' || typeof content !== 'string') return false
  const t = content.trim()
  if (t.length < 10 || t.length > 2000) return false
  if (/^[{[]/.test(t) || /^askgogo_/i.test(t)) return false
  if (INTERNAL_MARKER.test(t) || NO_MEMORY_FACT.test(t) || PRIVATE_SECRET.test(t)) return false
  // The memory might be an AI/system explanation rather than the user's actual note.
  if (/^(?:assistant|system|user)\s*:\s*(?:cannot|could not|did not|wants to|no (?:fact|detail))/i.test(t)) return false
  return true
}
