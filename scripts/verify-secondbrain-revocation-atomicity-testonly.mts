/**
 * TEST ONLY — EXPECTED RED — DO NOT MERGE/DEPLOY.
 * Independent SecondBrain membership-removal revocation / atomicity contract.
 * Executes the shipped source functions with a synthetic, in-memory Supabase.
 * Never connects to a database, real provider, customer or hosted application.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const SOURCE = 'lib/workspaces/access.ts'
const source = readFileSync(SOURCE, 'utf8')
const ast = ts.createSourceFile(SOURCE, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const WS = '11111111-1111-4111-8111-111111111111'
const WS_OTHER = '22222222-2222-4222-8222-222222222222'
const FIRST = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const RACING = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
type Member = { workspace_id: string; telegram_id: string; role: string }
type Share = { workspace_id: string; artifact_id: string; shared_by: string }
type Artifact = { id: string; telegram_id: string; title: string; content_json: unknown }
type Scenario = {
  memberDeleteFails?: boolean
  shareDeleteFails?: boolean
  shareInsertedDuringRemoval?: boolean
  extraWorkspaceShare?: boolean
}

function compiledFunction(name: string, deps: Record<string, unknown>): (...args: any[]) => Promise<any> {
  const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name)
  assert.ok(declaration, 'Expected real workspace implementation for ' + name)
  const raw = declaration.getText(ast).replace(/^export\s+/, '')
  const compiled = ts.transpileModule(raw, {
    fileName: SOURCE,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  const names = Object.keys(deps)
  return new Function(...names, compiled + '\nreturn ' + name + ';')(...names.map(k => deps[k]))
}

function synthetic(scenario: Scenario = {}) {
  const members: Member[] = [
    { workspace_id: WS, telegram_id: 'owner', role: 'owner' },
    { workspace_id: WS, telegram_id: 'departing', role: 'member' },
    { workspace_id: WS, telegram_id: 'viewer', role: 'viewer' },
  ]
  const shares: Share[] = [
    { workspace_id: WS, artifact_id: FIRST, shared_by: 'departing' },
  ]
  if (scenario.extraWorkspaceShare) shares.push({ workspace_id: WS_OTHER, artifact_id: FIRST, shared_by: 'departing' })
  const artifacts: Artifact[] = [
    { id: FIRST, telegram_id: 'departing', title: 'Private fixture document', content_json: { sections: [{ tool: 'memory', result: { text: 'INERT_PRIVATE_FIXTURE_A' } }] } },
    { id: RACING, telegram_id: 'departing', title: 'Private fixture document B', content_json: { sections: [{ tool: 'memory', result: { text: 'INERT_PRIVATE_FIXTURE_B' } }] } },
  ]
  const log: string[] = []
  const db = {
    from(table: string) {
      let action: 'delete' | 'select' | null = null
      const predicates: Array<[string, unknown]> = []
      const matches = (row: Record<string, unknown>) =>
        predicates.every(([key, expected]) => row[key] === expected)
      function execute() {
        if (table === 'workspace_artifacts' && action === 'delete') {
          log.push('delete_shares')
          if (scenario.shareDeleteFails) return { error: { code: 'FIXTURE', message: 'share delete failed' } }
          for (let i = shares.length - 1; i >= 0; i--) {
            if (matches(shares[i] as unknown as Record<string, unknown>)) shares.splice(i, 1)
          }
          // Deterministic concurrent actor: inserts a share while the member is still present,
          // between the two app-level DB calls. No external tasks or concurrency needed.
          if (scenario.shareInsertedDuringRemoval) {
            assert.ok(members.some(m => m.workspace_id === WS && m.telegram_id === 'departing'))
            shares.push({ workspace_id: WS, artifact_id: RACING, shared_by: 'departing' })
            log.push('concurrent_share')
          }
          return { error: null }
        }
        if (table === 'workspace_members' && action === 'delete') {
          log.push('delete_member')
          if (scenario.memberDeleteFails) return { error: { code: 'FIXTURE', message: 'member deletion denied' } }
          for (let i = members.length - 1; i >= 0; i--) {
            if (matches(members[i] as unknown as Record<string, unknown>)) members.splice(i, 1)
          }
          return { error: null }
        }
        if (action === 'select') {
          const data = table === 'workspace_audit_log' ? [{ id: 'fixture-prior-view' }] :
            table === 'workspace_artifacts' ? shares.filter(r => matches(r as unknown as Record<string, unknown>)) :
            table === 'agent_artifacts' ? artifacts.filter(r => matches(r as unknown as Record<string, unknown>)) :
            table === 'workspace_members' ? members.filter(r => matches(r as unknown as Record<string, unknown>)) : []
          return { data, error: null }
        }
        throw new Error('Unexpected synthetic DB path: ' + table + ' ' + action)
      }
      const query: any = {
        delete() { action = 'delete'; return query },
        select(_columns: string) { action = 'select'; return query },
        eq(column: string, value: unknown) { predicates.push([column, value]); return query },
        gte(_column: string, _value: unknown) { return query },
        limit(_count: number) { return query },
        maybeSingle: async () => {
          const result = execute()
          return { data: result.data?.[0] ?? null, error: result.error }
        },
        then(resolve: (result: unknown) => unknown, reject?: (err: unknown) => unknown) {
          return Promise.resolve().then(execute).then(resolve, reject)
        },
      }
      return query
    },
  }
  const check = (error: { message: string } | null, context: string) => {
    if (error) throw new Error(context + ': ' + error.message)
  }
  const WorkspaceError = class extends Error {
    constructor(public code: string) { super(code) }
  }
  const requireWorkspaceRole = async (actor: string, workspace: string, _action: string) => {
    const member = members.find(m => m.telegram_id === actor && m.workspace_id === workspace)
    if (!member) throw new WorkspaceError('workspace_forbidden')
    return { workspaceId: workspace, telegramId: actor, role: member.role }
  }
  const applyMemberChange = async (actor: string, workspace: string, target: string, change: { kind: string }) => {
    assert.equal(actor, 'owner')
    assert.equal(workspace, WS)
    assert.equal(target, 'departing')
    assert.equal(change.kind, 'remove')
    assert.ok(members.some(m => m.workspace_id === workspace && m.telegram_id === target), 'Target must be member before removal')
    return { membership: { workspaceId: workspace, telegramId: actor, role: 'owner' }, target, targetRole: 'member' }
  }
  const audit = async () => { log.push('audit') }
  const removeMember = compiledFunction('removeMember', { supabaseAdmin: db, applyMemberChange, check, audit })
  const getSharedArtifact = compiledFunction('getSharedArtifact', {
    supabaseAdmin: db, requireWorkspaceRole, check, audit,
    WorkspaceError, UUID_RE: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    displayNames: async () => new Map([['departing', 'Fixture contributor']]),
  })
  return { members, shares, log, removeMember, getSharedArtifact }
}

let passes = 0
let failures = 0
async function test(kind: 'control' | 'safety', label: string, f: () => Promise<void>) {
  try {
    await f()
    passes++
    console.log('PASS [' + kind + '] ' + label)
  } catch (e) {
    failures++
    console.error('FAIL [' + kind + '] ' + label + ': ' + String(e).slice(0, 260))
  }
}

await test('control', 'successful removal clears departing member and their existing share', async () => {
  const x = synthetic()
  assert.deepEqual(await x.removeMember('owner', WS, 'departing'), { ok: true })
  assert.ok(!x.members.some(m => m.telegram_id === 'departing' && m.workspace_id === WS))
  assert.ok(!x.shares.some(s => s.shared_by === 'departing' && s.workspace_id === WS))
})
await test('control', 'share-delete failure prevents member removal', async () => {
  const x = synthetic({ shareDeleteFails: true })
  await assert.rejects(x.removeMember('owner', WS, 'departing'), /share delete failed/)
  assert.ok(x.members.some(m => m.telegram_id === 'departing'))
  assert.equal(x.shares.length, 1)
})
await test('control', 'unrelated workspace share is not deleted', async () => {
  const x = synthetic({ extraWorkspaceShare: true })
  await x.removeMember('owner', WS, 'departing')
  assert.equal(x.shares.filter(s => s.workspace_id === WS_OTHER).length, 1)
  assert.equal(x.shares.filter(s => s.workspace_id === WS).length, 0)
})
await test('control', 'current workspace viewer can read a legitimately shared report', async () => {
  const x = synthetic()
  const view = await x.getSharedArtifact('viewer', WS, FIRST)
  assert.equal(view.artifactId, FIRST, 'Fixture reader must work before revocation')
})
await test('safety', 'failed membership removal must not destroy the contributor existing share', async () => {
  const x = synthetic({ memberDeleteFails: true })
  await assert.rejects(x.removeMember('owner', WS, 'departing'), /member deletion denied/)
  assert.ok(x.members.some(m => m.workspace_id === WS && m.telegram_id === 'departing'))
  assert.ok(x.shares.some(s => s.workspace_id === WS && s.artifact_id === FIRST), 'Share must survive an unsuccessful member removal')
})
await test('safety', 'concurrent share cannot survive successful member removal', async () => {
  const x = synthetic({ shareInsertedDuringRemoval: true })
  await x.removeMember('owner', WS, 'departing')
  assert.ok(!x.members.some(m => m.workspace_id === WS && m.telegram_id === 'departing'))
  assert.ok(!x.shares.some(s => s.workspace_id === WS && s.shared_by === 'departing'), 'Member revocation must also revoke concurrently added shares')
})
await test('safety', 'workspace viewer must not read former contributor artifact after revocation', async () => {
  const x = synthetic({ shareInsertedDuringRemoval: true })
  await x.removeMember('owner', WS, 'departing')
  assert.ok(x.shares.some(s => s.artifact_id === RACING), 'Fixture reproduces a post-revocation stale share')
  const readOutcome = await x.getSharedArtifact('viewer', WS, RACING).then(
    value => ({ ok: true, value }),
    error => ({ ok: false, error: String(error instanceof Error ? error.message : error) }),
  )
  assert.ok(!readOutcome.ok && /artifact_not_found|workspace_forbidden/.test('error' in readOutcome ? readOutcome.error : ''),
    'Revoked contributor report must fail closed, received: ' + JSON.stringify(readOutcome))
})

console.log('SecondBrain synthetic revocation: ' + passes + '/' + (passes + failures) + ' pass; ' + failures + ' fail.')
if (failures) process.exitCode = 1
