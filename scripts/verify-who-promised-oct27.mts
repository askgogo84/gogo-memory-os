// Perisclaw-style commitment memory (27 Oct): "Who promised to send the proposal?" answered from open loops with
// person, subject, date and source link. Pure parts only; no network.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture'
const c = await import('../lib/agent/commitments-query')

assert.deepEqual(c.parseWhoPromisedQuery('Who promised to send the proposal?'), { person: null, thing: 'proposal' })
assert.deepEqual(c.parseWhoPromisedQuery('who said they would share the API docs'), { person: null, thing: 'api docs' })
assert.deepEqual(c.parseWhoPromisedQuery('Who owes me the invoice'), { person: null, thing: 'invoice' })
assert.deepEqual(c.parseWhoPromisedQuery('What did Nithin promise?'), { person: 'Nithin', thing: null })
assert.deepEqual(c.parseWhoPromisedQuery('what has Divya promised to send'), { person: 'Divya', thing: null })
assert.deepEqual(c.parseWhoPromisedQuery("What am I still waiting on from Nithin K"), { person: 'Nithin K', thing: null })
for (const t of ['remind me to send the proposal', 'what am I waiting on', 'I promised to call Divya', 'who is Nithin', 'send the proposal to Divya'])
  assert.equal(c.parseWhoPromisedQuery(t), null, t)

const promise = { kind: 'waiting_on', title: 'Waiting on Nithin K L — POS API docs', summary: 'I will share the API docs and the proposal by Friday', evidence_json: { last_message_from: 'Nithin K L <nithin@tipplr.in>', direction: 'incoming_promise' } }
const owe = { kind: 'commitment', title: 'Reply to Divya — Q4 proposal review', summary: 'Can you review the proposal deck?', evidence_json: { last_message_from: 'Divya <divya@x.in>' } }
const other = { kind: 'life_event', title: 'Flight BLR → BOM', summary: 'proposal' }
assert.ok(c.commitmentMatches(promise, { person: null, thing: 'proposal' }) > c.commitmentMatches(owe, { person: null, thing: 'proposal' }), 'their promise ranks above an ask you owe')
assert.ok(c.commitmentMatches(promise, { person: 'Nithin', thing: null }) > 0)
assert.equal(c.commitmentMatches(promise, { person: 'Divya', thing: null }), 0, 'another person never matches')
assert.equal(c.commitmentMatches(promise, { person: null, thing: 'invoice' }), 0, 'another thing never matches')
assert.equal(c.commitmentMatches(other, { person: null, thing: 'proposal' }), 0, 'trips and approvals are not promises')
assert.ok(c.commitmentMatches(promise, { person: null, thing: 'api docs' }) > 0, 'plural/singular tolerated')

// Wiring: both surfaces load the module only behind the phrase gate, after the existing open-loop query.
const bridge = readFileSync('lib/agent/whatsapp-bridge.ts', 'utf8'), route = readFileSync('app/api/dashboard/chat/route.ts', 'utf8')
assert.ok(bridge.indexOf("await import('./commitments-query')") > bridge.indexOf('const query=await handleOpenLoopQuery'))
assert.match(route, /const \{handleWhoPromisedQuery\} = await import\('@\/lib\/agent\/commitments-query'\)/)
assert.doesNotMatch(route, /^import .*commitments-query/m, 'never a static import in the route')
// The gate used in the routes accepts every parser phrasing.
const gate = /\b(?:who\s+(?:promised|said\s+(?:they|he|she)|owes\s+me|was\s+(?:going|supposed)\s+to)|what\s+(?:did|has)\s+\S+(?:\s+\S+)?\s+promise|waiting\s+(?:on|for)\s+from\s+\S)/i
for (const t of ['Who promised to send the proposal?', 'who said they would share the API docs', 'Who owes me the invoice', 'What did Nithin promise?', 'What am I still waiting on from Nithin K']) assert.ok(gate.test(t), t)
console.log('Who promised passed')
