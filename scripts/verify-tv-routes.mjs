import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import * as protocol from '../lib/tv/protocol.ts'

let owner = null
let duringAnswer = null
const users = [
  { id: 'account-one', telegram_id: 101, whatsapp_id: 'one', access_status: 'active', name: 'One' },
  { id: 'account-two', telegram_id: 102, whatsapp_id: 'two', access_status: 'active', name: 'Two' },
]
const pairings = []
const reads = []
const id = '11111111-1111-1111-1111-111111111111'
const database = {
  from(table) {
    const rows = table === 'users' ? users : pairings
    const checks = []
    let updates
    const query = {
      eq(key, value) { checks.push(row => row[key] === value); return this },
      is(key, value) { return this.eq(key, value) },
      not(key, comparison, value) {
        assert.equal(comparison, 'is')
        checks.push(row => row[key] !== value)
        return this
      },
      gt(key, value) { checks.push(row => row[key] > value); return this },
      lte(key, value) { checks.push(row => row[key] <= value); return this },
      select() { return this },
      update(next) { updates = next; return this },
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
  async rpc(name, args) {
    if (name === 'tv_start_pairing') {
      pairings.push({
        id, code_hash: args.p_code_hash, token_hash: args.p_token_hash, scope: 'ask:read',
        owner_id: null, approved_at: null, expires_at: null, revoked_at: null,
        pair_expires_at: new Date(Date.now() + 600_000).toISOString(), next_request_at: new Date(0).toISOString(),
      })
      return { data: true, error: null }
    }
    assert.equal(name, 'tv_approve_pairing')
    const row = pairings.find(item => item.code_hash === args.p_code_hash && !item.owner_id && !item.revoked_at)
    if (!row) return { data: false, error: null }
    Object.assign(row, {
      owner_id: args.p_owner_id, approved_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 86400_000).toISOString(),
    })
    return { data: true, error: null }
  },
}

const dependencies = {
  'next/server': { NextResponse: Response },
  '@/lib/tv/protocol': protocol,
  '@/lib/supabase-admin': { supabaseAdmin: database },
  '@/lib/dashboard/session': { getSession: async () => owner },
  '@/lib/bot/memory-redaction': { redactSecretShapedText: text => text },
  '@/lib/tv/answer': { answerTvQuestion: async (ownerId, name, text) => {
    reads.push({ ownerId, name, text })
    if (duringAnswer) await duringAnswer()
    return 'Read-only result'
  } },
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
const account = load('../app/api/tv/account/route.ts')
const device = load('../app/api/tv/device/route.ts')
const ask = load('../app/api/tv/ask/route.ts')

const endpoint = 'https://preview.example.test'
function request(method, { token, body, origin = endpoint, native = true } = {}) {
  const headers = { host: 'preview.example.test', origin }
  if (native) headers['x-gogo-tv'] = '1'
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
await status(device.POST(request('POST', { native: false })), 400)
const { token, code } = await status(device.POST(request('POST')), 201)
assert.notEqual(pairings[0].token_hash, token)
assert.notEqual(pairings[0].code_hash, code)
assert.equal((await status(device.GET(request('GET', { token })), 200)).state, 'pending')
await status(ask.POST(request('POST', { token, body: { text: 'Show my calendar' } })), 401)
await status(account.POST(request('POST', { body: { action: 'approve', code } })), 401)
owner = { telegramId: '101' }
assert.equal((await account.POST(request('POST', { origin: 'https://different.example.test', body: { action: 'approve', code } }))).status, 403)
await status(account.POST(request('POST', { body: { action: 'approve', code } })), 200)
assert.equal((await status(device.GET(request('GET', { token })), 200)).state, 'paired')
owner = { telegramId: '102' }
await status(account.POST(request('POST', { body: { action: 'approve', code } })), 409)
assert.deepEqual((await status(account.GET(), 200)).devices, [])
await status(account.POST(request('POST', { body: { action: 'revoke', id } })), 200)
const question = { token, body: { owner: 'account-two', scope: 'write', text: 'What is on my calendar?' } }
assert.equal((await status(ask.POST(request('POST', question)), 200)).text, 'Read-only result')
assert.deepEqual(reads, [{ ownerId: '101', name: 'One', text: question.body.text }])
await status(ask.POST(request('POST', question)), 429)
pairings[0].next_request_at = new Date(0).toISOString()
await status(ask.POST(request('POST', { token, body: new Uint8Array(4000) })), 400)
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
console.log('TV routes passed with test dashboard, database, and provider adapters')
