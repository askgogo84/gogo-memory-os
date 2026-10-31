// Outbound leak filter (Duet brief, 23 Oct). Run: npx tsx scripts/verify-outbound-leak-filter.mts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { maskOutboundIdentifiers as m } from '../lib/security/outbound-identifiers'

assert.equal(m('Card 4111 1111 1111 1111 saved'), 'Card card ending 1111 saved')
assert.equal(m('4111-1111-1111-1111'), 'card ending 1111')
assert.equal(m('Order 4111111111111112 shipped'), 'Order 4111111111111112 shipped', 'non-Luhn numbers (order ids) stay')
assert.equal(m('Aadhaar 2341 2341 2346'), 'Aadhaar Aadhaar ending 2346')
assert.equal(m('Ref 234123412345'), 'Ref 234123412345', 'a 12-digit number that fails Verhoeff is not Aadhaar')
assert.equal(m('PAN ABCPE1234F'), 'PAN PAN ending 234F')
assert.equal(m('PNR ABC123, flight 6E 1004, call +91 98450 12345'), 'PNR ABC123, flight 6E 1004, call +91 98450 12345', 'PNRs, flights and phones untouched')
assert.equal(m(''), '')
assert.match(readFileSync('lib/whatsapp.ts', 'utf8'), /sanitizeMarkdownForWhatsApp\(maskOutboundIdentifiers\(text \|\| ''\)\)/)
console.log('Outbound leak filter: card (Luhn), Aadhaar (Verhoeff), PAN masked to last 4; other numbers untouched')


// Link Vault semantic-query provider boundary — execute the ACTUAL exported
// module in a sealed VM using fake DB/embedding transports. No network, users,
// provider embeddings or persistent records are used in these regressions.
import vm from 'node:vm'
import ts from 'typescript'
import { isSecretShapedMemory, redactSecretShapedText } from '../lib/bot/memory-redaction'

const linkSource = readFileSync('lib/services/link-vault.ts', 'utf8')
const transpiledLink = ts.transpileModule(linkSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const linkRows = [{
  id: 'synthetic-link-1',
  telegram_id: 42,
  canonical_url: 'https://fixture.invalid/guide',
  original_url: 'https://fixture.invalid/guide',
  platform: 'web',
  title: 'Design planning handbook',
  description: 'A harmless design-planning link',
  user_note: '',
  topic: 'design',
  tags: ['design'],
  source: 'fixture.invalid',
  saved_at: '2026-10-20T08:00:00Z',
}]
const embeddedInputs: string[] = []
let semanticRpcCalls = 0
let privateReads = 0
const fakeLinkDb = {
  from(table: string) {
    assert.equal(table, 'link_vault_items', 'fixture only permits local link rows')
    privateReads++
    const q: any = {
      select: () => q,
      eq: () => q,
      order: () => q,
      limit: async () => ({ data: linkRows, error: null }),
    }
    return q
  },
  async rpc(name: string) {
    assert.equal(name, 'match_memories')
    semanticRpcCalls++
    return { data: [], error: null }
  },
}
const linkExports: any = {}
const linkModule = { exports: linkExports }
const mocks: Record<string, any> = {
  '@/lib/supabase-admin': { supabaseAdmin: fakeLinkDb },
  '@/lib/services/embeddings': {
    embedText: async (input: string) => {
      embeddedInputs.push(input)
      return [0.125, 0.5]
    },
  },
  '@/lib/bot/memory-redaction': { isSecretShapedMemory, redactSecretShapedText },
  '@/lib/agent/typed-object-context': { rememberTypedObjects: async () => {} },
}
vm.runInNewContext(transpiledLink, {
  exports: linkExports, module: linkModule,
  require: (name: string) => mocks[name] || {},
  URL, Date, console, AbortController, setTimeout, clearTimeout,
  process: { env: {} },
}, { timeout: 3000 })

for (const query of [
  'Find my saved links about password is test-only',
  'Find my saved links about API key is synthetic-123',
  'Find my saved links about card number 4111 1111 1111 1111',
]) {
  embeddedInputs.length = 0
  semanticRpcCalls = 0
  const results = await linkExports.queryLinkVault(42, query)
  assert.equal(Array.isArray(results), true)
  assert.equal(embeddedInputs.length, 0, 'Link Vault must never send synthetic secret queries to an embedding provider: ' + query)
  assert.equal(semanticRpcCalls, 0, 'secret-shaped query must not initiate semantic RPC')
}
embeddedInputs.length = 0
semanticRpcCalls = 0
const benignResults = await linkExports.queryLinkVault(42, 'Find my saved links about design planning')
assert.equal(benignResults.length, 1, 'ordinary lexical search still works')
assert.deepEqual(embeddedInputs, ['design planning'], 'ordinary semantic fallback remains functional')
assert.equal(semanticRpcCalls, 1)
assert.equal(privateReads, 4, 'the read-only lexical query remains enabled for all cases')
console.log('PASS: actual Link Vault query withholds synthetic secrets from provider egress; benign lexical + semantic search retained')
