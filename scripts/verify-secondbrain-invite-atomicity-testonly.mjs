// TEST ONLY / MANDATORY SAFETY RED. DO NOT MERGE OR DEPLOY.
// Runs the unchanged production respondToInvite function against a fully synthetic database.
// Never imports the application, reaches Supabase, sends messages, or accesses private user data.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'

const ts = createRequire(import.meta.url)('typescript')
const src = readFileSync('lib/workspaces/access.ts', 'utf8')
const start = src.indexOf('export async function respondToInvite(')
const end = src.indexOf('\n/** Admin+ withdraws a pending invitation.', start)
assert.ok(start >= 0 && end > start, 'extract exactly the shipped invite function')
const actual = src.slice(start, end).replace(/^export\s+/, '')
assert.match(actual, /\.update\(\{ status: decision === 'accept' \? 'accepted' : 'declined'/)
assert.match(actual, /\.insert\(\{ workspace_id: invite\.workspace_id/)
assert.match(readFileSync('lib/workspaces/rules.ts', 'utf8'), /MAX_MEMBERS_PER_WORKSPACE\s*=\s*50\b/)
const compiled = ts.transpileModule(actual, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText

const INVITE_ID = '11111111-1111-4111-8111-111111111111'
const WS_ID = '22222222-2222-4222-8222-222222222222'
class WorkspaceError extends Error { constructor(code) { super(code); this.code = code } }

function fixture(options = {}) {
  const state = {
    invite: { id: INVITE_ID, workspace_id: WS_ID, role: 'member', telegram_id: '123', status: 'pending', expires_at: '2099-10-31T23:59:59.000Z', ...options.invite },
    members: new Set(options.existingMember ? ['123'] : []),
    limitCount: options.limitCount,
    failInsert: !!options.failInsert,
    failAudit: !!options.failAudit,
    events: [],
  }
  class Query {
    constructor(table) { this.table = table; this.filters = []; this.op = null; this.opts = {}; this.patch = null }
    select(_columns, options = {}) { if (!this.op) this.op = 'select'; this.opts = options; return this }
    eq(column, value) { this.filters.push([column, String(value)]); return this }
    update(patch) { this.op = 'update'; this.patch = patch; return this }
    insert(patch) { this.op = 'insert'; this.patch = patch; return this }
    matches(row) { return this.filters.every(([col, val]) => String(row[col]) === val) }
    execute() {
      if (this.table === 'workspace_invites') {
        if (this.op === 'select') return { data: this.matches(state.invite) ? [{ ...state.invite }] : [], error: null }
        if (this.op === 'update') {
          if (!this.matches(state.invite)) return { data: [], error: null }
          state.events.push('invite.' + this.patch.status)
          Object.assign(state.invite, this.patch)
          return { data: [{ id: INVITE_ID }], error: null }
        }
      }
      if (this.table === 'workspace_members') {
        if (this.op === 'select' && this.opts.head) return { count: state.limitCount ?? state.members.size, error: null }
        if (this.op === 'insert') {
          state.events.push('membership.attempt')
          if (state.failInsert) return { data: null, error: { code: 'synthetic_failed', message: 'simulated write failure' } }
          state.members.add(String(this.patch.telegram_id)); state.events.push('membership.inserted')
          return { data: null, error: null }
        }
      }
      throw new Error('UNEXPECTED_SYNTHETIC_QUERY:' + this.table + ':' + this.op)
    }
    maybeSingle() { const out = this.execute(); return Promise.resolve({ data: out.data?.[0] ?? null, error: out.error }) }
    then(resolve, reject) { return Promise.resolve().then(() => this.execute()).then(resolve, reject) }
  }
  const context = {
    WorkspaceError,
    tg: val => { const id = String(val ?? '').trim(); if (!id) throw new WorkspaceError('invalid_session'); return id },
    UUID_RE: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    supabaseAdmin: { from: table => new Query(table) },
    check: error => { if (error) throw new WorkspaceError('workspace_unavailable') },
    isWorkspaceRole: role => ['owner', 'admin', 'member', 'viewer'].includes(role),
    memberRow: async (_ws, member) => state.members.has(member) ? 'member' : null,
    MAX_MEMBERS_PER_WORKSPACE: 50,
    audit: async () => { state.events.push('audit.attempt'); if (state.failAudit) throw new WorkspaceError('workspace_unavailable') },
  }
  const acceptFn = vm.runInNewContext(compiled + '\nrespondToInvite', context, { timeout: 2000, filename: 'shipped-respondToInvite.ts' })
  return { state, reply: (user = '123', action = 'accept') => acceptFn(user, INVITE_ID, action) }
}

let controls = 0
async function control(name, run) {
  try { await run(); controls++; console.log('PASS CONTROL: ' + name) }
  catch (error) { console.error('FIXTURE FAILURE: ' + name, error); process.exitCode = 2 }
}
await control('normal invite accepted only for own member', async () => {
  const c = fixture(); const result = await c.reply()
  assert.equal(result.joined, true); assert.equal(c.state.invite.status, 'accepted'); assert.ok(c.state.members.has('123'))
})
await control('decline does not add member', async () => {
  const c = fixture(); const result = await c.reply('123', 'decline')
  assert.equal(result.joined, false); assert.equal(c.state.invite.status, 'declined'); assert.equal(c.state.members.size, 0)
})
await control('different owner cannot claim invitation', async () => {
  const c = fixture(); await assert.rejects(c.reply('999'), /invite_not_found/)
  assert.equal(c.state.invite.status, 'pending'); assert.equal(c.state.members.size, 0)
})
await control('expired invite blocked and expired', async () => {
  const c = fixture({ invite: { expires_at: '2020-01-01T00:00:00.000Z' } })
  await assert.rejects(c.reply(), /invite_expired/)
  assert.equal(c.state.invite.status, 'expired'); assert.equal(c.state.members.size, 0)
})
await control('already admitted invitee has no duplicate insert', async () => {
  const c = fixture({ existingMember: true }); const result = await c.reply()
  assert.equal(result.joined, true); assert.equal(c.state.members.size, 1)
  assert.ok(!c.state.events.includes('membership.inserted'))
})
if (process.exitCode === 2) process.exit(2)

const mandatory = [
  ['full workspace must not consume invite', async () => {
    const c = fixture({ limitCount: 50 })
    await assert.rejects(c.reply(), /member_limit/)
    assert.equal(c.state.members.size, 0)
    assert.equal(c.state.invite.status, 'pending', 'claim must be atomic with admission')
  }],
  ['failed member insert must leave invite safely retryable', async () => {
    const c = fixture({ failInsert: true })
    await assert.rejects(c.reply(), /workspace_unavailable/)
    assert.equal(c.state.members.size, 0)
    assert.equal(c.state.invite.status, 'pending', 'cannot strand accepted invite without membership')
  }],
  ['invalid persisted role cannot terminally accept', async () => {
    const c = fixture({ invite: { role: 'owner' } })
    await assert.rejects(c.reply(), /invalid_role/)
    assert.equal(c.state.members.size, 0)
    assert.equal(c.state.invite.status, 'pending', 'validate stored role before claim')
  }],
  ['audit failure after membership must have recoverable, idempotent receipt', async () => {
    const c = fixture({ failAudit: true })
    await assert.rejects(c.reply(), /workspace_unavailable/)
    assert.ok(c.state.members.has('123'), 'member was durably inserted')
    const retry = await c.reply()
    assert.equal(retry.joined, true, 'retry must acknowledge committed admission, not invite_not_found')
  }],
]
let reds = 0
for (const [name, run] of mandatory) {
  try { await run(); console.log('PASS SAFETY: ' + name) }
  catch (error) { reds++; console.log('SAFETY RED: ' + name + ' :: ' + String(error.message || error).slice(0, 190)) }
}
console.log('DIAGNOSTIC: benign controls ' + controls + '/5; mandatory safety RED ' + reds + '/' + mandatory.length)
if (reds) { console.error('EXPECTED SAFETY RED. TEST ONLY, DO NOT MERGE/DEPLOY.'); process.exit(1) }
