/** Test-first, inert regression for the REAL Dashboard Library TSX page.
 * The fakes make ZERO network, Supabase, provider, document or customer-data requests.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { exactSessionOwnerId } from '../lib/dashboard/owner-identity.ts'

const source = readFileSync('app/dashboard/(app)/library/page.tsx', 'utf8')
const transformed = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
} }).outputText

async function renderWithOwner(owner: string | number | null) {
  const selectors: Array<{ column: string; value: unknown }> = []
  let reads = 0
  const query: any = {
    select(fields: string) { assert.match(fields, /doc_type,title,summary/); return this },
    eq(column: string, value: unknown) { selectors.push({ column, value }); return this },
    order(column: string) { assert.equal(column, 'created_at'); return this },
    async limit(count: number) {
      assert.equal(count, 100)
      return { data: [], error: null }
    },
  }
  const fakeDb = { from(table: string) { reads++; assert.equal(table, 'documents'); return query } }
  const jsx = { jsx: (type: unknown, props: unknown) => ({ type, props }),
    jsxs: (type: unknown, props: unknown) => ({ type, props }) }
  const imports: Record<string, unknown> = {
    '@/lib/dashboard/session': { getSession: async () => owner === null ? null : { telegramId: owner } },
    '@/lib/supabase-admin': { supabaseAdmin: fakeDb },
    '@/lib/services/document-summary-privacy': {
      safeDocumentSummary: (v: string) => v, redactDocumentMetadata: (v: string) => v,
    },
    '@/lib/dashboard/owner-identity': { exactSessionOwnerId },
    'react/jsx-runtime': jsx,
  }
  const mod: any = { exports: {} }
  runInNewContext(transformed, {
    module: mod, exports: mod.exports,
    require: (path: string) => {
      if (!(path in imports)) throw new Error('Unexpected import: ' + path)
      return imports[path]
    },
  }, { filename: 'synthetic-library-page.cjs', timeout: 5000 })
  assert.equal(typeof mod.exports.default, 'function')
  await mod.exports.default()
  return { reads, selectors }
}

// Original deployed parseInt/Number aliases these distinct signed64 identities.
assert.equal(Number('9007199254740992'), Number('9007199254740993'))
for (const owner of ['9007199254740992', '9007199254740993', '42', '-123', 42] as const) {
  const { reads, selectors } = await renderWithOwner(owner)
  assert.equal(reads, 1, 'valid exact owner ' + owner + ' should read only its documents')
  assert.equal(selectors.length, 1)
  assert.equal(selectors[0].column, 'telegram_id')
  assert.equal(selectors[0].value, String(owner), 'never coerce exact owner to lossy Number: ' + owner)
  assert.equal(typeof selectors[0].value, 'string')
}
for (const owner of [null, '', '0', '42junk', '42.0', '9007199254740993xyz',
  '9223372036854775808', '999999999999999999999999999', 9007199254740992, 42.5]) {
  const { reads, selectors } = await renderWithOwner(owner)
  assert.equal(reads, 0, 'invalid/unsafe owner ' + String(owner) + ' cannot query service-role documents')
  assert.equal(selectors.length, 0)
}
console.log('PASS LIBRARY_EXACT_OWNER_ISOLATION: exact two-owner and malformed-session regressions')
