import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { exactOwnerOnly, exactSessionOwnerId, allocateWhatsAppOwnerId } from '../lib/dashboard/owner-identity'
import { linkedTelegramIds, idsForWhatsapp } from '../lib/dashboard/owner-ids'

// Exercise the actual runtime helpers, not merely static source inspections.
assert.deepEqual(await linkedTelegramIds('4242'), ['4242'])
assert.deepEqual(await linkedTelegramIds('-884501501'), ['-884501501'])
assert.deepEqual(await idsForWhatsapp('whatsapp:+918884501501'), [])
assert.deepEqual(await idsForWhatsapp('whatsapp:+198884501501'), [])
assert.deepEqual(await linkedTelegramIds(Number.MAX_SAFE_INTEGER + 10), [])

assert.deepEqual(exactOwnerOnly('4242'), ['4242'])
assert.deepEqual(exactOwnerOnly(-884501501), ['-884501501'])
assert.deepEqual(exactOwnerOnly('9007199254740993'), ['9007199254740993'])
assert.deepEqual(exactOwnerOnly(Number.MAX_SAFE_INTEGER + 2), [])
assert.deepEqual(exactOwnerOnly(''), [])
assert.deepEqual(exactOwnerOnly('0'), [])
assert.deepEqual(exactOwnerOnly('123e4'), [])
assert.equal(exactSessionOwnerId('whatsapp:+918884501501'), null)
const idA=allocateWhatsAppOwnerId(new Uint8Array(7))
const idB=allocateWhatsAppOwnerId(new Uint8Array(7).fill(255))
assert.ok(Number.isSafeInteger(idA)&&Number.isSafeInteger(idB))
assert.ok(idA<-1_000_000_000&&idB<-1_000_000_000)
assert.notEqual(idA,idB)
assert.notEqual(idA,-884501501)
assert.throws(()=>allocateWhatsAppOwnerId(new Uint8Array(1)))

const own=readFileSync('lib/dashboard/owner-ids.ts','utf8')
const resolver=readFileSync('lib/bot/resolve-user.ts','utf8')
const workspace=readFileSync('lib/agent/google-workspace-read.ts','utf8')
assert.match(own,/exactOwnerOnly\(sessionTelegramId\)/)
assert.doesNotMatch(own,/slice\(-(?:9|10)\)|\.ilike\(|%\$\{digits\}/i)
assert.match(own,/idsForWhatsapp\([\s\S]*?return \[\]/)
assert.match(resolver,/allocateWhatsAppOwnerId\(\)/)
assert.doesNotMatch(resolver,/generateNegativeTelegramId|slice\(-9\)/)
assert.match(workspace,/const ids=\[String\(actor\.legacyTelegramId\)\]/)
assert.doesNotMatch(workspace,/idsForWhatsapp\(actor\.whatsappId\)/)
console.log('P0 original owner-only and allocation fixture controls passed')

const failures: string[] = []
async function check(name: string, run: () => unknown) {
  try { await run(); console.log('PASS ' + name) } catch (err: any) { failures.push(name + ': ' + err.message) }
}
function load(path: string, mocks: Record<string, unknown>, append = '') {
  const out: any = {}
  const source = readFileSync(path, 'utf8') + append
  runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, {
    exports: out, module: { exports: out }, Buffer, BigInt, Date, Intl, console, Response, Request, URL, URLSearchParams,
    require: (name: string) => {
      if (Object.hasOwn(mocks, name)) return mocks[name]
      throw new Error('Unmocked dependency in inert owner containment test: ' + name)
    },
    fetch: () => { throw new Error('Network is forbidden in owner containment test') },
  })
  return out
}

await check('exact owners reject padding and signed64 overflow without normalization', async () => {
  for (const owner of [' 4242', '4242 ', '\u00a04242\u00a0', '\t4242\n', '9223372036854775808', '-9223372036854775809']) {
    assert.equal(exactSessionOwnerId(owner), null, owner)
    assert.deepEqual(await linkedTelegramIds(owner), [])
  }
  for (const owner of ['9223372036854775807', '-9223372036854775808', '9007199254740993', '4242']) {
    assert.equal(exactSessionOwnerId(owner), owner)
  }
})

await check('Make listing cannot fall back to unvalidated raw session owner', async () => {
  let dbCalls = 0
  let selected: unknown
  const rows = ['9007199254740992', '9007199254740993'].map((owner, i) => ({ owner, id: `artifact-${i}`, type: 'research_brief', title: `PRIVATE_${owner}` }))
  const query: any = { select: () => query, eq: (_key: string, value: unknown) => { selected = value; return query },
    in: () => { throw Error('No inferred owner expansion') }, order: () => query, limit: async () => ({ data: rows.filter(r => r.owner === selected), error: null }) }
  const make = load('lib/dashboard/make.ts', {
    '@/lib/supabase-admin': { supabaseAdmin: { from: () => { dbCalls++; return query } } },
    './owner-identity': { exactSessionOwnerId },
    './owner-ids': { linkedTelegramIds: async (owner: string) => exactOwnerOnly(owner) },
  })
  for (const owner of [' 4242 ', '\u00a04242\u00a0', '9223372036854775808', '0']) {
    const before = dbCalls
    const result = await make.getMadeForYou(owner)
    assert.equal(result.items.length, 0)
    assert.equal(dbCalls, before, 'invalid listing owner must not enter private table')
  }
  const own = await make.getMadeForYou('9007199254740993')
  assert.equal(selected, '9007199254740993')
  assert.equal(own.items.length, 1)
  assert.equal(own.items[0].title, 'PRIVATE_9007199254740993')
  const unavailable = load('lib/dashboard/make.ts', {
    '@/lib/supabase-admin': { supabaseAdmin: { from: () => { throw Error('Fallback must not query') } } },
    './owner-identity': { exactSessionOwnerId },
    './owner-ids': { linkedTelegramIds: async () => { throw Error('fixture helper unavailable') } },
  })
  assert.equal((await unavailable.getMadeForYou('4242')).ok, false)
})

await check('direct report rejects invalid owner before private query and never probes foreign rows', async () => {
  let owner = ' 4242 ', dbCalls = 0, selected: unknown
  const query: any = { select: () => query, eq: (key: string, value: unknown) => { if (key === 'telegram_id') selected = value; return query },
    maybeSingle: async () => ({ data: selected === '9007199254740993' ? { content_json: { doc: { format: 'deck', title: 'PRIVATE_OWNER_B' } } } : null, error: null }) }
  const page = load('app/dashboard/(app)/reports/[id]/page.tsx', {
    'next/link': { default: () => null }, 'next/navigation': { notFound: () => { throw Error('NOT_FOUND') }, redirect: () => { throw Error('REDIRECT') } },
    '@/lib/dashboard/session': { getSession: async () => ({ telegramId: owner }) },
    '@/lib/supabase-admin': { supabaseAdmin: { from: () => { dbCalls++; return query } } },
    '@/lib/dashboard/owner-identity': { exactSessionOwnerId }, '@/lib/dashboard/owner-ids': { linkedTelegramIds },
    '@/lib/agent/artifact-presentation': { publicResearchUrl: (x: string) => x }, '@/lib/agent/artifact-versions': {},
    '@/components/dashboard/report-editor': {}, '@/lib/workspaces/access': { listMyWorkspaces: async () => [] }, '../../business/share-to-workspace': {},
    '@/components/dashboard/make-doc-viewer': { MakeDocViewer: 'viewer' }, 'react/jsx-runtime': { jsx: (type: unknown, props: unknown) => ({ type, props }), jsxs: (type: unknown, props: unknown) => ({ type, props }) },
  })
  const params = Promise.resolve({ id: '00000000-0000-4000-8000-000000000001' })
  await assert.rejects(page.default({ params }), /NOT_FOUND/)
  assert.equal(dbCalls, 0, 'invalid direct report cannot query another canonical owner')
  owner = '4242'
  await assert.rejects(page.default({ params }), /NOT_FOUND/)
  assert.equal(dbCalls, 1, 'own miss must not probe a foreign owner or infer links')
  owner = '9007199254740992'
  await assert.rejects(page.default({ params }), /NOT_FOUND/)
  owner = '9007199254740993'
  assert.match(JSON.stringify(await page.default({ params })), /PRIVATE_OWNER_B/)
  assert.equal(selected, owner, 'direct report retains the exact neighboring owner')
})

await check('WhatsApp owner lookup failure cannot create a new owner', async () => {
  let inserts = 0
  const query: any = { select: () => query, eq: () => query,
    insert: () => { inserts++; return query },
    maybeSingle: async () => ({ data: null, error: { code: '08006', message: 'fixture read unavailable' } }),
    single: async () => ({ data: null, error: { code: '08006', message: 'fixture read unavailable' } }) }
  const resolver = load('lib/bot/resolve-user.ts', {
    '@/lib/supabase-admin': { supabaseAdmin: { from: () => query } }, './handlers/user-timezone': { getUserTimeZone: () => 'UTC' },
    '@/lib/dashboard/owner-identity': { allocateWhatsAppOwnerId, exactSessionOwnerId },
  })
  await assert.rejects(resolver.resolveUser({ channel: 'whatsapp', externalUserId: 'whatsapp:+12025550123' }))
  assert.equal(inserts, 0, 'a failed/ambiguous owner read must not enter insertion')
})

await check('WhatsApp creation retries only known uniqueness and reads back same-sender races', async () => {
  for (const mode of ['idCollision', 'senderRace', 'transport', 'missingRow', 'unsafeExisting', 'safeExisting', 'exhausted', 'writeError', 'raceReadError'] as const) {
    let inserts = 0, reads = 0
    const sender = 'whatsapp:+12025550123'
    const calls: number[] = []
    const db = { from: () => {
      let inserted: any = null
      const q: any = { select: () => q, eq: () => q, insert: (row: any) => { inserted = row; inserts++; calls.push(row.telegram_id); return q },
        maybeSingle: async () => {
          reads++
          return { data: mode === 'unsafeExisting' ? { telegram_id: '9007199254740993', whatsapp_id: sender }
            : mode === 'safeExisting' || (mode === 'senderRace' && reads > 1) ? { telegram_id: -2251799813685249, whatsapp_id: sender } : null,
            error: mode === 'raceReadError' && reads > 1 ? { code: '08006', message: 'fixture readback unavailable' } : null }
        },
        single: async () => {
          if (!inserted) return q.maybeSingle()
          if (mode === 'transport') throw Error('fixture transport outcome unknown')
          if (mode === 'missingRow') return { data: null, error: null }
          if (mode === 'writeError') return { data: null, error: { code: '42501', message: 'fixture write denied' } }
          if (inserts === 1 || mode === 'senderRace' || mode === 'exhausted') return { data: null, error: { code: '23505', message: 'fixture unique collision' } }
          return { data: { ...inserted }, error: null }
        } }
      return q
    } }
    const resolver = load('lib/bot/resolve-user.ts', {
      '@/lib/supabase-admin': { supabaseAdmin: db }, './handlers/user-timezone': { getUserTimeZone: () => 'UTC' },
      '@/lib/dashboard/owner-identity': { allocateWhatsAppOwnerId: () => -2251799813685250 - inserts, exactSessionOwnerId },
    })
    const run = () => resolver.resolveUser({ channel: 'whatsapp', externalUserId: sender })
    if (mode === 'idCollision') { assert.equal((await run()).isNewUser, true); assert.equal(inserts, 2); assert.notEqual(calls[0], calls[1]) }
    else if (mode === 'senderRace') { assert.equal((await run()).telegramId, -2251799813685249); assert.equal(inserts, 1) }
    else if (mode === 'safeExisting') { assert.equal((await run()).isNewUser, false); assert.equal(inserts, 0) }
    else { await assert.rejects(run()); assert.equal(inserts, mode === 'unsafeExisting' ? 0 : mode === 'exhausted' ? 4 : 1, 'unknown outcomes are never re-inserted') }
  }
})

await check('Workspace rejects unsafe numeric actor before credential or provider selection', async () => {
  let dbCalls = 0, providerCalls = 0
  const selection: string[][] = []
  const q: any = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: null, error: null }) }
  const workspaceModule = load('lib/agent/google-workspace-read.ts', {
    '@/lib/security/email-redaction': { decodeHtmlEntities: (x: string) => x, formatEmailSnippet: (x: string) => x },
    '@/lib/supabase-admin': { supabaseAdmin: { from: () => { dbCalls++; return q } } }, '@/lib/google-gmail': {},
    '@/lib/bot/memory-redaction': { redactSecretShapedText: (x: string) => x }, '@/lib/security/google-token-crypto': {},
    '@/lib/connectors/composio-gmail': { composioConfigured: () => true, activeDriveAccount: async (ids: string[]) => { providerCalls++; selection.push(Array.from(ids)); return 'fixture-account' },
      composioDriveFetch: async () => Response.json({ files: [] }) },
  }, '\nexport { workspaceFetch as __ownerTestFetch };')
  for (const owner of [0, Number.NaN, Number.POSITIVE_INFINITY, 9007199254740992, -9007199254740992]) {
    const before = [dbCalls, providerCalls]
    await assert.rejects(workspaceModule.__ownerTestFetch({ legacyTelegramId: owner, whatsappId: 'whatsapp:+12025550123' }, 'https://www.googleapis.com/drive/v3/files'))
    assert.deepEqual([dbCalls, providerCalls], before)
  }
  await workspaceModule.__ownerTestFetch({ legacyTelegramId: 4242, whatsappId: 'whatsapp:+12025550123' }, 'https://www.googleapis.com/drive/v3/files')
  assert.deepEqual(selection, [['4242']], 'phone never expands credential owners')
})

if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1 }
