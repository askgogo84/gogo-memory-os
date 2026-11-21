/** No-network, synthetic AskGogo × Zomato owner UX state-machine checks. */
import assert from 'node:assert/strict'
import {
  advanceSandbox, newSandboxState, sandboxQuote, SANDBOX_MENU, SANDBOX_RESTAURANTS,
  type SandboxState, type SandboxEvent,
} from '../lib/commerce/partner-bridge/zomato-sandbox-demo.ts'

let tests = 0
const eq = (a: unknown, b: unknown) => {assert.deepEqual(a, b); tests++}
const fails = (state: SandboxState, event: SandboxEvent, reason: RegExp) => {
  assert.throws(() => advanceSandbox(state, event), reason); tests++
}
let state = newSandboxState()
eq(state.stage, 'discover')
eq(SANDBOX_RESTAURANTS.length, 2)
eq(SANDBOX_MENU.length, 6)
fails(state, {type: 'select', restaurantId: 'demo-south'}, /connection first/)
fails(state, {type: 'approve', explicitlyApproved: true, displayedSnapshot: 'anything'}, /Explicit approval/)
state = advanceSandbox(state, {type: 'connect'})
eq(state.connected, true)
fails(state, {type: 'select', restaurantId: 'not-on-menu'}, /Unknown synthetic/)
state = advanceSandbox(state, {type: 'select', restaurantId: 'demo-south'})
fails(state, {type: 'review'}, /Add an item/)
fails(state, {type: 'quantity', itemId: 'pizza', quantity: 1}, /does not belong/)
fails(state, {type: 'quantity', itemId: 'dosa', quantity: 6}, /Quantity/)
state = advanceSandbox(state, {type: 'quantity', itemId: 'dosa', quantity: 2})
state = advanceSandbox(state, {type: 'quantity', itemId: 'coffee', quantity: 1})
eq(sandboxQuote(state).subtotalMinor, 35000)
eq(sandboxQuote(state).taxMinor, 1750)
eq(sandboxQuote(state).deliveryMinor, 2500)
eq(sandboxQuote(state).totalMinor, 39250)
state = advanceSandbox(state, {type: 'review'})
eq(state.stage, 'review')
fails(state, {type: 'approve', explicitlyApproved: false, displayedSnapshot: sandboxQuote(state).snapshot}, /Explicit approval/)
fails(state, {type: 'approve', explicitlyApproved: true, displayedSnapshot: 'changed'}, /Cart changed/)
const stale = state.reviewSnapshot!
state = advanceSandbox(state, {type: 'quantity', itemId: 'coffee', quantity: 0})
eq(state.stage, 'cart')
eq(state.reviewSnapshot, null)
fails(state, {type: 'approve', explicitlyApproved: true, displayedSnapshot: stale}, /Explicit approval/)
state = advanceSandbox(state, {type: 'review'})
state = advanceSandbox(state, {type: 'scenario', value: 'pending'})
state = advanceSandbox(state, {type: 'approve', explicitlyApproved: true, displayedSnapshot: state.reviewSnapshot!})
eq(state.stage, 'outcome_unknown')
eq(state.submissionCount, 1)
fails(state, {type: 'approve', explicitlyApproved: true, displayedSnapshot: state.reviewSnapshot!}, /submissions cannot be repeated/)
fails(state, {type: 'quantity', itemId: 'dosa', quantity: 5}, /submitted cart/)
eq(advanceSandbox(state, {type: 'reconcile'}).stage, 'outcome_unknown')
eq(state.submissionCount, 1)
state = advanceSandbox(state, {type: 'reset'})
eq(state.submissionCount, 0)
state = advanceSandbox(state, {type: 'connect'})
state = advanceSandbox(state, {type: 'select', restaurantId: 'demo-pizza'})
state = advanceSandbox(state, {type: 'quantity', itemId: 'pizza', quantity: 1})
state = advanceSandbox(state, {type: 'review'})
state = advanceSandbox(state, {type: 'approve', explicitlyApproved: true, displayedSnapshot: state.reviewSnapshot!})
eq(advanceSandbox(state, {type: 'reconcile'}).stage, 'fixture_completed')
state = advanceSandbox(state, {type: 'reset'})
state = advanceSandbox(state, {type: 'connect'})
state = advanceSandbox(state, {type: 'select', restaurantId: 'demo-south'})
state = advanceSandbox(state, {type: 'quantity', itemId: 'idli', quantity: 1})
state = advanceSandbox(state, {type: 'scenario', value: 'failed'})
state = advanceSandbox(state, {type: 'review'})
state = advanceSandbox(state, {type: 'approve', explicitlyApproved: true, displayedSnapshot: state.reviewSnapshot!})
state = advanceSandbox(state, {type: 'reconcile'})
eq(state.stage, 'fixture_failed')
fails(state, {type: 'select', restaurantId: 'demo-pizza'}, /already submitted/)
console.log('Zomato MCP sandbox: ' + tests + ' synthetic assertions passed; zero network/provider actions')
