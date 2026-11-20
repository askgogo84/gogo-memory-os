// 19 Nov live: "Stop this reminder" was read as chat. One reminder, said with "stop": "stop reminder", "stop this
// reminder", "stop the water reminder". Never the plural or "all" (that is the opt-out's), never "stop reminding me".
// One definition for the brain bypass, the intent rule and the handler. Pure.
const STOP_ONE_REMINDER = /^(?:please\s+|pls\s+)?stop\s+(?:(?:this|that|the|my)\s+)?(?:[a-z0-9'’-]+\s+){0,3}?reminder\b(?!s)(?:\s+(?:please|pls|now))*\s*[.!]*$/i
export function isStopOneReminder(input: unknown): boolean {
  const t = String(input || '').trim()
  return t.length <= 80 && STOP_ONE_REMINDER.test(t) && !/\b(?:all|every|any|sending|getting|these|those)\b/i.test(t)
}
/** The command without politeness or closing punctuation, so "please stop this reminder now." names nothing by accident. */
export function stopReminderCore(input: unknown): string {
  return String(input || '').trim().replace(/^(?:please|pls)\s+/i, '').replace(/(?:\s+(?:please|pls|now))+\s*[.!]*$/i, '').replace(/[.!\s]+$/, '')
}
