// Sealed original-source push evidence regression: fictional devices, owners, Expo.
// Absolutely no external provider calls or real account state changes.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const source = readFileSync('lib/agent/push.ts', 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  fileName: 'push.ts', reportDiagnostics: true,
})
assert.equal(compiled.diagnostics?.filter(d => d.category === ts.DiagnosticCategory.Error).length || 0, 0)
const audit = { requests: [], reads: [], updates: [], logs: [] }
const fixture = {
  owner: '-2251799813685249', tokens: [], readError: null, readThrows: false,
  cleanupThrows: false, cleanupError: null, fetchImpl: null,
}
function reset() {
  for (const value of Object.values(audit)) value.length = 0
  Object.assign(fixture, {
    owner: '-2251799813685249', tokens: [], readError: null, readThrows: false,
    cleanupThrows: false, cleanupError: null, fetchImpl: null,
  })
}
const fakeDb = {
  from(table) {
    assert.equal(table, 'agent_devices')
    let mode = 'read', changes = null
    const filters = []
    const query = {
      select() { return query },
      eq(key, value) { filters.push([key, value]); return query },
      not(key, op, value) { filters.push([key, op, value]); return query },
      update(change) { mode = 'update'; changes = change; return query },
      then(resolve, reject) {
        if (mode === 'read') {
          audit.reads.push([...filters])
          if (fixture.readThrows) return Promise.reject(Error('fictional DB timeout')).then(resolve, reject)
          return Promise.resolve({ data: fixture.tokens.map((token, id) => ({
            id: 'device-' + id, expo_push_token: token,
          })), error: fixture.readError }).then(resolve, reject)
        }
        audit.updates.push({ filters: [...filters], changes })
        if (fixture.cleanupThrows) return Promise.reject(Error('fictional cleanup write timeout')).then(resolve, reject)
        return Promise.resolve({ error: fixture.cleanupError }).then(resolve, reject)
      },
    }
    return query
  },
}
const module = { exports: {} }
vm.runInNewContext(compiled.outputText, {
  module, exports: module.exports, Date, String, JSON, Number,
  require(id) {
    if (id === '@/lib/supabase-admin') return { supabaseAdmin: fakeDb }
    throw Error('Unexpected dependency: ' + id)
  },
  fetch: async (url, options) => {
    audit.requests.push({ url, options })
    if (!fixture.fetchImpl) throw Error('No real HTTP transport is allowed in this suite')
    return fixture.fetchImpl(url, options)
  },
  console: { error: (...parts) => audit.logs.push(parts.join(' ')) },
}, { timeout: 5000 })
const { sendAgentPush } = module.exports
const input = { title: 'Fixture update', body: 'This is not an actual notification.' }
const okTicket = { status: 'ok', id: 'fictional-expo-ticket-001' }
const failedTicket = { status: 'error', message: 'invalid token', details: { error: 'InvalidCredentials' } }
function response(data, status = 200) {
  fixture.fetchImpl = async () => ({ ok: status >= 200 && status < 300, status, json: async () => ({ data }) })
}
function assertState(actual, sent, failed, evidenceState) {
  assert.equal(actual.sent, sent)
  assert.equal(actual.failed, failed)
  assert.equal(actual.evidenceState, evidenceState)
}
let benign = 0, mandatory = 0

reset()
assertState(await sendAgentPush(fixture.owner, input), 0, 0, 'no_devices')
assert.equal(audit.requests.length, 0)
benign++

reset()
fixture.readError = { message: 'fictional device query failure' }
assertState(await sendAgentPush(fixture.owner, input), 0, 0, 'device_lookup_failed')
assert.equal(audit.requests.length, 0)
mandatory++

reset()
fixture.readThrows = true
assertState(await sendAgentPush(fixture.owner, input), 0, 0, 'device_lookup_failed')
assert.equal(audit.requests.length, 0)
mandatory++

reset()
fixture.tokens = ['  ', '']
assertState(await sendAgentPush(fixture.owner, input), 0, 0, 'no_devices')
assert.equal(audit.requests.length, 0)
benign++

reset()
fixture.tokens = ['ExponentPushToken[alice]']
response([okTicket])
assertState(await sendAgentPush(fixture.owner, input), 1, 0, 'provider_accepted')
assert.equal(audit.requests.length, 1)
assert.equal(audit.requests[0].url, 'https://exp.host/--/api/v2/push/send')
assert.equal(JSON.parse(audit.requests[0].options.body)[0].to, 'ExponentPushToken[alice]')
assert.ok(audit.reads[0].some(row => row[0] === 'telegram_id' && row[1] === fixture.owner))
benign++

reset()
fixture.tokens = ['ExponentPushToken[alice]']
response([{ status: 'ok' }])
assertState(await sendAgentPush(fixture.owner, input), 0, 1, 'outcome_unknown')
mandatory++

reset()
fixture.tokens = ['ExponentPushToken[alice]']
response([failedTicket])
assertState(await sendAgentPush(fixture.owner, input), 0, 1, 'provider_rejected')
benign++

reset()
fixture.tokens = ['ExponentPushToken[alice]', 'ExponentPushToken[bob]']
response([okTicket, failedTicket])
assertState(await sendAgentPush(fixture.owner, input), 1, 1, 'partial')
benign++

reset()
fixture.tokens = ['ExponentPushToken[alice]']
fixture.fetchImpl = async () => { throw Error('fictional request sent / response lost') }
assertState(await sendAgentPush(fixture.owner, input), 0, 1, 'outcome_unknown')
assert.equal(audit.requests.length, 1, 'no blind retry on uncertain send')
mandatory++

reset()
fixture.tokens = ['ExponentPushToken[alice]']
response(null, 502)
assertState(await sendAgentPush(fixture.owner, input), 0, 1, 'outcome_unknown')
assert.equal(audit.requests.length, 1)
mandatory++

reset()
fixture.tokens = ['ExponentPushToken[alice]']
fixture.fetchImpl = async () => ({ ok: true, status: 200, json: async () => { throw Error('fictional parse failure') } })
assertState(await sendAgentPush(fixture.owner, input), 0, 1, 'outcome_unknown')
assert.equal(audit.requests.length, 1)
mandatory++

reset()
fixture.tokens = ['ExponentPushToken[alice]']
fixture.fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ error: 'missing ticket array' }) })
assertState(await sendAgentPush(fixture.owner, input), 0, 1, 'outcome_unknown')
mandatory++

reset()
fixture.tokens = ['ExponentPushToken[alice]', 'ExponentPushToken[bob]']
response([okTicket])
assertState(await sendAgentPush(fixture.owner, input), 1, 1, 'outcome_unknown')
mandatory++

reset()
fixture.tokens = ['ExponentPushToken[alice]']
response([{ status: 'surprising-status', id: 'fictional-id' }])
assertState(await sendAgentPush(fixture.owner, input), 0, 1, 'outcome_unknown')
mandatory++

reset()
fixture.tokens = ['ExponentPushToken[alice]']
fixture.cleanupThrows = true
response([{ status: 'error', details: { error: 'DeviceNotRegistered' } }])
assertState(await sendAgentPush(fixture.owner, input), 0, 1, 'provider_rejected')
assert.equal(audit.updates.length, 1)
assert.ok(audit.updates[0].filters.some(row => row[0] === 'telegram_id' && row[1] === fixture.owner))
assert.ok(audit.updates[0].filters.some(row => row[0] === 'expo_push_token' && row[1] === fixture.tokens[0]))
assert.equal(audit.requests.length, 1)
mandatory++

reset()
fixture.tokens = ['ExponentPushToken[alice]']
fixture.cleanupError = { message: 'fictional update failed' }
response([{ status: 'error', details: { error: 'DeviceNotRegistered' } }])
assertState(await sendAgentPush(fixture.owner, input), 0, 1, 'provider_rejected')
mandatory++

reset()
fixture.tokens = Array.from({ length: 25 }, (_, i) => 'ExponentPushToken[fixture' + i + ']')
response(Array.from({ length: 20 }, () => okTicket))
assertState(await sendAgentPush(fixture.owner, input), 20, 0, 'provider_accepted')
assert.equal(JSON.parse(audit.requests[0].options.body).length, 20)
benign++

assert.match(source, /evidenceState:\s*'outcome_unknown'/, 'transport uncertainty must remain explicitly tagged')
assert.match(source, /ticket\.id\.trim\(\)/, 'positive count requires provider ticket ID')
assert.doesNotMatch(source, /setTimeout\s*\(|retryAgentPush\s*\(/, 'no implicit replay')
mandatory++
console.log(`Push original-source evidence: ${benign} benign controls + ${mandatory} mandatory safety assertions PASS`)
