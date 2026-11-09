import assert from 'node:assert/strict'
import { runInNewContext } from 'node:vm'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

// PRIVATE-DOCUMENT BEARER LINK EXPIRY: actual exported production module, isolated
// in a VM with an entirely inert service-role DB and signing stub. No network,
// signed real URL, customer account, storage or provider operation takes place.
const productionSource = readFileSync('lib/services/document-links.ts', 'utf8')
const compiled = ts.transpileModule(productionSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

type Link = {
  document_id: string
  telegram_id: string
  expires_at: string | null | undefined
  revoked_at: string | null
  accessed_count: number
}

async function exercise(link: Link | null) {
  const tables: string[] = []
  const predicates: { table: string; field: string; value: unknown }[] = []
  let signed = 0
  let updates = 0
  const db = {
    from(table: string) {
      tables.push(table)
      const query = {
        select(_columns: string) { return query },
        eq(field: string, value: unknown) {
          predicates.push({ table, field, value })
          return query
        },
        maybeSingle: async () => ({
          data: table === 'document_links' ? link
            : table === 'documents' ? { storage_path: 'account-42/private-document.pdf' } : null,
          error: null,
        }),
        update(_fields: unknown) { updates++; return query },
      }
      return query
    },
  }
  const stubbedSignedUrl = 'https://storage.fixture.invalid/private-document.pdf?fixture=1'
  const module = { exports: {} as Record<string, any> }
  runInNewContext(compiled, {
    module,
    exports: module.exports,
    process: { env: {} },
    Date,
    console,
    require(name: string) {
      if (name === 'crypto') return { randomBytes: () => { throw new Error('unexpected mint') } }
      if (name === '@/lib/supabase-admin') return { supabaseAdmin: db }
      if (name === '@/lib/services/document-store') return {
        getDocumentSignedUrl: async (storagePath: string, ttl: number) => {
          assert.equal(storagePath, 'account-42/private-document.pdf')
          assert.equal(ttl, 120)
          signed++
          return stubbedSignedUrl
        },
      }
      throw new Error('unexpected dependency: ' + name)
    },
  })
  const result = await module.exports.resolveShortLinkToSignedUrl('opaque-synthetic-token')
  return { result, tables, predicates, signed, updates, stubbedSignedUrl }
}

const expiresTomorrow = new Date(Date.now() + 86_400_000).toISOString()
const expiredYesterday = new Date(Date.now() - 86_400_000).toISOString()
const base = {
  document_id: 'doc-42',
  telegram_id: '42',
  revoked_at: null,
  accessed_count: 0,
}
const invalid = [
  ['null expiration', null],
  ['missing expiration', undefined],
  ['empty expiration', ''],
  ['nonsense expiration', 'never'],
  ['invalid calendar date', '2077-13-99T00:00:00Z'],
  ['expired yesterday', expiredYesterday],
] as const

for (const [label, expires_at] of invalid) {
  const got = await exercise({ ...base, expires_at })
  assert.equal(got.result, null, label + ': invalid/expired bearer link must fail closed')
  assert.deepEqual(got.tables, ['document_links'], label + ': never fetch a private document')
  assert.equal(got.signed, 0, label + ': never sign private storage')
  assert.equal(got.updates, 0, label + ': no accounting mutation')
}

const noRecord = await exercise(null)
assert.equal(noRecord.result, null)
assert.deepEqual(noRecord.tables, ['document_links'])
assert.equal(noRecord.signed, 0)

const revoked = await exercise({ ...base, expires_at: expiresTomorrow, revoked_at: new Date().toISOString() })
assert.equal(revoked.result, null, 'revoked link is never reopened')
assert.equal(revoked.signed, 0)

const valid = await exercise({ ...base, expires_at: expiresTomorrow })
assert.equal(valid.result, valid.stubbedSignedUrl, 'valid unrevoked link still works')
assert.equal(valid.signed, 1)
assert.deepEqual(valid.tables.slice(0, 2), ['document_links', 'documents'])
assert.ok(valid.predicates.some(p => p.table === 'documents' && p.field === 'id' && p.value === 'doc-42'))
assert.ok(valid.predicates.some(p => p.table === 'documents' && p.field === 'telegram_id' && p.value === '42'))
assert.equal(valid.updates, 1, 'valid link alone can increment access accounting')

console.log('PASS synthetic document bearer short-link expiry: six malformed/expired reject, revoked/missing reject, valid owner-scoped link signs once')
