// RED regression for the original production Ops Alerts billing account selector.
// Synthetic users only. No Supabase connection, Gmail, WhatsApp, secrets, accounts or HTTP calls.
// Failure means the deployed selector can confuse distinct international owners.
// This test intentionally remains failing until the Claude-owned lib/ops/run.ts
// implementation is fixed and independently security reviewed.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const path = 'lib/ops/run.ts'
const source = readFileSync(path, 'utf8')
const start = source.indexOf('async function userByPhone(')
const end = source.indexOf('/** Billing problems', start)
assert.ok(start >= 0 && end > start, 'locate the original userByPhone production function')
const original = source.slice(start, end)
// The shipped function closes over last10; this helper is only part of the inert test harness.
const helper = "const last10 = (v) => String(v ?? '').replace(/\\D/g, '').slice(-10)"
const code = ts.transpileModule(
  helper + '\n' + original + '\n globalThis.__userByPhone = userByPhone',
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
).outputText

let rows = []
let reads = 0
const db = {
  from(table) {
    assert.equal(table, 'users', 'owner selector must query users only')
    reads += 1
    let matched = [...rows]
    const query = {
      select() { return this },
      eq(field, value) {
        matched = matched.filter(r => String(r[field]) === String(value))
        return this
      },
      ilike(field, pattern) {
        const suffix = String(pattern).replace(/^%/, '').toLowerCase()
        matched = matched.filter(r => String(r[field] ?? '').toLowerCase().endsWith(suffix))
        return this
      },
      limit(n) { return Promise.resolve({ data: matched.slice(0, n), error: null }) },
      maybeSingle() { return Promise.resolve({ data: matched[0] || null, error: null }) },
      then(resolve, reject) { return Promise.resolve({ data: matched, error: null }).then(resolve, reject) },
    }
    return query
  },
}
const sandbox = { supabaseAdmin: db }
vm.runInNewContext(code, sandbox, { timeout: 1000, filename: 'inert-original-ops-owner-selector.js' })
const selectOwner = sandbox.__userByPhone
assert.equal(typeof selectOwner, 'function')

const ten = '9123456789'
const exact = '+91' + ten
const otherCountrySameSuffix = '+1' + ten
const ownRow = { telegram_id: '-919123456789', whatsapp_id: 'whatsapp:' + exact }
const otherRow = { telegram_id: '1001', whatsapp_id: 'whatsapp:' + otherCountrySameSuffix }
let passed = 0
let failed = 0
async function check(name, input, fixtureRows, expectedId, allowReads = true) {
  rows = fixtureRows
  reads = 0
  try {
    const result = await selectOwner(input)
    assert.equal(result?.telegram_id ?? null, expectedId, name)
    if (!allowReads) assert.equal(reads, 0, 'reject malformed/local-only phone before database reads')
    passed += 1
    console.log('PASS', name)
  } catch (error) {
    failed += 1
    console.error('FAIL', name, ':', error?.message || String(error))
  }
}
await check('exact international owner resolves one trusted row', exact, [ownRow], ownRow.telegram_id)
await check('international WhatsApp prefix resolves exact owner', 'whatsapp:' + exact, [ownRow], ownRow.telegram_id)
await check('other-country same national suffix must NOT resolve', exact, [otherRow], null)
await check('other-country collision must not supersede the actual owner', exact, [otherRow, ownRow], ownRow.telegram_id)
await check('local-only ten-digit number cannot authorize owner', ten, [ownRow], null, false)
await check('ambiguous duplicate full international owner fails closed', exact,
  [ownRow, { ...ownRow, telegram_id: '-919123456788' }], null)
await check('unsafe rounded 64-bit database owner must not be used', exact,
  [{ ...ownRow, telegram_id: Number.MAX_SAFE_INTEGER + 2 }], null)
await check('unknown fully qualified owner does not resolve', '+447700900901', [ownRow], null)

console.log('Original-source Ops Alerts billing owner isolation:', passed, 'passed,', failed, 'failed')
if (failed > 0) {
  console.error('EXPECTED RED: same-suffix or ambiguous private-account resolution remains unsafe in production source.')
  process.exitCode = 1
}
