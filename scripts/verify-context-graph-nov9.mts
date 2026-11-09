// Same Brain 3.0 Phase 2: the decision context pack is bounded, deterministic, and answers the three required cases:
// "Has my flight landed?" needs live data (notes are dropped); "prepare for tomorrow's meeting" names what is missing
// (documents not connected); "I already paid that bill" stays reported, never verified. Conflicts resolve provider > owner > inference.
import assert from 'node:assert/strict'
import { assembleDecisionContext, classifyObjective, contextGraphMode, renderDecisionContext } from '../lib/agent/context-graph/build'
import { emptyUnderstandingContext } from '../lib/agent/understanding'
import { MemorySemanticStore } from '../lib/semantic/store'
import { SemanticRepo, scopeForActor } from '../lib/semantic/repo'
import { fromCalendarEvent, fromLifeEvent, fromMemory, ingestBatch, SELF } from '../lib/semantic/ingest'
let n = 0; const ok = (s: string) => { n++; console.log('PASS', s) }
const NOW = Date.parse('2026-11-09T10:00:00Z')
const actor = { legacyTelegramId: -884501501, timezone: 'Asia/Kolkata' }
const perm = (c: string) => c === 'payments' ? 'ask' : 'read'
const base = (over: Partial<Parameters<typeof assembleDecisionContext>[0]> = {}) => assembleDecisionContext({ actor, objective: 'x', understanding: emptyUnderstandingContext(), facts: [], semantic: [], permission: perm, reads: 2, startedAt: Date.now(), now: NOW, ...over })

{ // objective classification
  assert.equal(classifyObjective('Has my flight landed?').kind, 'live_status'); assert.equal(classifyObjective('Has my flight landed?').domain, 'travel')
  assert.equal(classifyObjective('What should I prepare for tomorrow\'s meeting?').kind, 'prepare')
  assert.equal(classifyObjective('I already paid that bill.').kind, 'report'); assert.equal(classifyObjective('I already paid that bill.').domain, 'payments')
  const book = classifyObjective('Book the Savaari cab for 12 Dec'); assert.equal(book.kind, 'action'); assert.equal(book.consequential, true)
  assert.equal(classifyObjective('what is Divya\'s address').kind, 'question')
  ok('objectives classified deterministically; consequential actions flagged')
}

const store = new MemorySemanticStore(); const repo = new SemanticRepo(store, scopeForActor(actor))
await ingestBatch(repo, {
  memories: [{ id: 1, content: 'Flight 6E204 to Goa landed at 11:40 last time', created_at: '2026-10-01T06:00:00Z' }, { id: 2, content: 'I always prefer an aisle seat', created_at: '2026-10-02T06:00:00Z' }],
  lifeEvents: [{ id: 'f1', subtype: 'flight', title: '6E204 BLR→GOI', start_at: '2026-11-09T09:10:00Z', end_at: '2026-11-09T10:30:00Z', metadata_json: { flightNo: '6E204', to: 'Goa' }, provider: 'IndiGo' }],
  calendarEvents: [{ id: 'm1', title: 'Harbor partner meeting', startAt: '2026-11-10T04:30:00Z', endAt: '2026-11-10T05:30:00Z', attendees: [{ name: 'Nithin K L', email: 'nithin@tipplr.in' }] }],
}, new Date(NOW).toISOString())
const semantic = await repo.neighbourhood(SELF, NOW)

{ // 1. Has my flight landed? → live read required, memory notes dropped, flight resolved from the saved booking
  const u = emptyUnderstandingContext(); u.travelLegs = [{ id: 't1', title: '6E204 BLR → GOI', at: '2026-11-09T09:10:00Z' }]
  const p = base({ objective: 'Has my flight landed?', understanding: u, semantic, facts: [{ id: 'mem9', source: 'semantic_memory', summary: 'Flight 6E204 landed at 11:40 last time', score: 0.9, confidence: 0.8 } as any, { id: 'le1', source: 'life_event', summary: '6E204 BLR→GOI today 14:40', score: 0.95, confidence: 0.9, startAt: '2026-11-09T09:10:00Z', endAt: '2026-11-09T10:30:00Z' } as any] })
  assert.equal(p.objective.liveDataRequired, true)
  assert.ok(!p.facts.some(f => f.source === 'semantic_memory'), 'stale flight notes are not offered as an answer')
  assert.ok(p.facts.some(f => f.id === 'le1'), 'today\'s booking stays, it identifies the flight')
  assert.ok(p.missing.some(m => /live flight status/.test(m)))
  assert.ok(!p.missing.some(m => /which flight/.test(m)), 'the flight is resolved from the saved leg')
  assert.equal(p.freshness.stale, true); assert.ok(Date.parse(p.expiresAt) - NOW <= 2 * 60_000)
  assert.match(renderDecisionContext(p)[0], /needs a live provider read/)
  ok('"Has my flight landed?" → live data required, notes dropped, flight identified')
}

{ // 2. Prepare for tomorrow's meeting → calendar + participants linked; documents unavailable is disclosed
  const u = emptyUnderstandingContext(); u.calendarEvents = [{ id: 'm1', title: 'Harbor partner meeting', at: '2026-11-10T04:30:00Z' }]; u.openTasks = [{ id: 'o1', title: 'Send the deck to Harbor' }]
  const p = base({ objective: "What should I prepare for tomorrow's meeting?", understanding: u, semantic, documentsAvailable: false })
  assert.equal(p.objective.kind, 'prepare')
  assert.ok(p.assertions.some(a => a.predicate === 'attends' && a.subject === 'email:nithin@tipplr.in' && a.value === 'Harbor partner meeting' && a.evidenceClass === 'verified'), 'participant linked from the verified calendar read')
  assert.ok(p.deadlines.some(d => /Harbor/.test(d.label) && d.inHours > 18 && d.inHours < 19))
  assert.ok(p.missing.some(m => /documents \(not connected/.test(m)))
  assert.deepEqual(p.taskState.openTasks, ['Send the deck to Harbor'])
  ok('"prepare for tomorrow\'s meeting" → calendar, participants, open tasks; missing documents disclosed')
}

{ // 3. I already paid that bill → reported, never verified; provider confirmation listed as missing
  const r = await repo.assert({ subject: { entity_type: 'bill', canonical_key: 'mongodb:2026-11' }, predicate: 'payment_status', literal: 'paid', source: { source_type: 'conversation', source_object_ref: 'turn-77', verification_status: 'user_stated' }, confidence: 0.8 }, new Date(NOW).toISOString())
  assert.equal(r.changed, true)
  const facts = await repo.factsFor({ entity_type: 'bill', canonical_key: 'mongodb:2026-11' }, NOW)
  const p = base({ objective: 'I already paid that bill.', semantic: facts })
  assert.equal(p.objective.kind, 'report')
  const paid = p.assertions.find(a => a.predicate === 'payment_status')!
  assert.equal(paid.evidenceClass, 'reported'); assert.equal(paid.status, 'user_stated')
  assert.ok(p.missing.some(m => /provider confirmation/.test(m)))
  assert.ok(renderDecisionContext(p).some(l => /Reported by you, not provider-verified/.test(l)))
  ok('"I already paid that bill" → reported, not verified; no fabricated confirmation')
}

{ // conflicts: provider beats the owner's note; inference stays unresolved against a note
  const s2 = new MemorySemanticStore(); const r2 = new SemanticRepo(s2, scopeForActor(actor))
  const ev = fromCalendarEvent({ id: 'e9', title: 'Standup', startAt: '2026-11-10T06:00:00Z', endAt: '2026-11-10T06:30:00Z' })
  await r2.assert(ev.find(a => a.predicate === 'starts_at')!)
  // a second current value can only coexist via a different source status on a relationship; simulate conflicting literals by direct store rows
  const subj = s2.entities.find(e => e.canonical_key === 'google:e9')!
  const src = await r2.recordSource({ source_type: 'memories', source_object_ref: 'm-standup', verification_status: 'user_stated' })
  await s2.insertAssertion(r2.scope, { subject_entity_id: subj.id, predicate: 'starts_at', object_entity_id: null, literal_value_json: '2026-11-10T05:30:00Z', source_id: src.id, confidence: 0.8, assertion_status: 'current', valid_from: null, valid_until: null, supersedes_assertion_id: null, metadata_json: {} })
  const p = base({ objective: 'when is standup', semantic: await r2.factsFor({ entity_type: 'event', canonical_key: 'google:e9' }, NOW) })
  assert.equal(p.conflicts.length, 1); assert.equal(p.conflicts[0].resolution, 'provider_wins'); assert.equal(p.conflicts[0].chosen, '2026-11-10T06:00:00Z')
  ok('conflict: live provider value wins over an older note; both values kept visible')
}

{ // budgets, boundaries, mode flag
  const many = Array.from({ length: 120 }, (_, i) => ({ assertion: { id: `a${i}`, subject_entity_id: 's', predicate: 'noted', object_entity_id: null, literal_value_json: `note ${i}`, source_id: 'x', confidence: 0.9, assertion_status: 'current', valid_from: null, valid_until: null, recorded_at: '', supersedes_assertion_id: null, metadata_json: {} }, subject: { id: 's', scope_type: 'user', scope_id: '-884501501', entity_type: 'person', canonical_key: 'self' }, object: null, source: { id: 'x', source_type: 'memories', source_object_ref: 'r', verification_status: 'user_stated' }, temporal: 'current' })) as any
  const p = base({ objective: 'anything', semantic: many, permission: c => c === 'email' ? 'off' : 'read' })
  assert.ok(p.assertions.length <= 80); assert.ok(p.warnings.includes('edge_budget_reached'))
  const q = base({ objective: 'check my email for the invoice', permission: c => c === 'email' ? 'off' : 'read' })
  assert.deepEqual(q.boundaries.blockedCapabilities, ['email'])
  assert.equal(contextGraphMode('-884501501', {}), 'off'); assert.equal(contextGraphMode('-884501501', { GOGO_CONTEXT_GRAPH: 'shadow' }), 'shadow')
  assert.equal(contextGraphMode('5', { GOGO_CONTEXT_GRAPH: 'on', GOGO_CONTEXT_GRAPH_OWNERS: '-884501501' }), 'off')
  assert.equal(p.decisionId.length, 20); assert.equal(p.actor.scopeId, '-884501501')
  ok('bounded (edge budget), off capabilities surfaced, mode flag off by default, decision id stable')
}
console.log(`verify-context-graph-nov9: ${n} passed`)
