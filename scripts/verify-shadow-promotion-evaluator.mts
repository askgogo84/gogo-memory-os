import assert from 'node:assert/strict'
import { evaluateShadowPromotion } from '../lib/agent/shadow-report'

let r=evaluateShadowPromotion({
  observations:10,paired:10,contextual:5,contextualAmbiguous:0,
  capabilityComparable:8,capabilityMatches:8,contextualHandledByLegacy:0,
})
assert.equal(r.eligibleForReadOnlyContextAuthority,false)
assert.ok(r.failures.includes('paired_events_below_50'))

r=evaluateShadowPromotion({
  observations:100,paired:90,contextual:40,contextualAmbiguous:2,
  capabilityComparable:80,capabilityMatches:76,contextualHandledByLegacy:0,
})
assert.equal(r.eligibleForReadOnlyContextAuthority,false)
assert.ok(r.failures.includes('pairing_rate_below_95_percent'))

r=evaluateShadowPromotion({
  observations:100,paired:98,contextual:40,contextualAmbiguous:8,
  capabilityComparable:80,capabilityMatches:76,contextualHandledByLegacy:0,
})
assert.equal(r.eligibleForReadOnlyContextAuthority,false)
assert.ok(r.failures.includes('contextual_ambiguity_rate_above_10_percent'))

r=evaluateShadowPromotion({
  observations:100,paired:98,contextual:40,contextualAmbiguous:2,
  capabilityComparable:80,capabilityMatches:70,contextualHandledByLegacy:0,
})
assert.equal(r.eligibleForReadOnlyContextAuthority,false)
assert.ok(r.failures.includes('capability_agreement_below_90_percent'))

r=evaluateShadowPromotion({
  observations:100,paired:98,contextual:40,contextualAmbiguous:2,
  capabilityComparable:80,capabilityMatches:76,contextualHandledByLegacy:1,
})
assert.equal(r.eligibleForReadOnlyContextAuthority,false)
assert.ok(r.failures.includes('contextual_legacy_cases_require_manual_review'))

r=evaluateShadowPromotion({
  observations:100,paired:98,contextual:40,contextualAmbiguous:2,
  capabilityComparable:80,capabilityMatches:76,contextualHandledByLegacy:0,
})
assert.equal(r.eligibleForReadOnlyContextAuthority,true)
assert.deepEqual(r.failures,[])

console.log('Shadow Brain promotion evaluator verification passed')
