// Deterministic, inert storage-commit truth regression. No real Supabase, Twilio, object store or provider access.
// Test-first: against 28 Oct main source, the update-error case must FAIL (path wrongly reported stored).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

type Patch = 'accepted' | 'rejected' | 'missing' | 'wrong-row' | 'throws'
type Scenario = { patch: Patch; duplicate?: boolean; uploadFailure?: boolean }
const source = readFileSync('lib/services/document-store.ts', 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
} }).outputText

async function probe({ patch, duplicate = false, uploadFailure = false }: Scenario) {
  const calls = { downloads: 0, uploads: 0, inserts: 0, updates: 0, index: 0, meters: 0, selectors: [] as string[] }
  const patchedRow = patch === 'accepted' ? { id: 'doc-fixture-1' }
    : patch === 'wrong-row' ? { id: 'another-owner-document' } : null
  const patchReply = { data: patchedRow, error: patch === 'rejected' ? { message: 'fixture denied update' } : null }

  const updateQuery: any = {
    eq(column: string, value: unknown) { calls.selectors.push(column + '=' + String(value)); return this },
    select(columns: string) { calls.selectors.push('select:' + columns); return this },
    async maybeSingle() {
      if (patch === 'throws') throw new Error('fixture patch transport failed')
      return patchReply
    },
    then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
      const result = patch === 'throws'
        ? Promise.reject(new Error('fixture patch transport failed')) : Promise.resolve(patchReply)
      return result.then(resolve, reject)
    },
  }
  const fakeAdmin = {
    from(table: string) {
      assert.equal(table, 'documents')
      return {
        insert(row: any) {
          calls.inserts++
          assert.equal(row.telegram_id, 7)
          assert.equal(row.storage_path, null)
          return {
            select(column: string) {
              assert.equal(column, 'id')
              return { async single() {
                return duplicate
                  ? { data: null, error: { code: '23505', message: 'fixture duplicate' } }
                  : { data: { id: 'doc-fixture-1' }, error: null }
              } }
            },
          }
        },
        update(row: any) {
          calls.updates++
          assert.equal(row.storage_path, '7/synthetic-id.pdf')
          return updateQuery
        },
      }
    },
    storage: {
      from(bucket: string) {
        assert.equal(bucket, 'user-documents')
        return {
          async upload(path: string, bytes: Buffer, options: any) {
            calls.uploads++
            assert.equal(path, '7/synthetic-id.pdf')
            assert.equal(bytes.byteLength, 4)
            assert.equal(options.contentType, 'application/pdf')
            return { error: uploadFailure ? { message: 'fixture upload failed' } : null }
          },
        }
      },
    },
  }
  const stubs: Record<string, any> = {
    crypto: { randomUUID: () => 'synthetic-id' },
    '@/lib/supabase-admin': { supabaseAdmin: fakeAdmin },
    '@/lib/services/memory-index': { indexMemory: async () => { calls.index++ } },
    '@/lib/services/meter': { recordUsage: async () => { calls.meters++ } },
    '@/lib/services/image-note-reader': { extractNoteFields: () => ({ summary: '', extracted: '' }) },
    '@/lib/services/document-summary-privacy': {
      safeDocumentSummary: (text: string) => text, redactDocumentMetadata: (text: string) => text,
    },
  }
  const module: any = { exports: {} }
  runInNewContext(compiled, {
    module, exports: module.exports,
    require: (key: string) => { if (!(key in stubs)) throw new Error('Unexpected import: ' + key); return stubs[key] },
    process: { env: { METER_ENABLED: 'false' } },
    Buffer,
    fetch: async (url: string, init: any) => {
      calls.downloads++
      assert.equal(url, 'https://fixture.invalid/media') // intercepted: not a real request
      assert.match(String(init?.headers?.Authorization), /^Basic /)
      return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 })
    },
    console: { log: () => {}, error: () => {} },
  }, { filename: 'document-store-fixture.cjs', timeout: 5000 })

  const result = await module.exports.storeDocument({
    telegramId: 7, docType: 'ticket', docAction: 'ticket_parse', title: 'Fixture ticket',
    summary: 'Fixture itinerary', extracted: {}, indexContent: 'fixture only',
    messageId: 'synthetic-MessageSid', file: {
      mediaUrl: 'https://fixture.invalid/media', accountSid: 'fixture-sid',
      authToken: 'fixture-secret', contentType: 'application/pdf',
    },
  })
  return { result, calls }
}

// The uploaded object is NOT proof of a committed owner-bound documents.storage_path.
for (const patch of ['rejected', 'missing', 'wrong-row', 'throws'] as Patch[]) {
  const { result, calls } = await probe({ patch })
  assert.equal(result.id, 'doc-fixture-1', 'metadata row survives patch failure: ' + patch)
  assert.equal(result.storagePath, null, 'never claim file retention without acknowledged owner-bound DB patch: ' + patch)
  assert.equal(calls.uploads, 1, 'do not replay a potentially completed object upload: ' + patch)
  assert.equal(calls.index, 1, 'existing metadata indexing stays once: ' + patch)
}
const committed = await probe({ patch: 'accepted' })
assert.equal(committed.result.storagePath, '7/synthetic-id.pdf', 'only a confirmed row update proves stored path')
assert.equal(committed.calls.updates, 1)
assert.ok(committed.calls.selectors.includes('id=doc-fixture-1'))
assert.ok(committed.calls.selectors.includes('telegram_id=7'), 'patch must remain owner-bound')
assert.ok(committed.calls.selectors.includes('select:id'), 'row must be read back, not inferred from no error')
const uploadFail = await probe({ patch: 'accepted', uploadFailure: true })
assert.equal(uploadFail.result.storagePath, null)
assert.equal(uploadFail.calls.updates, 0)
const duplicate = await probe({ patch: 'accepted', duplicate: true })
assert.equal(duplicate.result.duplicate, true)
assert.equal(duplicate.calls.downloads, 0, 'never blindly re-download on duplicate MessageSid')
assert.equal(duplicate.calls.uploads, 0, 'never blindly retry object upload on duplicate MessageSid')
assert.equal(duplicate.calls.index, 0)
assert.equal(duplicate.calls.meters, 0)
console.log('PASS DOCUMENT_STORAGE_PATCH_ACK: owner-bound confirmed patch required, no false path, duplicate no-retry (synthetic only)')
