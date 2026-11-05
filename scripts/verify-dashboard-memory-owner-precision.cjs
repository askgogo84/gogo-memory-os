// Execute ORIGINAL dashboard Memory and document-link functions against two inert BIGINT owners.
// No real users, Supabase, storage, HTTP, credentials or signed URLs.
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { runInNewContext } = require('node:vm')
const ts = require('typescript')

const A = '9007199254740992'
const B = '9007199254740993'
const docs = [
  { id: 'doc-A', telegram_id: A, title: 'A private document', summary: 'OWNER_A_ONLY',
    extracted: {}, doc_type: 'document', doc_date: null, expires_on: null,
    storage_path: 'owner-a-private.pdf', mime: 'application/pdf', created_at: '2026-11-05T08:00:00Z' },
  { id: 'doc-B', telegram_id: B, title: 'B passport', summary: 'OWNER_B_ONLY',
    extracted: { privacyClass: 'sensitive' }, doc_type: 'passport', doc_date: null,
    expires_on: null, storage_path: 'owner-b-private.pdf', mime: 'application/pdf',
    created_at: '2026-11-05T09:00:00Z' },
  { id: 'doc-safe', telegram_id: '123', title: 'Safe ID document', summary: 'OWNER_123_ONLY',
    extracted: {}, doc_type: 'document', doc_date: null, expires_on: null,
    storage_path: 'owner-123.pdf', mime: 'application/pdf', created_at: '2026-11-05T10:00:00Z' },
]
let failDocumentRead = false
const reads = [], linkMints = [], linkInserts = [], linkReads = []

const supabaseAdmin = {
  from(table) {
    assert.ok(['documents', 'document_links'].includes(table), 'unexpected database table: ' + table)
    const predicates = {}
    const query = {
      select() { return query },
      eq(key, value) { predicates[key] = value; return query },
      is(key, value) { predicates[key] = value; return query },
      gt(key, value) { predicates[key] = value; return query },
      order() { return query },
      limit() { return query },
      maybeSingle: async () => {
        assert.equal(table, 'document_links')
        linkReads.push({ ...predicates })
        return { data: null, error: null }
      },
      insert: async row => {
        assert.equal(table, 'document_links')
        linkInserts.push({ ...row })
        return { error: null }
      },
      then(resolve, reject) {
        assert.equal(table, 'documents', 'document query must remain read-only')
        assert.deepEqual(Object.keys(predicates), ['telegram_id'], 'document read must have a single exact owner')
        reads.push({ owner: predicates.telegram_id })
        const value = failDocumentRead
          ? { data: null, error: new Error('synthetic read failed') }
          : { data: docs.filter(doc => doc.telegram_id === String(predicates.telegram_id)), error: null }
        return Promise.resolve(value).then(resolve, reject)
      },
    }
    return query
  },
}
function original(path, mocks) {
  const js = ts.transpileModule(readFileSync(path, 'utf8'), {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const exp = {}
  runInNewContext(js, {
    exports: exp, module: { exports: exp }, Buffer, Date, Intl, Number, BigInt,
    String, Promise, console: { error() {} }, process: { env: {} },
    require(name) {
      if (Object.prototype.hasOwnProperty.call(mocks, name)) return mocks[name]
      throw Error('unregistered source dependency: ' + name)
    },
    fetch() { throw Error('network forbidden in owner isolation fixture') },
  }, { filename: path, timeout: 3000 })
  return exp
}
const ownerIdentity = original('lib/dashboard/owner-identity.ts', {
  'node:crypto': { randomBytes() { throw Error('owner allocation forbidden') } },
})
const memory = original('lib/dashboard/memory.ts', {
  '@/lib/supabase-admin': { supabaseAdmin },
  '@/lib/services/document-links': {
    async createDocumentShortLink(params) {
      linkMints.push({ ...params })
      return 'fixture-' + params.documentId
    },
    shortLinkUrl(token) { return 'https://inert.invalid/f/' + token },
  },
  './owner-identity': ownerIdentity,
})
const documentLinks = original('lib/services/document-links.ts', {
  crypto: { randomBytes(size) { assert.equal(size, 16); return Buffer.alloc(size, 7) } },
  '@/lib/supabase-admin': { supabaseAdmin },
  '@/lib/services/document-store': { getDocumentSignedUrl() { throw Error('storage forbidden') } },
})

async function run() {
  for (const [owner, expectedDoc] of [[A, 'doc-A'], [B, 'doc-B'], ['123', 'doc-safe']]) {
    const before = reads.length
    const result = await memory.getDashboardMemory(owner)
    assert.equal(result.ok, true)
    assert.deepEqual(result.items.map(x => x.id), [expectedDoc], 'no other owner document exposed')
    assert.equal(reads.length, before + 1)
    const dbOwner = reads.at(-1).owner
    assert.equal(String(dbOwner), owner)
    assert.equal(typeof dbOwner, owner === '123' ? 'number' : 'string',
      'unsafe owner must use a lossless string; safe ID keeps numeric behavior')
    const link = linkMints.at(-1)
    assert.equal(link.documentId, expectedDoc)
    assert.equal(link.telegramId, dbOwner, 'bearer token must be minted for exact queried owner')
    assert.match(result.items[0].openUrl || '', /^https:\/\/inert\.invalid\/f\/fixture-/)
  }
  for (const invalid of ['123junk', '+123', '00123', '0', '-0', '', 'foo',
    '9007199254740993junk', '9223372036854775808', '-9223372036854775809']) {
    const beforeRead = reads.length, beforeLink = linkMints.length
    const result = await memory.getDashboardMemory(invalid)
    assert.equal(result.ok, true)
    assert.deepEqual(result.items, [])
    assert.equal(reads.length, beforeRead, 'invalid owner cannot query documents: ' + invalid)
    assert.equal(linkMints.length, beforeLink, 'invalid owner cannot mint link: ' + invalid)
  }
  failDocumentRead = true
  const failed = await memory.getDashboardMemory(B)
  assert.equal(failed.ok, false, 'DB failures must not appear as an empty account')
  failDocumentRead = false

  // Exercise the real short-link issuer using inert document_links storage, not just a spy.
  const bToken = await documentLinks.createDocumentShortLink({ telegramId: B, documentId: 'doc-B', sensitive: true })
  assert.ok(bToken, 'valid exact owner should mint an opaque token')
  assert.equal(linkInserts.at(-1).telegram_id, B, 'persisted link owner is exact full BIGINT string')
  assert.equal(linkReads.at(-1).telegram_id, B, 'reuse lookup is exact full BIGINT string')
  const aToken = await documentLinks.createDocumentShortLink({ telegramId: A, documentId: 'doc-A', sensitive: false })
  assert.ok(aToken)
  assert.equal(linkInserts.at(-1).telegram_id, A, 'second colliding owner remains distinct')
  const safeToken = await documentLinks.createDocumentShortLink({ telegramId: 123, documentId: 'doc-safe', sensitive: false })
  assert.ok(safeToken)
  assert.equal(linkInserts.at(-1).telegram_id, 123, 'legacy safe number stays numeric')
  const before = linkInserts.length, beforeRead = linkReads.length
  const unsafe = await documentLinks.createDocumentShortLink({
    telegramId: Number(B), documentId: 'doc-B', sensitive: true,
  })
  assert.equal(unsafe, null, 'rounded numeric owner must fail closed')
  assert.equal(linkInserts.length, before)
  assert.equal(linkReads.length, beforeRead)
  console.log('Dashboard Memory original read + document short-link issuer: exact adjacent BIGINT owners, malformed IDs deny, safe IDs retained; synthetic/no provider I/O')
}
run().catch(err => { console.error(err); process.exitCode = 1 })
