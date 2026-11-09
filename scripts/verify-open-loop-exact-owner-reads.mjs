// P1 exact-owner service-role read regression. Exercises actual source functions with inert DB fixtures.
// No network, credentials, customer data, sends, or real account writes.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const path = 'lib/agent/open-loops.ts'
const source = readFileSync(path, 'utf8')
const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
function original(name, sandbox) {
  const node = file.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === name)
  assert.ok(node, 'missing original function ' + name)
  const compiled = ts.transpileModule(node.getText(file).replace(/^export\s+/, ''), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
    reportDiagnostics: true,
  })
  assert.equal((compiled.diagnostics || []).filter(x => x.category === ts.DiagnosticCategory.Error).length, 0)
  vm.runInNewContext(compiled.outputText + '\nthis.original = ' + name, sandbox, { timeout: 1000 })
  return { fn: sandbox.original, body: node.getText(file) }
}

const A = '9007199254740992'
const B = '9007199254740993'
assert.equal(String(Number(B)), A, 'fixtures must demonstrate a real JavaScript number collision')
const NOW = new Date().toISOString()
const meeting = title => ({
  id: title + '-memory', created_at: NOW,
  content: JSON.stringify({ type: 'followup_state', kind: 'meeting_action_items', payload: { items: [{ message: title }] } }),
})
const rows = {
  memories: {
    [A]: [meeting('PRIVATE OWNER A')],
    [B]: [meeting('Owner B action')],
  },
  user_consent_settings: {
    [A]: { memory_enabled: false },
    [B]: { memory_enabled: true },
  },
  conversations: {
    [A]: [{ id: 'owner-a-conversation', content: 'Owner A private follow up', created_at: NOW }],
    [B]: [{ id: 'owner-b-conversation', content: 'Owner B follow up', created_at: NOW }],
  },
  users: {
    [A]: { google_calendar_connected: false },
    [B]: { google_calendar_connected: false },
  },
}
function fakeDB() {
  const queries = []
  return {
    queries,
    from(table) {
      let owner = null
      const q = {
        select() { return q },
        eq(field, value) {
          if (field === 'telegram_id') {
            owner = value
            queries.push({ table, owner: value })
          }
          return q
        },
        gte() { return q }, lte() { return q }, order() { return q }, in() { return q },
        limit() { return Promise.resolve({ data: rows[table]?.[owner] || [], error: null }) },
        maybeSingle() { return Promise.resolve({ data: rows[table]?.[owner] || null, error: null }) },
      }
      return q
    },
  }
}
function harness() {
  const db = fakeDB(), created = []
  return {
    db, created, sandbox: {
      Date, Promise, String, Number, Error, Set, BigInt,
      supabaseAdmin: db,
      clean: text => String(text ?? '').trim(),
      isoPlusHoursFrom: () => NOW,
      parseExplicitOpenLoop: text => ({
        kind: 'followup', title: String(text), summary: String(text), priority: 0.86,
      }),
      upsertOpenLoop: async input => { created.push(input); return { id: 'synthetic' } },
    },
  }
}
let passed = 0
async function check(title, work) {
  await work()
  console.log('PASS ' + title)
  passed++
}
await check('original meeting-memory scan reads only exact owner B, never rounded owner A', async () => {
  const h = harness()
  const { fn, body } = original('syncMeetingActionMemories', h.sandbox)
  assert.match(body, /\.eq\('telegram_id',telegramId\)/)
  const n = await fn(B)
  assert.equal(n, 1)
  assert.equal(h.db.queries.find(q => q.table === 'memories')?.owner, B)
  assert.equal(h.created.length, 1)
  assert.equal(h.created[0].telegramId, B)
  assert.equal(h.created[0].title, 'Owner B action')
  assert.ok(!h.created.some(x => x.summary.includes('PRIVATE OWNER A')))
})
await check('original conversation scan evaluates B consent and B messages, not collided A consent', async () => {
  const h = harness()
  const { fn, body } = original('syncConversationSignals', h.sandbox)
  assert.equal([...body.matchAll(/\.eq\('telegram_id',telegramId\)/g)].length, 2)
  assert.equal(await fn(B), 1, 'B is consented even though A is explicitly off')
  assert.deepEqual(h.db.queries.map(q => [q.table, q.owner]), [
    ['user_consent_settings', B],
    ['conversations', B],
  ])
  assert.equal(h.created.length, 1)
  assert.equal(h.created[0].telegramId, B)
  assert.equal(h.created[0].title, 'Owner B follow up')
})
await check('consent false for owner A still suppresses only owner A', async () => {
  const h = harness()
  const { fn } = original('syncConversationSignals', h.sandbox)
  assert.equal(await fn(A), 0)
  assert.equal(h.created.length, 0)
  assert.deepEqual(h.db.queries.map(q => [q.table, q.owner]), [['user_consent_settings', A]])
})
await check('calendar user and ticket DB filters use exact owner without Number() coercion', async () => {
  const h = harness()
  const { fn, body } = original('syncCalendarConflicts', h.sandbox)
  assert.equal([...body.matchAll(/\.eq\('telegram_id',telegramId\)/g)].length, 2)
  assert.doesNotMatch(body, /Number\(\s*telegramId\s*\)/)
  await assert.rejects(() => fn(B, new Set()), /skip:calendar_not_connected/)
  assert.equal(h.db.queries.find(q => q.table === 'users')?.owner, B)
})
await check('the public scout fails closed on unsafe numeric or malformed owner identities', async () => {
  const h = harness()
  const { fn, body } = original('syncOpenLoopsForUser', h.sandbox)
  assert.match(body, /Number\.isSafeInteger\(telegramId\)/)
  await assert.rejects(() => fn(Number(B)), /owner_invalid:unsafe_number/)
  await assert.rejects(() => fn('owner-unknown'), /owner_invalid:format/)
  assert.equal(h.db.queries.length, 0, 'invalid IDs must not touch any provider')
})
await check('all five owner-bound source queries preserve original decimal strings', async () => {
  const signatures = ['syncMeetingActionMemories', 'syncConversationSignals', 'syncCalendarConflicts']
  const h = harness()
  let total = 0
  for (const name of signatures) {
    const { body } = original(name, h.sandbox)
    assert.doesNotMatch(body, /\.eq\(\s*'telegram_id'\s*,\s*Number\(\s*telegramId\s*\)\s*\)/)
    total += [...body.matchAll(/\.eq\('telegram_id',telegramId\)/g)].length
  }
  assert.equal(total, 5)
})
console.log('OPEN_LOOP_EXACT_OWNER: PASS=' + passed + ' FAIL=0')
