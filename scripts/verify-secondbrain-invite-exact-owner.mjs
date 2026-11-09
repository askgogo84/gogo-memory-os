// DRAFT-only original-function SecondBrain invite-recipient precision regression.
// Synthetic, inert fixtures: no real DB, accounts, invitations, network, or sharing.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const file = 'lib/workspaces/access.ts'
const source = readFileSync(file, 'utf8')
const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const statement = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'inviteMember')
assert.ok(statement?.body, 'original production inviteMember must exist')
const code = ts.transpileModule(statement.getText(ast).replace(/^export\s+/, '') + '\nglobalThis.inviteMember = inviteMember', {
  fileName: file, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText

class WorkspaceError extends Error { constructor(code) { super(code); this.code = code } }
let data = [], memberExists = false, writes = [], seenOwners = [], audits = [], staleCalls = 0
const supabaseAdmin = {
  from(table) {
    if (table === 'users') return {
      select(cols) {
        assert.equal(cols, 'telegram_id')
        return { in(col, candidates) {
          assert.equal(col, 'whatsapp_id')
          assert.equal(candidates[0], 'whatsapp:+919999000000')
          return { limit: async n => {
            assert.equal(n, 2)
            return { data, error: null }
          } }
        } }
      },
    }
    if (table === 'workspace_members') return {
      select(cols, options) {
        assert.equal(cols, 'telegram_id')
        assert.equal(options.count, 'exact')
        return { eq: async (col, value) => {
          assert.equal(col, 'workspace_id')
          assert.equal(value, 'workspace-fixture')
          return { count: 0, error: null }
        } }
      },
    }
    if (table === 'workspace_invites') return {
      insert(row) {
        writes.push(row)
        return { select: cols => {
          assert.equal(cols, 'id')
          return { single: async () => ({ data: { id: 'fictional-invite' }, error: null }) }
        } }
      },
    }
    throw Error('unexpected external table ' + table)
  },
}

const sandbox = {
  supabaseAdmin, WorkspaceError,
  requireWorkspaceRole: async () => ({ workspaceId: 'workspace-fixture', telegramId: '-123', role: 'owner' }),
  isWorkspaceRole: role => role === 'viewer',
  INVITABLE_ROLES: ['viewer'],
  whatsappIdCandidates: number => number === 'phone' ? ['whatsapp:+919999000000'] : [],
  check: err => { if (err) throw err },
  memberRow: async (ws, recipient) => { seenOwners.push(recipient); return memberExists ? 'viewer' : null },
  MAX_MEMBERS_PER_WORKSPACE: 100,
  expireStaleInvites: async () => { staleCalls++ },
  audit: async (ws, actor, action, target) => { audits.push({ ws, actor, action, target }) },
}
vm.runInNewContext(code, sandbox, { timeout: 1000 })
const invite = sandbox.inviteMember
assert.equal(typeof invite, 'function')
function reset(users, exists = false) {
  data = users; memberExists = exists; writes = []; seenOwners = []; audits = []; staleCalls = 0
}
async function shouldReject(label, raw, errorCode = 'invalid_owner') {
  reset([{ telegram_id: raw }])
  await assert.rejects(() => invite('-123', 'workspace-fixture', 'phone', 'viewer'), err => err?.code === errorCode, label)
  assert.equal(writes.length, 0, label + ': no pending invite write')
  assert.equal(staleCalls, 0, label + ': no invite-expiry write')
  assert.equal(seenOwners.length, 0, label + ': no membership read')
  assert.equal(audits.length, 0, label + ': no successful audit')
}
let benign = 0, mandatory = 0
async function positive(label, raw, exact) {
  reset([{ telegram_id: raw }])
  const r = await invite('-123', 'workspace-fixture', 'phone', 'viewer')
  assert.equal(r.status, 'pending', label)
  assert.equal(writes.length, 1)
  assert.equal(writes[0].telegram_id, exact, label + ': exact persisted invitee')
  assert.equal(writes[0].invited_by, '-123', label + ': exact actor')
  assert.equal(writes[0].status, 'pending', label + ': consent required')
  assert.deepEqual(seenOwners, [exact], label + ': exact member lookup')
  assert.equal(staleCalls, 1)
  assert.equal(audits[0].target, exact)
  benign++
}
const adjacentA = '9007199254740992', adjacentB = '9007199254740993'
assert.equal(Number(adjacentA), Number(adjacentB), 'reproduce unsafe BIGINT owner alias')
await positive('exact owner adjacent A', adjacentA, adjacentA)
await positive('exact owner adjacent B', adjacentB, adjacentB)
await positive('negative WhatsApp owner', '-345612345', '-345612345')
await positive('safe signed numeric WhatsApp owner', -42, '-42')
await positive('safe positive numeric owner', 42, '42')

for (const [label, raw] of [
  ['rounded unsafe DB number', Number(adjacentB)],
  ['unsafe negative DB number', -Number(adjacentB)],
  ['missing owner', undefined], ['null owner', null], ['zero', 0],
  ['decimal zero string', '0'], ['negative zero string', '-0'],
  ['fractional numeric owner', 1.5], ['NaN owner', NaN],
  ['infinite owner', Infinity], ['invalid decimal', '1e3'],
  ['plus-prefixed owner', '+42'], ['leading zeros', '0042'],
  ['whitespace-only owner', ' '], ['non-number object', { id: '42' }],
]) { await shouldReject(label, raw); mandatory++ }

reset([{ telegram_id: 42 }, { telegram_id: 43 }])
await assert.rejects(() => invite('-123', 'workspace-fixture', 'phone', 'viewer'), e => e?.code === 'ambiguous_number')
assert.equal(writes.length, 0); mandatory++
reset([])
await assert.rejects(() => invite('-123', 'workspace-fixture', 'phone', 'viewer'), e => e?.code === 'user_not_found')
assert.equal(writes.length, 0); mandatory++
reset([{ telegram_id: '42' }], true)
await assert.rejects(() => invite('-123', 'workspace-fixture', 'phone', 'viewer'), e => e?.code === 'already_member')
assert.equal(writes.length, 0); mandatory++
reset([{ telegram_id: '42' }])
await assert.rejects(() => invite('-123', 'workspace-fixture', 'phone', 'editor'), e => e?.code === 'invalid_role')
assert.equal(writes.length, 0); mandatory++
await assert.rejects(() => invite('-123', 'workspace-fixture', 'invalid-phone', 'viewer'), e => e?.code === 'invalid_number')
assert.equal(writes.length, 0); mandatory++

console.log('Original workspace inviteMember exact-owner safety: ' + benign + ' benign + ' + mandatory + ' mandatory synthetic controls PASS')
