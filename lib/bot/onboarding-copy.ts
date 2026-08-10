// AskGogo first-message onboarding copy.
// Source of truth: docs/onboarding/UIUX-03-askgogo-onboarding.md §4.
//
// Formatting rules from the brief §2:
//   - Bold via WhatsApp *asterisks* only. NO italics anywhere.
//   - Short lines, one idea per line, blank line between them.
//   - Name the user where WhatsApp gives a profile name; drop the clause cleanly
//     when it is absent — never render "undefined".
//
// This module holds copy ONLY. No wiring, no state, no side effects beyond
// reading the dashboard URL. The five phrasings in EXAMPLE_PHRASINGS are the
// single source shared with scripts/verify-onboarding-examples.mjs, which proves
// each one routes to its intended handler in the real two-stage pipeline.

const DASHBOARD_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.askgogo.in'

// The five examples sent in message 2b. Kept as plain strings so the verifier
// can import and route them verbatim — EXAMPLES() renders these same strings, so
// copy and test can never drift.
export const EXAMPLE_PHRASINGS: string[] = [
  'remind me to drink water in 2 minutes',
  'remind me to take my meds every day at 9am',
  'add milk to shopping list',
  'show my cards',
  'gold price',
]

// WhatsApp profile name, first word only. Returns null when absent/blank so the
// caller can drop the whole name clause rather than print "undefined".
function firstName(name?: string): string | null {
  const n = (name || '').trim().split(/\s+/)[0]
  return n || null
}

// Message 1 — Welcome. Sent on the first-ever inbound message.
export function WELCOME(name?: string): string {
  const n = firstName(name)
  return [
    n ? `Hi ${n} 👋` : 'Hi 👋',
    "I'm AskGogo. I remember things for you — reminders, lists, expenses, tickets — and I live right here in WhatsApp. No app to install.",
    "Send *start* and I'll show you what I can do.",
    'You can type or send a voice note. Either works.',
  ].join('\n\n')
}

// Message 2a — What I do. Five capabilities, one line each.
export function CAPABILITIES(name?: string): string {
  const n = firstName(name)
  return [
    n ? `Here's what I'm good at, ${n}:` : "Here's what I'm good at:",
    '*Reminders* — one-off, recurring, or nagging until you actually do it.',
    '*Lists* — groceries, packing, anything you keep re-making.',
    "*Expenses* — tell me what you spent, I'll keep the running total.",
    "*Documents & tickets* — forward me a PDF and I'll pull out what matters.",
    '*Your cards* — if you use CreditIQ, I can show your points and cards here.',
  ].join('\n\n')
}

// Message 2b — Try one of these. Five examples + the laptop/dashboard offer.
// The brief copy carries no name token here; the param exists for API symmetry.
export function EXAMPLES(_name?: string): string {
  return [
    'Try one of these right now — copy it, or say it as a voice note:',
    ...EXAMPLE_PHRASINGS.map((p) => `"${p}"`),
    'Pick one and send it. Which shall we do?',
    `Want this on your laptop too? Sign in at ${DASHBOARD_URL} — takes ten seconds.`,
  ].join('\n\n')
}

// Message 3 — First action done. Warm, named, exactly two next steps.
export function FIRST_ACTION(name?: string): string {
  const n = firstName(name)
  return [
    n ? `Nice — that's your first one, ${n}.` : "Nice — that's your first one.",
    'Two more worth knowing:',
    '"remind me to renew my card tomorrow at 6pm"',
    "Or forward me a flight ticket PDF and I'll set your check-in reminders automatically.",
  ].join('\n\n')
}
