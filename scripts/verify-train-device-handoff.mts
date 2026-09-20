import assert from 'node:assert/strict'
import { isTrainDeviceHandoffFollowup } from '../lib/agent/train-research'

assert.equal(
  isTrainDeviceHandoffFollowup('then tell me which train you want and I will take it from there'),
  true,
  'must intercept the exact misleading device-handoff follow-up instead of letting the general planner invent trains',
)
assert.equal(isTrainDeviceHandoffFollowup('Vande Bharat 20664'), true)
assert.equal(isTrainDeviceHandoffFollowup('20664'), true)
assert.equal(isTrainDeviceHandoffFollowup('the second one'), true)
assert.equal(isTrainDeviceHandoffFollowup('which one is best?'), true)
assert.equal(isTrainDeviceHandoffFollowup('continue'), true)

assert.equal(isTrainDeviceHandoffFollowup('remind me at 6 pm to call Mathew'), false)
assert.equal(isTrainDeviceHandoffFollowup('show me my Samsonite bill'), false)
assert.equal(isTrainDeviceHandoffFollowup('what is the weather in Bangalore?'), false)

console.log('✅ train device handoff follow-up guard passed')
