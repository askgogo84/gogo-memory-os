// Test-only expected RED: execute the unchanged original phone-booking persistence function.
// All database writes are recorded by an in-memory fake. No providers, real accounts, sends,
// bookings, reminders, credentials, network, or external sharing are used.
// DO NOT MERGE or deploy this deliberately failing security regression.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync('lib/agent/voice-call.ts', 'utf8')
const ast = ts.createSourceFile('voice-call.ts', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS)
const originalDecl = ast.statements.find(node =>
  ts.isFunctionDeclaration(node) && node.name?.text === 'recordPhoneBooking')
assert.ok(originalDecl, 'original booking persistence function must exist')

const compiled = ts.transpileModule(originalDecl.getText(ast), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  reportDiagnostics: true,
})
assert.equal((compiled.diagnostics || []).filter(d =>
  d.category === ts.DiagnosticCategory.Error).length, 0)

let writes = []
const fakeDB = {
  from(table) {
    assert.ok(['life_events', 'reminders'].includes(table), 'unrelated table access forbidden')
    return {
      async upsert(record, options) {
        // No database operation: record only the exact arguments production code passed.
        writes.push({ table, record: structuredClone(record), options: structuredClone(options) })
        return { error: null }
      },
    }
  },
}
const context = {
  exports: {}, Date, Number, String, Error,
  supabaseAdmin: fakeDB,
  bookedStartAt: (plan, outcome) =>
    outcome?.booked && plan.validDate !== false ? '2099-07-31T18:00:00.000Z' : null,
  voiceAttemptId: (owner, meta, index) => 'fixture-reminder:' + owner + ':' + meta.createdAt + ':' + index,
}
vm.createContext(context, { codeGeneration: { strings: false, wasm: false } })
const original = vm.runInContext(compiled.outputText + '\n;recordPhoneBooking',
  context, { timeout: 1500, filename: 'original-voice-booking.vm.js' })
assert.equal(typeof original, 'function')

const plan = { venue: 'Fixture Bistro', partySize: 2, guestName: 'Synthetic Guest', validDate: true }
const outcome = { booked: true, staffName: 'Fixture Staff' }
const OWNER_A = '9007199254740992'
const OWNER_B = '9007199254740993'
assert.notEqual(OWNER_A, OWNER_B)
assert.equal(Number(OWNER_A), Number(OWNER_B), 'different 64-bit owners collide as JS Number')

async function invoke(owner, testPlan = plan, testOutcome = outcome) {
  writes = []
  const result = await original(owner, 'synthetic-exec-1', testPlan, testOutcome)
  return { result, events: writes.filter(w => w.table === 'life_events'),
    reminders: writes.filter(w => w.table === 'reminders'), all: [...writes] }
}

let passed = 0, failed = 0
async function check(name, action) {
  try { await action(); console.log('PASS ' + name); passed++ }
  catch (error) { console.error('REQUIRED SAFETY RED ' + name + ': ' +
    String(error?.message || error)); failed++ }
}

// Existing safe-owner behavior must stay intact.
await check('control: safe string owner 42 keeps both records owner-bound', async () => {
  const x = await invoke('42')
  assert.deepEqual([x.events.length, x.reminders.length], [1, 1])
  assert.equal(x.result.saved, true)
  assert.equal(x.result.reminderScheduled, true)
  assert.equal(String(x.events[0].record.telegram_id), '42')
  assert.equal(String(x.reminders[0].record.telegram_id), '42')
  assert.equal(String(x.reminders[0].record.chat_id), '42')
})
await check('control: safe numeric owner 43 keeps both records owner-bound', async () => {
  const x = await invoke(43)
  assert.deepEqual([x.events.length, x.reminders.length], [1, 1])
  assert.equal(String(x.reminders[0].record.telegram_id), '43')
})
await check('control: absent confirmed booking time creates no records', async () => {
  const x = await invoke('42', { ...plan, validDate: false })
  assert.equal(x.all.length, 0)
  assert.equal(x.result.saved, false)
  assert.equal(x.result.reminderScheduled, false)
})
await check('control: retained idempotency settings for both inserts', async () => {
  const x = await invoke('42')
  assert.equal(x.events[0].options.onConflict, 'telegram_id,dedupe_key')
  assert.equal(x.events[0].record.dedupe_key, 'voice_call:synthetic-exec-1')
  assert.equal(x.reminders[0].options.onConflict, 'id')
  assert.equal(x.reminders[0].options.ignoreDuplicates, true)
})

// Required safety properties deliberately fail on the current production implementation.
await check('P1: exact 64-bit owner B cannot get a reminder addressed to owner A', async () => {
  const x = await invoke(OWNER_B)
  assert.equal(x.events.length, 1)
  assert.equal(String(x.events[0].record.telegram_id), OWNER_B)
  // Accept a safe fail-closed implementation with no reminder, or exact owner identity.
  assert.ok(x.reminders.length === 0 ||
    (String(x.reminders[0].record.telegram_id) === OWNER_B &&
      String(x.reminders[0].record.chat_id) === OWNER_B),
    'booking for B wrote an A-addressed reminder (lossy numeric owner conversion)')
})
await check('P1: already-rounded unsafe numeric owner must not create ANY record', async () => {
  const x = await invoke(Number(OWNER_B))
  assert.equal(x.all.length, 0, 'ambiguous owner must fail closed before any write')
})
await check('P1: negative owner must not create any record', async () => {
  const x = await invoke(-42)
  assert.equal(x.all.length, 0)
})
await check('P1: fractional owner must not create any record', async () => {
  const x = await invoke(42.5)
  assert.equal(x.all.length, 0)
})
await check('P1: malformed text owner must not create any record', async () => {
  const x = await invoke('not-an-owner')
  assert.equal(x.all.length, 0)
})
await check('P1: zero/empty owner must not create any record', async () => {
  const x = await invoke('')
  assert.equal(x.all.length, 0)
})

console.log('Original voice booking: ' + passed + ' PASS / ' + failed +
  ' REQUIRED RED; original code executed against fake in-memory records only')
if (failed) process.exitCode = 1
