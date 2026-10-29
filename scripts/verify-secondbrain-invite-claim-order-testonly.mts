// TEST ONLY / EXPECTED RED — DO NOT MERGE OR DEPLOY.
// Executes the ACTUAL SecondBrain invite acceptance function in a closed TypeScript VM.
// All tables, identities, times, and writes are strictly synthetic in-memory fixtures.
// No live Supabase, provider, network, credentials, account, or invitation operations.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const file = 'lib/workspaces/access.ts'
const compiled = ts.transpileModule(readFileSync(file, 'utf8'), {
  fileName: file,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  reportDiagnostics: true,
})
assert.equal((compiled.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0)

const ws = '11111111-1111-4111-8111-111111111111'
const inviteId = '22222222-2222-4222-8222-222222222222'
const owner = '4444'
type Scenario = {
  invite: { id: string; workspace_id: string; telegram_id: string; role: string; status: string; expires_at: string }
  members: Set<string>
  memberCount: number
  insertFails: boolean
  auditCount: number
  claimedCount: number
  providerCalls: number
}
function scenario(options: Partial<Pick<Scenario, 'memberCount' | 'insertFails'>> = {}): Scenario {
  return {
    invite: { id: inviteId, workspace_id: ws, telegram_id: owner, role: 'member', status: 'pending', expires_at: '2030-12-01T00:00:00.000Z' },
    members: new Set<string>(), memberCount: options.memberCount ?? 0,
    insertFails: options.insertFails ?? false, auditCount: 0, claimedCount: 0, providerCalls: 0,
  }
}
let current = scenario()
const counts: Record<string, number> = {}
function hit(table: string) {
  assert.ok(['workspace_invites', 'workspace_members', 'workspace_audit_log'].includes(table), 'no other workspace or personal table read')
  counts[table] = (counts[table] || 0) + 1
}
class SyntheticQuery {
  private filters: { key: string; value: unknown }[] = []
  private op: 'read' | 'update' = 'read'
  private updates: Record<string, any> = {}
  private countOnly = false
  constructor(private table: string) {}
  eq(key: string, value: unknown) { this.filters.push({ key, value }); return this }
  select(_columns: string, opts?: { count?: string; head?: boolean }) {
    if (this.op === 'update') {
      assert.equal(this.table, 'workspace_invites')
      assert.deepEqual(this.filters, [
        { key: 'id', value: inviteId }, { key: 'telegram_id', value: owner }, { key: 'status', value: 'pending' },
      ], 'exact invite, owner and pending state are required to claim')
      const data = current.invite.status === 'pending' ? [{ id: inviteId }] : []
      if (data.length) {
        current.claimedCount++
        current.invite.status = String(this.updates.status)
      }
      return Promise.resolve({ data, error: null })
    }
    this.countOnly = opts?.head === true && opts?.count === 'exact'
    return this
  }
  update(fields: Record<string, any>) { this.op = 'update'; this.updates = fields; return this }
  maybeSingle() {
    if (this.table === 'workspace_invites') {
      assert.deepEqual(this.filters, [{ key: 'id', value: inviteId }, { key: 'telegram_id', value: owner }], 'invite is recipient-bound')
      return Promise.resolve({ data: { ...current.invite }, error: null })
    }
    assert.equal(this.table, 'workspace_members')
    assert.deepEqual(this.filters, [{ key: 'workspace_id', value: ws }, { key: 'telegram_id', value: owner }], 'membership is workspace+recipient scoped')
    return Promise.resolve({ data: current.members.has(owner) ? { role: 'member' } : null, error: null })
  }
  insert(row: Record<string, any>) {
    if (this.table === 'workspace_members') {
      assert.equal(row.workspace_id, ws)
      assert.equal(row.telegram_id, owner)
      if (current.insertFails) return Promise.resolve({ error: { code: 'P0001', message: 'synthetic member insert denied' } })
      current.members.add(owner)
      current.memberCount++
      return Promise.resolve({ error: null })
    }
    assert.equal(this.table, 'workspace_audit_log')
    assert.equal(row.workspace_id, ws)
    current.auditCount++
    return Promise.resolve({ error: null })
  }
  then(resolve: (value: any) => any, reject?: (reason: any) => any) {
    assert.equal(this.table, 'workspace_members')
    assert.equal(this.countOnly, true, 'only bounded workspace member count is awaited')
    assert.deepEqual(this.filters, [{ key: 'workspace_id', value: ws }])
    return Promise.resolve({ count: current.memberCount, error: null }).then(resolve, reject)
  }
}
const fakeDb = { from(table: string) { hit(table); return new SyntheticQuery(table) } }
const rules = {
  UUID_RE: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  MAX_MEMBERS_PER_WORKSPACE: 50,
  isWorkspaceRole: (value: unknown) => typeof value === 'string' && ['owner','admin','member','viewer'].includes(value),
  isMissingTableError: (_e: unknown) => false,
}
const mod: { exports: Record<string, any> } = { exports: {} }
const fakeRequire = (spec: string) => {
  if (spec === '@/lib/supabase-admin') return { supabaseAdmin: fakeDb }
  if (spec === './rules') return rules
  throw new Error('UNEXPECTED IMPORT / POSSIBLE NETWORK: ' + spec)
}
vm.runInNewContext(compiled.outputText, {
  module: mod, exports: mod.exports, require: fakeRequire, console, Date, Promise,
}, { filename: 'actual-secondbrain-workspace-access.js', timeout: 5000 })
assert.equal(typeof mod.exports.respondToInvite, 'function', 'test must invoke actual exported implementation')
const respond = mod.exports.respondToInvite as (owner: string, id: string, decision: string) => Promise<any>
const results: { name: string; passed: boolean; error?: string }[] = []
async function check(name: string, fn: () => Promise<void>) {
  try { await fn(); results.push({ name, passed: true }); console.log('PASS: ' + name) }
  catch (error: any) {
    results.push({ name, passed: false, error: error?.message || String(error) })
    console.error('FAIL: ' + name + ': ' + (error?.message || String(error)))
  }
}
async function expectRejected(code: string) {
  let error: any = null
  try { await respond(owner, inviteId, 'accept') } catch (e) { error = e }
  assert.ok(error, 'the synthetic failure must reject')
  assert.equal(error.code, code)
}
await check('CONTROL: successful invite acceptance atomically corresponds to membership', async () => {
  current = scenario()
  const response = await respond(owner, inviteId, 'accept')
  assert.equal(response.joined, true)
  assert.equal(current.invite.status, 'accepted')
  assert.ok(current.members.has(owner))
  assert.equal(current.auditCount, 1)
})
await check('CONTROL: decline consumes invite without granting workspace membership', async () => {
  current = scenario()
  const response = await respond(owner, inviteId, 'decline')
  assert.equal(response.joined, false)
  assert.equal(current.invite.status, 'declined')
  assert.equal(current.members.size, 0)
})
await check('P2 RED: full workspace must not consume pending invite before capacity check', async () => {
  current = scenario({ memberCount: 50 })
  await expectRejected('member_limit')
  assert.equal(current.members.size, 0)
  assert.equal(current.invite.status, 'pending', 'member-capacity rejection must leave recipient able to accept later')
})
await check('P2 RED: failed member INSERT must not irreversibly mark invite accepted', async () => {
  current = scenario({ insertFails: true })
  await expectRejected('workspace_unavailable')
  assert.equal(current.members.size, 0)
  assert.equal(current.invite.status, 'pending', 'no membership created: cannot persist an accepted invitation')
})
await check('P2 RED: fixed transient member INSERT must be safely continuable by invitee', async () => {
  current = scenario({ insertFails: true })
  await expectRejected('workspace_unavailable')
  current.insertFails = false
  const response = await respond(owner, inviteId, 'accept')
  assert.equal(response.joined, true, 'after confirmed no insert, retry must not be trapped as invite_not_found')
  assert.ok(current.members.has(owner))
})
const failed = results.filter(item => !item.passed)
assert.equal(current.providerCalls, 0, 'never calls real providers')
console.log('SecondBrain synthetic invite acceptance: ' + (results.length - failed.length) + ' PASS / ' + failed.length + ' FAIL')
if (failed.length) { console.error('EXPECTED RED: draft test-only evidence, NOT production acceptance.'); process.exitCode = 1 }
