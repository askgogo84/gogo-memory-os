// Isolated, test-only source execution: NO external network, database, WhatsApp or real users.
// This test intentionally stays RED until the original production function fails closed
// for imprecise/invalid owner IDs. Never merge or deploy an expected-RED PR.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync('lib/services/link-vault.ts', 'utf8')
const ast = ts.createSourceFile('link-vault.ts', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS)
const target = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'exportLinkVaultJson')
assert.ok(target, 'original Link Vault export implementation must exist')
const isolated = ts.transpileModule(target.getText(ast), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  reportDiagnostics: true,
})
assert.equal((isolated.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0)

const OWNER_A = '9007199254740992'
const OWNER_B = '9007199254740993'
assert.notEqual(OWNER_A, OWNER_B)
assert.equal(Number(OWNER_A), Number(OWNER_B), 'setup: distinct BIGINTs alias through Number')
const item = (who, note) => ({
  canonical_url: 'https://example.org/' + who, original_url: 'https://example.org/' + who,
  platform: 'web', item_type: 'article', title: 'Private ' + who,
  description: 'Synthetic only', user_note: note, saved_at: '2026-10-30T00:00:00Z',
  topic: null, tags: [], shelf: 'reference', preview_image: null,
  enrichment_status: 'metadata_only', auth_required: false,
})
const records = new Map([
  ['42', [item('safe-42', 'SAFE_42_NOTE')]],
  [OWNER_A, [item('owner-A', 'OWNER_A_PRIVATE_NOTE')]],
  [OWNER_B, [item('owner-B', 'OWNER_B_PRIVATE_NOTE')]],
])
let observations = []
const context = {
  exports: {}, Date, Error,
  supabaseAdmin: { from(table) {
    assert.equal(table, 'link_vault_items', 'never access unrelated tables')
    const query = { field: null, value: null,
      select() { return this },
      eq(field, value) { this.field = field; this.value = value; observations.push({ field, value }); return this },
      order() {
        assert.equal(this.field, 'telegram_id', 'all reads must be owner scoped')
        return Promise.resolve({ data: records.get(String(this.value)) || [], error: null })
      },
    }
    return query
  } },
}
vm.createContext(context, { codeGeneration: { strings: false, wasm: false } })
vm.runInContext(isolated.outputText, context, { timeout: 1500, filename: 'original-link-vault-export.vm.js' })
const exportOriginal = context.exports.exportLinkVaultJson
assert.equal(typeof exportOriginal, 'function')

let passed = 0, failed = 0
async function check(label, test) {
  observations = []
  try { await test(); console.log('PASS ' + label); passed++ }
  catch (err) { console.error('SECURITY RED ' + label + ': ' + (err?.message || err)); failed++ }
}

await check('control: safe numeric owner exports only own note', async () => {
  const out = await exportOriginal(42)
  assert.equal(out.items.length, 1)
  assert.equal(out.items[0].note, 'SAFE_42_NOTE')
  assert.equal(observations.length, 1)
  assert.equal(String(observations[0].value), '42')
})
await check('control: distinct exact BIGINT string owner A selects A only', async () => {
  const out = await exportOriginal(OWNER_A)
  assert.equal(out.items.length, 1)
  assert.equal(out.items[0].note, 'OWNER_A_PRIVATE_NOTE')
  assert.equal(String(observations[0].value), OWNER_A)
})
await check('control: distinct exact BIGINT string owner B selects B only', async () => {
  const out = await exportOriginal(OWNER_B)
  assert.equal(out.items.length, 1)
  assert.equal(out.items[0].note, 'OWNER_B_PRIVATE_NOTE')
  assert.equal(String(observations[0].value), OWNER_B)
})
await check('control: absent safe numeric owner exports empty private vault', async () => {
  const out = await exportOriginal(123)
  assert.equal(out.items.length, 0)
  assert.equal(out.visibility, 'private')
  assert.equal(String(observations[0].value), '123')
})

async function mustFailClosed(value, forbiddenNote) {
  let rejected = false, output = null
  try { output = await exportOriginal(value) } catch { rejected = true }
  if (forbiddenNote) assert.ok(!output?.items?.some(x => x.note === forbiddenNote), 'other owner private note exposed')
  assert.equal(observations.length, 0, 'invalid or imprecise owner must be rejected BEFORE service-role query')
  assert.ok(rejected || !output?.items?.length, 'invalid owner must not return private Link Vault rows')
}
await check('P1: already-rounded unsafe BIGINT number must not export owner A for owner B', async () => {
  await mustFailClosed(Number(OWNER_B), 'OWNER_A_PRIVATE_NOTE')
})
await check('P1: negative unsafe owner number must fail closed before database read', async () => {
  await mustFailClosed(Number('-9007199254740993'))
})
await check('P1: fractional owner ID must fail closed before service-role read', async () => {
  await mustFailClosed(42.5)
})
await check('P1: non-decimal owner string must fail closed before service-role read', async () => {
  await mustFailClosed('not-an-owner')
})
console.log('Link Vault exact-owner source-execution result: ' + passed + ' PASS, ' + failed + ' expected-security-RED; NO real users/providers')
if (failed) process.exitCode = 1
