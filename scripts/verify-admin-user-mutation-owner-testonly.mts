// TEST ONLY / EXPECTED SAFETY RED — exact owner binding for admin account mutations.
// Execute the ACTUAL shipped lib/admin/actions.ts in a sealed VM against two synthetic
// 64-bit owner IDs; NO real database, users, network, messages, credentials or sessions.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const FILE = 'lib/admin/actions.ts'
const original = readFileSync(FILE, 'utf8')
assert.match(original, /export async function runAdminAction\(/,
  'fixture must execute the original admin action function')
assert.match(original, /case 'user\.block'/)
assert.match(original, /case 'user\.unblock'/)
assert.match(original, /case 'user\.plan'/)
const built = ts.transpileModule(original, {
  fileName: FILE,
  reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})
assert.equal((built.diagnostics || []).filter(d =>
  d.category === ts.DiagnosticCategory.Error).length, 0, 'shipped module must transpile')

const A = '9007199254740992'
const B = '9007199254740993'
assert.equal(Number(A), Number(B), 'synthetic distinct decimal IDs must expose JS aliasing')
const ADMIN_PHONE = '+15559990000'
type User = { telegram_id: string; whatsapp_id: string; name: string;
  access_status: string; tier: string }
type Event = { kind: string; [key: string]: unknown }
function fixture() {
  const users: User[] = [
    { telegram_id: '42', whatsapp_id: 'whatsapp:+15550000042', name: 'Safe Owner',
      access_status: 'active', tier: 'free' },
    { telegram_id: A, whatsapp_id: 'whatsapp:+15550000001', name: 'Synthetic A',
      access_status: 'active', tier: 'free' },
    { telegram_id: B, whatsapp_id: 'whatsapp:+15550000002', name: 'Synthetic B',
      access_status: 'active', tier: 'free' },
  ]
  const events: Event[] = []
  const record = (kind: string, props: Record<string, unknown> = {}) =>
    events.push({ kind, ...props })
  const byId = (id: unknown) => users.filter(row => row.telegram_id === String(id))
  const db = {
    from(table: string) {
      if (table === 'users') {
        return {
          select(_columns: string) {
            return {
              eq(column: string, id: unknown) {
                assert.equal(column, 'telegram_id')
                record('user_lookup', { id: String(id), type: typeof id })
                return {
                  async maybeSingle() {
                    const found = byId(id)
                    return { data: found.length === 1 ? { ...found[0] } : null,
                      error: found.length > 1 ? { code: 'duplicate_owner' } : null }
                  },
                }
              },
            }
          },
          update(patch: Record<string, unknown>) {
            return {
              async eq(column: string, id: unknown) {
                assert.equal(column, 'telegram_id')
                const selected = byId(id)
                record('user_mutation', { id: String(id), type: typeof id,
                  owners: selected.map(x => x.telegram_id), patch: { ...patch } })
                for (const row of selected) Object.assign(row, patch)
                return { data: null, error: null }
              },
            }
          },
        }
      }
      if (table === 'dashboard_sessions') {
        return {
          delete() {
            return {
              async eq(column: string, id: unknown) {
                assert.equal(column, 'telegram_id')
                record('session_revoke', { id: String(id) })
                return { error: null }
              },
            }
          },
        }
      }
      throw Error('BLOCKED unexpected DB table: ' + table)
    },
  }
  const mocks: Record<string, any> = {
    '@/lib/supabase-admin': { supabaseAdmin: db },
    '@/lib/whatsapp': {
      sendWhatsAppAccessGranted() { throw Error('BLOCKED outgoing WhatsApp') },
    },
    '@/lib/bot/handlers/welcome': {
      ACCESS_GRANTED_TEMPLATE_BODY: 'inert',
      buildAccessGrantedText: () => 'inert welcome',
      welcomeFirstName: () => 'Synthetic',
    },
    './console-auth': {
      audit: async (_admin: unknown, action: string, details: string,
        metadata: unknown) => { record('audit', { action, details, metadata }); return null },
      canDo: (role: string, min: string) =>
        role === 'owner' || (role === 'operator' && min === 'operator'),
      e164: (raw: unknown) => String(raw || '').replace(/^whatsapp:/, ''),
      hashPassword: () => 'inert',
      setPasswordHash() { throw Error('BLOCKED admin authentication change') },
    },
  }
  const exports: Record<string, any> = {}
  runInNewContext(built.outputText, {
    exports,
    require(name: string) {
      if (Object.prototype.hasOwnProperty.call(mocks, name)) return mocks[name]
      throw Error('BLOCKED unexpected import: ' + name)
    },
    console, Date, Promise, Number, String, Object, JSON,
    process: { env: {} },
    fetch() { throw Error('BLOCKED network access') },
  }, { filename: FILE, timeout: 2500 })
  assert.equal(typeof exports.runAdminAction, 'function',
    'must execute actual shipped admin handler, not a rewritten imitation')
  const run = (action: string, telegramId: string | number,
    role = 'operator') => exports.runAdminAction(
      { role, phone: ADMIN_PHONE }, action,
      { telegramId, tier: 'pro' })
  const owner = (id: string) => users.find(row => row.telegram_id === id)!
  return { run, owner, events }
}
let controls = 0
let safetyPass = 0
let safetyFail = 0
async function control(name: string, test: () => Promise<void>) {
  await test()
  controls++
  console.log('PASS CONTROL: ' + name)
}
async function safety(name: string, test: () => Promise<void>) {
  try {
    await test()
    safetyPass++
    console.log('PASS SAFETY: ' + name)
  } catch (error: any) {
    safetyFail++
    console.error('FAIL SAFETY (expected until corrected): ' + name + ': ' +
      String(error?.message || error))
  }
}
// Safe identities prove that the original handler is genuinely being exercised.
await control('operator blocks exact, safely represented owner and revokes same session', async () => {
  const h = fixture()
  const r = await h.run('user.block', '42')
  assert.equal(r.ok, true)
  assert.equal(h.owner('42').access_status, 'blocked')
  assert.equal(h.owner(A).access_status, 'active')
  assert.deepEqual(h.events.filter(e => e.kind === 'session_revoke').map(e => e.id), ['42'])
  assert.equal(h.events.filter(e => e.kind === 'audit').length, 1)
})
await control('operator unblocks safely represented owner', async () => {
  const h = fixture()
  h.owner('42').access_status = 'blocked'
  const r = await h.run('user.unblock', '42')
  assert.equal(r.ok, true)
  assert.equal(h.owner('42').access_status, 'active')
})
await control('operator changes plan for safely represented owner only', async () => {
  const h = fixture()
  const r = await h.run('user.plan', '42')
  assert.equal(r.ok, true)
  assert.equal(h.owner('42').tier, 'pro')
  assert.equal(h.owner(A).tier, 'free')
})
await control('viewer cannot invoke account changes', async () => {
  const h = fixture()
  const r = await h.run('user.block', B, 'viewer')
  assert.equal(r.ok, false)
  assert.equal(h.events.length, 0)
})
await control('missing admin target fails without mutations', async () => {
  const h = fixture()
  const r = await h.run('user.block', '')
  assert.equal(r.ok, false)
  assert.equal(h.events.length, 0)
})
// These required tenant-isolation assertions are RED on the shipped implementation.
await safety('P1: block B must not change A access state', async () => {
  const h = fixture()
  await h.run('user.block', B)
  assert.equal(h.owner(A).access_status, 'active', 'owner A blocked by B request')
})
await safety('P1: exact B block must change B, not an aliased owner', async () => {
  const h = fixture()
  await h.run('user.block', B)
  assert.equal(h.owner(B).access_status, 'blocked', 'requested B remains active')
})
await safety('P1: unblock B must not unblock A', async () => {
  const h = fixture()
  h.owner(A).access_status = 'blocked'
  h.owner(B).access_status = 'blocked'
  await h.run('user.unblock', B)
  assert.equal(h.owner(A).access_status, 'blocked', 'unblocked owner A instead of B')
})
await safety('P1: change plan for B must not mutate A subscription', async () => {
  const h = fixture()
  await h.run('user.plan', B)
  assert.equal(h.owner(A).tier, 'free', 'owner A plan changed by B request')
})
await safety('P1: session revoke must identify the same owner as the block mutation', async () => {
  const h = fixture()
  await h.run('user.block', B)
  const changed = h.events.filter(e => e.kind === 'user_mutation').flatMap(e => e.owners as string[])
  const revoked = h.events.filter(e => e.kind === 'session_revoke').map(e => String(e.id))
  assert.deepEqual(revoked, changed, 'revoked B sessions while mutating account A')
})
await safety('P1: unsafe numeric owner inputs must be rejected before account writes', async () => {
  const h = fixture()
  const r = await h.run('user.block', Number(B))
  assert.equal(r.ok, false, 'rounded numeric target accepted as valid owner')
  assert.equal(h.events.filter(e => e.kind === 'user_mutation').length, 0)
})
await safety('P2: absent target must not receive completed block receipt', async () => {
  const h = fixture()
  const r = await h.run('user.block', '99999')
  assert.equal(r.ok, false, 'absent account reported blocked without any matched row')
})
console.log('RESULT positive_controls=' + controls + ' safety_pass=' +
  safetyPass + ' safety_fail=' + safetyFail)
assert.equal(controls, 5, 'all safe-path controls must run')
assert.equal(safetyPass, 7,
  'all seven exact-owner mutation and truthful-receipt security gates must pass')
console.log('SECURITY GREEN: account changes and sessions are bound to exact owner identities')
