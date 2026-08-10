// Verifies the REAL two-stage routing order for CreditIQ-portfolio vs bill-split.
//
// Production order (lib/feature-intents.ts:138 → lib/bot/detect-intent.ts):
//   STAGE 1  parseSplitIntent(text)  — if it returns an intent, the message is
//            handed to /api/splitbill and NEVER reaches detectIntent.
//   STAGE 2  detectIntent(text)      — only runs on phrases STAGE 1 declined.
//
// The confirmed bug: split-parser's reverse-balance branch (/^(.+?)\s+balance$/)
// had a lazy prefix, so "my card balance" was CLAIMED by STAGE 1 as a group named
// "my card". /api/splitbill found no such group and dead-ended with "No split
// group found yet" — the creditiq_cards handler in STAGE 2 never got a look.
//
// This harness models both stages so an upstream claim registers as the FAILURE it
// really is. STAGE 2's detectIntent regexes are copied verbatim from
// lib/bot/detect-intent.ts; STAGE 1's balance branches mirror lib/splitwise/
// split-parser.ts (OLD = pre-fix, NEW = Fixes A+B).
//
// CRITICAL guard (mirrors the Aug 8 rice⊂price outage): \b word boundaries only,
// never substring matching.

// ── STAGE 2: detectIntent — OLD (pre-fix, verbatim) ──────────────────────────
function old_isCreditIq(lower) {
  return (
    /^(show\s+)?my\s+(credit\s+)?cards$/.test(lower) ||
    /^show\s+cards$/.test(lower) ||
    /^(show\s+)?my\s+portfolio$/.test(lower) ||
    /^(show\s+)?my\s+(reward\s+)?points$/.test(lower) ||
    /^(show\s+)?my\s+creditiq$/.test(lower) ||
    /^creditiq\s+(cards|portfolio|points)$/.test(lower)
  )
}

// ── STAGE 2: detectIntent — NEW (post-fix, verbatim from detect-intent.ts) ────
function new_isCreditIq(lower) {
  return (
    /^(show\s+)?my\s+(credit\s+)?cards$/.test(lower) ||
    /^show\s+cards$/.test(lower) ||
    /^(show\s+)?my\s+portfolio$/.test(lower) ||
    /^(show\s+)?my\s+(reward\s+)?points$/.test(lower) ||
    /^(show\s+)?my\s+creditiq$/.test(lower) ||
    /^creditiq\s+(cards|portfolio|points)$/.test(lower) ||
    /^(?:show\s+(?:me\s+)?|check\s+|what(?:'?s|\s+is|\s+are)\s+)?my\s+(?:credit\s+|reward\s+)?(?:cards?|points|miles|card\s+balance)\b/.test(lower) ||
    /^how\s+many\s+(?:credit\s+|reward\s+)?(?:cards?|points|miles)\b.*\b(?:do\s+i|i\s+have|have\s+i|i've)\b/.test(lower) ||
    /^what\s+(?:credit\s+|reward\s+)?(?:cards?|points|miles)\s+(?:do\s+i\s+have|have\s+i)\b/.test(lower)
  )
}

// ── STAGE 1: parseSplitIntent balance branches (does the split parser claim it?) ─
// Returns true when split-parser would return an intent for these balance-shaped
// phrases (or an explicit split directive). Only the branches relevant to the bug
// are modelled; the explicit-directive check stands in for parseSplitIntent's
// wider create/expense/command surface (so a genuine "split …" phrase is owned by
// STAGE 1, as it is in production).
function explicitSplitDirective(t) {
  return /^split\b/i.test(t) && /\b(bill|with|between|among|equally)\b/i.test(t)
}

// OLD split parser (pre-fix): lazy reverse prefix claims ANYTHING ending in
// "balance"; forward group lead-in (for/in/of) was OPTIONAL, so "balance due" was
// also claimed (group "due").
function old_splitClaims(text) {
  const t = (text || '').trim()
  if (/^(?:show\s+)?(?:balance|balances|who owes who|who owes whom)(?:\s+(?:(?:for|in|of)\s+)?(.+))?$/i.test(t)) return true
  if (/^(.+?)\s+(?:balance|balances)$/i.test(t)) return true
  return explicitSplitDirective(t)
}

// NEW split parser (Fixes A+B), mirroring lib/splitwise/split-parser.ts:169-190.
function new_splitClaims(text) {
  const t = (text || '').trim()
  // FIX B: trailing group REQUIRES a for/in/of lead-in (kills "balance due",
  // keeps bare "balance" and "balance for Goa").
  if (/^(?:show\s+)?(?:balance|balances|who owes who|who owes whom)(?:\s+(?:for|in|of)\s+(.+))?$/i.test(t)) return true
  // FIX A: reverse "<name> balance" — reject a possessive lead or reserved
  // non-group noun found ANYWHERE in the prefix. Plausible/typo'd names still pass.
  const rev = t.match(/^(.+?)\s+(?:balance|balances)$/i)
  if (rev) {
    const prefix = rev[1]
    const possessiveLead = /\b(my|our|your|his|her|their)\b/i
    const reservedNoun = /\b(card|credit|bank|account|points|miles|loan|wallet)\b/i
    if (!possessiveLead.test(prefix) && !reservedNoun.test(prefix)) return true
  }
  return explicitSplitDirective(t)
}

// ── Two-stage pipeline: STAGE 1 (split) wins; else STAGE 2 (detectIntent) ─────
function route(text, mode) {
  const lower = (text || '').trim().toLowerCase()
  const splitClaims = mode === 'old' ? old_splitClaims : new_splitClaims
  if (splitClaims(text)) return 'bill_split'
  const isCreditIq = mode === 'old' ? old_isCreditIq : new_isCreditIq
  return isCreditIq(lower) ? 'creditiq_cards' : 'fallthrough'
}

// [phrase, expected-NEW-final-route, note]
const cases = [
  // ── Required Fix A/B cases ────────────────────────────────────────────────
  ['my card balance',                'creditiq_cards', 'THE BUG: STAGE 1 no longer steals it'],
  ['balance due',                    'fallthrough',    'FIX B: no for/in/of lead-in → unclaimed'],
  ['bank balance',                   'fallthrough',    'FIX A: reserved noun "bank" → unclaimed'],
  ["what's my balance",              'fallthrough',    'FIX A: possessive "my" → unclaimed'],
  ['Goa balance',                    'bill_split',     'plausible group name → STAGE 1 claims'],
  ['split the bill with Rahul',      'bill_split',     'explicit split directive → STAGE 1 owns it'],
  // ── Documented accepted limitation ────────────────────────────────────────
  ['Credit Union Trip balance',      'fallthrough',    'ACCEPTED: real group w/ reserved noun "credit" falsely rejected — graceful, "show balance for <group>" still works'],
  // ── Portfolio phrases that must survive STAGE 1 and reach STAGE 2 ──────────
  ['show my cards',                  'creditiq_cards', 'existing anchored'],
  ['my points',                      'creditiq_cards', 'existing anchored'],
  ['creditiq points',                'creditiq_cards', 'existing anchored'],
  ['how many points do I have',      'creditiq_cards', 'count question'],
  ['how many miles do I have',       'creditiq_cards', 'miles count question'],
  ['what cards do I have',           'creditiq_cards', 'which-do-I-have question'],
  ['my reward points',               'creditiq_cards', 'reward points possessive'],
  ['my miles',                       'creditiq_cards', 'miles possessive'],
  ["what's my card balance",         'creditiq_cards', 'card balance question (STAGE 1 rejects on my/card)'],
  ['check my miles',                 'creditiq_cards', 'check lead-in'],
  ['show me my points',              'creditiq_cards', 'show me lead-in'],
  // ── Split-owned balance phrases (STAGE 1 correctly claims) ────────────────
  ['balance for Goa',                'bill_split',     'forward with for-lead-in → group Goa'],
  ['balance',                        'bill_split',     'bare balance → show_balance, no group'],
  ['work-life balance',              'bill_split',     'plausible name passes guard → STAGE 1 claims (dead-ends in splitbill, harmless — never a portfolio phrase)'],
  // ── Must fall through both stages ─────────────────────────────────────────
  ["what's the point",               'fallthrough',    'singular point, no \\b points'],
  ['current gold price in India today','fallthrough',  '→ gold_live, no reward noun'],
  ['pay my credit card bill',        'fallthrough',    'mid-sentence my card = reminder'],
  ['remind me to renew my card',     'fallthrough',    '→ set_reminder, not portfolio'],
  ['how many points to redeem a flight','fallthrough', 'no first-person marker'],
  ['save this card',                 'fallthrough',    'no first-person marker'],
  ['my nutrition',                   'fallthrough',    'no reward noun'],
]

const pad = (s, n) => (s + ' '.repeat(n)).slice(0, n)
console.log(pad('PHRASE', 34), pad('OLD final', 16), pad('NEW final', 18), 'EXPECTED / note')
console.log('-'.repeat(140))
let fails = 0
for (const [phrase, want, note] of cases) {
  const oldR = route(phrase, 'old')
  const newR = route(phrase, 'new')
  const ok = newR === want
  if (!ok) fails++
  console.log(pad(phrase, 34), pad(oldR, 16), pad(newR + (ok ? ' ✓' : ' ✗'), 18), `${want}  (${note})`)
}
console.log('-'.repeat(140))
console.log(fails === 0 ? 'ALL NEW ROUTES MATCH EXPECTED ✓' : `${fails} MISMATCH(ES) ✗`)
process.exit(fails === 0 ? 0 : 1)
