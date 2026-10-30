// TEST-ONLY, EXPECTED SECURITY RED until approved-browser actor binding is corrected.
// This executes the shipped approved-browser worker, with all external modules substituted by
// synthetic, in-memory fixtures. No credentials, real providers, DB, network or customers.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const OWNER_A = '9007199254740992'
const OWNER_B = '9007199254740993'
const SAFE_OWNER = '123456789'
const RUN_ID = 'synthetic-approved-browser-run'
assert.equal(Number(OWNER_A), Number(OWNER_B), 'fixture requires a lossy 64-bit conversion')

type User = { id: string; telegram_id: string; whatsapp_id: string; name: string }
const person = (key: string, telegram_id: string): User => ({
  id: 'synthetic-user-' + key,
  telegram_id,
  whatsapp_id: 'whatsapp:+1555000000' + (key === 'A' ? '1' : key === 'B' ? '2' : '3'),
  name: 'Synthetic ' + key,
})
type Clauses = { column: string; value: unknown }[]
type Observation = {
  lookup: Array<{ table: string; column: string; value: unknown }>
  approvedLookup: Clauses[]
  browserActors: Array<Record<string, unknown>>
  whatsapp: Array<{ to: string; text: string }>
  conversations: Array<Record<string, unknown>>
  runUpdates: Array<Record<string, unknown>>
}

function fixture(input: {
  runOwner?: string
  approvalOwner?: string | null
  users?: Map<string, User>
  status?: string
  mode?: string
} = {}) {
  const runOwner = input.runOwner || SAFE_OWNER
  const users = input.users ?? new Map([[SAFE_OWNER, person('SAFE', SAFE_OWNER)]])
  const approvedOwner = input.approvalOwner === undefined ? runOwner : input.approvalOwner
  const obs: Observation = {
    lookup: [], approvedLookup: [], browserActors: [], whatsapp: [], conversations: [], runUpdates: [],
  }
  const run = {
    id: RUN_ID, telegram_id: runOwner, type: 'secure_browser',
    status: input.status || 'queued',
    metadata_json: { plan_type: 'secure_browser', mode: input.mode || 'execute' },
  }
  const db = {
    from(table: string) {
      if (!['users', 'agent_runs', 'agent_approvals', 'conversations'].includes(table)) {
        throw Error('BLOCKED external table ' + table)
      }
      let action: 'select' | 'update' = 'select'
      let updated: Record<string, unknown> | null = null
      const clauses: Clauses = []
      const q = {
        select(_columns: string) { return this },
        update(payload: Record<string, unknown>) {
          action = 'update'
          updated = payload
          obs.runUpdates.push(payload)
          return this
        },
        eq(column: string, value: unknown) {
          clauses.push({ column, value })
          if (table === 'users') obs.lookup.push({ table, column, value })
          return this
        },
        limit(_n: number) { return this },
        async maybeSingle() {
          const match = (col: string, val: unknown) => clauses.some(c => c.column === col && String(c.value) === String(val))
          if (table === 'users') {
            const identity = clauses.find(c => c.column === 'telegram_id')
            assert.ok(identity, 'users query must bind telegram_id')
            return { data: users.get(String(identity.value)) || null, error: null }
          }
          if (table === 'agent_approvals') {
            obs.approvedLookup.push([...clauses])
            return { data: approvedOwner !== null && match('run_id', RUN_ID)
              && match('telegram_id', approvedOwner) && match('status', 'approved')
              ? { id: 'synthetic-approved-row' } : null, error: null }
          }
          if (table === 'agent_runs') {
            if (action === 'update') {
              // Pure in-memory claim acknowledgement, not a database mutation.
              return { data: match('id', RUN_ID) && match('telegram_id', runOwner)
                ? { id: RUN_ID } : null, error: null }
            }
            return { data: match('id', RUN_ID) ? run : null, error: null }
          }
          throw Error('unexpected maybeSingle on ' + table)
        },
        async insert(payload: Record<string, unknown>) {
          assert.equal(table, 'conversations', 'only fake conversation inserts are permitted')
          obs.conversations.push(payload)
          return { error: null }
        },
      }
      return q
    },
  }

  const external: Record<string, unknown> = {
    '@/lib/supabase-admin': { supabaseAdmin: db },
    '@/lib/whatsapp': {
      async sendWhatsApp(to: string, text: string) { obs.whatsapp.push({ to, text }) },
    },
    './browser-command': {
      async executeApprovedBrowserCommand({ actor }: { actor: Record<string, unknown> }) {
        obs.browserActors.push(actor)
        return { status: 'completed', text: 'synthetic execution only' }
      },
      async resumePausedBrowserRun() { throw Error('BLOCKED background browser operation') },
    },
    './policy': { evaluateAgentExecutionPolicy() { throw Error('BLOCKED policy execution') } },
  }
  const source = readFileSync('lib/agent/approved-browser-worker.ts', 'utf8')
  const compiled = ts.transpileModule(source, {
    fileName: 'lib/agent/approved-browser-worker.ts', reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  })
  const errors = (compiled.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error)
  assert.equal(errors.length, 0, 'original deployed worker must compile')
  const mod = { exports: {} as Record<string, any> }
  const sandbox = {
    module: mod, exports: mod.exports, Date, URL, console, process: { env: {} },
    fetch() { throw Error('BLOCKED external HTTP request') },
    require(name: string) {
      if (!Object.prototype.hasOwnProperty.call(external, name)) throw Error('BLOCKED import ' + name)
      return external[name]
    },
  }
  runInNewContext(compiled.outputText, sandbox, {
    filename: 'lib/agent/approved-browser-worker.ts', timeout: 2000,
  })
  assert.equal(typeof mod.exports.actorForTelegramId, 'function')
  assert.equal(typeof mod.exports.runApprovedBrowserRun, 'function')
  return { functions: mod.exports, obs, run, updated }
}

let controls = 0
let passedSafety = 0
let failedSafety = 0
async function control(name: string, fn: () => Promise<void>) {
  await fn()
  controls++
  console.log('PASS CONTROL: ' + name)
}
async function safety(name: string, fn: () => Promise<void>) {
  try {
    await fn()
    passedSafety++
    console.log('PASS SAFETY: ' + name)
  } catch (err: any) {
    failedSafety++
    console.error('FAIL SAFETY (expected until fixed): ' + name + ': ' + String(err?.message || err))
  }
}
function twoOwners() {
  return fixture({ runOwner: OWNER_B, approvalOwner: OWNER_B,
    users: new Map([[OWNER_A, person('A', OWNER_A)], [OWNER_B, person('B', OWNER_B)]]) })
}

await control('normal safe-integer owner resolves exact actor', async () => {
  const h = fixture()
  const actor = await h.functions.actorForTelegramId(SAFE_OWNER)
  assert.equal(actor?.userId, 'synthetic-user-SAFE')
  assert.equal(actor?.whatsappId, person('SAFE', SAFE_OWNER).whatsapp_id)
  assert.equal(actor?.legacyTelegramId, Number(SAFE_OWNER))
})
await control('normal approved run executes under the exact permitted owner', async () => {
  const h = fixture()
  assert.equal(await h.functions.runApprovedBrowserRun(RUN_ID), 'completed')
  assert.equal(h.obs.browserActors.length, 1)
  assert.equal(h.obs.browserActors[0].userId, 'synthetic-user-SAFE')
  assert.equal(h.obs.whatsapp.length, 1)
  assert.equal(h.obs.whatsapp[0].to, person('SAFE', SAFE_OWNER).whatsapp_id)
  assert.equal(h.obs.conversations.length, 1)
})
await control('a run with no matching approval cannot execute any browser command', async () => {
  const h = fixture({ approvalOwner: null })
  assert.equal(await h.functions.runApprovedBrowserRun(RUN_ID), 'skipped')
  assert.equal(h.obs.browserActors.length, 0)
  assert.equal(h.obs.whatsapp.length, 0)
})
await control('a nonqueued run never executes', async () => {
  const h = fixture({ status: 'completed' })
  assert.equal(await h.functions.runApprovedBrowserRun(RUN_ID), 'skipped')
  assert.equal(h.obs.browserActors.length, 0)
})
await control('an absent user cannot execute an approved browser task', async () => {
  const h = fixture({ users: new Map() })
  assert.equal(await h.functions.runApprovedBrowserRun(RUN_ID), 'failed')
  assert.equal(h.obs.browserActors.length, 0)
  assert.equal(h.obs.whatsapp.length, 0)
})

await safety('P1: direct 64-bit actor resolution must not return a different owner', async () => {
  const h = twoOwners()
  const actor = await h.functions.actorForTelegramId(OWNER_B)
  assert.ok(!actor || actor.userId === 'synthetic-user-B',
    'requesting owner B resolved owner A actor: ' + String(actor?.userId))
  if (actor) {
    assert.ok(typeof actor.legacyTelegramId !== 'number' || Number.isSafeInteger(actor.legacyTelegramId),
      'legacy actor identity must not be a rounded unsafe number')
  }
})
await safety('P1: exact approval for owner B must not run browser with owner A identity', async () => {
  const h = twoOwners()
  await h.functions.runApprovedBrowserRun(RUN_ID)
  assert.ok(!h.obs.browserActors.some(a => a.userId === 'synthetic-user-A'),
    'synthetic owner B approved run executed as owner A')
  assert.ok(h.obs.browserActors.every(a => a.userId === 'synthetic-user-B'),
    'approved execution must retain owner B identity')
})
await safety('P1: approved browser result must never notify another owner WhatsApp', async () => {
  const h = twoOwners()
  await h.functions.runApprovedBrowserRun(RUN_ID)
  assert.ok(!h.obs.whatsapp.some(m => m.to === person('A', OWNER_A).whatsapp_id),
    'synthetic owner B outcome notified owner A')
})
await safety('P1: approved browser result cannot write conversation as the wrong owner', async () => {
  const h = twoOwners()
  await h.functions.runApprovedBrowserRun(RUN_ID)
  assert.ok(!h.obs.conversations.some(c => String(c.telegram_id) === OWNER_A),
    'owner B browser outcome wrote a conversation under owner A decimal id')
})

console.log('CONTROLS=' + controls + ' SAFETY_PASS=' + passedSafety + ' SAFETY_FAIL=' + failedSafety)
if (failedSafety) process.exitCode = 1
