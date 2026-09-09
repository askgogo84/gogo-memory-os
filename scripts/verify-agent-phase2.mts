import assert from 'node:assert/strict'
import { classifyAgentRequest } from '../lib/agent/classifier'
import { evaluateAgentExecutionPolicy } from '../lib/agent/policy'

const reminder = classifyAgentRequest('Remind me Friday at 8 AM to book the hotel')
assert.equal(reminder.capability, 'reminders')
assert.equal(reminder.mode, 'execute')
assert.equal(reminder.risk, 'low')
assert.equal(reminder.irreversible, false)
console.log('✓ reminder request is a low-risk first-class agent capability')

const list = classifyAgentRequest('Add milk to my groceries list')
assert.equal(list.capability, 'lists')
assert.equal(list.mode, 'execute')
assert.equal(list.risk, 'low')
console.log('✓ list mutation is routed as a first-class agent capability')

const task = classifyAgentRequest('Add task send the investor update')
assert.equal(task.capability, 'tasks')
assert.equal(task.mode, 'execute')
console.log('✓ task mutation is routed as a first-class agent capability')

const calendar = classifyAgentRequest('Move my meeting with Srinivas to tomorrow afternoon')
assert.equal(calendar.capability, 'calendar')
assert.equal(calendar.mode, 'execute')
assert.equal(calendar.risk, 'medium')
assert.equal(calendar.approvalAction, 'calendar_change')
console.log('✓ calendar mutation is approval-gated')

const purchase = classifyAgentRequest('Buy this and pay with my card')
assert.equal(purchase.capability, 'payments')
assert.equal(purchase.risk, 'high')
assert.equal(purchase.irreversible, true)
assert.equal(purchase.approvalAction, 'purchase')
console.log('✓ payment action is high risk and irreversible')

assert.deepEqual(
  evaluateAgentExecutionPolicy({ capability:'reminders', permissionLevel:'auto', mode:'execute', risk:'low', irreversible:false }),
  { allowed:true, reason:'safe_auto_execute' },
)
console.log('✓ reversible reminder action can execute under auto permission')

assert.deepEqual(
  evaluateAgentExecutionPolicy({ capability:'calendar', permissionLevel:'ask', mode:'execute', risk:'medium', irreversible:false }),
  { allowed:false, reason:'approval_required' },
)
console.log('✓ calendar mutation cannot execute before approval')

assert.deepEqual(
  evaluateAgentExecutionPolicy({ capability:'calendar', permissionLevel:'ask', mode:'execute', risk:'medium', irreversible:false, approvalStatus:'approved' }),
  { allowed:true, reason:'approved_execute' },
)
console.log('✓ approved calendar mutation can proceed')

console.log('✅ Phase 2 agent routing and safety checks passed')
