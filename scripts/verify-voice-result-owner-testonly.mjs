// TEST ONLY / EXPECTED SECURITY RED / DO NOT MERGE OR DEPLOY.
// Execute the ORIGINAL unchanged processVoiceCalls function from current repo source,
// using only synthetic account rows, fake Supabase query objects and intercepted sends.
// No network, provider calls, actual messages, accounts, call placements or credentials.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync('lib/agent/voice-call.ts', 'utf8')
const ast = ts.createSourceFile('voice-call.ts', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS)
const originalDecl = ast.statements.find(n =>
  ts.isFunctionDeclaration(n) && n.name?.text === 'processVoiceCalls')
assert.ok(originalDecl, 'the original processVoiceCalls implementation must exist')
const compiled = ts.transpileModule(originalDecl.getText(ast), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  reportDiagnostics: true,
})
assert.equal((compiled.diagnostics || []).filter(d =>
  d.category === ts.DiagnosticCategory.Error).length, 0)

const OWNER_A = '9007199254740992'
const OWNER_B = '9007199254740993'
assert.notEqual(OWNER_A, OWNER_B)
assert.equal(Number(OWNER_A), Number(OWNER_B), 'two different BIGINT owners collide in Number')
const WA_A = '15550101001'
const WA_B = '15550202002'
const users = [
  { telegram_id: '42', whatsapp_id: '15550000042' },
  { telegram_id: '43', whatsapp_id: '15550000043' },
  { telegram_id: OWNER_A, whatsapp_id: WA_A },
  { telegram_id: OWNER_B, whatsapp_id: WA_B },
]

async function simulate(owner, options = {}) {
  const ledger = { userQueries: [], conversations: [], sends: [], updates: [], providerReads: 0 }
  const run = {
    id: 'synthetic-voice-result-run',
    telegram_id: owner,
    started_at: new Date().toISOString(),
    metadata_json: {
      execution_id: options.missingExecution ? undefined : 'synthetic-execution',
      plan: { venue: 'Fixture Cafe', partySize: 2, dateLabel: 'tomorrow',
        timeLabel: '8pm', test: false, redials: 0 },
    },
  }

  // Chained query recorder; it intentionally mimics exact BIGINT-string matching.
  // A JS Number passed to .eq is stringified, just as a SQL filter parameter is.
  const fakeDB = {
    from(table) {
      assert.ok(['agent_runs', 'users', 'conversations'].includes(table),
        'unexpected database table; test must not perform real DB operations')
      const predicates = []
      const query = {
        select() { return this },
        eq(column, value) {
          predicates.push({ column, value })
          if (table === 'users' && column === 'telegram_id')
            ledger.userQueries.push(value)
          return this
        },
        is() { return this },
        update(payload) {
          assert.equal(table, 'agent_runs')
          ledger.updates.push(structuredClone(payload))
          return this
        },
        limit() {
          assert.equal(table, 'agent_runs')
          return Promise.resolve({ data: [run], error: null })
        },
        maybeSingle() {
          if (table === 'agent_runs')
            return Promise.resolve({ data: { id: run.id }, error: null })
          assert.equal(table, 'users')
          const ownerFilter = predicates.find(p => p.column === 'telegram_id')
          const row = ownerFilter
            ? users.find(u => u.telegram_id === String(ownerFilter.value))
            : undefined
          return Promise.resolve({ data: row || null, error: null })
        },
        insert(row) {
          assert.equal(table, 'conversations')
          ledger.conversations.push(structuredClone(row))
          return Promise.resolve({ error: null })
        },
      }
      return query
    },
  }

  const context = {
    exports: {}, Date, Number, String, Error, Math, Set,
    supabaseAdmin: fakeDB,
    TERMINAL: new Set(['completed', 'failed', 'no-answer']),
    randomUUID: () => 'synthetic-claim-id',
    getExecution: async executionId => {
      assert.equal(executionId, 'synthetic-execution')
      ledger.providerReads++
      // Simulated terminal failure: avoids any model, booking or provider operations.
      return { status: options.executionStatus || 'failed', transcript: '' }
    },
    callResultText: (plan, status) => 'Synthetic call result for ' + plan.venue + ': ' + status,
    // No model, email, WhatsApp, network or real Supabase dependencies in this VM.
  }
  vm.createContext(context, { codeGeneration: { strings: false, wasm: false } })
  const original = vm.runInContext(compiled.outputText + '\n;processVoiceCalls',
    context, { timeout: 1500, filename: 'original-process-voice-calls.vm.js' })
  assert.equal(typeof original, 'function')
  ledger.done = await original({
    send: async (to, message) => {
      ledger.sends.push({ to, message })
      return { accepted: true } // fake acceptance, NEVER a provider send
    },
  })
  return ledger
}

let passed = 0
let failed = 0
async function check(name, fn) {
  try { await fn(); console.log('PASS ' + name); passed++ }
  catch (e) {
    console.error('REQUIRED SAFETY RED ' + name + ': ' + String(e?.message || e))
    failed++
  }
}

// Positive controls protect existing safe routing and unknown-outcome semantics.
await check('control: safe string owner 42 receives only own result', async () => {
  const x = await simulate('42')
  assert.equal(x.done, 1)
  assert.equal(x.providerReads, 1)
  assert.equal(x.sends.length, 1)
  assert.equal(x.sends[0].to, '15550000042')
  assert.equal(x.conversations.length, 1)
  assert.equal(String(x.conversations[0].telegram_id), '42')
})
await check('control: safe numeric owner 43 receives only own result', async () => {
  const x = await simulate(43)
  assert.equal(x.done, 1)
  assert.equal(x.sends.length, 1)
  assert.equal(x.sends[0].to, '15550000043')
  assert.equal(String(x.conversations[0].telegram_id), '43')
})
await check('control: no execution ID never sends a result or retries provider', async () => {
  const x = await simulate('42', { missingExecution: true })
  assert.equal(x.done, 0)
  assert.equal(x.providerReads, 0)
  assert.equal(x.sends.length, 0)
  assert.equal(x.conversations.length, 0)
  assert.ok(x.updates.some(u => u.status === 'outcome_unknown'))
})
await check('control: unfinished recent call never sends a completion', async () => {
  const x = await simulate('42', { executionStatus: 'running' })
  assert.equal(x.done, 0)
  assert.equal(x.providerReads, 1)
  assert.equal(x.sends.length, 0)
  assert.equal(x.conversations.length, 0)
})

// All below are required fail-closed/exact-owner safety properties. RED is
// expected until separately reviewed application-source remediation is shipped.
await check('P1: B terminal result cannot be sent to unrelated owner A', async () => {
  const x = await simulate(OWNER_B)
  assert.ok(x.sends.every(s => s.to !== WA_A),
    'owner B result sent to synthetic WhatsApp identity A')
  assert.ok(x.sends.length === 0 || x.sends.every(s => s.to === WA_B))
})
await check('P1: B terminal result cannot enter unrelated owner A conversation', async () => {
  const x = await simulate(OWNER_B)
  assert.ok(x.conversations.every(row => String(row.telegram_id) === OWNER_B),
    'owner B result inserted as owner A due to lossy Number conversion')
})
await check('P1: already-rounded unsafe numeric owner cannot finalize/send/write', async () => {
  const x = await simulate(Number(OWNER_B))
  assert.equal(x.sends.length, 0)
  assert.equal(x.conversations.length, 0)
  assert.equal(x.userQueries.length, 0)
})
await check('P1: negative owner cannot look up recipient or write a conversation', async () => {
  const x = await simulate('-42')
  assert.equal(x.userQueries.length, 0)
  assert.equal(x.conversations.length, 0)
})
await check('P1: fractional owner cannot look up recipient or write a conversation', async () => {
  const x = await simulate('42.5')
  assert.equal(x.userQueries.length, 0)
  assert.equal(x.conversations.length, 0)
})
await check('P1: malformed owner cannot look up recipient or write a conversation', async () => {
  const x = await simulate('owner-bad')
  assert.equal(x.userQueries.length, 0)
  assert.equal(x.conversations.length, 0)
})
await check('P1: empty owner cannot look up recipient or write a conversation', async () => {
  const x = await simulate('')
  assert.equal(x.userQueries.length, 0)
  assert.equal(x.conversations.length, 0)
})

console.log('Unmodified processVoiceCalls: ' + passed + ' PASS / ' + failed +
  ' REQUIRED RED; synthetic in-memory records/intercepted sends ONLY')
if (failed) process.exitCode = 1
