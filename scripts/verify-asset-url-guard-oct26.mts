// 26 Oct live (WhatsApp 17:08): "Open https://www.croma.com/… read-only and tell me the price and delivery date for
// my pincode…" was claimed by saved-asset retrieval and answered with a loan agreement. Offline.
// Run: npx --yes tsx scripts/verify-asset-url-guard-oct26.mts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://synthetic.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'synthetic'
process.env.OPENAI_API_KEY ||= 'synthetic'
const asset = await import('../lib/services/asset-natural-retrieval')
for (const t of [
  'Open https://www.croma.com/apple-iphone-16-128gb-black-/p/324488 read-only and tell me the price and delivery date for my pincode. Do not add to cart or order.',
  'open www.flipkart.com and find my order',
  'Find the price on https://www.amazon.in/dp/B0DGJHBX5Y',
  'open https://example.com/my-agreement.pdf',
]) assert.equal(asset.shouldAttemptNaturalAssetRetrieval(t), false, t)
for (const t of ['find my passport', 'show me my rental agreement', 'open my loan agreement', 'send me the Mythili sales estimate'])
  assert.equal(asset.shouldAttemptNaturalAssetRetrieval(t), true, `saved assets still retrievable: ${t}`)
console.log('Messages with a web link are page reads, never saved-asset retrieval')


// Execute the actual source module with inert injected dependencies to prove the
// independent contact-question path does NOT touch private documents or notes.
// No Supabase, provider, browser or network request is made by this fixture.
const source = readFileSync(new URL('../lib/services/asset-natural-retrieval.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
let documentReads = 0
let noteReads = 0
const fakeDocuments = {
  from(table: string) {
    documentReads++
    assert.equal(table, 'documents', 'only the expected private table should be read')
    return {
      select(_fields: string) { return this },
      eq(column: string, owner: number) {
        assert.equal(column, 'telegram_id')
        assert.equal(owner, 101, 'positive path must remain bound to the requested owner')
        return this
      },
      order(_field: string, _options: unknown) { return this },
      async limit(_rows: number) { return { data: [], error: null } },
    }
  },
}
const deps: Record<string, unknown> = {
  '@/lib/supabase-admin': { supabaseAdmin: fakeDocuments },
  '@/lib/services/asset-memory': {
    buildAssetRetrievalReply: async () => 'synthetic saved asset',
    buildDocumentReplyById: async () => 'synthetic saved document',
    isAssetRetrievalCommand: () => false,
    isBusinessCardText: () => false,
  },
  '@/lib/data/lists': {
    getList: async (owner: number, list: string) => {
      noteReads++
      assert.equal(owner, 101, 'notes must remain owner-bound')
      assert.equal(list, 'notes')
      return { items: [{ text: 'Jane Doe: jane@example.com', added_at: '2026-10-26T00:00:00Z' }] }
    },
  },
  '@/lib/services/reporting-directive': { stripReportingDirectives: (value: string) => value },
}
const isolatedModule: { exports: Record<string, unknown> } = { exports: {} }
runInNewContext(compiled, {
  module: isolatedModule,
  exports: isolatedModule.exports,
  require: (id: string) => {
    if (Object.prototype.hasOwnProperty.call(deps, id)) return deps[id]
    throw new Error('Unexpected module dependency: ' + id)
  },
})
const build = isolatedModule.exports.buildNaturalAssetRetrievalReply as
  (owner: number, text: string) => Promise<string | null>
for (const t of [
  "Find Jane Doe's phone on https://example.com",
  "Look up John's email at www.example.com",
  "Find Maya's mobile via HTTPS://EXAMPLE.ORG/contact",
  'Find my passport PDF at https://example.org',
  "Find Jane's email on http://169.254.169.254/latest/meta-data/",
]) {
  assert.equal(await build(101, t), null, 'public URL must not be answered by private asset lookup: ' + t)
  assert.equal(documentReads, 0, 'public URL must not query private documents: ' + t)
  assert.equal(noteReads, 0, 'public URL must not query saved notes: ' + t)
}
const savedContact = await build(101, "Find Jane Doe's phone")
assert.match(savedContact || '', /jane@example\\.com/, 'genuine saved contact retrieval must still work')
assert.equal(documentReads, 1, 'saved contact queries only the authenticated owner documents')
assert.equal(noteReads, 1, 'saved contact checks only the authenticated owner notes')
console.log('URL + contact question: zero private DB/notes reads; genuine saved-contact lookup preserved')
