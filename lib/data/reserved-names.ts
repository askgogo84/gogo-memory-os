// Single source of truth for the "show my <x>" reserved words.
//
// These names collide with higher-priority detectIntent handlers (creditiq_cards,
// edit_reminder, weather_live, gold_live). A user list literally named "reminders"
// or "cards" must NOT data-hijack "show my reminders"/"show my cards" — so the SHOW
// matcher declines these outright, before getList, letting the word reach its real
// owner downstream. Imported by both the router (lib/feature-intents.ts) and the
// routing harness (scripts/verify-list-routing.mjs) so the two can never drift.
export const RESERVED_SHOW_NAMES = new Set(['cards', 'card', 'reminders', 'reminder', 'weather', 'points', 'miles', 'balance'])
