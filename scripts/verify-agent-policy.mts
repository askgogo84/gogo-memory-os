import assert from 'node:assert/strict'
import { evaluateAgentExecutionPolicy } from '../lib/agent/policy'

const cases = [
  {
    name: 'read requires at least read permission',
    actual: evaluateAgentExecutionPolicy({ capability:'memory', permissionLevel:'read', mode:'read', risk:'low', irreversible:false }),
    expected: { allowed:true, reason:'read_allowed' },
  },
  {
    name: 'off blocks reads',
    actual: evaluateAgentExecutionPolicy({ capability:'memory', permissionLevel:'off', mode:'read', risk:'low', irreversible:false }),
    expected: { allowed:false, reason:'permission_off' },
  },
  {
    name: 'read permission cannot draft',
    actual: evaluateAgentExecutionPolicy({ capability:'email', permissionLevel:'read', mode:'draft', risk:'low', irreversible:false }),
    expected: { allowed:false, reason:'permission_insufficient' },
  },
  {
    name: 'draft permission can draft',
    actual: evaluateAgentExecutionPolicy({ capability:'email', permissionLevel:'draft', mode:'draft', risk:'low', irreversible:false }),
    expected: { allowed:true, reason:'draft_allowed' },
  },
  {
    name: 'irreversible submit requires approval',
    actual: evaluateAgentExecutionPolicy({ capability:'browser', permissionLevel:'ask', mode:'execute', risk:'high', irreversible:true, approvalStatus:'pending' }),
    expected: { allowed:false, reason:'approval_required' },
  },
  {
    name: 'approved irreversible submit can proceed',
    actual: evaluateAgentExecutionPolicy({ capability:'browser', permissionLevel:'ask', mode:'execute', risk:'high', irreversible:true, approvalStatus:'approved' }),
    expected: { allowed:true, reason:'approved_execute' },
  },
  {
    name: 'rejected approval cannot be replayed',
    actual: evaluateAgentExecutionPolicy({ capability:'email', permissionLevel:'ask', mode:'execute', risk:'high', irreversible:true, approvalStatus:'rejected' }),
    expected: { allowed:false, reason:'approval_not_valid' },
  },
  {
    name: 'auto cannot bypass consequential medium-risk gate',
    actual: evaluateAgentExecutionPolicy({ capability:'payments', permissionLevel:'auto', mode:'execute', risk:'medium', irreversible:false }),
    expected: { allowed:false, reason:'auto_not_allowed_for_consequential_action' },
  },
  {
    name: 'safe low-risk auto action can proceed',
    actual: evaluateAgentExecutionPolicy({ capability:'memory', permissionLevel:'auto', mode:'execute', risk:'low', irreversible:false }),
    expected: { allowed:true, reason:'safe_auto_execute' },
  },
]

for (const c of cases) {
  assert.deepEqual(c.actual, c.expected, c.name)
  console.log(`✓ ${c.name}`)
}
console.log(`✅ agent execution policy: ${cases.length} checks passed`)
