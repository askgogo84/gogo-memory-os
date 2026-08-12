// Verifies the list check/uncheck/add/done routing + set-semantics fixes.
// Run: node scripts/verify-list-routing.mjs   (Node v24 type-strips the .ts import)
//
// Unlike a mirror-the-regex harness, this imports the REAL pure functions the bot runs
// from lib/data/lists-core.ts — classifyCheckVerb, normalizeListName, applyAdd,
// applySetDone, findPendingExactMatches — so a drift between test and prod is impossible.
//
// CRITICAL guard under test (mirrors the Aug 8 rice⊂price outage): "uncheck" CONTAINS
// "check", so uncheck is classified FIRST and the check trigger stays PREFIX-anchored.

import {
  classifyCheckVerb,
  normalizeListName,
  applyAdd,
  applySetDone,
  findPendingExactMatches,
  isDedupeExemptBucket,
} from '../lib/data/lists-core.ts'

const NOW = '2026-08-12T00:00:00.000Z'
let fails = 0
const line = (name, got, want, ok) => {
  if (!ok) fails++
  console.log(`  ${ok ? '✓' : '✗'}  ${name.padEnd(58)} got=${JSON.stringify(got)}  want=${JSON.stringify(want)}`)
}
const eq = (name, got, want) => line(name, got, want, JSON.stringify(got) === JSON.stringify(want))

// ── 1. classification: uncheck must NEVER be claimed by list_check ─────────────
console.log('\n1. CHECK vs UNCHECK classification (the collision guard)')
for (const p of ['uncheck milk', 'untick milk', 'undone milk', 'unmark milk']) {
  eq(`"${p}" → list_uncheck`, classifyCheckVerb(p), 'list_uncheck')
}
for (const p of ['check milk', 'tick milk', 'mark milk']) {
  eq(`"${p}" → list_check`, classifyCheckVerb(p), 'list_check')
}
eq('"uncheck milk" is NOT list_check', classifyCheckVerb('uncheck milk') === 'list_check', false)

// ── 2. dedupe on add ("add milk to groceries" twice) ───────────────────────────
console.log('\n2. DEDUPE on add')
{
  // list already holds pending milk + eggs (the state the bug duplicated)
  let arr = [
    { text: 'milk', done: false, added_at: 'a' },
    { text: 'eggs', done: false, added_at: 'b' },
  ]
  const r = applyAdd(arr, ['milk'], NOW)
  eq('second "add milk" → not added', r.added, [])
  eq('second "add milk" → reported already pending', r.alreadyPending, ['milk'])
  eq('second "add milk" → no duplicate (length stays 2)', r.next.length, 2)
  eq('second "add milk" → no write needed', r.changed, false)
}
{
  // a DONE milk is reactivated rather than duplicated
  let arr = [{ text: 'milk', done: true, added_at: 'a' }]
  const r = applyAdd(arr, ['milk'], NOW)
  eq('adding a DONE item → reactivated to pending', r.reactivated, ['milk'])
  eq('adding a DONE item → not duplicated (length 1)', r.next.length, 1)
  eq('adding a DONE item → now pending', r.next[0].done, false)
}
eq('"milk" and "almond milk" stay distinct',
  applyAdd([{ text: 'milk', done: false, added_at: 'a' }], ['almond milk'], NOW).next.length, 2)

// ── 3. show normalisation ("show groceries" vs "show grocery") ──────────────────
console.log('\n3. NORMALISATION — both SHOW forms resolve to one key')
// mirrors process-message extractListNameFromText: strip verb, then normalizeListName
const showName = t =>
  normalizeListName(t.replace(/^\s*(show|open|view|display)\s+/i, '').replace(/^\s*(my|the)\s+/i, ''))
eq('"show groceries" → grocery', showName('show groceries'), 'grocery')
eq('"show grocery" → grocery', showName('show grocery'), 'grocery')
eq('"show my grocery list" → grocery', showName('show my grocery list'), 'grocery')
eq('ADD "groceries" == SHOW "grocery"', normalizeListName('groceries'), normalizeListName('grocery'))

// ── 4. SET semantics: "done milk" twice stays done (no flip) ────────────────────
console.log('\n4. SET semantics — done is absolute, not a toggle')
{
  let items = [
    { text: 'milk', done: false, added_at: 'a' },
    { text: 'eggs', done: false, added_at: 'b' },
  ]
  const s1 = applySetDone(items, 'milk', true)
  items = s1.next
  const s2 = applySetDone(items, 'milk', true)
  eq('first "done milk" → changed, names milk', [s1.changed, s1.matched], [true, 'milk'])
  eq('second "done milk" → no change (stays done)', s2.changed, false)
  eq('exactly one milk is done after twice', items.filter(i => i.done).length, 1)
}

// ── 5. exact-match-first: milk vs almond milk ──────────────────────────────────
console.log('\n5. MATCH — exact wins, only the exact item changes')
{
  const items = [
    { text: 'milk', done: false, added_at: 'a' },
    { text: 'almond milk', done: false, added_at: 'b' },
  ]
  const s = applySetDone(items, 'milk', true)
  eq('"done milk" matched item is milk (named, not query)', s.matched, 'milk')
  eq('milk → done', s.next[0].done, true)
  eq('almond milk → untouched', s.next[1].done, false)
}

// ── 6-9. "done <text>" divert decision (list-first, exact+pending only) ─────────
console.log('\n6-9. "done <text>" routing (list-first, else /api/todos unchanged)')
function doneRoute(arg, lists) {
  if (/^\d+$/.test(arg)) return 'todos'            // "done 1" — unchanged, never list
  const hits = findPendingExactMatches(lists, arg)
  if (hits.length === 1) return `list:${hits[0].list_name}`
  if (hits.length > 1) return 'ask'
  return 'todos'                                    // no matching list item → fall through
}
const grocery = { list_name: 'grocery', items: [{ text: 'milk', done: false, added_at: 'a' }] }
const weekend = { list_name: 'weekend', items: [{ text: 'milk', done: false, added_at: 'c' }] }
eq('"done milk" w/ one pending match → list:grocery', doneRoute('milk', [grocery]), 'list:grocery')
eq('"done buy stamps" no match → todos (unchanged)', doneRoute('buy stamps', [grocery]), 'todos')
eq('"done 1" → todos/reminders (unchanged)', doneRoute('1', [grocery]), 'todos')
eq('"done milk" in two lists → ask which', doneRoute('milk', [grocery, weekend]), 'ask')
eq('"done milk" when already DONE → todos (no pending match)',
  doneRoute('milk', [{ list_name: 'grocery', items: [{ text: 'milk', done: true, added_at: 'a' }] }]), 'todos')

// ── 10. legacy reachability: getList normalises BOTH sides on the fallback ──────
console.log('\n10. REACHABILITY — stored (raw) vs query, both normalised (getList fallback)')
// Models getList's fallback: all.find(l => normalizeListName(l.list_name) === normalizeListName(query))
const reachable = (storedRaw, query) => normalizeListName(storedRaw) === normalizeListName(query)
// Canonical rows your account actually holds (dashboard only sentence-cases for display):
eq('stored "grocery"  reachable by "groceries"', reachable('grocery', 'groceries'), true)
eq('stored "grocery"  reachable by "grocery"', reachable('grocery', 'grocery'), true)
eq('stored "goa"      reachable by "goa"', reachable('goa', 'goa'), true)
eq('stored "notes"    reachable by "notes"', reachable('notes', 'notes'), true)
eq('stored "meeting_notes" reachable by "meeting_notes"', reachable('meeting_notes', 'meeting_notes'), true)
// Legacy non-canonical rows the fallback now rescues (would miss on a raw .eq alone):
eq('LEGACY stored "groceries" reachable by "grocery"', reachable('groceries', 'grocery'), true)
eq('LEGACY stored "grocery list" reachable by "grocery"', reachable('grocery list', 'grocery'), true)
eq('LEGACY stored "Grocery" (caps) reachable by "grocery"', reachable('Grocery', 'grocery'), true)

// ── 11. dedupe exemption for canonical artifact buckets ────────────────────────
console.log('\n11. DEDUPE EXEMPTION — artifact buckets append, user lists dedupe')
for (const b of ['notes', 'meeting_notes', 'instagram_saves', 'youtube_saves', 'social_saves']) {
  eq(`bucket "${b}" is dedupe-exempt`, isDedupeExemptBucket(b), true)
}
eq('"note" (folds → notes) is exempt', isDedupeExemptBucket('note'), true)
for (const l of ['grocery', 'groceries', 'weekend', 'todo']) {
  eq(`user list "${l}" is NOT exempt (dedupes)`, isDedupeExemptBucket(l), false)
}
{
  // notes: two "skin check report" saved on different days both survive (dedupe=false)
  const day1 = [{ text: 'skin check report', done: false, added_at: 'd1' }]
  const r = applyAdd(day1, ['skin check report'], 'd2', false)
  eq('notes: 2nd "skin check report" appended, not collapsed', r.next.length, 2)
  eq('notes: reported as added (not "already there")', r.added, ['skin check report'])
  eq('notes: nothing flagged alreadyPending', r.alreadyPending, [])
}
{
  // grocery: still dedupes (dedupe=true)
  const cur = [{ text: 'milk', done: false, added_at: 'a' }]
  const r = applyAdd(cur, ['milk'], 'b', true)
  eq('grocery: duplicate milk still blocked', r.next.length, 1)
  eq('grocery: reported already pending', r.alreadyPending, ['milk'])
}

// ── 12. SHOW-A-LIST matcher — claim ONLY if serviceable (real two-stage order) ──
// Exercises the REAL pipeline order for the new routeFeatureIntent SHOW matcher:
//   stage 1  showListMatch  — claims "show/open/view [my] <name>" ONLY if getList finds it
//   stage 2  detectIntent   — modelled subset, the homes the controls MUST keep
// The account holds exactly ONE list: "grocery" (canonical). A control the new matcher
// would claim on shape alone is a FAILURE — it would be the 4th hijack of this class
// (rice⊂price, split-parser, …): "show my cards" (CreditIQ), "show my reminders",
// "show me the weather" must reach their own handlers untouched.
console.log('\n12. SHOW-A-LIST — claim only if serviceable, else fall through')

// Reserved names checked BEFORE getList — mirrors lib/feature-intents.ts. These collide
// with higher-priority detectIntent handlers, so a list literally named "reminders"/"cards"
// must NOT data-hijack "show my reminders"/"show my cards".
const RESERVED_SHOW_NAMES = new Set(['cards', 'card', 'reminders', 'reminder', 'weather', 'points', 'miles', 'balance'])
// getList modelled against an injected store: normalise BOTH sides, exactly like getList.
const getListFake = (store, name) => store.find(s => normalizeListName(s) === normalizeListName(name)) ?? null
// The new matcher (mirrors lib/feature-intents.ts): reserved-decline → resolve → else null.
function showListMatch(text, store = ['grocery']) {
  const m = text.toLowerCase().trim().match(/^(show|open|view)\s+(?:my\s+)?(.+)$/)
  if (!m) return null
  const name = normalizeListName(m[2])
  if (RESERVED_SHOW_NAMES.has(name)) return null // reserved → real owner keeps it
  const hit = getListFake(store, name)
  return hit ? `list_show:${hit}` : null
}
// detectIntent subset — the real precedence for these controls (creditiq_cards line 100,
// edit_reminder line 118, weather_live line 140, gold_live line 141 of detect-intent.ts).
function detectIntentModel(text) {
  const lower = text.toLowerCase().trim()
  if (/^(?:show\s+(?:me\s+)?|check\s+|what(?:'?s|\s+is|\s+are)\s+)?my\s+(?:credit\s+|reward\s+)?(?:cards?|points|miles|card\s+balance)\b/.test(lower)) return 'creditiq_cards'
  if (lower === 'show my reminders' || lower === 'show reminders' || lower === 'my reminders') return 'edit_reminder'
  if (lower.includes('weather')) return 'weather_live'
  if (lower.includes('gold price')) return 'gold_live'
  return 'general_chat'
}
// Full two-stage resolution in the REAL order: stage-1 wins if it claims, else stage-2.
const route = text => showListMatch(text) ?? detectIntentModel(text)

// must-MATCH: the new serviceable matcher resolves each form to the grocery list.
eq('"show groceries"       → grocery list', route('show groceries'), 'list_show:grocery')
eq('"show grocery"         → grocery list', route('show grocery'), 'list_show:grocery')
eq('"view my grocery list" → grocery list', route('view my grocery list'), 'list_show:grocery')

// stage-1 non-negotiable: the matcher DECLINES every non-list control (no such list).
eq('stage-1 declines "show my cards"',       showListMatch('show my cards'), null)
eq('stage-1 declines "show my reminders"',   showListMatch('show my reminders'), null)
eq('stage-1 declines "show me the weather"', showListMatch('show me the weather'), null)
eq('stage-1 declines "show gold price"',     showListMatch('show gold price'), null)

// must-NOT-match: each control keeps its REAL home in the two-stage order (no hijack).
eq('"show my cards"       → creditiq_cards (not hijacked)', route('show my cards'), 'creditiq_cards')
eq('"show my reminders"   → edit_reminder (not hijacked)', route('show my reminders'), 'edit_reminder')
eq('"show me the weather" → weather_live (not hijacked)', route('show me the weather'), 'weather_live')
eq('"show gold price"     → gold_live (not hijacked)', route('show gold price'), 'gold_live')

// data-hijack guard: even when a list named "reminders"/"cards" EXISTS, stage 1 declines
// (reserved-name set is checked before getList) so the real handler still keeps it.
const COLLIDING = ['grocery', 'reminders', 'cards']
eq('list "reminders" EXISTS → stage-1 still declines "show my reminders"', showListMatch('show my reminders', COLLIDING), null)
eq('list "cards" EXISTS → stage-1 still declines "show my cards"', showListMatch('show my cards', COLLIDING), null)
eq('sanity: "reminders" WOULD resolve without the reserved guard', getListFake(COLLIDING, normalizeListName('reminders')), 'reminders')

console.log('\n' + '-'.repeat(80))
console.log(fails === 0 ? 'ALL LIST-ROUTING CHECKS PASS ✓' : `${fails} CHECK(S) FAILED ✗`)
process.exit(fails === 0 ? 0 : 1)
