// Single source of truth for the "show my <x>" reserved words.
//
// These names collide with higher-priority detectIntent handlers (creditiq_cards,
// edit_reminder, weather_live, gold_live) or with the calendar view. A user list literally
// named "reminders"/"cards"/"calendar" must NOT data-hijack "show my reminders"/"show my
// cards"/"show my calendar" — so the SHOW matcher declines these outright, before getList,
// letting the word reach its real owner downstream ("show my calendar" → calendar view).
// Imported by both the router (lib/feature-intents.ts) and the routing harness
// (scripts/verify-list-routing.mjs) so the two can never drift.
export const RESERVED_SHOW_NAMES = new Set(['cards', 'card', 'reminders', 'reminder', 'weather', 'points', 'miles', 'balance', 'calendar'])
