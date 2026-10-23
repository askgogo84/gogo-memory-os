// Proves the connector proposal (lib/connectors/adapter.ts) keeps its two promises:
//   - writes (and unclassified actions) never reach a provider without a bound, approved, fresh approval;
//   - credentials never appear in anything the model can see.
// Also checks the workspace boundary and that the proposal is not wired into runtime code yet.
// Run: npx --yes tsx scripts/verify-connector-adapter-policy.mts
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { inspect } from 'node:util'
import {
  CredentialHandle, ConnectorPolicyError, executeConnectorAction, stageConnectorApproval, toModelToolDescriptor,
  toModelToolResult, toModelVisible, effectiveRisk,
  type ConnectionRef, type ConnectorActionSpec, type ConnectorAdapter, type CredentialResolver, type ProviderCall,
  type WorkspaceConnectorPolicy,
} from '../lib/connectors/adapter.ts'

const ACCESS = 'ya29.a0AfH6SMBexampleACCESStoken1234567890'
const REFRESH = '1//0gEXAMPLErefreshTOKEN-abcdefghijk'
const API_KEY = 'sk_live_51Hexamplekey0000000000'
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlc2lnbmF0dXJl'
const SECRETS = [ACCESS, REFRESH, API_KEY, JWT]

const personal = { kind: 'personal' as const, ownerId: '-919800000001' }
const conn = (over: Partial<ConnectionRef> = {}): ConnectionRef => ({
  connectionId: 'conn_1', toolkit: 'notion', backend: 'composio', scope: personal, status: 'active',
  accountHint: 'd…@example.com', grantedScopes: ['read_content', 'insert_content'], createdBy: '-919800000001',
  createdAt: '2026-10-23T00:00:00Z', ...over,
})
const read: ConnectorActionSpec = { id: 'notion.search', toolkit: 'notion', name: 'Search', description: 'Search pages', risk: 'read', dataClasses: ['files'], inputSchema: { type: 'object', properties: { query: { type: 'string' } } } }
const write: ConnectorActionSpec = { id: 'notion.create_page', toolkit: 'notion', name: 'Create page', description: 'Create a page', risk: 'write', dataClasses: ['files'], inputSchema: { type: 'object', properties: { title: { type: 'string' } } } }
const unclassified: ConnectorActionSpec = { id: 'notion.archive_page', toolkit: 'notion', name: 'Archive', description: 'Archive a page', dataClasses: ['files'], inputSchema: {} }

const calls: ProviderCall[] = []
const adapter: ConnectorAdapter = {
  backend: 'composio',
  async listToolkits() { return [] },
  async listActions() { return [read, write, unclassified] },
  async beginConnect() { return { flowId: 'f', redirectUrl: 'https://app.askgogo.in/api/connectors/callback', expiresAt: '' } },
  async completeConnect() { return conn() },
  async disconnect() {},
  async execute(call) {
    calls.push(call)
    // A hostile/naive provider echoing secrets back in every shape we have seen.
    return { ok: true, providerReceiptId: 'prov_123', data: {
      page: { id: 'p1', title: 'Trip notes' },
      access_token: ACCESS, refreshToken: REFRESH, headers: { Authorization: `Bearer ${ACCESS}` },
      nested: [{ api_key: API_KEY }, { note: `debug: token=${REFRESH} jwt ${JWT} key ${API_KEY}` }],
      handle: call.credential,
    } }
  },
}
const resolver: CredentialResolver = { async resolve(c) { return new CredentialHandle(c.connectionId, ACCESS) } }
const base = { adapter, resolver, scope: personal, runId: 'run_1', stepId: 'step_1' }

const noSecrets = (label: string, value: unknown) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  for (const s of SECRETS) assert.ok(!text.includes(s), `${label} leaked a secret`)
}
const refused = async (p: Promise<unknown>, code: RegExp) => {
  const before = calls.length
  await assert.rejects(p, code)
  assert.equal(calls.length, before, 'adapter must not be called when policy refuses')
}

// 1. Reads run without approval.
const r = await executeConnectorAction({ ...base, connection: conn(), action: read, args: { query: 'trip' } })
assert.equal(r.status, 'succeeded'); assert.equal(r.approvalId, null); assert.equal(calls.length, 1)

// 2. Writes need an approval; pending, rejected, expired and executed approvals are refused.
await refused(executeConnectorAction({ ...base, connection: conn(), action: write, args: { title: 'Goa' } }), /connector_approval_required/)
const binding = stageConnectorApproval({ runId: 'run_1', stepId: 'step_1', connection: conn(), action: write, args: { title: 'Goa' } })
const approval = (status: any, extra = {}) => ({ id: 'appr_1', status, ...binding, ...extra })
for (const status of ['pending', 'rejected', 'expired', 'executed']) {
  await refused(executeConnectorAction({ ...base, connection: conn(), action: write, args: { title: 'Goa' }, approval: approval(status) }), new RegExp(`connector_approval_${status}`))
}
await refused(executeConnectorAction({ ...base, connection: conn(), action: write, args: { title: 'Goa' }, approval: approval('approved', { expires_at: '2020-01-01T00:00:00Z' }) }), /connector_approval_expired/)
await refused(executeConnectorAction({ ...base, connection: conn(), action: write, args: { title: 'Goa' }, approval: approval('approved', { scope_key: 'personal:someone-else' }) }), /connector_approval_scope_mismatch/)

// 3. An approval binds the exact payload, connection and action.
await refused(executeConnectorAction({ ...base, connection: conn(), action: write, args: { title: 'Goa, and share with everyone' }, approval: approval('approved') }), /approval_action_changed/)
await refused(executeConnectorAction({ ...base, connection: conn({ connectionId: 'conn_2' }), action: write, args: { title: 'Goa' }, approval: approval('approved') }), /approval_action_changed/)
await refused(executeConnectorAction({ ...base, connection: conn(), action: write, args: { title: 'Goa' }, approval: { id: 'x', status: 'approved', action_hash: null, policy_version: null } }), /approval_binding_missing/)

// 4. A bound, approved, fresh approval executes once and leaves a receipt naming it.
const w = await executeConnectorAction({ ...base, connection: conn(), action: write, args: { title: 'Goa' }, approval: approval('approved') })
assert.equal(w.status, 'succeeded'); assert.equal(w.approvalId, 'appr_1'); assert.equal(w.providerReceiptId, 'prov_123')
assert.equal(w.argsHash.length, 64); assert.equal(w.scopeKey, 'personal:-919800000001')

// 5. Unclassified actions are writes (fail closed), and reads cannot be staged as approvals.
assert.equal(effectiveRisk(unclassified), 'write')
assert.equal(effectiveRisk({ risk: 'READ' as any }), 'write')
await refused(executeConnectorAction({ ...base, connection: conn(), action: unclassified, args: { id: 'p1' } }), /connector_approval_required/)
assert.throws(() => stageConnectorApproval({ runId: 'r', stepId: 's', connection: conn(), action: read, args: {} }), ConnectorPolicyError)

// 6. Provider exceptions on a write are outcome_unknown, never silent failure.
const flaky: ConnectorAdapter = { ...adapter, async execute() { throw new Error(`socket hang up ${ACCESS}`) } }
const u = await executeConnectorAction({ ...base, adapter: flaky, connection: conn(), action: write, args: { title: 'Goa' }, approval: approval('approved') })
assert.equal(u.status, 'outcome_unknown'); noSecrets('exception receipt', u)

// 7. Workspace boundary.
const ws = (role: any) => ({ kind: 'workspace' as const, workspaceId: '11111111-1111-1111-1111-111111111111', actorId: '-919800000002', actorRole: role })
const policy: WorkspaceConnectorPolicy = { workspaceId: '11111111-1111-1111-1111-111111111111', approvedToolkits: ['notion'], allowedDataClasses: ['files', 'tasks'], membersMayWrite: false }
const wsConn = conn({ connectionId: 'ws_conn', scope: ws('admin') })
// personal Gmail/Notion cannot be used from a workspace request
await refused(executeConnectorAction({ ...base, scope: ws('admin'), connection: conn(), action: read, args: {}, workspacePolicy: policy }), /connector_scope_mismatch/)
await refused(executeConnectorAction({ ...base, scope: ws('admin'), connection: wsConn, action: read, args: {} }), /connector_workspace_policy_missing/)
await refused(executeConnectorAction({ ...base, scope: ws('admin'), connection: wsConn, action: read, args: {}, workspacePolicy: { ...policy, approvedToolkits: [] } }), /connector_toolkit_not_admin_approved/)
await refused(executeConnectorAction({ ...base, scope: ws('admin'), connection: wsConn, action: { ...read, dataClasses: ['mail'] }, args: {}, workspacePolicy: policy }), /connector_data_class_not_allowed/)
const wsBinding = stageConnectorApproval({ runId: 'run_1', stepId: 'step_1', connection: wsConn, action: write, args: { title: 'Q4' } })
const wsApproval = { id: 'appr_ws', status: 'approved' as const, ...wsBinding }
await refused(executeConnectorAction({ ...base, scope: ws('viewer'), connection: wsConn, action: write, args: { title: 'Q4' }, approval: wsApproval, workspacePolicy: policy }), /connector_role_forbidden/)
await refused(executeConnectorAction({ ...base, scope: ws('member'), connection: wsConn, action: write, args: { title: 'Q4' }, approval: wsApproval, workspacePolicy: policy }), /connector_role_forbidden/)
const okWs = await executeConnectorAction({ ...base, scope: ws('admin'), connection: wsConn, action: write, args: { title: 'Q4' }, approval: wsApproval, workspacePolicy: policy })
assert.equal(okWs.status, 'succeeded'); assert.ok(okWs.scopeKey.startsWith('workspace:'))
await refused(executeConnectorAction({ ...base, connection: conn({ status: 'needs_reauth' }), action: read, args: {} }), /connector_connection_inactive/)

// 8. Credentials never appear in model-visible output.
const handle = new CredentialHandle('conn_1', ACCESS)
assert.equal(JSON.stringify({ handle }), '{"handle":"[credential]"}')
assert.equal(String(handle), '[credential]')
assert.ok(!inspect(handle, { showHidden: true, depth: 5 }).includes(ACCESS))
assert.ok(!Object.keys(handle).some(k => String((handle as any)[k]).includes(ACCESS)))
assert.equal(handle.reveal(), ACCESS, 'only the adapter can reveal')
for (const receipt of [r, w, okWs]) {
  noSecrets('receipt', receipt)
  noSecrets('model tool result', toModelToolResult(receipt))
  assert.ok(!JSON.stringify(toModelToolResult(receipt)).includes('conn_'), 'model result carries no connection id')
}
assert.equal((toModelToolResult(w) as any).summary.page.title, 'Trip notes', 'useful data survives redaction')
for (const action of [read, write, unclassified]) {
  const d = toModelToolDescriptor(action)
  noSecrets('descriptor', d)
  assert.deepEqual(Object.keys(d).sort(), ['description', 'inputSchema', 'name', 'needsApproval'])
}
assert.equal(toModelToolDescriptor(unclassified).needsApproval, true)
noSecrets('redaction', toModelVisible({ authorization: `Bearer ${ACCESS}`, client_secret: 'abc', text: `here ${REFRESH}`, cookie: 'sid=1', list: [JWT, { password: 'x' }] }))
// A secret with no recognisable shape is still dropped because of its key name.
const opaque = 'opaqueValueWithNoKnownShape42'
const keyed = JSON.stringify(toModelVisible({ client_secret: opaque, data: { access_token: opaque, Authorization: opaque, refresh_token: opaque, api_key: opaque, password: opaque } }))
assert.ok(!keyed.includes(opaque), 'secret-named keys must be dropped regardless of value shape')
// The approval snapshot staged in agent_approvals must not hold credentials either.
noSecrets('approval snapshot', binding)
assert.ok(calls.every(c => c.credential instanceof CredentialHandle), 'credentials reach the adapter only as handles')

// 9. Proposal only: nothing in app/ or lib/ imports the connector or skills proposals yet.
const root = new URL('..', import.meta.url).pathname
const walk = (dir: string): string[] => readdirSync(dir).flatMap(name => {
  const p = join(dir, name)
  if (name === 'node_modules' || name.startsWith('.')) return []
  return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx|mts|js|mjs)$/.test(name) ? [p] : []
})
const importers = [...walk(join(root, 'app')), ...walk(join(root, 'lib'))]
  .filter(p => !p.includes('/lib/connectors/') && !p.includes('/lib/skills/'))
  .filter(p => /lib\/connectors\/adapter|lib\/skills\/registry|from ['"]\.\.?\/(?:connectors|skills)\//.test(readFileSync(p, 'utf8')))
assert.deepEqual(importers, [], 'connectors/skills proposal must not be wired in yet')

console.log('connector adapter policy verification passed')
