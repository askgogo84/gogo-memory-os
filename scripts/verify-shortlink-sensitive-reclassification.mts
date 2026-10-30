import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

// Execute the ACTUAL document-link source with inert database + signer stubs.
// No live tenant, Supabase, provider, internet access, or production mutation.
const source = readFileSync('lib/services/document-links.ts', 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

const now = Date.now()
const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString()
const ahead = (minutes: number) => new Date(now + minutes * 60_000).toISOString()
const longExpiry = new Date(now + 29 * 86_400_000).toISOString()
const oldToken = 'synthetic-long-lived-bearer'
const signed = 'https://storage.fixture.invalid/synthetic.pdf?not-real=1'

type LinkRow = {
  token?: string
  document_id: string
  telegram_id: string
  created_at?: string | null
  expires_at?: string | null
  revoked_at?: string | null
  accessed_count?: number
}

function sandbox(link: LinkRow | null, doc: Record<string, unknown> | null) {
  const seen = { signs: 0, updates: 0, inserts: [] as Array<Record<string, unknown>>, reads: [] as string[], predicates: [] as Array<{table: string; field: string; value: unknown}> }
  const db = {
    from(table: string) {
      seen.reads.push(table)
      const query = {
        select(_fields: string) { return query },
        eq(field: string, value: unknown) { seen.predicates.push({ table, field, value }); return query },
        is(_field: string, _value: unknown) { return query },
        gt(_field: string, _value: unknown) { return query },
        order(_field: string, _options: unknown) { return query },
        limit(_limit: number) { return query },
        maybeSingle: async () => ({ data: table === 'document_links' ? link : doc, error: null }),
        insert: async (row: Record<string, unknown>) => { seen.inserts.push(row); return { error: null } },
        update: (_value: unknown) => { seen.updates++; return query },
      }
      return query
    },
  }
  const module = { exports: {} as Record<string, any> }
  runInNewContext(compiled, {
    module,
    exports: module.exports,
    process: { env: {} },
    Date,
    console,
    Buffer,
    require(name: string) {
      if (name === 'crypto') return { randomBytes: () => Buffer.alloc(16, 7) }
      if (name === '@/lib/supabase-admin') return { supabaseAdmin: db }
      if (name === '@/lib/services/document-store') return {
        getDocumentSignedUrl: async (path: string, ttl: number) => {
          assert.equal(path, 'owner-42/document.pdf')
          assert.equal(ttl, 120)
          seen.signs++
          return signed
        },
      }
      throw new Error('unexpected module: ' + name)
    },
  })
  return { service: module.exports, seen }
}

const longLink: LinkRow = {
  token: oldToken, document_id: 'doc-42', telegram_id: '42',
  created_at: ago(5), expires_at: longExpiry, revoked_at: null, accessed_count: 0,
}
const normal = { storage_path: 'owner-42/document.pdf', doc_type: 'generic_document', extracted: { assetType: 'generic_document' } }
const sensitive = { storage_path: 'owner-42/document.pdf', doc_type: 'passport', extracted: { assetType: 'passport', privacyClass: 'sensitive' } }
const reclassified = { storage_path: 'owner-42/document.pdf', doc_type: 'generic_document', extracted: { assetType: 'id_document', privacyClass: 'sensitive' } }
const titleClassified = { storage_path: 'owner-42/document.pdf', doc_type: 'generic_document', title: 'Passport scan', extracted: { assetType: 'generic_document' } }

// Test-FIRST RED: an old 30-day bearer token must stop resolving as soon as
// the SAME owner/document's current classification becomes sensitive.
for (const doc of [sensitive, reclassified, titleClassified]) {
  const { service, seen } = sandbox(longLink, doc)
  const result = await service.resolveShortLinkToSignedUrl(oldToken)
  assert.equal(result, null, 'long-lived token may not access a reclassified sensitive document')
  assert.equal(seen.signs, 0, 'long-lived token must never sign sensitive storage')
}

// A preexisting normal token remains usable for non-sensitive material.
{
  const { service, seen } = sandbox(longLink, normal)
  assert.equal(await service.resolveShortLinkToSignedUrl(oldToken), signed)
  assert.equal(seen.signs, 1)
}

// Short-lived links are still valid for sensitive documents (no regression).
const recentShort: LinkRow = { ...longLink, token: 'synthetic-short', created_at: ago(1), expires_at: ahead(12) }
{
  const { service, seen } = sandbox(recentShort, sensitive)
  assert.equal(await service.resolveShortLinkToSignedUrl(recentShort.token), signed)
  assert.equal(seen.signs, 1)
  assert.ok(seen.predicates.some(p => p.table === 'documents' && p.field === 'id' && p.value === 'doc-42'),
    'resolver must address the original linked document')
  assert.ok(seen.predicates.some(p => p.table === 'documents' && p.field === 'telegram_id' && p.value === '42'),
    'resolver must retain exact persisted owner predicate')
}

// No valid issuance timestamp: fail closed for private documents.
for (const created_at of [null, undefined, '', 'not-a-date', ahead(2)]) {
  const { service, seen } = sandbox({ ...recentShort, created_at }, sensitive)
  assert.equal(await service.resolveShortLinkToSignedUrl(recentShort.token), null, 'invalid/future issue time rejects sensitive token')
  assert.equal(seen.signs, 0)
}

// Sensitive retrieval must not reuse a normal 30-day token; mint one scoped
// to 15 minutes without revoking/deleting the historical row.
{
  const { service, seen } = sandbox(longLink, sensitive)
  const got = await service.createDocumentShortLink({ telegramId: 42, documentId: 'doc-42', sensitive: true })
  assert.ok(got && got !== oldToken, 'sensitive token must not reuse previously long-lived token')
  assert.equal(seen.inserts.length, 1)
  const inserted = seen.inserts[0]
  assert.equal(inserted.document_id, 'doc-42')
  assert.equal(inserted.telegram_id, 42)
  assert.ok(Date.parse(String(inserted.expires_at)) <= Date.now() + 15 * 60_000 + 1000)
  assert.equal(seen.updates, 0, 'do not revoke/delete historical links during mint')
}

// Normal (non-sensitive) path retains existing 30-day reuse, preserving UX.
{
  const { service, seen } = sandbox(longLink, normal)
  assert.equal(await service.createDocumentShortLink({ telegramId: 42, documentId: 'doc-42', sensitive: false }), oldToken)
  assert.equal(seen.inserts.length, 0)
}

// A legitimate pre-existing sensitive 15-minute token is reused.
{
  const { service, seen } = sandbox(recentShort, sensitive)
  assert.equal(await service.createDocumentShortLink({ telegramId: 42, documentId: 'doc-42', sensitive: true }), recentShort.token)
  assert.equal(seen.inserts.length, 0)
}

console.log('PASS SHORTLINK_SENSITIVE_RECLASSIFICATION (synthetic owner/document; no live storage/provider)')
