import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildApprovalBinding, assertApprovalBinding } from '../lib/agent/approval-binding'
import { checkinApprovalFingerprintInput } from '../lib/agent/life-event-approval-binding'

const binding=buildApprovalBinding({
  missionId:'run-1',stepId:'step-1',capability:'calendar',actionType:'calendar_change',
  target:'calendar:primary',payload:{title:'Flight EY1',startIso:'2026-09-28T02:35:00Z'},
})
assert.equal(binding.action_hash.length,64)
assert.doesNotThrow(()=>assertApprovalBinding({
  missionId:'run-1',stepId:'step-1',capability:'calendar',actionType:'calendar_change',
  target:'calendar:primary',payload:{title:'Flight EY1',startIso:'2026-09-28T02:35:00Z'},
},binding))
assert.throws(()=>assertApprovalBinding({
  missionId:'run-1',stepId:'step-1',capability:'calendar',actionType:'calendar_change',
  target:'calendar:primary',payload:{title:'Flight EY1',startIso:'2026-09-28T03:35:00Z'},
},binding),/approval_action_changed/)

const privateCheckin=checkinApprovalFingerprintInput({
  runId:'run-2',lifeEventId:'life-1',lifeEventActionId:'action-1',
  checkinUrl:'https://airline.example/checkin?token=super-secret-token',
  seatPolicy:'free_only',provider:'Airline',title:'Flight AB123',confirmationRef:'PNRSECRET',
})
const privateBinding=buildApprovalBinding(privateCheckin)
const snap=JSON.stringify(privateBinding.action_snapshot_json)
assert.doesNotMatch(snap,/super-secret-token/)
assert.doesNotMatch(snap,/PNRSECRET/)
assert.match(snap,/checkin_url_sha256/)
assert.match(snap,/confirmation_ref_sha256/)

const sources=[
  ['orchestrator','lib/agent/orchestrator.ts'],
  ['general planner','lib/agent/general-planner.ts'],
  ['secure browser','lib/agent/browser-command.ts'],
  ['travel calendar','lib/agent/travel-calendar-plan.ts'],
  ['booking calendar','lib/agent/booking-calendar-execution.ts'],
  ['life event worker','lib/agent/life-event-worker.ts'],
  ['life event execution','lib/agent/life-event-execution.ts'],
] as const

for(const [label,path] of sources){
  const src=readFileSync(path,'utf8')
  assert.match(src,/buildApprovalBinding|assertApprovalBinding/,label+' missing approval binding integration')
}

assert.match(readFileSync('lib/agent/browser-command.ts','utf8'),/url_sha256/)
assert.match(readFileSync('lib/agent/life-event-approval-binding.ts','utf8'),/confirmation_ref_sha256/)
assert.match(readFileSync('lib/agent/booking-calendar-execution.ts','utf8'),/status:'expired'/)

console.log('exact approval binding verification passed')
