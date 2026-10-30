// TEST ONLY: original-source synthetic Make owner-binding regression.
// EXPECTED SECURITY RED. Never merge or deploy this deliberately failing PR.
// No network, model call, provider send, production database, credential or real account.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const originalSource = readFileSync('lib/make/store.ts', 'utf8')
assert.match(originalSource, /export async function handleMakeDoc\s*\(/,
  'the unchanged application entry point must exist')
const emitted = ts.transpileModule(originalSource, {
  fileName: 'lib/make/store.ts',
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  reportDiagnostics: true,
})
assert.equal((emitted.diagnostics || []).filter(
  d => d.category === ts.DiagnosticCategory.Error).length, 0,
  'test must compile original application module, not a rewritten imitation')

const A = '9007199254740992'
const B = '9007199254740993'
assert.notEqual(A, B)
assert.equal(Number(A), Number(B), 'distinct signed64 owners alias through Number')

const fakeDocument = Object.freeze({
  format: 'deck',
  title: 'Fixture confidential B-authored deck',
  slides: [{ title: 'Synthetic private owner content', body: 'NO REAL USER DATA' }],
})

async function simulate({
  userId,
  legacyTelegramId,
  persistedTelegramId,
  missingRow = false,
  lookupThrows = false,
  text = 'create deck',
}) {
  const ledger = { userQueries: [], inserts: [], unexpectedCalls: [] }
  const mockDb = {
    from(table) {
      if (table === 'users') return {
        select(columns) {
          assert.equal(columns, 'telegram_id')
          return {
            eq(column, value) {
              assert.equal(column, 'id')
              ledger.userQueries.push(String(value))
              return {
                async maybeSingle() {
                  if (lookupThrows) throw Error('synthetic users read outage')
                  const exists = !missingRow && String(value) === String(userId)
                  return {
                    data: exists ? { telegram_id: persistedTelegramId } : null,
                    error: exists ? null : { code: 'NO_ROW' },
                  }
                },
              }
            },
          }
        },
      }
      if (table === 'agent_artifacts') return {
        insert(row) {
          ledger.inserts.push(structuredClone(row))
          return {
            select(column) {
              assert.equal(column, 'id')
              return {
                async single() {
                  return { data: { id: 'synthetic-artifact-001' }, error: null }
                },
              }
            },
          }
        },
      }
      ledger.unexpectedCalls.push(table)
      throw Error('unexpected DB table ' + table)
    },
  }
  const mockDocuments = {
    makeDocRequest: content => /^create deck$/i.test(String(content))
      ? { format: 'deck', request: 'synthetic deck content from actor' } : null,
    chatReply: () => 'Synthetic draft created',
    editedReply: () => 'Synthetic edit',
    isMakeEdit: () => false,
    madeIdFromReply: () => null,
  }
  const modules = Object.freeze({
    '@/lib/supabase-admin': { supabaseAdmin: mockDb },
    './documents': mockDocuments,
    './generate': {
      generateDoc: async () => ({ doc: fakeDocument, sources: [] }),
      editDoc: async () => {
        throw Error('NO EDIT or LLM invocation is allowed in this fixture')
      },
    },
  })
  const sandbox = {
    exports: {},
    require: name => {
      if (!Object.hasOwn(modules, name)) throw Error('forbidden external dependency: ' + name)
      return modules[name]
    },
  }
  vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: false } })
  vm.runInContext(emitted.outputText, sandbox, {
    timeout: 1500,
    filename: 'unchanged-lib-make-store.vm.cjs',
  })
  assert.equal(typeof sandbox.exports.handleMakeDoc, 'function')
  ledger.result = await sandbox.exports.handleMakeDoc({
    actor: { ...(userId === undefined ? {} : { userId }), legacyTelegramId },
    text,
  })
  return ledger
}

let positives = 0
let safetyFailures = 0
async function control(name, fn) {
  await fn()
  positives++
  console.log('PASS control: ' + name)
}
async function safety(name, fn) {
  try {
    await fn()
    console.log('PASS safety: ' + name)
  } catch (e) {
    console.error('REQUIRED SAFETY RED: ' + name + ': ' + String(e?.message || e))
    safetyFailures++
  }
}

// These must pass: a focused test must not RED simply due to a broken harness.
await control('persisted safe owner 42 gets its own document', async () => {
  const x = await simulate({ userId: 'safe-user-42', legacyTelegramId: 73, persistedTelegramId: '42' })
  assert.equal(x.result?.status, 'completed')
  assert.equal(x.userQueries.length, 1)
  assert.equal(x.inserts.length, 1)
  assert.equal(x.inserts[0].telegram_id, '42')
  assert.equal(x.inserts[0].content_json.doc.title, fakeDocument.title)
})
await control('legacy safe owner 43 without UUID retains supported legacy creation', async () => {
  const x = await simulate({ legacyTelegramId: 43 })
  assert.equal(x.result?.status, 'completed')
  assert.equal(x.userQueries.length, 0)
  assert.equal(x.inserts.length, 1)
  assert.equal(x.inserts[0].telegram_id, '43')
})
await control('non-Make text never invokes storage or generation', async () => {
  const x = await simulate({ userId: 'safe-user-42', legacyTelegramId: 73,
    persistedTelegramId: '42', text: 'hello' })
  assert.equal(x.result, null)
  assert.equal(x.inserts.length, 0)
  assert.equal(x.userQueries.length, 0)
})
await control('safe UUID-bound owner wins over a different legacy chat identity', async () => {
  const x = await simulate({ userId: 'safe-user-42', legacyTelegramId: 43, persistedTelegramId: '42' })
  assert.equal(x.inserts.length, 1)
  assert.equal(x.inserts[0].telegram_id, '42')
})

// The original code currently fails these source-executed privacy checks.
// No user-identifying artifact may be saved under another account.
await safety('P1: B 64-bit owner never persists authored document under unrelated A', async () => {
  const x = await simulate({ userId: 'synthetic-user-B', legacyTelegramId: 43, persistedTelegramId: B })
  assert.ok(x.inserts.every(row => row.telegram_id === B),
    'B authored synthetic deck was saved under A via lossy Number()')
  assert.ok(x.inserts.length === 0 || x.result?.status === 'completed')
})
await safety('P1: already-rounded unsafe numeric legacy owner must never write', async () => {
  const x = await simulate({ legacyTelegramId: Number(B) })
  assert.equal(x.inserts.length, 0,
    'a rounded numeric owner was accepted as the wrong artifact tenant')
})
await safety('P1: failed UUID owner lookup must not fall back to unverified legacy identity', async () => {
  const x = await simulate({ userId: 'unresolvable-uuid', legacyTelegramId: 42,
    missingRow: true })
  assert.equal(x.inserts.length, 0,
    'missing exact user association must deny service-role document persistence')
})
await safety('P1: thrown user-identity read must not persist under legacy fallback', async () => {
  const x = await simulate({ userId: 'synthetic-user', legacyTelegramId: 42,
    lookupThrows: true })
  assert.equal(x.inserts.length, 0,
    'unreadable UUID owner must deny service-role document persistence')
})
await safety('P1: fractional legacy owner cannot be used as a tenant', async () => {
  const x = await simulate({ legacyTelegramId: 42.5 })
  assert.equal(x.inserts.length, 0)
})
await safety('P1: malformed legacy owner cannot become NaN artifact owner', async () => {
  const x = await simulate({ legacyTelegramId: 'not-an-owner' })
  assert.equal(x.inserts.length, 0)
})
await safety('P1: absent legacy owner cannot become tenant zero', async () => {
  const x = await simulate({ legacyTelegramId: '' })
  assert.equal(x.inserts.length, 0)
})

console.log('Original lib/make/store.ts (no provider/DB): ' + positives +
  '/4 positive controls PASS; ' + safetyFailures + '/7 expected safety RED')
assert.equal(positives, 4, 'positive controls must always pass')
if (safetyFailures) process.exitCode = 1
