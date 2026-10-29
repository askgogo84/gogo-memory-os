/** Test-first synthetic owner-isolation regression for the REAL Dashboard Memory implementation.
 * No real database, document links, credentials, network, users or provider calls.
 * Does NOT prove authenticated session/RLS/hosted two-owner behavior.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { exactDashboardOwnerId } from '../lib/dashboard/session-access.ts'

const source = readFileSync('lib/dashboard/memory.ts', 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2022,
  esModuleInterop: true,
} }).outputText

const doc = {
  id: 'synthetic-passport-1', doc_type: 'id_document', title: 'Passport',
  summary: 'sensitive synthetic sample', extracted: { privacyClass: 'sensitive', assetType: 'id_document' },
  doc_date: null, expires_on: null, storage_path: 'fixture/no-real-storage',
  mime: 'application/pdf', created_at: '2026-01-01T00:00:00Z',
}

async function exercise(owner: unknown) {
  const tables: string[] = []
  const predicates: Array<{ column: string; value: unknown }> = []
  const signed: Array<Record<string, unknown>> = []
  const db = {
    from(table: string) {
      tables.push(table)
      assert.equal(table, 'documents', 'must not read a different table')
      const query = {
        select(_fields: string) { return this },
        eq(column: string, value: unknown) {
          predicates.push({ column, value })
          return this
        },
        order(_column: string, _opts: unknown) { return this },
        limit(_max: number) { return { data: [doc], error: null } },
      }
      return query
    },
  }
  const imports: Record<string, unknown> = {
    '@/lib/supabase-admin': { supabaseAdmin: db },
    '@/lib/dashboard/session-access': { exactDashboardOwnerId },
    '@/lib/services/document-links': {
      createDocumentShortLink: async (args: Record<string, unknown>) => {
        signed.push(args)
        return 'synthetic-link'
      },
      shortLinkUrl: (token: string) => 'https://example.test/fixture/' + token,
    },
  }
  const mod: any = { exports: {} }
  runInNewContext(compiled, {
    module: mod, exports: mod.exports, Promise, Date, Intl, console: {
      error: () => { throw new Error('unexpected internal error') },
    },
    require(path: string) {
      assert.ok(Object.prototype.hasOwnProperty.call(imports, path), 'unexpected import ' + path)
      return imports[path]
    },
  }, { timeout: 5000, filename: 'memory-owner-synthetic.cjs' })
  assert.equal(typeof mod.exports.getDashboardMemory, 'function')
  const result = await mod.exports.getDashboardMemory(owner)
  return { result, tables, predicates, signed }
}

assert.equal(Number('9007199254740992'), Number('9007199254740993'),
  'two distinct signed64 owners collide through JS Number')
let invalid = 0
for (const id of [
  '9007199254740992', '9007199254740993', '-9007199254740992',
  '9223372036854775808', '-9223372036854775809',
  '42junk', '42.0', '00042', '0', '', null, undefined, 42.5, 9007199254740992,
] as const) {
  assert.equal(exactDashboardOwnerId(id), null, 'invalid synthetic owner input')
  const r = await exercise(id)
  assert.deepEqual(r.tables, [], 'invalid owner must cause zero private document queries: ' + String(id))
  assert.deepEqual(r.predicates, [], 'invalid owner must add zero private predicates: ' + String(id))
  assert.deepEqual(r.signed, [], 'invalid owner must create zero document shortlinks: ' + String(id))
  assert.equal(r.result.ok, true)
  assert.deepEqual(Array.from(r.result.items), [])
  invalid++
}
let valid = 0
for (const id of ['42', '-123', '9007199254740991', '-9007199254740991', 42] as const) {
  const exact = exactDashboardOwnerId(id)
  assert.ok(exact !== null && Number.isSafeInteger(exact))
  const r = await exercise(id)
  assert.deepEqual(r.tables, ['documents'])
  assert.equal(r.predicates.length, 1)
  assert.equal(r.predicates[0].column, 'telegram_id')
  assert.equal(r.predicates[0].value, exact, 'legacy numeric DB owner must match exact safe owner')
  assert.equal(r.signed.length, 1)
  assert.equal(r.signed[0].telegramId, exact, 'private document shortlink must bind same safe owner')
  assert.equal(r.signed[0].documentId, 'synthetic-passport-1')
  assert.equal(r.signed[0].sensitive, true)
  assert.equal(r.result.ok, true)
  assert.equal(r.result.items.length, 1)
  assert.equal(r.result.items[0].sensitive, true)
  assert.equal(r.result.items[0].openUrl, 'https://example.test/fixture/synthetic-link')
  valid++
}
console.log('PASS DASHBOARD_MEMORY_EXACT_OWNER: real TS source, inert private database & document links (' +
  valid + ' valid / ' + invalid + ' invalid synthetic owner inputs)')
