// A time-first reminder directive, observed in WhatsApp on 1 Oct 2026.
// Require both a leading explicit clock and the trailing command word; merely
// mentioning an appointment or a reminder is not a scheduling instruction.
export function isTimeFirstReminder(text: string): boolean {
  return /^\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)\b.+\breminder[.!]*\s*$/i.test(text.trim())
}
