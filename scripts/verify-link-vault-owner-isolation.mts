// P1: the REAL Link Vault import/export route handlers must never round persisted
// 64-bit session owner IDs into another tenant's service-role data scope.
// Pure synthetic, actual transpiled TS handlers; no database, network or credentials.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { safeNumericLinkVaultOwnerId } from '../lib/services/link-vault-owner.ts'

const paddedOwnerIds = [' 1234 ', '\t-2345\n', '\u00a01234\u00a0',
  '1234 ', ' 1234', '\u2003-2345\u2003']

let checks = 0
const verify = (name: string, fn: () => void) => {
  fn(); checks++; console.log('PASS Link Vault owner: ' + name)
}

verify('JS aliases adjacent unsafe bigint owners but the boundary rejects both', () => {
  assert.equal(Number('9007199254740992'), Number('9007199254740993'))
  assert.equal(safeNumericLinkVaultOwnerId('9007199254740992'), null)
  assert.equal(safeNumericLinkVaultOwnerId('9007199254740993'), null)
  assert.equal(safeNumericLinkVaultOwnerId(-9007199254740992), null)
})

verify('only exact canonical, safe integer owners enter numeric Link Vault storage', () => {
  for (const raw of [undefined, null, {}, [], '', ' ', '0', '-0', '0012',
    '+12', '1e3', '1.5', 'NaN', 'Infinity', '9007199254740993', '-9007199254740993',
    ...paddedOwnerIds]) {
    assert.equal(safeNumericLinkVaultOwnerId(raw), null, String(raw))
  }
  assert.equal(safeNumericLinkVaultOwnerId('1234'), 1234)
  assert.equal(safeNumericLinkVaultOwnerId('-2345'), -2345)
  assert.equal(safeNumericLinkVaultOwnerId('9007199254740991'), Number.MAX_SAFE_INTEGER)
  assert.equal(safeNumericLinkVaultOwnerId(-123), -123)
  assert.equal(safeNumericLinkVaultOwnerId(Number.MAX_SAFE_INTEGER + 1), null)
})

class FakeResponse {
  body: string
  status: number
  headers: Record<string, string>
  constructor(body: string, options: {status?: number; headers?: Record<string, string>} = {}) {
    this.body = body
    this.status = options.status ?? 200
    this.headers = options.headers ?? {}
  }
  static json(data: unknown, options: {status?: number; headers?: Record<string, string>} = {}) {
    return new FakeResponse(JSON.stringify(data), options)
  }
  async json() { return JSON.parse(this.body) }
}

let sessionId: string | null = '1234'
let sameOrigin = true
let importJsonReads = 0
const exportsSent: number[] = []
const importsSent: {owner: number; input: unknown}[] = []

const modules: Record<string, unknown> = {
  'next/server': { NextResponse: FakeResponse },
  '@/lib/dashboard/session': { getSession: async () => sessionId === null ? null : { telegramId: sessionId } },
  '@/lib/dashboard/guard': {
    verifySameOrigin: () => sameOrigin ? null : FakeResponse.json({ error: 'forbidden' }, { status: 403 }),
  },
  '@/lib/services/link-vault-owner': { safeNumericLinkVaultOwnerId },
  '@/lib/services/link-vault': {
    exportLinkVaultJson: async (owner: number) => {
      exportsSent.push(owner)
      return { version: 'inert-v1', items: [{ title: 'synthetic-owner-data', owner }] }
    },
    importLinkVaultJson: async (owner: number, input: unknown) => {
      importsSent.push({ owner, input })
      return { imported: 1, skipped: 0 }
    },
  },
}

function actualRoute(relativePath: string) {
  const file = new URL('../' + relativePath, import.meta.url)
  const compiled = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const exported: Record<string, any> = {}
  const module = { exports: exported }
  runInNewContext(compiled, {
    exports: exported,
    module,
    require: (name: string) => {
      if (!Object.prototype.hasOwnProperty.call(modules, name)) throw new Error('unexpected import: ' + name)
      return modules[name]
    },
    console,
  }, { filename: relativePath })
  return module.exports
}

const exportHandler = actualRoute('app/api/link-vault/export/route.ts').GET as () => Promise<FakeResponse>
const importHandler = actualRoute('app/api/link-vault/import/route.ts').POST as (req: unknown) => Promise<FakeResponse>
const validImport = {
  json: async () => {
    importJsonReads++
    return { items: [{ url: 'https://example.org/synthetic-owner-link' }] }
  },
}

for (const poisoned of ['9007199254740992', '9007199254740993', '-9007199254740993',
  '12e3', '001234', '0', '', 'not-a-user', ...paddedOwnerIds]) {
  sessionId = poisoned
  const oldExports = exportsSent.length
  const oldImports = importsSent.length
  const oldJsonReads = importJsonReads
  const a = await exportHandler()
  const b = await importHandler(validImport)
  assert.equal(a.status, 409, 'export fail-closed for ' + poisoned)
  assert.equal(b.status, 409, 'import fail-closed for ' + poisoned)
  assert.equal((await a.json()).error, 'owner_id_unrepresentable')
  assert.equal((await b.json()).error, 'owner_id_unrepresentable')
  assert.equal(exportsSent.length, oldExports, 'zero cross-owner exports')
  assert.equal(importsSent.length, oldImports, 'zero cross-owner imports')
  assert.equal(importJsonReads, oldJsonReads, 'reject before consuming imported contents')
}
console.log('PASS Link Vault owner: unsafe/colliding exact owner IDs never reach either actual handler')
checks++

sessionId = null
assert.equal((await exportHandler()).status, 401)
assert.equal((await importHandler(validImport)).status, 401)
assert.equal(exportsSent.length, 0)
assert.equal(importsSent.length, 0)
console.log('PASS Link Vault owner: unauthenticated owner cannot export or import')
checks++

sessionId = '1234'
sameOrigin = false
assert.equal((await importHandler(validImport)).status, 403)
assert.equal(importJsonReads, 0)
assert.equal(importsSent.length, 0)
sameOrigin = true
console.log('PASS Link Vault owner: cross-origin import remains refused without reading body')
checks++

const safeExport = await exportHandler()
assert.equal(safeExport.status, 200)
assert.deepEqual(exportsSent, [1234])
assert.equal((await safeExport.json()).items[0].owner, 1234)
assert.equal(safeExport.headers['Cache-Control'], 'no-store')

const safeImport = await importHandler(validImport)
assert.equal(safeImport.status, 200)
assert.equal((await safeImport.json()).imported, 1)
assert.equal(importsSent.length, 1)
assert.equal(importsSent[0].owner, 1234)
assert.equal(importJsonReads, 1)
console.log('PASS Link Vault owner: ordinary signed-in exports/imports retain exact numeric owner, same-origin, no-store')
checks++

sessionId = '-2345'
assert.equal((await exportHandler()).status, 200)
assert.equal((await importHandler(validImport)).status, 200)
assert.equal(exportsSent.at(-1), -2345)
assert.equal(importsSent.at(-1)?.owner, -2345)
console.log('PASS Link Vault owner: safe negative WhatsApp actor still works')
checks++

console.log('Link Vault owner isolation: ' + checks + ' independent synthetic checks passed')
