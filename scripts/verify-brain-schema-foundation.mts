import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { approvalActionHash,approvalMatches } from '../lib/agent/approval-fingerprint'

const base={
  missionId:'mission-1',stepId:'step-4',capability:'travel',actionType:'booking',
  target:'hotel:abc',payload:{dates:{checkout:'2026-09-30',checkin:'2026-09-27'},rooms:1},
  amount:'622.19',objectRef:'hotel:abc',objectVersion:7,policyVersion:'brain-v1.1',
}
const h1=approvalActionHash(base)
const h2=approvalActionHash({...base,payload:{rooms:1,dates:{checkin:'2026-09-27',checkout:'2026-09-30'}}})
assert.equal(h1,h2,'canonical key order must not change approval hash')
assert.equal(approvalMatches(base,h1),true)
assert.equal(approvalMatches({...base,amount:'700.00'},h1),false,'amount drift must invalidate approval')
assert.equal(approvalMatches({...base,target:'hotel:def'},h1),false,'target drift must invalidate approval')
assert.equal(approvalMatches({...base,objectVersion:8},h1),false,'object version drift must invalidate approval')
assert.equal(approvalMatches({...base,policyVersion:'brain-v1.2'},h1),false,'policy drift must invalidate approval')

const migration=readFileSync('supabase/migrations/20260921051000_brain_v1_1_schema_foundation.sql','utf8')
for(const required of [
  'agent_inbound_events','unique (surface, event_key)','brain_user_leases',
  'try_acquire_brain_user_lease','release_brain_user_lease',
  'action_hash','policy_version','action_snapshot_json','outcome_unknown'
]) assert.ok(migration.includes(required),required+' missing from schema foundation')

console.log('Brain v1.1 schema foundation verification passed')

const lockdown=readFileSync('supabase/migrations/20260921052000_brain_v1_1_lease_rpc_lockdown.sql','utf8')
assert.match(lockdown,/revoke execute[\s\S]*from anon, authenticated/i)
assert.match(lockdown,/grant execute[\s\S]*to service_role/i)
