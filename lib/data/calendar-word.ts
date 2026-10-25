// Single, zero-import source of truth for the tolerant "calendar" spelling set.
//
// Users routinely misspell "calendar" and the mistakes used to fall through to the
// freeform LLM (or get filed into a LIST literally named "calender"). This module owns
// the canonical pattern so it can never be duplicated a fifth time. It is DELIBERATELY
// zero-import — exactly like reserved-names.ts / lists-core.ts — so Node's native
// TypeScript type-stripping can load it directly under the routing harnesses.
//
// Consumers:
//   - calendar-actions.ts   (isCalendarAction, the calendar-create signal test; re-exports)
//   - detect-intent.ts       (connect_calendar intent matcher)
//   - feature-intents.ts     (WhatsApp pre-router ADD-TO-LIST guard, via isCalendarListName)
//
// Spelling set: calendar | calendars | calender | calenders | calandar | calandars |
//   calander | calanders  — i.e. e/a swaps in either vowel slot, optional plural.
export const CALENDAR_WORD_RE = /\bcal[ae]nd[ae]rs?\b/

// "add X to (my/the/your) calendar" must reach the calendar-create handler, never create a
// list literally named "calendar" (or "calender"). Tests the RAW captured target (not
// normalizeListName, which only strips a trailing " list", not a leading the/your) and
// mirrors parseCalendarCreate's possessive calendar phrase. Used by the router's
// ADD-TO-LIST guard. Built from CALENDAR_WORD_RE so misspellings are covered too — this
// is the fourth location and duplicating the spelling literal is how "calender" leaked in.
const CALENDAR_LIST_NAME_RE = new RegExp(
  `^(?:my\\s+|the\\s+|your\\s+)?${CALENDAR_WORD_RE.source}(?:\\s+list)?$`,
  'i',
)
export function isCalendarListName(raw: string): boolean {
  return CALENDAR_LIST_NAME_RE.test((raw || '').trim())
}
