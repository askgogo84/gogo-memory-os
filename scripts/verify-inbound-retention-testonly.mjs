// TEST ONLY / EXPECTED SAFETY RED. Do not merge/deploy this diagnostic PR.
// Executes unchanged lib/email/inbound.ts::processInboundEmail in a fully inert VM.
// No user mail, WhatsApp, DB, network, credentials, or external provider calls.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const path = 'lib/email/inbound.ts'
const src = readFileSync(path, 'utf8')
const ast = ts.createSourceFile(path, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const node = ast.statements.find(x => ts.isFunctionDeclaration(x) && x.name?.text === 'processInboundEmail')
assert.ok(node, 'must execute the actual unchanged forwarded-mail handler')
assert.match(src, /inbound_emails'\)\.delete\(\)\.eq\('telegram_id', telegramId\)\.lt\('received_at'/,
  'original retention cleanup and its owner binding must be present')
const fnText = node.getText(ast).replace(/^export\s+/, '')
const js = ts.transpileModule(fnText, { fileName: path,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText
assert.match(js, /async function processInboundEmail\(/)

const ownerId = 271828
const now = Date.parse('2026-10-31T03:40:00.000Z')
const retentionCutoff = new Date(now - 30 * 86400_000).toISOString()

async function runCase({ kind = 'ordinary', cleanupError = false, cleanupThrows = false } = {}) {
  const queries = []
  const notifications = []
  const errors = []
  const db = {
    from(table) {
      assert.ok(['inbound_emails', 'email_aliases'].includes(table), 'unexpected DB table: ' + table)
      const q = { table, action: null, filters: [] }
      const chain = {
        upsert(row, options) { q.action = 'upsert'; q.row = row; q.options = options; queries.push(q); return chain },
        update(row) { q.action = 'update'; q.row = row; queries.push(q); return chain },
        delete() { q.action = 'delete'; queries.push(q); return chain },
        select(columns) { q.select = columns; return chain },
        eq(field, value) { q.filters.push(['eq', field, value]); return chain },
        lt(field, value) { q.filters.push(['lt', field, value]); return chain },
        then(resolve, reject) {
          let response = { data: null, error: null }
          if (table === 'inbound_emails' && q.action === 'upsert') {
            response = { data: kind === 'duplicate' ? [] : [{ id: 'synthetic-inbound-row' }], error: null }
          }
          if (table === 'inbound_emails' && q.action === 'delete') {
            if (cleanupThrows) return Promise.reject(new Error('synthetic cleanup rejection')).then(resolve, reject)
            if (cleanupError) response = { data: null, error: { message: 'synthetic cleanup rejection' } }
          }
          return Promise.resolve(response).then(resolve, reject)
        },
      }
      return chain
    },
  }
  const mail = {
    to: 'alias@test.invalid', from: 'sender@test.invalid', messageId: 'synthetic-message-id',
    references: '', inReplyTo: '', subject: 'Synthetic mail', text: 'No private mail content',
    headers: {}, listId: '', listUnsubscribe: '', autoSubmitted: '', precedence: '',
  }
  const sandbox = {
    supabaseAdmin: db,
    parseMail: () => mail,
    aliasFromAddress: address => (kind === 'unknown_alias' ? null : address === mail.to ? 'synthetic-alias' : null),
    ownerOfAlias: async alias => { assert.equal(alias, 'synthetic-alias'); return { telegramId: ownerId, confirmedAt: '2026-10-01T00:00:00Z' } },
    gmailForwardingConfirmation: () => kind === 'confirmation' ? { code: '123456', forwarder: null, link: null } : null,
    confirmationText: () => 'Synthetic confirmation, no real address',
    notify: async (...args) => { notifications.push(args); return false },
    previewText: text => text,
    threadKeyOf: () => 'synthetic-thread',
    clean: (value, limit = 500) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit),
    loadRules: async () => [],
    scoreEmail: () => ({ score: 0.1, category: 'other', picked: false }),
    PUSH_SCORE: 0.8,
    MAX_PUSHES_PER_DAY: 6,
    console: { error: (...args) => errors.push(['error', ...args]), warn: (...args) => errors.push(['warn', ...args]) },
  }
  // Only the actual function is transpiled. No application imports. No process, fetch,
  // require, credentials or network globals are passed to this isolated execution.
  runInNewContext(js + '\n;globalThis.__subject = processInboundEmail;', sandbox,
    { filename: path, timeout: 2000 })
  assert.equal(typeof sandbox.__subject, 'function')
  let result, thrown
  try { result = await sandbox.__subject({ to: mail.to, from: mail.from, raw: 'Synthetic only', now }) }
  catch (err) { thrown = err }
  return { result, thrown, queries, notifications, errors }
}

let controls = 0
let safetyPassed = 0
let safetyFailed = 0
async function control(name, scenario, check) {
  const got = await runCase(scenario)
  check(got)
  controls++
  console.log('CONTROL PASS:', name)
}
async function safety(name, scenario, check) {
  const got = await runCase(scenario)
  try { check(got); safetyPassed++; console.log('SAFETY PASS:', name) }
  catch (e) { safetyFailed++; console.log('SAFETY RED:', name, '-', e.message) }
}
const deletions = got => got.queries.filter(q => q.table === 'inbound_emails' && q.action === 'delete')
const verifyPurge = got => {
  const q = deletions(got)
  assert.equal(q.length, 1, 'all accepted inbox paths should enforce or schedule 30-day cleanup')
  assert.ok(q[0].filters.some(f => f[0] === 'eq' && f[1] === 'telegram_id' && f[2] === ownerId),
    'retention cleanup must remain bound to this exact owner')
  assert.ok(q[0].filters.some(f => f[0] === 'lt' && f[1] === 'received_at' && f[2] === retentionCutoff),
    'retention cutoff must be computed from event time exactly 30 days ago')
}

await control('valid newly forwarded low-priority mail purges only its own old records', {}, got => {
  assert.equal(got.result?.status, 'stored')
  assert.equal(got.notifications.length, 0)
  assert.equal(got.thrown, undefined)
  verifyPurge(got)
})
await control('unrecognized forwarding address fails closed without touching a database', { kind: 'unknown_alias' }, got => {
  assert.equal(got.result?.status, 'unknown_alias')
  assert.equal(got.queries.length, 0)
})

await safety('duplicate inbound message still enforces expired-mail retention', { kind: 'duplicate' }, got => {
  assert.equal(got.result?.status, 'duplicate')
  verifyPurge(got)
})
await safety('Gmail forwarding confirmation still enforces retention of private stored links and messages',
  { kind: 'confirmation' }, got => {
    assert.equal(got.result?.status, 'confirmation')
    verifyPurge(got)
  })
await safety('resolved database deletion error cannot be silently ignored', { cleanupError: true }, got => {
  assert.ok(got.thrown || got.errors.length > 0,
    'a retention error must be surfaced for auditable repair (error / warning / explicit failure)')
})
await safety('rejected retention deletion cannot be silently ignored', { cleanupThrows: true }, got => {
  assert.ok(got.thrown || got.errors.length > 0,
    'a rejected retention cleanup needs a visible repair signal, not an apparent normal completion')
})

console.log('INBOUND RETENTION SUMMARY: ' + controls + '/2 positive controls PASS; ' + safetyPassed + '/4 retention safety PASS; ' + safetyFailed + '/4 retention safety RED')
if (controls !== 2 || safetyPassed !== 4) {
  console.error('EXPECTED SAFETY RED: no merge/deploy. Source owner should implement independently reviewed TTL purge + observable failures, then pass this gate.')
  process.exitCode = 1
}
