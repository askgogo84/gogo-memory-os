// Verifies detectIntent's CreditIQ-portfolio gate for the "how many points do I
// have" bug: an already-linked user asking for points/miles/card balance in
// natural language fell through to the general LLM (which wrongly told them to
// go link their cards). Models the OLD (anchored-only) vs NEW (anchored + shape
// patterns) matcher, copied verbatim from lib/bot/detect-intent.ts.
//
// CRITICAL guard (mirrors the Aug 8 rice⊂price outage): \b word boundaries only,
// never substring matching. "balance" must never fire on bank/work-life balance,
// and a bare "points" ("what's the point") must never route. Every NEW pattern
// is anchored to a query/possessive SHAPE so a mid-sentence "my card" in a
// reminder ("pay my credit card bill") can't steal the intent.

// ── OLD logic (pre-fix, verbatim) — fully anchored commands only ─────────────
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

// ── NEW logic (post-fix, verbatim from lib/bot/detect-intent.ts) ─────────────
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

function route(text, mode) {
  const lower = (text || '').trim().toLowerCase()
  const hit = mode === 'old' ? old_isCreditIq(lower) : new_isCreditIq(lower)
  return hit ? 'creditiq_cards' : 'fallthrough'
}

// [phrase, expected-new-route, note]
const cases = [
  // ── MUST route to the portfolio ──────────────────────────────────────────
  ['show my cards',                  'creditiq_cards', 'existing anchored'],
  ['my points',                      'creditiq_cards', 'existing anchored'],
  ['my portfolio',                   'creditiq_cards', 'existing anchored'],
  ['creditiq points',                'creditiq_cards', 'existing anchored'],
  ['how many points do I have',      'creditiq_cards', 'THE BUG — count question'],
  ['how many miles do I have',       'creditiq_cards', 'miles count question'],
  ['what cards do I have',           'creditiq_cards', 'which-do-I-have question'],
  ['my reward points',               'creditiq_cards', 'reward points possessive'],
  ['my miles',                       'creditiq_cards', 'miles possessive'],
  ['my card balance',                'creditiq_cards', 'card balance possessive'],
  ["what's my card balance",         'creditiq_cards', 'card balance question'],
  ['check my miles',                 'creditiq_cards', 'check lead-in'],
  ['show me my points',              'creditiq_cards', 'show me lead-in'],
  // ── MUST NOT route (near-misses) ─────────────────────────────────────────
  ["what's the point",               'fallthrough',    'singular point, no \\b points'],
  ['bank balance',                   'fallthrough',    'balance w/o card/points noun'],
  ['work-life balance',              'fallthrough',    'balance w/o card/points noun'],
  ['current gold price in India today','fallthrough',  '→ gold_live, no reward noun'],
  ['pay my credit card bill',        'fallthrough',    'mid-sentence my card = reminder'],
  ['remind me to renew my card',     'fallthrough',    '→ set_reminder, not portfolio'],
  ['how many points to redeem a flight','fallthrough', 'no first-person marker'],
  ['save this card',                 'fallthrough',    'no first-person marker'],
  ['my nutrition',                   'fallthrough',    'no reward noun'],
]

const pad = (s, n) => (s + ' '.repeat(n)).slice(0, n)
console.log(pad('PHRASE', 40), pad('OLD', 16), pad('NEW', 18), 'EXPECTED / note')
console.log('-'.repeat(120))
let fails = 0
for (const [phrase, want, note] of cases) {
  const oldR = route(phrase, 'old')
  const newR = route(phrase, 'new')
  const ok = newR === want
  if (!ok) fails++
  console.log(pad(phrase, 40), pad(oldR, 16), pad(newR + (ok ? ' ✓' : ' ✗'), 18), `${want}  (${note})`)
}
console.log('-'.repeat(120))
console.log(fails === 0 ? 'ALL NEW ROUTES MATCH EXPECTED ✓' : `${fails} MISMATCH(ES) ✗`)
process.exit(fails === 0 ? 0 : 1)
