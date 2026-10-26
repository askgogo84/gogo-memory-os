import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { exactSessionOwnerId } from '../lib/dashboard/owner-identity'
import { buildMemoryDisplayTitle } from '../lib/dashboard/memory'

const cases = [
  [
    { doc_type:'image', title:'The image shows a product for car care. It is a dashboard and tyre polish.', extracted:{}, mime:'image/jpeg' },
    false,
    'Car care product',
  ],
  [
    { doc_type:'image', title:'The document appears to be an official notice or guideline. It includes a list of documents or requirements.', extracted:{}, mime:'image/jpeg' },
    false,
    'Official notice / guideline',
  ],
  [
    { doc_type:'passport', title:'Passport AB1234567', extracted:{ assetType:'passport', fields:{ name:'Goverdhan M D' } }, mime:'application/pdf' },
    true,
    "Goverdhan M's Passport",
  ],
  [
    { doc_type:'image', title:'A very long generated sentence that keeps going with far too many words and should never become the visual headline on a memory card.', extracted:{}, mime:'image/jpeg' },
    false,
    'Saved image',
  ],
] as const

let failed = 0
for (const [doc, sensitive, expected] of cases) {
  const got = buildMemoryDisplayTitle(doc as any, sensitive)
  if (got !== expected) {
    failed++
    console.error(`✗ ${JSON.stringify(doc.title)} got=${JSON.stringify(got)} expected=${JSON.stringify(expected)}`)
  } else {
    console.log(`✓ ${JSON.stringify(doc.title)} → ${JSON.stringify(got)}`)
  }
}

if (failed) process.exit(1)
console.log('✅ Dashboard Memory presentation checks passed')


//
// Security regression: a signed-in owner must never see another tenant's
// sensitive documents (or mint their short links) through parseInt/Number
// collisions at the service-role dashboard Memory boundary.
// These are inert in-process fixtures: no provider, DB, storage or real documents.
//
const fixtureDocs = [
  { telegram_id: 4242, id: 'owner-4242-doc', doc_type: 'document', title: 'OWNER_4242_ONLY', summary: 'Private fixture', extracted: {}, doc_date: null, expires_on: null, storage_path: 'fixture/4242.pdf', mime: 'application/pdf', created_at: '2026-10-01T00:00:00Z' },
  { telegram_id: -2251799813685249, id: 'negative-owner-doc', doc_type: 'document', title: 'NEGATIVE_OWNER_ONLY', summary: 'Private fixture', extracted: {}, doc_date: null, expires_on: null, storage_path: 'fixture/negative.pdf', mime: 'application/pdf', created_at: '2026-10-01T00:00:00Z' },
  { telegram_id: '9007199254740992', id: 'rounded-neighbour-doc', doc_type: 'passport', title: 'FOREIGN_PASSPORT_PRIVATE', summary: 'Sensitive fixture', extracted: {}, doc_date: null, expires_on: null, storage_path: 'fixture/foreign.pdf', mime: 'application/pdf', created_at: '2026-10-01T00:00:00Z' },
]
const ownerReads: unknown[] = []
const linkRequests: Array<{ telegramId: number; documentId: string; sensitive: boolean }> = []
const fixtureDb = {
  from(table: string) {
    assert.equal(table, 'documents', 'owner Memory fixture may only read documents')
    let owner: unknown = null
    const q: any = {
      select: () => q,
      eq: (key: string, id: unknown) => {
        assert.equal(key, 'telegram_id')
        owner = id
        ownerReads.push(id)
        return q
      },
      order: () => q,
      limit: async () => ({
        data: fixtureDocs.filter(d => String(d.telegram_id) === String(owner)),
        error: null,
      }),
    }
    return q
  },
}
const fixtureExports: Record<string, any> = {}
const fixtureModule = { exports: fixtureExports }
const transpiledMemory = ts.transpileModule(readFileSync('lib/dashboard/memory.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
runInNewContext(transpiledMemory, {
  exports: fixtureExports,
  module: fixtureModule,
  require(name: string) {
    if (name === '@/lib/supabase-admin') return { supabaseAdmin: fixtureDb }
    if (name === './owner-identity') return { exactSessionOwnerId }
    if (name === '@/lib/services/document-links') return {
      createDocumentShortLink: async (p: { telegramId: number; documentId: string; sensitive: boolean }) => {
        linkRequests.push(p)
        return 'fixture-opaque-token'
      },
      shortLinkUrl: (token: string) => 'https://fixture.example/f/' + token,
    }
    throw new Error('Unmocked dependency in inert Memory owner test: ' + name)
  },
  console, Date, Intl, Number, String, Promise, Set, Map, BigInt,
})
const memoryUnderTest = fixtureModule.exports as typeof import('../lib/dashboard/memory')

for (const badId of [
  '9007199254740992', '9007199254740993', '-9007199254740993',
  '4242garbage', '004242', '+4242', '4.242e3', '4242 ', ' 4242',
  '', '0', '-0', '9223372036854775808',
]) {
  const readsBefore = ownerReads.length, linksBefore = linkRequests.length
  const result = await memoryUnderTest.getDashboardMemory(badId)
  assert.equal(result.ok, true, 'invalid account fails closed to an empty Memory')
  if (result.ok) assert.equal(result.items.length, 0, 'no foreign Memory item for ' + badId)
  assert.equal(ownerReads.length, readsBefore, 'invalid or rounded id must never query documents: ' + badId)
  assert.equal(linkRequests.length, linksBefore, 'invalid or rounded id must never mint private document link: ' + badId)
}

const legitimate = await memoryUnderTest.getDashboardMemory('4242')
assert.equal(legitimate.ok, true)
if (legitimate.ok) {
  assert.equal(legitimate.items.length, 1)
  assert.equal(legitimate.items[0].id, 'owner-4242-doc')
  assert.equal(legitimate.items[0].openUrl, 'https://fixture.example/f/fixture-opaque-token')
}
assert.equal(ownerReads.at(-1), 4242, 'exact safe owner scopes document query')
assert.equal(linkRequests.at(-1)?.telegramId, 4242, 'short link bound to same safe session owner')
assert.equal(linkRequests.at(-1)?.documentId, 'owner-4242-doc')

const negative = await memoryUnderTest.getDashboardMemory('-2251799813685249')
assert.equal(negative.ok, true)
if (negative.ok) {
  assert.equal(negative.items.length, 1)
  assert.equal(negative.items[0].id, 'negative-owner-doc')
}
assert.equal(ownerReads.at(-1), -2251799813685249)
assert.equal(linkRequests.at(-1)?.telegramId, -2251799813685249)
assert.ok(!linkRequests.some(p => p.documentId === 'rounded-neighbour-doc'), 'no foreign document link')

console.log('✅ Dashboard Memory precision: 64-bit adjacent owners and malformed IDs fail closed before DB; safe owner links remain bound')
