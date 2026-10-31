// TEST ONLY — original-source Workspace Drive binary owner-precision diagnostic.
// All accounts/tokens/binary bodies are synthetic; VM network and database are fully intercepted.
// This intentionally exits nonzero on existing owner-safety failures. DO NOT MERGE/DEPLOY.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const path = 'lib/agent/google-workspace-drive-binary.ts'
const original = readFileSync(path, 'utf8')
const ast = ts.createSourceFile(path, original, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const names = ['credentials', 'refresh', 'workspaceFetch', 'fetchDriveBytes']
const functions = new Map(ast.statements
  .filter(ts.isFunctionDeclaration)
  .map(node => [node.name?.text, node.getText(ast)]))
for (const name of names) assert.ok(functions.has(name), 'expected original exported/private function: ' + name)
assert.match(original, /const MAX_DRIVE_BINARY_BYTES\s*=\s*8\s*\*\s*1024\s*\*\s*1024/, 'source binary budget unexpectedly changed')
const code = ts.transpileModule(
  [...names.map(n => functions.get(n)), 'globalThis.__test = { fetchDriveBytes };'].join('\n\n'),
  { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } },
).outputText

const file = { id: 'fixture-google-file', name: 'fixture.pdf', size: 100 }
const row = (owner, overrides = {}) => ({
  gmail_connected: true,
  gmail_access_token: 'fixture-access-' + owner,
  gmail_refresh_token: '',
  ...overrides,
})
function isolate(rows) {
  const reads = []
  const network = []
  const database = {
    from(table) {
      assert.equal(table, 'users', 'no other tables may be queried')
      return {
        select() {
          return {
            eq(field, value) {
              assert.equal(field, 'telegram_id')
              reads.push(value)
              return {
                async maybeSingle() {
                  return { data: rows[String(value)] ?? null, error: null }
                },
              }
            },
          }
        },
        update() {
          throw Error('fixture forbids token persistence writes')
        },
      }
    },
  }
  const sandbox = {
    supabaseAdmin: database,
    decryptGoogleToken: value => String(value ?? ''),
    encryptGoogleToken: value => String(value ?? ''),
    refreshGmailAccessToken: async () => { throw Error('fixture forbids refresh') },
    MAX_DRIVE_BINARY_BYTES: 8 * 1024 * 1024,
    Buffer,
    URL,
    console: { error: () => {} },
    fetch: async (url, init) => {
      network.push({ url: String(url), authorization: String(init?.headers?.Authorization || '') })
      assert.match(String(url), /^https:\/\/www\.googleapis\.com\/drive\/v3\/files\/fixture-google-file\?alt=media$/)
      return new Response('synthetic-file-bytes:' + String(init?.headers?.Authorization || ''), {
        status: 200,
        headers: { 'content-length': '48' },
      })
    },
  }
  vm.runInNewContext(code, sandbox, { filename: path + ' (unchanged selected functions)', timeout: 1500 })
  return { read: sandbox.__test.fetchDriveBytes, reads, network }
}

let controls = 0, controlFailures = 0, safety = 0, safetyFailures = 0
async function check(kind, name, fn) {
  try {
    await fn()
    console.log('PASS ' + kind + ' ' + name)
    if (kind === 'CONTROL') controls++
    else safety++
  } catch (error) {
    console.error('FAIL ' + kind + ' ' + name + ': ' + (error?.message || String(error)))
    if (kind === 'CONTROL') controlFailures++
    else safetyFailures++
  }
}
await check('CONTROL', 'safe owner reads only its own synthetic OAuth token', async () => {
  const f = isolate({ '101': row('101'), '202': row('202') })
  const bytes = await f.read({ legacyTelegramId: 101 }, file)
  assert.match(bytes.toString(), /Bearer fixture-access-101/)
  assert.deepEqual(f.reads, [101])
  assert.equal(f.network.length, 1)
  assert.equal(f.network[0].authorization, 'Bearer fixture-access-101')
})
await check('CONTROL', 'distinct safe owner cannot borrow another synthetic token', async () => {
  const f = isolate({ '101': row('101'), '202': row('202') })
  const bytes = await f.read({ legacyTelegramId: 202 }, file)
  assert.match(bytes.toString(), /Bearer fixture-access-202/)
  assert.doesNotMatch(bytes.toString(), /fixture-access-101/)
  assert.deepEqual(f.reads, [202])
})
await check('CONTROL', 'disconnected Workspace refuses provider read', async () => {
  const f = isolate({ '101': row('101', { gmail_connected: false }) })
  await assert.rejects(() => f.read({ legacyTelegramId: 101 }, file), /workspace_not_connected/)
  assert.equal(f.network.length, 0)
})
await check('CONTROL', 'missing OAuth credentials refuse provider read', async () => {
  const f = isolate({ '101': row('101', { gmail_access_token: '', gmail_refresh_token: '' }) })
  await assert.rejects(() => f.read({ legacyTelegramId: 101 }, file), /workspace_reconnect_required/)
  assert.equal(f.network.length, 0)
})
await check('CONTROL', 'over-budget Drive binary rejects before privileged read', async () => {
  const f = isolate({ '101': row('101') })
  await assert.rejects(() => f.read({ legacyTelegramId: 101 }, { ...file, size: 8 * 1024 * 1024 + 1 }), /workspace_drive_binary_too_large/)
  assert.equal(f.reads.length, 0)
  assert.equal(f.network.length, 0)
})
await check('CONTROL', 'missing file id rejects before privileged read', async () => {
  const f = isolate({ '101': row('101') })
  await assert.rejects(() => f.read({ legacyTelegramId: 101 }, { ...file, id: '' }), /workspace_file_id_missing/)
  assert.equal(f.reads.length, 0)
  assert.equal(f.network.length, 0)
})

const unsafeCases = [
  ['unsafe 64-bit number', 9007199254740992],
  ['64-bit source identity already rounded by JS Number', Number('9007199254740993')],
  ['unsafe decimal string (invalid AgentActor runtime input)', '9007199254740993'],
  ['zero identifier', 0],
  ['infinite numeric identifier', Number.POSITIVE_INFINITY],
  ['fractional identifier', 101.25],
  ['not-a-number identifier', Number.NaN],
]
for (const [label, unsafeId] of unsafeCases) {
  await check('SAFETY', label + ' must fail closed before private credentials or Drive fetch', async () => {
    const f = isolate({ [String(unsafeId)]: row('synthetic-other-owner') })
    let error = null
    try { await f.read({ legacyTelegramId: unsafeId }, file) } catch (caught) { error = caught }
    assert.match(String(error?.message || ''), /workspace_owner_invalid/, 'unsafe actor was not rejected with owner-invalid')
    assert.equal(f.reads.length, 0, 'unsafe actor triggered service-role credential query')
    assert.equal(f.network.length, 0, 'unsafe actor triggered credential-bearing Drive egress')
  })
}
console.log('ORIGINAL_SOURCE_WORKSPACE_DRIVE_OWNER_PRECISION: benign=' + controls + '/6 safety=' + safety + '/7 control_failures=' + controlFailures + ' safety_failures=' + safetyFailures)
console.log('Source: ' + path + '; no real account, database, OAuth token, network, Gmail or Drive access')
if (controlFailures || safetyFailures) process.exitCode = 1
