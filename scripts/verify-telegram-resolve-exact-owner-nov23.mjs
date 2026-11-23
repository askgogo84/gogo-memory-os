// Provider-free security regression for the real Telegram resolver, not a copied parser.
// Sealed VM: no Telegram API, real Supabase, network, secrets, or account writes.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'

const ts = createRequire(import.meta.url)('typescript')
const source = readFileSync('lib/bot/resolve-user.ts', 'utf8')
const code = ts.transpileModule(source, {
  fileName: 'resolve-user.ts',
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText

function fixture() {
  const lookup = [], inserts = [], otherTables = []
  const chain = {
    select() { return chain },
    eq(column, value) {
      assert.equal(column, 'telegram_id')
      lookup.push(value)
      return chain
    },
    async single() {
      assert.equal(lookup.length, 1)
      const id = lookup[0]
      return { data: { id: 'fixture-user', telegram_id: id, name: 'Fixture',
        whatsapp_id: null, timezone: 'Asia/Kolkata', tier: 'free' }, error: null }
    },
    insert(row) { inserts.push(row); throw Error('test must never create account') },
  }
  const deps = {
    '@/lib/supabase-admin': {
      supabaseAdmin: { from(table) {
        if (table !== 'users') { otherTables.push(table); throw Error('unexpected table') }
        return chain
      } },
    },
    './handlers/user-timezone': { getUserTimeZone: () => 'Asia/Kolkata' },
    '@/lib/dashboard/owner-identity': {
      allocateWhatsAppOwnerId: () => { throw Error('unexpected WhatsApp allocation') },
      exactSessionOwnerId: () => { throw Error('unexpected WhatsApp parsing') },
    },
  }
  const mod = { exports: {} }
  runInNewContext(code, {
    module: mod, exports: mod.exports,
    require(id) {
      if (!(id in deps)) throw Error('unexpected import: ' + id)
      return deps[id]
    },
    console, Date,
  }, { filename: 'inert-resolve-user.js', timeout: 2000 })
  return {
    resolve: externalUserId => mod.exports.resolveUser({
      channel: 'telegram', externalUserId, userName: 'Fixture',
    }),
    lookup, inserts, otherTables,
  }
}

let pass = 0, fail = 0
async function check(label, fn) {
  try { await fn(); pass++; console.log('PASS', label) }
  catch (e) { fail++; console.error('FAIL', label, String(e?.message || e)) }
}

// Preserve the numeric legacy contract for canonical, exactly representable users.
for (const owner of ['42', '-42', '9007199254740991', '-9007199254740991']) {
  await check('CONTROL canonical safe Telegram ID ' + owner, async () => {
    const f = fixture()
    const resolved = await f.resolve(owner)
    assert.equal(resolved.telegramId, Number(owner))
    assert.equal(resolved.rawUser.telegram_id, Number(owner))
    assert.deepEqual(f.lookup, [Number(owner)])
    assert.equal(f.inserts.length, 0)
    assert.equal(f.otherTables.length, 0)
  })
}

// Mandatory: parseInt used to accept a prefix, even if the original owner
// string was malformed; Number could also round an oversized private ID.
for (const owner of [
  '42garbage', '42.0', '4.2e1', ' 42', '42 ', '+42', '042',
  '42\n', '0', '-0', '', 'NaN', 'Infinity',
  '9007199254740992', '9007199254740993', '-9007199254740993',
  '9223372036854775807', '9223372036854775808', '-9223372036854775808',
]) {
  await check('MANDATORY deny malformed or unsafe Telegram owner ' + JSON.stringify(owner), async () => {
    const f = fixture()
    await assert.rejects(f.resolve(owner), /telegram_owner_identity_invalid/)
    assert.deepEqual(f.lookup, [], 'must refuse before any users lookup')
    assert.deepEqual(f.inserts, [], 'must refuse before any account creation')
    assert.deepEqual(f.otherTables, [])
  })
}

console.log('TELEGRAM EXACT OWNER: ' + pass + ' PASS / ' + fail + ' FAIL; offline only')
if (fail) process.exitCode = 1
