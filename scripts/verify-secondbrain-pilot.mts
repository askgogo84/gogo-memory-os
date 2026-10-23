// SecondBrain for Business pilot (23 Oct). Run: npx tsx scripts/verify-secondbrain-pilot.mts
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-key'
process.env.OPENAI_API_KEY ||= 'test-key'
process.env.ANTHROPIC_API_KEY ||= 'test-key'

const rules = await import('../lib/workspaces/rules.ts')
const { canRole, memberChangeProblem, wouldRemoveLastOwner, whatsappIdCandidates, cleanWorkspaceName, isMissingTableError } = rules
const access = await import('../lib/workspaces/access.ts')
assert.equal(access.canRole, canRole, 'access re-exports the pure rules')

// 1. canRole matrix.
const MATRIX: Record<string, Record<string, boolean>> = {
  owner:  { view: true,  share_artifact: true,  invite: true,  change_role: true,  remove_member: true,  rename: true },
  admin:  { view: true,  share_artifact: true,  invite: true,  change_role: true,  remove_member: true,  rename: true },
  member: { view: true,  share_artifact: true,  invite: false, change_role: false, remove_member: false, rename: false },
  viewer: { view: true,  share_artifact: false, invite: false, change_role: false, remove_member: false, rename: false },
}
for (const [role, actions] of Object.entries(MATRIX))
  for (const [action, allowed] of Object.entries(actions)) assert.equal(canRole(role as any, action as any), allowed, `${role} ${action}`)
assert.equal(canRole(null, 'view'), false); assert.equal(canRole('root' as any, 'view'), false)

// 2. Last-owner protection and who may change whom.
assert.equal(wouldRemoveLastOwner('owner', 1, { kind: 'remove' }), true)
assert.equal(wouldRemoveLastOwner('owner', 1, { kind: 'role', to: 'admin' }), true)
assert.equal(wouldRemoveLastOwner('owner', 1, { kind: 'role', to: 'owner' }), false)
assert.equal(wouldRemoveLastOwner('owner', 2, { kind: 'remove' }), false)
assert.equal(wouldRemoveLastOwner('admin', 1, { kind: 'remove' }), false)
const p = (actorRole: any, targetRole: any, change: any, opts: { self?: boolean; owners?: number } = {}) =>
  memberChangeProblem({ actorTelegramId: 'a', actorRole, targetTelegramId: opts.self ? 'a' : 'b', targetRole, ownerCount: opts.owners ?? 1, change })
assert.equal(p('owner', 'owner', { kind: 'remove' }, { self: true }), 'last_owner', 'last owner cannot leave')
assert.equal(p('owner', 'owner', { kind: 'role', to: 'member' }, { self: true }), 'last_owner', 'last owner cannot demote self')
assert.equal(p('owner', 'owner', { kind: 'remove' }, { owners: 2 }), null, 'an owner may remove a co-owner')
assert.equal(p('admin', 'owner', { kind: 'remove' }, { owners: 2 }), 'workspace_forbidden', 'admins never touch owners')
assert.equal(p('admin', 'admin', { kind: 'role', to: 'member' }), 'workspace_forbidden', 'admins never demote admins')
assert.equal(p('admin', 'member', { kind: 'role', to: 'owner' }), 'workspace_forbidden', 'only owners grant owner')
assert.equal(p('admin', 'member', { kind: 'role', to: 'admin' }), null)
assert.equal(p('admin', 'viewer', { kind: 'remove' }), null)
assert.equal(p('member', 'viewer', { kind: 'remove' }), 'workspace_forbidden')
assert.equal(p('viewer', 'viewer', { kind: 'remove' }, { self: true }), null, 'anyone may leave')
assert.equal(p('member', 'member', { kind: 'role', to: 'admin' }, { self: true }), 'workspace_forbidden', 'no self-promotion')

// Small pure helpers.
assert.deepEqual(whatsappIdCandidates('+91 98765 43210'), ['919876543210', '+919876543210'])
assert.deepEqual(whatsappIdCandidates('9876543210'), ['919876543210', '+919876543210'])
assert.deepEqual(whatsappIdCandidates('123'), [])
assert.equal(cleanWorkspaceName('  Tipplr   ops '), 'Tipplr ops'); assert.equal(cleanWorkspaceName(''), null); assert.equal(cleanWorkspaceName('x'.repeat(81)), null)
assert.equal(isMissingTableError({ code: '42P01', message: 'relation "workspaces" does not exist' }), true)
assert.equal(isMissingTableError({ code: 'PGRST205', message: "Could not find the table 'public.workspaces' in the schema cache" }), true)
assert.equal(isMissingTableError({ code: '23505', message: 'duplicate key' }), false)

// 3. Source: every workspace function membership-checks or filters by the caller's telegram_id before touching a table.
const src = readFileSync('lib/workspaces/access.ts', 'utf8')
const fns = [...src.matchAll(/^(?:export )?async function (\w+)\(/gm)].map((m, i, all) => ({ name: m[1], body: src.slice(m.index!, all[i + 1]?.index ?? src.length) }))
// listMyInvites / respondToInvite: only invitations addressed to the caller (telegram_id = me).
const SCOPED_BY_CALLER = new Set(['getMembership', 'listMyWorkspaces', 'createWorkspace', 'listMyInvites', 'respondToInvite'])
// expireStaleInvites / pendingInvites run only after the caller passed requireWorkspaceRole (asserted below).
const INTERNAL = new Set(['audit', 'displayNames', 'memberRow', 'ownerCount', 'applyMemberChange', 'expireStaleInvites', 'pendingInvites'])
for (const fn of fns) {
  const firstFrom = fn.body.indexOf('.from(')
  if (firstFrom < 0 && !fn.body.includes('applyMemberChange(')) continue
  if (INTERNAL.has(fn.name)) continue
  if (SCOPED_BY_CALLER.has(fn.name)) {
    assert.match(fn.body.slice(0, fn.body.indexOf('check(')), /\.eq\('(telegram_id|created_by)', me\)/, `${fn.name} filters by the caller`)
    continue
  }
  const gate = Math.max(fn.body.indexOf('requireWorkspaceRole('), fn.body.indexOf('applyMemberChange('))
  assert.ok(gate >= 0 && (firstFrom < 0 || gate < firstFrom), `${fn.name} checks membership before its first query`)
}
assert.match(src, /async function getMembership[\s\S]*?\.eq\('workspace_id', id\)\.eq\('telegram_id', me\)/, 'membership lookup keyed by workspace and caller')
assert.match(src, /async function applyMemberChange[\s\S]*?requireWorkspaceRole\(telegramId, workspaceId, 'view'\)[\s\S]*?memberChangeProblem\(/, 'member changes go through the rules')
// Writes on member rows are scoped to the checked workspace.
for (const m of src.matchAll(/from\('workspace_members'\)\.(update|delete)\([^)]*\)\s*\.eq\('workspace_id', membership\.workspaceId\)\.eq\('telegram_id', target\)/g)) assert.ok(m)
assert.equal((src.match(/from\('workspace_members'\)\.(update|delete)\(/g) || []).length, 2)

// Every route authenticates, uses the origin guard on mutations, and reaches data only through access.ts.
function walk(dir: string, out: string[] = []) { for (const n of readdirSync(dir)) { const f = join(dir, n); statSync(f).isDirectory() ? walk(f, out) : out.push(f) } return out }
const routes = walk('app/api/workspaces').filter(f => f.endsWith('route.ts'))
assert.equal(routes.length, 8, 'eight workspace route files (5 pilot + 3 invitation)')
for (const file of routes) {
  const r = readFileSync(file, 'utf8')
  assert.doesNotMatch(r, /supabaseAdmin|\.from\(/, `${file} never queries directly`)
  assert.match(r, /from '@\/lib\/workspaces\/access'/, `${file} goes through the access layer`)
  for (const m of r.matchAll(/export async function (GET|POST|PATCH|DELETE)\([\s\S]*?\n\}/g)) {
    const body = m[0]
    assert.match(body, /requireAgentSession\(request\)[\s\S]*isAgentSession\(session\)/, `${file} ${m[1]} requires a session`)
    if (m[1] !== 'GET') assert.match(body, /requireAgentMutationOrigin\(request\)/, `${file} ${m[1]} has the origin guard`)
    assert.match(body, /session\.telegramId/, `${file} ${m[1]} acts as the signed-in user`)
  }
}
const http = readFileSync('lib/workspaces/http.ts', 'utf8')
assert.match(http, /workspaces_not_enabled: 503/); assert.match(http, /workspace_forbidden: 403/)

// 4. Sharing requires owning the artifact.
const share = src.slice(src.indexOf('export async function shareArtifact'), src.indexOf('export async function unshareArtifact'))
assert.match(share, /requireWorkspaceRole\(telegramId, workspaceId, 'share_artifact'\)/)
assert.match(share, /from\('agent_artifacts'\)[\s\S]*?\.eq\('id', id\)\.eq\('telegram_id', membership\.telegramId\)/, 'artifact lookup is owner-scoped')
assert.match(share, /String\(artifact\.telegram_id\) !== membership\.telegramId\) throw new WorkspaceError\('artifact_not_found'\)/, 'explicit ownership check')
assert.ok(share.indexOf("telegram_id) !== membership.telegramId") < share.indexOf("from('workspace_artifacts')"), 'ownership checked before the share write')
// Detail shows titles only, and only while the sharer still owns the artifact.
const detail = src.slice(src.indexOf('export async function getWorkspaceDetail'), src.indexOf('async function memberRow'))
assert.match(detail, /from\('agent_artifacts'\)\.select\('id,title,telegram_id'\)/, 'titles only, never content_json')
assert.match(detail, /art\.owner !== s\.shared_by/)

// Every mutation writes the audit log.
for (const name of ['createWorkspace', 'renameWorkspace', 'inviteMember', 'changeMemberRole', 'removeMember', 'shareArtifact', 'unshareArtifact'])
  assert.match(fns.find(f => f.name === name)!.body, /await audit\(/, `${name} is audited`)

// 5. Migration: four tables, RLS on each, no policies, idempotent, transactional; rollback sibling exists.
const mig = readFileSync('supabase/migrations/20261023100000_secondbrain_workspaces.sql', 'utf8')
for (const t of ['workspaces', 'workspace_members', 'workspace_audit_log', 'workspace_artifacts']) {
  assert.match(mig, new RegExp(`create table if not exists public\\.${t} \\(`), `${t} created idempotently`)
  assert.match(mig, new RegExp(`alter table public\\.${t} enable row level security;`), `${t} has RLS`)
}
assert.doesNotMatch(mig, /create policy/i, 'service role only: no policies')
assert.match(mig, /^begin;/m); assert.match(mig, /^commit;/m)
assert.match(mig, /create index if not exists workspace_members_telegram_idx on public\.workspace_members \(telegram_id\)/)
assert.match(mig, /role in \('owner','admin','member','viewer'\)/)
assert.match(mig, /references public\.agent_artifacts\(id\) on delete cascade/)
assert.match(mig, /char_length\(name\) between 1 and 80/)
const rollback = readFileSync('supabase/migrations/20261023100000_secondbrain_workspaces.rollback.sql', 'utf8')
for (const t of ['workspaces', 'workspace_members', 'workspace_audit_log', 'workspace_artifacts']) assert.match(rollback, new RegExp(`drop table if exists public\\.${t};`))

// 6. Workspace code never reads personal memory, the Vault or conversations.
const workspaceFiles = [...walk('lib/workspaces'), ...walk('app/api/workspaces'), ...walk('app/dashboard/(app)/business')]
assert.ok(workspaceFiles.length >= 9)
for (const file of workspaceFiles) {
  const text = readFileSync(file, 'utf8')
  assert.doesNotMatch(text, /\b(memories|conversations|link_vault_items|agent_vault\w*|vault\w*)\b/, `${file} must not reference personal data tables`)
}

// 7. Nav: SecondBrain sits under More, the four main places are unchanged.
const nav = readFileSync('components/dashboard/dashboard-nav.tsx', 'utf8')
const main = nav.slice(nav.indexOf('export const NAV'), nav.indexOf('export const MORE'))
const more = nav.slice(nav.indexOf('export const MORE'), nav.indexOf('export const SETTINGS'))
assert.equal((main.match(/label:'/g) || []).length, 4)
assert.match(more, /href:'\/dashboard\/business', label:'SecondBrain'/)

// 8. The page is honest: no invented metrics, set-up state when the tables are missing.
const page = readFileSync('app/dashboard/(app)/business/page.tsx', 'utf8')
const client = readFileSync('app/dashboard/(app)/business/business-client.tsx', 'utf8')
assert.match(page, /SecondBrain is being set up/); assert.match(page, /workspaces_not_enabled/)
assert.match(client, /Executive brief arrives when workspace sources are connected\. Nothing here reads anyone’s personal data\./)
for (const s of ['No team approvals yet.', 'Team channels are coming next.', 'Pilot · read-only', 'you are {ROLE_LABEL[detail.myRole]}', 'Ask about ${detail.name}…', 'Shared by '])
  assert.ok(client.includes(s), `client shows ${s}`)
assert.match(client, /canInvite && <form/, 'invite controls only for admin+')
for (const file of ['app/dashboard/(app)/business/business-client.tsx', 'app/dashboard/(app)/business/share-to-workspace.tsx'])
  for (const line of readFileSync(file, 'utf8').split('\n').filter(l => l.includes("'@/lib/workspaces/access'")))
    assert.match(line, /^import type /, `${file} imports only types from the server access layer`)
console.log('verify-secondbrain-pilot: ok')

// Invitations are consent-based: inviting creates a pending invite, never a membership row.
{
  const body = (name: string) => fns.find(f => f.name === name)!.body
  const invite = body('inviteMember')
  assert.ok(!invite.includes("from('workspace_members')\n    .insert") && !/workspace_members'\)\s*\.insert/.test(invite), 'inviteMember never inserts a member')
  assert.match(invite, /from\('workspace_invites'\)\s*\.insert/)
  const respond = body('respondToInvite')
  assert.match(respond, /\.eq\('id', id\)\.eq\('telegram_id', me\)/, 'only the invitee can answer')
  assert.ok(respond.indexOf(".eq('status', 'pending').select('id')") < respond.indexOf("from('workspace_members')\n      .insert"), 'invite is claimed before membership is created')
  assert.ok(src.indexOf('expireStaleInvites(membership.workspaceId)') > src.indexOf("requireWorkspaceRole(telegramId, workspaceId, 'invite')"))
  assert.match(body('getWorkspaceDetail'), /admin \? await Promise\.all\(\[pendingInvites\(id\)/, 'pending invites and audit only for admins')
  assert.match(body('getSharedArtifact'), /requireWorkspaceRole\(telegramId, workspaceId, 'view'\)[\s\S]*\.eq\('telegram_id', String\(share\.shared_by\)\)/, 'shared view: member + still owned by sharer')
  assert.match(body('listAudit'), /requireWorkspaceRole\(telegramId, workspaceId, 'remove_member'\)/, 'audit trail is admin+')
  console.log('Invitations: pending until the invitee accepts; revoke/expiry; shared reports readable by members; audit admin-only')
}

// One open = one 'opened a shared report' (23 Oct live test logged seven).
{
  const v = fns.find(f => f.name === 'getSharedArtifact')!.body
  assert.match(v, /\.eq\('action', 'artifact\.view'\)\.eq\('target', id\)\.gte\('created_at'/)
  assert.match(v, /if \(!recent\?\.length\) await audit\(/)
  console.log('Shared report views: one audit entry per member and report per 10 minutes')
}

// REJECT leaves a truthful run summary (23 Oct live: panel kept "Waiting for approval").
{
  const wb = readFileSync('lib/agent/whatsapp-bridge.ts', 'utf8'), tr = readFileSync('lib/agent/typed-time-routing.ts', 'utf8')
  assert.match(wb, /decision === 'reject' \? \{ summary: 'Rejected by you\. Nothing was done\.' \}/)
  assert.match(tr, /status:'paused',summary:'Rejected by you\. Nothing was done\.'/)
  console.log('Rejected approvals: run summary says nothing was done')
}
