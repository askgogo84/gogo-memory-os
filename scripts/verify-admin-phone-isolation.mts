import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

/**
 * Fully inert actual-module authorization regressions: no external provider,
 * database, cookie, network, account or admin API is called.
 */
function load(sourcePath: string, mocks: Record<string, unknown>, env: Record<string, string>) {
  const out: Record<string, any> = {}
  const script = ts.transpileModule(readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  runInNewContext(script, {
    exports: out, process: { env }, Buffer, Date, URL, Math, JSON, console,
    require: (name: string) => {
      if (Object.hasOwn(mocks, name)) return mocks[name]
      throw new Error('Unmocked import in offline admin fixture: ' + name)
    },
  })
  return out
}

const env: Record<string, string> = {
  ADMIN_WHATSAPP_NUMBERS: '+919876543210,+12025550105',
}
const analytics = load('lib/bot/handlers/admin-analytics.ts', {
  '@/lib/supabase-admin': { supabaseAdmin: { from: () => { throw new Error('No database permitted') } } },
}, env)
const adminPhone: (v: string | null | undefined) => boolean = analytics.isAdminPhone

for (const exact of ['+919876543210', 'whatsapp:+919876543210', 'WHATSAPP:+919876543210', '919876543210', '+12025550105']) {
  assert.equal(adminPhone(exact), true, 'exact explicit full E.164 owner ' + exact)
}
for (const foreign of ['+449876543210', 'whatsapp:+449876543210', '+19876543210',
  '9876543210', 'whatsapp:9876543210', '+919876543210xxx',
  'prefix+919876543210', '+0919876543210', 'whatsapp:+919876543210?x=y', '',
  null, undefined]) {
  assert.equal(adminPhone(foreign), false, 'never authorize suffix/local/malformed ' + foreign)
}
env.ADMIN_WHATSAPP_NUMBERS = '9876543210'
assert.equal(adminPhone('+919876543210'), false, 'legacy local-only privileged config must fail closed')
env.ADMIN_WHATSAPP_NUMBERS = ''
assert.equal(adminPhone('+919876543210'), false, 'no configured admin must fail closed')
env.ADMIN_WHATSAPP_NUMBER = '+919876543210'
assert.equal(adminPhone('whatsapp:+919876543210'), true, 'singular explicit config still supported')
env.ADMIN_WHATSAPP_NUMBERS = '+919876543210,+12025550105'
delete env.ADMIN_WHATSAPP_NUMBER

let currentUser: { telegram_id: unknown; whatsapp_id?: string; name?: string } | null = null
let sessionOwner: unknown = '101'
let userError: unknown = null
let userThrows = false
let memberError: unknown = null
let userReads: unknown[] = []
let activeSession = true
let memberReads: string[] = []
const members: Record<string, { name: string; role: string; active: boolean }> = {
  '+12025550111': { name: 'Explicit Operator', role: 'operator', active: true },
}
const db = {
  from(table: string) {
    if (table === 'users') {
      return {
        select: () => ({
          eq: (field: string, id: unknown) => {
            assert.equal(field, 'telegram_id')
            userReads.push(id)
            return { maybeSingle: async () => { if (userThrows) throw new Error('inert owner read'); return { data: currentUser, error: userError } } }
          },
        }),
      }
    }
    if (table === 'admin_members') {
      return {
        select: () => ({
          eq: (field: string, id: string) => {
            assert.equal(field, 'phone_e164')
            memberReads.push(id)
            return { maybeSingle: async () => ({ data: members[id] || null, error: memberError }) }
          },
        }),
      }
    }
    throw new Error('Unexpected admin fixture table ' + table)
  },
}
const consoleModule = load('lib/admin/console-auth.ts', {
  'node:crypto': {},
  'next/headers': {},
  '@/lib/supabase-admin': { supabaseAdmin: db },
  '@/lib/dashboard/session': { getSession: async () => activeSession ? { telegramId: sessionOwner } : null },
  '@/lib/bot/handlers/admin-analytics': analytics,
}, env)

async function expectIdentity(whatsappId: string | null, role: string | null, shouldReadMember: boolean) {
  currentUser = whatsappId === null ? null : { telegram_id: sessionOwner, whatsapp_id: whatsappId, name: 'Fixture' }
  memberReads = []
  const actual = await consoleModule.adminIdentity()
  assert.equal(actual?.role || null, role, 'actual console identity for ' + whatsappId)
  if (!shouldReadMember) assert.equal(memberReads.length, 0, 'no member lookup for forbidden/owner ' + whatsappId)
}
await expectIdentity('whatsapp:+919876543210', 'owner', false)
await expectIdentity('919876543210', 'owner', false)
await expectIdentity('+449876543210', null, true)
await expectIdentity('9876543210', null, false)
await expectIdentity('whatsapp:9876543210', null, false)
await expectIdentity('+12025550111', 'operator', true)
await expectIdentity('whatsapp:+12025550111', 'operator', true)
await expectIdentity('2025550111', null, false)
await expectIdentity(null, null, false)
activeSession = false
await expectIdentity('+919876543210', null, false)
activeSession = true

for (const invalid of [null, undefined, '', '0', '00101', '+101', '1e3', ' 101 ', '\u00a0101\u00a0', '9223372036854775808', '-9223372036854775809', 9007199254740992, NaN, Infinity, {}, []]) {
  sessionOwner = invalid
  currentUser = { telegram_id: '101', whatsapp_id: '+919876543210', name: 'Other owner' }
  userReads = []; memberReads = []
  assert.equal(await consoleModule.adminIdentity(), null, 'invalid original owner never authenticates')
  assert.equal(userReads.length, 0, 'invalid owner causes no private users read')
  assert.equal(memberReads.length, 0)
}
for (const owner of ['101', '-101', '9007199254740992', '9007199254740993', '9223372036854775807', '-9223372036854775808', 101, -101]) {
  sessionOwner = owner
  currentUser = { telegram_id: owner, whatsapp_id: '+919876543210', name: 'Exact owner' }
  userReads = []
  const identity = await consoleModule.adminIdentity()
  assert.equal(identity?.role, 'owner')
  assert.equal(identity?.telegramId, String(owner))
  assert.deepEqual(userReads, [String(owner)], 'query must preserve canonical owner string, never Number')
}
sessionOwner = '9007199254740993'
for (const returnedOwner of ['9007199254740992', ' 9007199254740993 ', 9007199254740992, null, undefined]) {
  currentUser = { telegram_id: returnedOwner, whatsapp_id: '+919876543210', name: 'Wrong owner' }
  memberReads = []
  assert.equal(await consoleModule.adminIdentity(), null, 'foreign/noncanonical returned owner denied')
  assert.equal(memberReads.length, 0)
}
currentUser = { telegram_id: sessionOwner, whatsapp_id: '+919876543210', name: 'Exact owner' }
userError = { code: 'inert' }
assert.equal(await consoleModule.adminIdentity(), null, 'error with returned row cannot authenticate')
userError = null; userThrows = true
assert.equal(await consoleModule.adminIdentity(), null, 'thrown private lookup cannot authenticate')
userThrows = false
sessionOwner = '101'
await expectIdentity('+12025550111', 'operator', true)
memberError = { code: 'inert' }
await expectIdentity('+12025550111', null, true)
memberError = null

const boundaryFailures: string[] = []
async function checkBoundary(name: string, run: () => Promise<void>) {
  try { await run(); console.log('PASS ' + name) } catch (error: any) { boundaryFailures.push(name + ': ' + error.message) }
}
await checkBoundary('legacy admin uses exact original and returned owner', async () => {
  const legacy = load('lib/admin/auth.ts', {
    '@/lib/dashboard/session': { getSession: async () => activeSession ? { telegramId: sessionOwner } : null },
    '@/lib/supabase-admin': { supabaseAdmin: db },
    '@/lib/bot/handlers/admin-analytics': analytics,
    '@/lib/admin/console-auth': consoleModule,
  }, env)
  for (const invalid of ['0', '00101', '+101', '1e3', ' 101 ', '\u00a0101\u00a0', '9007199254740993x', '9223372036854775808', 9007199254740992, null, undefined, {}, []]) {
    sessionOwner = invalid; currentUser = { telegram_id: '101', whatsapp_id: '+919876543210' }; userReads = []
    assert.equal((await legacy.requireAdminSession()).ok, false)
    assert.equal(userReads.length, 0, 'invalid original owner cannot enter private users query')
  }
  for (const owner of ['101', '-101', '9007199254740992', '9007199254740993', '9223372036854775807', '-9223372036854775808', 101]) {
    sessionOwner = owner; currentUser = { telegram_id: owner, whatsapp_id: '+919876543210' }; userReads = []
    const result = await legacy.requireAdminSession()
    assert.equal(result.ok, true); assert.equal(result.telegramId, String(owner))
    assert.deepEqual(userReads, [String(owner)], 'legacy users predicate retains exact string')
  }
  sessionOwner = '9007199254740993'
  for (const owner of ['9007199254740992', ' 9007199254740993 ', 9007199254740992, undefined]) {
    currentUser = { telegram_id: owner, whatsapp_id: '+919876543210' }
    assert.equal((await legacy.requireAdminSession()).ok, false, 'returned owner must match')
  }
  currentUser = { telegram_id: sessionOwner, whatsapp_id: '+919876543210' }; userError = { code: 'inert' }
  assert.equal((await legacy.requireAdminSession()).ok, false)
  userError = null; userThrows = true
  assert.equal((await legacy.requireAdminSession()).ok, false)
  userThrows = false; activeSession = false
  assert.equal((await legacy.requireAdminSession()).ok, false)
  activeSession = true; sessionOwner = '101'
})

await checkBoundary('access admin privilege uses original full phone, with normal policy preserved', async () => {
  let gateUsers: any[] = [{ whatsapp_id: '+919876543210', access_status: 'blocked' }]
  let gateReads = 0, redeemed = 0
  const gate = load('lib/access/gate.ts', {
    '@/lib/bot/handlers/admin-analytics': analytics,
    '@/lib/invites/core': { extractInviteCode: (text?: string) => text === 'fixture invite' ? 'fixture' : null },
    '@/lib/invites/store': { redeemInvite: async () => { redeemed++; return null } },
    '@/lib/supabase-admin': { supabaseAdmin: { from(table: string) {
      assert.equal(table, 'users', 'inert gate cases must not touch waitlist/other tables')
      let candidates: string[] = []
      const q: any = { select() { return q }, in(field: string, values: string[]) { assert.equal(field, 'whatsapp_id'); candidates = values; return q },
        async limit() { gateReads++; return { data: gateUsers.filter(row => candidates.includes(row.whatsapp_id)), error: null } } }
      return q
    } } },
  }, env)
  let decision = await gate.checkWhatsAppAccess('9876543210')
  assert.equal(decision.allow, false, 'country guessing cannot bypass blocked owner policy')
  assert.equal(decision.reason, 'blocked')
  gateReads = 0
  assert.equal((await gate.checkWhatsAppAccess('+919876543210')).reason, 'admin')
  assert.equal(gateReads, 0, 'explicit configured admin retains bypass')
  gateUsers = [{ whatsapp_id: '+919900000001', access_status: 'active' }]
  assert.equal((await gate.checkWhatsAppAccess('+919900000001')).reason, 'user')
  env.ACCESS_GATE_ENABLED = 'false'; gateUsers = []; redeemed = 0
  decision = await gate.checkWhatsAppAccess('9876543210', 'Fixture', 'fixture invite')
  assert.equal(decision.reason, 'gate_off'); assert.equal(redeemed, 1, 'domestic inferred identity cannot skip normal invite path as admin')
  await gate.checkWhatsAppAccess('+919876543210', 'Fixture', 'fixture invite')
  assert.equal(redeemed, 1, 'explicit admin still skips invite consumption')
  delete env.ACCESS_GATE_ENABLED
})
assert.deepEqual(boundaryFailures, [], 'actual legacy admin/access boundary regressions')
console.log('Strict full-phone admin authentication: actual predicate + owner/member session boundary, foreign suffix, local legacy, malformed and unset config passed')
