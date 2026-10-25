// R08 (22 Oct live): "Check my relevant calendar and travel context" planned no calendar step and the report said
// "No access to your personal calendar". Run: npx tsx scripts/verify-r08-planner-context.mts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-key'
process.env.OPENAI_API_KEY ||= 'test-key'
process.env.ANTHROPIC_API_KEY ||= 'test-key'
const { requestedContextReads, ownerContextForReport } = await import('../lib/agent/general-planner')

const r08 = 'Research Naru Noodle Bar for two people on 2026-10-25 between 7 pm and 9 pm. Check my relevant calendar and travel context. Do not reserve, submit, pay or create monitoring.'
const reads = requestedContextReads(r08)
assert.deepEqual(reads.map(r => r.tool), ['calendar', 'travel'])
assert.equal(reads[0].instruction, 'Show my calendar from 2026-10-24 to 2026-10-26', 'the exact day, one day either side')
assert.doesNotMatch(reads[0].instruction, /\b(add|create|change|move|schedule|write|modify|prepare)\b/i, 'a read, never a write')

const noDate = requestedContextReads('Plan dinner with Divya this weekend and check my calendar', new Date('2026-10-23T00:00:00Z'))
assert.deepEqual(noDate.map(r => r.instruction), ['Show my calendar from 2026-10-23 to 2026-11-06'])
assert.deepEqual(requestedContextReads('Research Naru Noodle Bar for two. Do not check my calendar.'), [], 'a negated ask adds nothing')
assert.deepEqual(requestedContextReads('Compare iPhone 16 prices'), [])

const ctx = ownerContextForReport([
  { title: 'Check your calendar', tool: 'calendar', result: { reply: 'Sat 25 Oct: Move day 9 am–6 pm' } },
  { title: 'Search', tool: 'web_search', result: { results: [] } },
])
assert.deepEqual(ctx.map(c => c.source), ['calendar'])
assert.match(ctx[0].result, /Move day/)

const src = readFileSync('lib/agent/general-planner.ts', 'utf8')
assert.match(src, /ensureRequestedContextReads\(preparedSteps, missionText\)/)
assert.match(src, /Never say you have no access to their calendar or travel context/)
assert.ok(readFileSync('lib/agent/context-brain.ts', 'utf8').includes('never say "nothing blocks" or "you are free" while it stands'), 'R09: a saved move day is a constraint')
console.log('R08/R09: requested calendar/travel context is always read and reaches the report')

// Empty/failed searches never ask "is it done?" (22 Oct SIN→BLR).
const oc = await import('../lib/agent/owner-confirmation')
const base = { status: 'completed', type: [...oc.CONFIRMABLE_RUN_TYPES][0], updated_at: new Date().toISOString() }
assert.equal(oc.needsOwnerConfirmation({ ...base, summary: 'I could not obtain verified live rows for SIN → BLR.' }), false)
assert.equal(oc.needsOwnerConfirmation({ ...base, summary: 'No flights found for that date.' }), false)
assert.equal(oc.needsOwnerConfirmation({ ...base, summary: 'Found 3 fares from ₹8,400. Cheapest IndiGo 6E 1004.' }), true)
console.log('Empty searches: no confirm card')
