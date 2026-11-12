import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import * as protocol from '../lib/tv/protocol.ts'

let owner = null
let duringAnswer = null
const users = [
  { id: 'account-one', telegram_id: 101, whatsapp_id: 'one', access_status: 'active', name: 'One', timezone: 'UTC', google_calendar_connected: true, google_refresh_token: 'calendar-one' },
  { id: 'account-two', telegram_id: 102, whatsapp_id: 'two', access_status: 'active', name: 'Two', timezone: 'UTC', google_calendar_connected: true, google_refresh_token: 'calendar-two' },
]
const pairings = []
const sessions = users.map(user => ({
  session_id: 'session-' + user.telegram_id,
  telegram_id: String(user.telegram_id),
  expires_at: new Date(Date.now() + 300_000).toISOString(),
}))
const memories = [
  { telegram_id: 101, content: 'My favorite tea is jasmine.' },
  { telegram_id: 102, content: 'My favorite tea is oolong.' },
  { telegram_id: 101, content: 'Tea password: secret-fixture' },
]
const reads = []
const id = '11111111-1111-1111-1111-111111111111'
const database = {
  from(table) {
    const tables = { users, tv_pairings: pairings, dashboard_sessions: sessions, memories, wa_creditiq_links: [] }
    assert.ok(table in tables, 'Unexpected access to ' + table)
    const rows = tables[table]
    const checks = []
    let updates
    const query = {
      eq(key, value) {
        checks.push(row => key === 'telegram_id' ? String(row[key]) === String(value) : row[key] === value)
        return this
      },
      is(key, value) { return this.eq(key, value) },
      not(key, comparison, value) {
        assert.equal(comparison, 'is')
        checks.push(row => row[key] !== value)
        return this
      },
      gt(key, value) { checks.push(row => row[key] > value); return this },
      or() { return this },
      lte(key, value) { checks.push(row => row[key] <= value); return this },
      select() { return this },
      update(next) { assert.equal(table, 'tv_pairings'); updates = next; return this },
      order() { return this },
      limit() { return this },
      async maybeSingle() { return { data: finish()[0] ?? null, error: null } },
      then(resolve) { resolve({ data: finish(), error: null }) },
    }
    function finish() {
      const selected = rows.filter(row => checks.every(test => test(row)))
      if (updates) for (const row of selected) Object.assign(row, updates)
      return selected
    }
    return query
  },
  rpc(name, args) {
    if (name === 'tv_start_qr_pairing') {
      pairings.push({
        id, code_hash: args.p_code_hash, token_hash: args.p_token_hash, scope: 'ask:read',
        qr_hash: args.p_qr_hash, poll_hash: args.p_poll_hash, device_name: args.p_device_name,
        owner_id: null, approved_at: null, expires_at: null, revoked_at: null, denied_at: null,
        pair_expires_at: new Date(Date.now() + 300_000).toISOString(), next_request_at: new Date(0).toISOString(),
      })
      return { data: true, error: null }
    }
    if (name === 'tv_poll_qr_pairing') {
      const row = pairings.find(item => item.poll_hash === args.p_poll_hash)
      if (!row) return { data: 'invalid' }
      if (row.revoked_at) return { data: 'cancelled' }
      if (row.denied_at) return { data: 'denied' }
      if (!row.owner_id) return { data: 'pending' }
      row.approved_at ??= new Date().toISOString()
      row.expires_at ??= new Date(Date.now() + 43_200_000).toISOString()
      return { data: 'paired' }
    }
    const row = pairings.find(item => item.code_hash === args.p_code_hash && !item.owner_id &&
      !item.revoked_at && !item.denied_at && (!args.p_qr_hash || item.qr_hash === args.p_qr_hash))
    if (name === 'tv_review_qr_pairing') {
      return { async maybeSingle() {
        return { data: row ? { id, device_name: row.device_name, scope: row.scope } : null }
      } }
    }
    assert.equal(name, 'tv_decide_qr_pairing')
    if (!row || args.p_id !== id) return { data: false }
    if (args.p_approve) row.owner_id = args.p_owner_id
    else row.denied_at = new Date().toISOString()
    return { data: true }
  },
}

const dependencies = {
  'next/server': { NextResponse: Response },
  '@/lib/tv/protocol': protocol,
  '@/lib/supabase-admin': { supabaseAdmin: database },
  crypto: await import('node:crypto'),
  'next/headers': { cookies: async () => ({
    get: name => name === 'askgogo_session' && owner ? { value: 'session-' + owner.telegramId } : undefined,
  }) },
  '@/lib/agent/typed-object-context': { rememberTypedObjects: () => assert.fail('TV wrote conversation context') },
  '@/lib/services/embeddings': { embedText: () => assert.fail('TV used an embedding provider') },
  '@/lib/services/claude': { askClaude: async () => 'REMINDER create test action' },
  '@/lib/services/google-calendar-accounts': {
    getCalendarAccountAccess: async (id, refresh) => {
      assert.equal(refresh, id === 101 ? 'calendar-one' : 'calendar-two')
      return [{ accessToken: refresh }]
    },
  },
  '@/lib/google-calendar': {
    fetchPrimaryCalendarAccount: async () => null,
    fetchPrimaryCalendarEventsPage: async (token, start) => {
      reads.push(token)
      if (duringAnswer) await duringAnswer()
      const date = start.slice(0, 10)
      return { hasMore: false, events: [{
        id: token, summary: token === 'calendar-one' ? 'Ceramics workshop' : 'Kayaking class',
        start: { dateTime: date + 'T10:00:00Z' }, end: { dateTime: date + 'T11:00:00Z' },
      }] }
    },
  },
  '@/lib/services/voice-transcription': { transcribeTvVoice: async () => 'Voice question' },
}

function load(relative) {
  const source = readFileSync(new URL(relative, import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', code)(name => {
    assert.ok(name in dependencies, 'Unexpected route dependency ' + name)
    return dependencies[name]
  }, module, module.exports)
  return module.exports
}
dependencies['@/lib/dashboard/guard'] = load('../lib/dashboard/guard.ts')
dependencies['@/lib/dashboard/session-access'] = load('../lib/dashboard/session-access.ts')
dependencies['@/lib/dashboard/session'] = load('../lib/dashboard/session.ts')
dependencies['@/lib/bot/memory-redaction'] = load('../lib/bot/memory-redaction.ts')
dependencies['@/lib/timezone'] = dependencies['./timezone'] = load('../lib/timezone.ts')
dependencies['@/lib/data/calendar-word'] = load('../lib/data/calendar-word.ts')
dependencies['@/lib/calendar-intervals'] = load('../lib/calendar-intervals.ts')
dependencies['@/lib/agent/calendar-read'] = dependencies['./calendar-read'] = load('../lib/agent/calendar-read.ts')
dependencies['@/lib/agent/actor'] = load('../lib/agent/actor.ts')
dependencies['./typed-object-context'] = dependencies['@/lib/agent/typed-object-context']
dependencies['@/lib/agent/read-only-schedule'] = load('../lib/agent/read-only-schedule.ts')
dependencies['@/lib/services/memory-index'] = load('../lib/services/memory-index.ts')
dependencies['@/lib/agent/context-graph/recall'] = load('../lib/agent/context-graph/recall.ts')
dependencies['@/lib/tv/answer'] = load('../lib/tv/answer.ts')
const account = load('../app/api/tv/account/route.ts')
const device = load('../app/api/tv/device/route.ts')
const ask = load('../app/api/tv/ask/route.ts')

const endpoint = 'https://preview.example.test'
function request(method, { token, body, origin = endpoint, native = true } = {}) {
  const headers = { host: 'preview.example.test', origin }
  if (native) headers['x-gogo-tv'] = '2'
  if (token) headers.authorization = 'Bearer ' + token
  if (body) headers['content-type'] = body instanceof Uint8Array ? 'audio/wav' : 'application/json'
  return new Request(endpoint, { method, headers, body: body instanceof Uint8Array ? body : JSON.stringify(body) })
}
const status = async (response, expected) => {
  const result = await response
  assert.equal(result.status, expected)
  assert.equal(result.headers.get('cache-control'), 'no-store')
  return result.json()
}

process.env.GOGO_TV_PAIRING = '0'
await status(device.POST(request('POST')), 404)
await status(ask.POST(request('POST')), 404)
process.env.GOGO_TV_PAIRING = '1'
process.env.GOGO_TV_LOCAL_TEST = '1'
process.env.GOGO_TV_RATE_KEY = 'local-test-rate-key-'.repeat(2)
delete process.env.VERCEL
await status(device.POST(request('POST', { native: false })), 426)
const token = protocol.newToken()
const { proof, code, qr } = await status(device.POST(request('POST', {
  body: { sessionHash: protocol.hash(token), deviceName: 'TCL BeyondTV2' },
})), 201)
assert.equal(pairings[0].token_hash, protocol.hash(token))
assert.notEqual(pairings[0].code_hash, code)
assert.notEqual(pairings[0].poll_hash, proof)
assert.equal((await status(device.PUT(request('PUT', { token: proof })), 200)).state, 'pending')
await status(device.PUT(request('PUT', { token })), 401)
await status(ask.POST(request('POST', { token: proof, body: { text: 'Show my calendar' } })), 401)
await status(ask.POST(request('POST', { token, body: { text: 'Show my calendar' } })), 401)
const review = { action: 'review', code, qr }
await status(account.POST(request('POST', { body: review })), 401)
owner = { telegramId: '101' }
await status(account.POST(request('POST', { origin: 'https://different.example.test', body: review })), 403)
await status(account.POST(request('POST', { body: { ...review, qr: protocol.newQrCode() } })), 409)
const { pairing } = await status(account.POST(request('POST', { body: review })), 200)
assert.deepEqual(pairing, { id, device_name: 'TCL BeyondTV2', scope: 'ask:read' })
await status(account.POST(request('POST', { body: { ...review, action: 'approve', id } })), 200)
await status(ask.POST(request('POST', { token, body: { text: 'Show my calendar' } })), 401)
assert.deepEqual(await status(device.PUT(request('PUT', { token: proof })), 200), { state: 'paired' })
assert.deepEqual(await status(device.PUT(request('PUT', { token: proof })), 200), { state: 'paired' })
owner = { telegramId: '102' }
await status(account.POST(request('POST', { body: { action: 'approve', code, id } })), 409)
assert.deepEqual((await status(account.GET(), 200)).devices, [])
await status(account.POST(request('POST', { body: { action: 'revoke', id } })), 200)
const question = { token, body: { owner: 'account-two', scope: 'write', text: 'Show my calendar today' } }
const result = await status(ask.POST(request('POST', question)), 200)
assert.match(result.text, /Ceramics workshop/)
assert.doesNotMatch(result.text, /Kayaking class/)
assert.deepEqual(reads, ['calendar-one'])
await status(ask.POST(request('POST', question)), 429)
pairings[0].next_request_at = new Date(0).toISOString()
await status(ask.POST(request('POST', { token, body: new Uint8Array(4000) })), 400)
pairings[0].next_request_at = new Date(0).toISOString()
const fact = await status(ask.POST(request('POST', { token, body: { text: 'What do you remember about tea?' } })), 200)
assert.match(fact.text, /jasmine/)
assert.doesNotMatch(fact.text, /oolong|secret-fixture/)
pairings[0].next_request_at = new Date(0).toISOString()
const writeAttempt = await status(ask.POST(request('POST', { token, body: { text: 'Create a reminder' } })), 200)
assert.equal(writeAttempt.text, 'Open AskGogo on your phone for that request.')
pairings[0].next_request_at = new Date(0).toISOString()
const audio = Buffer.alloc(3244)
audio.write('RIFF', 0)
audio.writeUInt32LE(3236, 4)
audio.write('WAVEfmt ', 8)
audio.writeUInt32LE(16, 16)
audio.writeUInt16LE(1, 20)
audio.writeUInt16LE(1, 22)
audio.writeUInt32LE(16000, 24)
audio.writeUInt32LE(32000, 28)
audio.writeUInt16LE(2, 32)
audio.writeUInt16LE(16, 34)
audio.write('data', 36)
audio.writeUInt32LE(3200, 40)
assert.equal((await status(ask.POST(request('POST', { token, body: audio })), 200)).transcript, 'Voice question')
pairings[0].next_request_at = new Date(0).toISOString()
duringAnswer = async () => {
  process.env.GOGO_TV_PAIRING = '0'
  owner = { telegramId: '101' }
  await status(account.POST(request('POST', { body: { action: 'revoke', id } })), 200)
}
await status(ask.POST(request('POST', question)), 401)
await status(device.DELETE(request('DELETE', { token })), 200)
console.log('TV routes, dashboard cookie checks and Same Brain read-only Calendar and memory passed with isolated data')
