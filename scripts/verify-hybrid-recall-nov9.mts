// Same Brain 3.0 hybrid recall (Memorilla-inspired). Pins the trust guarantees, the fixed budget, the pack wiring and
// the fixture evaluation (hybrid passes every synthetic case with zero leaks; the current path leaks).
import assert from 'node:assert/strict'
import { hybridRecall, recallProbes, renderRecall, sensitiveCategory, questionAllows, type RecallIndex } from '../lib/agent/context-graph/recall'
import { assembleDecisionContext, hybridRecallMode, renderDecisionContext } from '../lib/agent/context-graph/build'
import { emptyUnderstandingContext } from '../lib/agent/understanding'
import { evaluate, loadFixture, memoryIndex } from './lib/hybrid-recall-eval.mts'
let n = 0; const ok = (s: string) => { n++; console.log('PASS', s) }

{ // sensitive guard: never into an unrelated question; the owner's own words only when they ask about it
  assert.equal(sensitiveCategory("Asked whether diabetes on my mother's side changes what I should eat"), 'health')
  assert.equal(sensitiveCategory('My salary hike this year was smaller than I hoped'), 'finance')
  assert.equal(sensitiveCategory('Nithin said his old headphones finally broke on his last run'), null, 'ordinary "broke" is not finance')
  assert.equal(sensitiveCategory("I'm broke until payday"), 'finance')
  assert.equal(questionAllows('Suggest breakfast ideas', 'health'), false); assert.equal(questionAllows('When do I take my thyroid medication?', 'health'), true)
  assert.deepEqual(recallProbes('Find a dinner place for Friday'), ['Find a dinner place for Friday', 'food preferences dislikes diet favourite places'])
  ok('sensitive categories detected without the "broke" false positive; allowed only when the question is about that category; facet probes deterministic')
}

{ // tenant isolation: a leaky index (scope bug upstream) is contained by the second check
  const f = loadFixture()
  const r = await hybridRecall(memoryIndex(f, true), { scopeId: '-100001', question: 'What does Nithin like to eat?', entityLabels: ['Nithin'] })
  assert.ok(r.items.every(i => !i.id.startsWith('n')), 'no other-tenant memory survives'); assert.ok(r.dropped.foreign >= 1)
  const clean = await hybridRecall(memoryIndex(f, false), { scopeId: '-100001', question: 'What does Nithin like to eat?' })
  assert.equal(clean.dropped.foreign, 0)
  ok('foreign-scope rows dropped even when the index leaks them')
}

{ // fixed budget independent of collection size; every item labelled, none can authorize
  const docs = Array.from({ length: 2000 }, (_, i) => ({ id: `m${i}`, text: `Note ${i}: dinner idea number ${i} with spicy food and friends on a Friday`, scopeId: '-1', score: 0.9 - i / 5000, sourceTable: 'memories' }))
  const index: RecallIndex = { async search(_s, probes, k) { return probes.flatMap(p => docs.slice(0, k).map(d => ({ ...d, probe: p }))) } }
  const r = await hybridRecall(index, { scopeId: '-1', question: 'dinner on Friday' })
  assert.ok(r.items.length <= 6); assert.ok(r.items.reduce((s, i) => s + i.text.length, 0) <= 900)
  assert.ok(r.items.every(i => i.evidenceClass === 'reported' && i.relevance === 'inferred' && i.mayAuthorize === false))
  assert.ok(r.hypotheses.every(h => h.evidenceClass === 'inferred' && /not a fact/.test(h.why)))
  assert.ok(renderRecall(r).every(l => /not verified|confirm before relying/.test(l)))
  ok('2,000 matching memories → still ≤ 6 items / 900 chars; all reported-not-verified, mayAuthorize false; hypotheses labelled')
}

{ // stale corrections and exact-wins dedupe
  const f = loadFixture()
  const r = await hybridRecall(memoryIndex(f), { scopeId: '-100001', question: 'Where do I live now?', staleSourceRefs: new Set(['memories:d9']), exactTexts: ['self in_city Indiranagar'], exactSourceRefs: new Set(['memories:d10']) })
  assert.ok(!r.items.some(i => i.id === 'd9'), 'superseded address not recalled'); assert.ok(!r.items.some(i => i.id === 'd10'), 'already in the exact path'); assert.ok(r.dropped.stale >= 1 && r.dropped.duplicate >= 1)
  const resolved = await hybridRecall(memoryIndex(f), { scopeId: '-100001', question: 'Where do I live now?', resolveStale: async refs => new Set(refs.filter(x => x === 'memories:d9')) })
  assert.ok(!resolved.items.some(i => i.id === 'd9'), 'graph lookup after search suppresses the stale memory')
  ok('corrections suppress stale memories (given or resolved from the graph); exact path wins duplicates')
}

{ // pack wiring: off by default; on → items in pack + render warns; consequential stays approval-bound
  const f = loadFixture()
  const recall = await hybridRecall(memoryIndex(f), { scopeId: '-100001', question: 'Order my usual from Swiggy' })
  const base = { actor: { legacyTelegramId: -100001 }, objective: 'Order my usual from Swiggy', understanding: emptyUnderstandingContext(), facts: [], semantic: [], permission: () => 'ask', reads: 1, startedAt: Date.now() }
  const off = assembleDecisionContext({ ...base, recall })
  assert.equal(off.recall.mode, 'off'); assert.equal(off.recall.items.length, 0, 'no recall without the flag')
  const on = assembleDecisionContext({ ...base, recall, recallMode: 'on' })
  assert.ok(on.recall.items.some(i => i.id === 'd17')); assert.equal(on.boundaries.approvalRequired, true, 'ordering is consequential: approval card regardless of recall')
  const lines = renderDecisionContext(on); assert.ok(lines.some(l => /related, not verified\. Do not act on them alone/.test(l))); assert.ok(lines.some(l => /^Recalled \(you said/.test(l)))
  const shadow = assembleDecisionContext({ ...base, recall, recallMode: 'shadow' }); assert.ok(!renderDecisionContext(shadow).some(l => /^Recalled/.test(l)), 'shadow never reaches the prompt')
  assert.equal(hybridRecallMode('-884501501', {}), 'off'); assert.equal(hybridRecallMode('-884501501', { GOGO_HYBRID_RECALL: 'shadow', GOGO_HYBRID_RECALL_OWNERS: '-884501501' }), 'shadow'); assert.equal(hybridRecallMode('5', { GOGO_HYBRID_RECALL: 'on', GOGO_HYBRID_RECALL_OWNERS: '-884501501' }), 'off')
  ok('flag off by default; shadow logs only; on adds labelled lines; consequential asks stay approval-bound')
}

{ // fixture evaluation: hybrid ≥ current and leak-free
  const r = await evaluate()
  assert.equal(r.totals.hybridLeaks, 0, 'hybrid leaks nothing forbidden'); assert.equal(r.totals.hybridPass, r.totals.cases)
  assert.ok(r.totals.currentLeaks > 0, 'the current path does leak on these fixtures (the gap this closes)')
  assert.ok(r.totals.hybridTokens <= r.totals.currentTokens + 10, 'no material token increase')
  ok(`fixtures: hybrid ${r.totals.hybridPass}/${r.totals.cases}, current ${r.totals.currentPass}/${r.totals.cases}; leaks ${r.totals.currentLeaks} → 0`)
}
console.log(`verify-hybrid-recall-nov9: ${n} passed`)
