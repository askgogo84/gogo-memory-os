// Same Brain 3.0 Phase 4: decision trace is additive; only verified evidence may become a verified_success; the v2
// calibration (20 samples, 0.82, safe handler list, canLearningOverrideSafety false) is untouched.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildDecisionTrace, evidenceClassOfRun, learningSignalFrom, DECISION_TRACE_SCHEMA } from '../lib/agent/decision-trace'
import { calibrateGuardedRouting, canLearningOverrideSafety } from '../lib/agent/decision-learning'
import { rankEvidence } from '../lib/agent/decision-evidence'
let n = 0; const ok = (s: string) => { n++; console.log('PASS', s) }
const at = '2026-11-09T10:00:00Z'

{ // evidence class of a run is the weakest decisive step
  assert.equal(evidenceClassOfRun([]), 'inferred')
  assert.equal(evidenceClassOfRun([{ at, node: 'r', type: 'READ', outcome: 'ok', evidenceClass: 'verified' }, { at, node: 'x', type: 'REASON', outcome: 'ok', evidenceClass: 'inferred' }, { at, node: 'e', type: 'EXECUTE', outcome: 'executed', evidenceClass: 'reported' }, { at, node: 'v', type: 'VERIFY', outcome: 'verified', evidenceClass: 'verified' }]), 'reported', 'an executed-but-only-reported step keeps the run at reported')
  assert.equal(evidenceClassOfRun([{ at, node: 'r', type: 'READ', outcome: 'ok', evidenceClass: 'verified' }, { at, node: 'v', type: 'VERIFY', outcome: 'verified', evidenceClass: 'verified' }]), 'verified')
  assert.equal(evidenceClassOfRun([{ at, node: 'x', type: 'REASON', outcome: 'ok', evidenceClass: 'inferred' }]), 'inferred')
  ok('evidence class: weakest decisive step; reason-only runs are inferred')
}
{ // trace shape and learning signal
  const t = buildDecisionTrace({ decisionId: 'd1', procedureId: 'email.follow_up', procedureVersion: 1, procedureRunId: 'run-9', contextPackRef: 'pack-1', objectiveKind: 'action', status: 'completed', now: at, trace: [{ at, node: 'v', type: 'VERIFY', outcome: 'verified', evidenceClass: 'verified' }] })
  assert.equal(t.schema, DECISION_TRACE_SCHEMA); assert.equal(t.outcome, 'completed'); assert.equal(t.evidence_class, 'verified')
  assert.deepEqual(learningSignalFrom(t), { outcome: 'verified_success', verified: true })
  const reported = buildDecisionTrace({ decisionId: 'd2', status: 'completed', now: at, trace: [{ at, node: 'e', type: 'EXECUTE', outcome: 'executed', evidenceClass: 'reported' }] })
  assert.deepEqual(learningSignalFrom(reported), { outcome: 'success', verified: false }, 'reported completion never claims verified')
  assert.deepEqual(learningSignalFrom(buildDecisionTrace({ decisionId: 'd3', status: 'escalated', now: at, trace: [] })), { outcome: 'unknown', verified: false })
  assert.equal(learningSignalFrom(buildDecisionTrace({ decisionId: 'd4', status: 'waiting_approval', now: at, trace: [] })), null)
  ok('trace links decision, procedure run and context pack; only verified → verified_success; waiting teaches nothing')
}
{ // v2 calibration is untouched by v3 rows: unverified successes do not raise confidence; thresholds intact
  const rows = Array.from({ length: 30 }, (_, i) => ({ handler: 'gmail-context', outcome: 'success', verified: false, similarity: 1, user_text: `t${i}` })) as any
  const r = rankEvidence(rows); assert.ok(r.confidence < 0.82, `unverified successes stay below live threshold (${r.confidence})`)
  assert.equal(calibrateGuardedRouting({ preferredHandler: 'gmail-context', confidence: 0.95, avoidHandlers: [], actionRequiresApproval: true }).useLearned, false)
  assert.equal(calibrateGuardedRouting({ preferredHandler: 'gmail-send', confidence: 0.99, avoidHandlers: [] }).useLearned, false)
  assert.equal(calibrateGuardedRouting({ preferredHandler: 'gmail-context', confidence: 0.81, avoidHandlers: [] }).reason, 'below_live_threshold')
  assert.equal(canLearningOverrideSafety(), false)
  const src = readFileSync('lib/agent/decision-learning.ts', 'utf8')
  assert.ok(src.includes("schema:'same-brain-v2'") && src.includes('p.confidence<0.82') && src.includes('canLearningOverrideSafety(){return false}'))
  assert.match(readFileSync('lib/agent/decision-evidence.ts', 'utf8'), /MIN_CALIBRATION_SAMPLES = 20/)
  const hints = src.slice(src.indexOf('export async function decisionHints')); assert.ok(hints.includes("m?.schema==='same-brain-v2'"), 'v2 hints still filter to v2 rows, so v3 trace rows cannot feed routing')
  ok('v2 calibration untouched: 0.82 threshold, safe-handler list, approval-required block, canLearningOverrideSafety false, v3 rows filtered out of hints')
}
console.log(`verify-decision-trace-nov9: ${n} passed`)
