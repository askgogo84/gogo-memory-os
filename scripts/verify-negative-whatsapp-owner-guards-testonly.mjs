// TEST ONLY: execute unchanged owner-handling functions with fictional sealed fixtures.
// No network, production Supabase, real OAuth, provider calls, messages or customer data.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

function actualFunction(path, name, globals = {}) {
  const source = readFileSync(path, 'utf8')
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const decl = ast.statements.find(node =>
    ts.isFunctionDeclaration(node) && node.name?.text === name)
  assert.ok(decl?.body, 'unchanged actual function not found: ' + path + '::' + name)
  const code = ts.transpileModule(decl.getText(ast).replace(/^export\s+/, ''), {
    fileName: path,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  const context = {
    Number, String, BigInt, Buffer, Date, Promise, Set, Error,
    console: { error() {}, log() {} },
    ...globals,
  }
  return vm.runInNewContext(code + '\n' + name, context, {
    filename: path, timeout: 2500,
  })
}

const NEG = -2251799813685248 // deterministic value from WhatsApp owner allocator
const GOOD = 42
const UNSAFE = 9007199254740994
const uuid = 'uuid-fictional-owner'
const phone = 'whatsapp:+919876543210'
function dbFixture(owner, { voice = false } = {}) {
  const queries = [], updates = [], inserts = []
  const run = {
    id: 'synthetic-run-1', telegram_id: owner,
    metadata_json: {
      execution_id: 'synthetic-execution', plan: {
        test: true, venue: 'Fictional Bistro', partySize: 2,
        dateLabel: 'Tomorrow', timeLabel: '8 pm',
      },
    },
    started_at: new Date().toISOString(),
  }
  function queryResult(q) {
    if (q.operation === 'update') return { data: { id: run.id }, error: null }
    if (q.table === 'agent_runs') return { data: voice ? [run] : [], error: null }
    const ownerFilter = q.filters.find(f => f.field === 'telegram_id')
    const matched = ownerFilter && String(ownerFilter.value) === String(owner)
    if (q.table === 'users')
      return { data: matched ? {
        id: uuid, telegram_id: owner, whatsapp_id: phone,
        name: 'Fictional Owner', email: 'fictional@example.invalid',
        gmail_connected: true,
        gmail_access_token: 'fictional-access-token',
        gmail_refresh_token: 'fictional-refresh-token',
      } : null, error: null }
    if (q.table === 'memories')
      return { data: matched ? [{ content: 'I prefer an aisle seat.' }] : [], error: null }
    if (q.table === 'user_preferences') return { data: [], error: null }
    throw new Error('unexpected table: ' + q.table)
  }
  const supabaseAdmin = { from(table) {
    const q = {
      table, operation: 'select', filters: [],
      select(fields) { this.fields = fields; return this },
      eq(field, value) { this.filters.push({ field, value }); queries.push({ table, field, value }); return this },
      is(field, value) { this.filters.push({ field, value }); return this },
      order() { return this },
      limit() { return this },
      gte() { return this },
      ilike() { return this },
      update(patch) { this.operation = 'update'; updates.push({ table, patch }); return this },
      insert(record) { inserts.push({ table, record }); return Promise.resolve({ error: null }) },
      maybeSingle() { return Promise.resolve(queryResult(this)) },
      then(resolve, reject) { return Promise.resolve(queryResult(this)).then(resolve, reject) },
    }
    return q
  } }
  return { supabaseAdmin, queries, updates, inserts, run }
}

const drivePath = 'lib/agent/google-workspace-drive-binary.ts'
const flightPath = 'lib/agent/flight-booking.ts'
const voicePath = 'lib/agent/voice-call.ts'
const ownerPath = 'lib/dashboard/owner-identity.ts'

function actor(owner) {
  return { userId: uuid, legacyTelegramId: owner, whatsappId: phone, name: 'Fictional Owner' }
}
async function driveRead(owner) {
  const db = dbFixture(owner)
  const fn = actualFunction(drivePath, 'credentials', {
    supabaseAdmin: db.supabaseAdmin,
    decryptGoogleToken: value => value,
  })
  let data = null, error = null
  try { data = await fn(actor(owner)) } catch (err) { error = err }
  return { ...db, data, error }
}
async function driveRefresh(owner) {
  const db = dbFixture(owner)
  const fn = actualFunction(drivePath, 'refresh', {
    supabaseAdmin: db.supabaseAdmin,
    refreshGmailAccessToken: async () => 'fictional-refreshed-access',
    encryptGoogleToken: value => 'fictional-encrypted-' + value,
  })
  return { ...db, token: await fn(actor(owner), 'fictional-refresh') }
}
async function flightRead(owner) {
  const db = dbFixture(owner)
  const fn = actualFunction(flightPath, 'loadKnownDetails', {
    supabaseAdmin: db.supabaseAdmin,
    seatFromPreference: () => 'aisle',
  })
  return { ...db, details: await fn(actor(owner)) }
}
async function voiceProcess(owner) {
  const db = dbFixture(owner, { voice: true })
  const sends = [], polls = []
  const fn = actualFunction(voicePath, 'processVoiceCalls', {
    supabaseAdmin: db.supabaseAdmin,
    TERMINAL: new Set(['completed', 'failed']),
    getExecution: async id => { polls.push(id); return { status: 'failed', transcript: '' } },
    randomUUID: () => 'synthetic-claim',
    callResultText: () => 'Synthetic terminal call result; no booking made.',
  })
  const processed = await fn({
    send: async (to, message) => { sends.push({ to, message }); return { sid: 'synthetic-intercepted' } },
  })
  return { ...db, processed, sends, polls }
}

let controlsPass = 0, controlsFail = 0, mandatoryPass = 0, mandatoryFail = 0
async function check(group, name, test) {
  try {
    await test()
    if (group === 'control') controlsPass++
    else mandatoryPass++
    console.log('PASS ' + group + ': ' + name)
  } catch (err) {
    if (group === 'control') controlsFail++
    else mandatoryFail++
    console.error('FAIL ' + group + ': ' + name + ': ' + String(err?.message || err).slice(0, 250))
  }
}

await check('control', 'real WhatsApp allocator produces safe negative ID', async () => {
  const allocate = actualFunction(ownerPath, 'allocateWhatsAppOwnerId', {
    randomBytes: () => Buffer.alloc(7),
  })
  const id = allocate(new Uint8Array(7))
  assert.equal(id, NEG)
  assert.ok(Number.isSafeInteger(id))
  assert.ok(id < 0)
})
await check('control', 'positive owner reads fictional Drive token row', async () => {
  const r = await driveRead(GOOD)
  assert.ifError(r.error)
  assert.equal(r.data.gmail_access_token, 'fictional-access-token')
  assert.ok(r.queries.some(q => q.table === 'users' && q.field === 'telegram_id' && q.value === GOOD))
})
await check('control', 'positive owner resolves fictional saved flight profile', async () => {
  const r = await flightRead(GOOD)
  assert.equal(r.details?.name, 'Fictional Owner')
  assert.equal(r.details?.seat, 'aisle')
  assert.ok(r.queries.some(q => q.table === 'users' && q.value === GOOD))
})
await check('control', 'positive owner terminal voice outcome uses only intercepted send', async () => {
  const r = await voiceProcess(GOOD)
  assert.equal(r.processed, 1)
  assert.equal(r.polls.length, 1)
  assert.equal(r.sends.length, 1)
  assert.equal(r.sends[0].to, phone)
})
await check('control', 'unsafe rounded Drive owner fails closed before any read', async () => {
  const db = dbFixture(GOOD)
  const fn = actualFunction(drivePath, 'credentials', {
    supabaseAdmin: db.supabaseAdmin, decryptGoogleToken: x => x,
  })
  await assert.rejects(fn(actor(UNSAFE)))
  assert.equal(db.queries.length, 0)
})
await check('control', 'unsafe rounded flight owner fails closed before any read', async () => {
  const r = await flightRead(UNSAFE)
  assert.equal(r.details, null)
  assert.equal(r.queries.length, 0)
})
await check('control', 'unsafe voice owner parks as outcome unknown without provider poll or send', async () => {
  const r = await voiceProcess(UNSAFE)
  assert.equal(r.processed, 0)
  assert.equal(r.polls.length, 0)
  assert.equal(r.sends.length, 0)
  assert.ok(r.updates.some(u => u.table === 'agent_runs' && u.patch.status === 'outcome_unknown'))
})
await check('control', 'positive owner refresh persists only to matching user row', async () => {
  const r = await driveRefresh(GOOD)
  assert.equal(r.token, 'fictional-refreshed-access')
  assert.ok(r.updates.some(u => u.table === 'users' && u.patch.gmail_access_token ===
    'fictional-encrypted-fictional-refreshed-access'))
  assert.ok(r.queries.some(q => q.table === 'users' && q.value === GOOD))
})

// These MUST pass on a corrected literal source SHA before a security release.
// The allocator produces NEG, which is a valid distinct, safe, owner-bound integer.
await check('mandatory', 'valid negative WhatsApp owner can read its own fake Drive credentials', async () => {
  const r = await driveRead(NEG)
  assert.ifError(r.error)
  assert.equal(r.data?.gmail_access_token, 'fictional-access-token')
  assert.ok(r.queries.some(q => q.table === 'users' && String(q.value) === String(NEG)))
})
await check('mandatory', 'valid negative owner can read its own saved flight context', async () => {
  const r = await flightRead(NEG)
  assert.equal(r.details?.name, 'Fictional Owner')
  assert.ok(r.queries.some(q => q.table === 'users' && String(q.value) === String(NEG)))
})
await check('mandatory', 'valid negative owner voice-result worker does not misclassify as invalid', async () => {
  const r = await voiceProcess(NEG)
  assert.equal(r.processed, 1)
  assert.equal(r.polls.length, 1)
  assert.equal(r.sends.length, 1)
  assert.equal(r.sends[0].to, phone)
  assert.equal(r.updates.some(u => u.patch.owner_invalid === true), false)
})
await check('mandatory', 'valid negative owner Drive refresh persists to same verified owner', async () => {
  const r = await driveRefresh(NEG)
  assert.ok(r.updates.some(u => u.table === 'users' && u.patch.gmail_access_token ===
    'fictional-encrypted-fictional-refreshed-access'))
  assert.ok(r.queries.some(q => q.table === 'users' && String(q.value) === String(NEG)))
})

console.log('RESULT controls_pass=' + controlsPass + '/8 controls_fail=' + controlsFail +
  ' mandatory_pass=' + mandatoryPass + '/4 mandatory_fail=' + mandatoryFail)
if (controlsFail) process.exit(2)
if (mandatoryFail) process.exit(1)
