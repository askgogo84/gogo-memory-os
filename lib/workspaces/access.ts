// SecondBrain for Business — workspace access layer (23 Oct pilot, read-only).
//
// The app reads Supabase with the service role, so the database does not isolate tenants for us.
// Every function here either filters by the caller's telegram_id or calls requireWorkspaceRole()
// before its first workspace read or write. scripts/verify-secondbrain-pilot.mts asserts this.
//
// Boundary: workspace code reads only the workspace tables, users (display name / number lookup)
// and agent_artifacts rows their owner explicitly shared. It never reads anyone's personal data
// stores — scripts/verify-secondbrain-pilot.mts fails if any workspace file names one.
import { supabaseAdmin } from '@/lib/supabase-admin'
import {
  canRole, cleanWorkspaceName, INVITABLE_ROLES, isMissingTableError, isWorkspaceRole, MAX_MEMBERS_PER_WORKSPACE,
  MAX_WORKSPACES_PER_USER, memberChangeProblem, UUID_RE, whatsappIdCandidates,
  type MemberChange, type WorkspaceAction, type WorkspaceRole,
} from './rules'

export * from './rules'

export class WorkspaceError extends Error {
  constructor(public code: string) { super(code) }
}

type PgError = { code?: string | null; message?: string | null } | null

/** Missing tables mean the migration has not run: callers answer 503 / show the set-up state. */
function check(error: PgError, context: string) {
  if (!error) return
  if (isMissingTableError(error)) throw new WorkspaceError('workspaces_not_enabled')
  console.error('WORKSPACE_QUERY_FAILED:', context, String(error.code || ''), String(error.message || '').slice(0, 160))
  throw new WorkspaceError('workspace_unavailable')
}

function tg(value: unknown): string {
  const id = String(value ?? '').trim()
  if (!id) throw new WorkspaceError('invalid_session')
  return id
}

function wsId(value: unknown): string {
  const id = String(value ?? '')
  if (!UUID_RE.test(id)) throw new WorkspaceError('workspace_not_found')
  return id
}

export type Membership = { workspaceId: string; telegramId: string; role: WorkspaceRole }

export async function getMembership(telegramId: string, workspaceId: string): Promise<Membership | null> {
  const me = tg(telegramId)
  const id = wsId(workspaceId)
  const { data, error } = await supabaseAdmin.from('workspace_members')
    .select('role').eq('workspace_id', id).eq('telegram_id', me).maybeSingle()
  check(error, 'membership')
  if (!data || !isWorkspaceRole(data.role)) return null
  return { workspaceId: id, telegramId: me, role: data.role }
}

/** Throws 'workspace_forbidden' unless the caller is a member whose role allows `action`. */
export async function requireWorkspaceRole(telegramId: string, workspaceId: string, action: WorkspaceAction): Promise<Membership> {
  const membership = await getMembership(telegramId, workspaceId)
  if (!membership || !canRole(membership.role, action)) throw new WorkspaceError('workspace_forbidden')
  return membership
}

export type MyWorkspace = { id: string; name: string; role: WorkspaceRole; pilotReadOnly: boolean; createdAt: string | null }

export async function listMyWorkspaces(telegramId: string): Promise<MyWorkspace[]> {
  const me = tg(telegramId)
  const { data: rows, error } = await supabaseAdmin.from('workspace_members')
    .select('workspace_id,role').eq('telegram_id', me).limit(100)
  check(error, 'list_memberships')
  const mine = ((rows || []) as { workspace_id: string; role: unknown }[])
    .filter((r): r is { workspace_id: string; role: WorkspaceRole } => isWorkspaceRole(r.role))
  if (!mine.length) return []
  // Only ids the caller is a member of (from the telegram_id-filtered query above).
  const { data: spaces, error: spaceError } = await supabaseAdmin.from('workspaces')
    .select('id,name,pilot_read_only,created_at').in('id', mine.map(r => r.workspace_id))
  check(spaceError, 'list_workspaces')
  type Space = { id: string; name: string; pilot_read_only: boolean | null; created_at: string | null }
  const byId = new Map(((spaces || []) as Space[]).map(s => [s.id, s]))
  return mine.flatMap(r => {
    const s = byId.get(r.workspace_id)
    return s ? [{ id: s.id, name: s.name, role: r.role, pilotReadOnly: s.pilot_read_only !== false, createdAt: s.created_at ?? null }] : []
  }).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
}

export async function audit(workspaceId: string, actor: string, action: string, target: string | null, metadata: Record<string, unknown> = {}) {
  const { error } = await supabaseAdmin.from('workspace_audit_log')
    .insert({ workspace_id: wsId(workspaceId), actor: tg(actor), action, target, metadata_json: metadata })
  check(error, 'audit')
}

async function displayNames(telegramIds: string[]): Promise<Map<string, string>> {
  const numeric = [...new Set(telegramIds)].map(Number).filter(Number.isFinite)
  if (!numeric.length) return new Map()
  const { data, error } = await supabaseAdmin.from('users').select('telegram_id,name').in('telegram_id', numeric)
  if (error) { console.error('WORKSPACE_NAMES_FAILED:', String(error.code || '')); return new Map() }
  return new Map(((data || []) as { telegram_id: unknown; name: unknown }[]).map(u => [String(u.telegram_id), String(u.name || '').trim() || 'AskGogo user']))
}

export async function createWorkspace(telegramId: string, rawName: unknown): Promise<MyWorkspace> {
  const me = tg(telegramId)
  const name = cleanWorkspaceName(rawName)
  if (!name) throw new WorkspaceError('invalid_name')
  const { count, error: countError } = await supabaseAdmin.from('workspaces')
    .select('id', { count: 'exact', head: true }).eq('created_by', me)
  check(countError, 'count_created')
  if ((count || 0) >= MAX_WORKSPACES_PER_USER) throw new WorkspaceError('workspace_limit')
  const { data: created, error } = await supabaseAdmin.from('workspaces')
    .insert({ name, created_by: me, pilot_read_only: true }).select('id,name,pilot_read_only,created_at').single()
  check(error, 'create')
  const { error: memberError } = await supabaseAdmin.from('workspace_members')
    .insert({ workspace_id: created.id, telegram_id: me, role: 'owner', invited_by: null })
  if (memberError) {
    await supabaseAdmin.from('workspaces').delete().eq('id', created.id).eq('created_by', me)
    check(memberError, 'create_owner')
  }
  await audit(created.id, me, 'workspace.create', created.id, { name })
  return { id: created.id, name: created.name, role: 'owner', pilotReadOnly: created.pilot_read_only !== false, createdAt: created.created_at ?? null }
}

export async function renameWorkspace(telegramId: string, workspaceId: string, rawName: unknown) {
  const membership = await requireWorkspaceRole(telegramId, workspaceId, 'rename')
  const name = cleanWorkspaceName(rawName)
  if (!name) throw new WorkspaceError('invalid_name')
  const { error } = await supabaseAdmin.from('workspaces').update({ name }).eq('id', membership.workspaceId)
  check(error, 'rename')
  await audit(membership.workspaceId, membership.telegramId, 'workspace.rename', membership.workspaceId, { name })
  return { ok: true as const, name }
}

export type WorkspaceMember = { telegramId: string; name: string; role: WorkspaceRole; isYou: boolean }
export type SharedArtifact = { artifactId: string; title: string; sharedBy: string; sharedByName: string; sharedByYou: boolean; sharedAt: string | null }
export type WorkspaceDetail = {
  id: string; name: string; pilotReadOnly: boolean; myRole: WorkspaceRole
  members: WorkspaceMember[]; artifacts: SharedArtifact[]
}

export async function getWorkspaceDetail(telegramId: string, workspaceId: string): Promise<WorkspaceDetail> {
  const membership = await requireWorkspaceRole(telegramId, workspaceId, 'view')
  const id = membership.workspaceId
  const [space, members, shares] = await Promise.all([
    supabaseAdmin.from('workspaces').select('id,name,pilot_read_only').eq('id', id).maybeSingle(),
    supabaseAdmin.from('workspace_members').select('telegram_id,role,created_at').eq('workspace_id', id).order('created_at', { ascending: true }).limit(MAX_MEMBERS_PER_WORKSPACE),
    supabaseAdmin.from('workspace_artifacts').select('artifact_id,shared_by,created_at').eq('workspace_id', id).order('created_at', { ascending: false }).limit(100),
  ])
  check(space.error, 'detail'); check(members.error, 'detail_members'); check(shares.error, 'detail_shares')
  if (!space.data) throw new WorkspaceError('workspace_not_found')
  const shareRows = (shares.data || []) as { artifact_id: string; shared_by: string; created_at: string | null }[]
  // Titles only, and only for artifacts still owned by the member who shared them.
  let titles = new Map<string, { title: string; owner: string }>()
  if (shareRows.length) {
    const { data: arts, error } = await supabaseAdmin.from('agent_artifacts').select('id,title,telegram_id')
      .in('id', shareRows.map(s => s.artifact_id)).in('telegram_id', [...new Set(shareRows.map(s => s.shared_by))])
    check(error, 'detail_artifacts')
    titles = new Map(((arts || []) as { id: unknown; title: unknown; telegram_id: unknown }[]).map(a => [String(a.id), { title: String(a.title || 'Untitled'), owner: String(a.telegram_id) }]))
  }
  const memberRows = ((members.data || []) as { telegram_id: unknown; role: unknown }[])
    .filter((m): m is { telegram_id: unknown; role: WorkspaceRole } => isWorkspaceRole(m.role))
  const names = await displayNames([...memberRows.map(m => String(m.telegram_id)), ...shareRows.map(s => s.shared_by)])
  const me = membership.telegramId
  return {
    id, name: space.data.name, pilotReadOnly: space.data.pilot_read_only !== false, myRole: membership.role,
    members: memberRows.map(m => ({ telegramId: String(m.telegram_id), name: names.get(String(m.telegram_id)) || 'AskGogo user', role: m.role, isYou: String(m.telegram_id) === me })),
    artifacts: shareRows.flatMap(s => {
      const art = titles.get(s.artifact_id)
      if (!art || art.owner !== s.shared_by) return []
      return [{ artifactId: s.artifact_id, title: art.title, sharedBy: s.shared_by, sharedByName: names.get(s.shared_by) || 'AskGogo user', sharedByYou: s.shared_by === me, sharedAt: s.created_at ?? null }]
    }),
  }
}

async function memberRow(workspaceId: string, telegramId: string): Promise<WorkspaceRole | null> {
  const { data, error } = await supabaseAdmin.from('workspace_members')
    .select('role').eq('workspace_id', workspaceId).eq('telegram_id', telegramId).maybeSingle()
  check(error, 'member_row')
  return data && isWorkspaceRole(data.role) ? data.role : null
}

async function ownerCount(workspaceId: string): Promise<number> {
  const { count, error } = await supabaseAdmin.from('workspace_members')
    .select('telegram_id', { count: 'exact', head: true }).eq('workspace_id', workspaceId).eq('role', 'owner')
  check(error, 'owner_count')
  return count || 0
}

/** Invite an existing AskGogo user by WhatsApp number. Never creates users. */
export async function inviteMember(telegramId: string, workspaceId: string, rawNumber: unknown, rawRole: unknown) {
  const membership = await requireWorkspaceRole(telegramId, workspaceId, 'invite')
  const role = isWorkspaceRole(rawRole) && INVITABLE_ROLES.includes(rawRole) ? rawRole : null
  if (!role) throw new WorkspaceError('invalid_role')
  const candidates = whatsappIdCandidates(rawNumber)
  if (!candidates.length) throw new WorkspaceError('invalid_number')
  const { data: users, error } = await supabaseAdmin.from('users').select('telegram_id').in('whatsapp_id', candidates).limit(2)
  check(error, 'invite_lookup')
  if (!users?.length) throw new WorkspaceError('user_not_found')
  if (users.length > 1) throw new WorkspaceError('ambiguous_number')
  const invitee = String(users[0].telegram_id)
  if (await memberRow(membership.workspaceId, invitee)) throw new WorkspaceError('already_member')
  const { count, error: countError } = await supabaseAdmin.from('workspace_members')
    .select('telegram_id', { count: 'exact', head: true }).eq('workspace_id', membership.workspaceId)
  check(countError, 'member_count')
  if ((count || 0) >= MAX_MEMBERS_PER_WORKSPACE) throw new WorkspaceError('member_limit')
  const { error: insertError } = await supabaseAdmin.from('workspace_members')
    .insert({ workspace_id: membership.workspaceId, telegram_id: invitee, role, invited_by: membership.telegramId })
  check(insertError, 'invite')
  await audit(membership.workspaceId, membership.telegramId, 'member.invite', invitee, { role })
  return { ok: true as const, telegramId: invitee, role }
}

async function applyMemberChange(telegramId: string, workspaceId: string, targetTelegramId: string, change: MemberChange) {
  const membership = await requireWorkspaceRole(telegramId, workspaceId, 'view')
  const target = tg(targetTelegramId)
  const targetRole = await memberRow(membership.workspaceId, target)
  if (!targetRole) throw new WorkspaceError('member_not_found')
  const owners = targetRole === 'owner' ? await ownerCount(membership.workspaceId) : 2
  const problem = memberChangeProblem({ actorTelegramId: membership.telegramId, actorRole: membership.role, targetTelegramId: target, targetRole, ownerCount: owners, change })
  if (problem) throw new WorkspaceError(problem)
  return { membership, target, targetRole }
}

export async function changeMemberRole(telegramId: string, workspaceId: string, targetTelegramId: string, rawRole: unknown) {
  if (!isWorkspaceRole(rawRole)) throw new WorkspaceError('invalid_role')
  const { membership, target, targetRole } = await applyMemberChange(telegramId, workspaceId, targetTelegramId, { kind: 'role', to: rawRole })
  const { error } = await supabaseAdmin.from('workspace_members').update({ role: rawRole })
    .eq('workspace_id', membership.workspaceId).eq('telegram_id', target)
  check(error, 'change_role')
  await audit(membership.workspaceId, membership.telegramId, 'member.role', target, { from: targetRole, to: rawRole })
  return { ok: true as const, role: rawRole }
}

export async function removeMember(telegramId: string, workspaceId: string, targetTelegramId: string) {
  const { membership, target, targetRole } = await applyMemberChange(telegramId, workspaceId, targetTelegramId, { kind: 'remove' })
  // Shares made by the departing member leave with them.
  const { error: shareError } = await supabaseAdmin.from('workspace_artifacts').delete()
    .eq('workspace_id', membership.workspaceId).eq('shared_by', target)
  check(shareError, 'remove_shares')
  const { error } = await supabaseAdmin.from('workspace_members').delete()
    .eq('workspace_id', membership.workspaceId).eq('telegram_id', target)
  check(error, 'remove')
  await audit(membership.workspaceId, membership.telegramId, target === membership.telegramId ? 'member.leave' : 'member.remove', target, { role: targetRole })
  return { ok: true as const }
}

/** Share one of the caller's OWN agent_artifacts into a workspace where they can share. */
export async function shareArtifact(telegramId: string, workspaceId: string, artifactId: unknown) {
  const membership = await requireWorkspaceRole(telegramId, workspaceId, 'share_artifact')
  const id = String(artifactId ?? '')
  if (!UUID_RE.test(id)) throw new WorkspaceError('invalid_artifact')
  const { data: artifact, error } = await supabaseAdmin.from('agent_artifacts')
    .select('id,telegram_id,title').eq('id', id).eq('telegram_id', membership.telegramId).maybeSingle()
  check(error, 'share_lookup')
  if (!artifact || String(artifact.telegram_id) !== membership.telegramId) throw new WorkspaceError('artifact_not_found')
  const { error: shareError } = await supabaseAdmin.from('workspace_artifacts')
    .upsert({ workspace_id: membership.workspaceId, artifact_id: id, shared_by: membership.telegramId }, { onConflict: 'workspace_id,artifact_id', ignoreDuplicates: true })
  check(shareError, 'share')
  await audit(membership.workspaceId, membership.telegramId, 'artifact.share', id, {})
  return { ok: true as const }
}

/** Unshare: the member who shared it, or an admin+. */
export async function unshareArtifact(telegramId: string, workspaceId: string, artifactId: unknown) {
  const membership = await requireWorkspaceRole(telegramId, workspaceId, 'share_artifact')
  const id = String(artifactId ?? '')
  if (!UUID_RE.test(id)) throw new WorkspaceError('invalid_artifact')
  const { data: share, error } = await supabaseAdmin.from('workspace_artifacts')
    .select('shared_by').eq('workspace_id', membership.workspaceId).eq('artifact_id', id).maybeSingle()
  check(error, 'unshare_lookup')
  if (!share) throw new WorkspaceError('artifact_not_found')
  if (share.shared_by !== membership.telegramId && !canRole(membership.role, 'remove_member')) throw new WorkspaceError('workspace_forbidden')
  const { error: deleteError } = await supabaseAdmin.from('workspace_artifacts').delete()
    .eq('workspace_id', membership.workspaceId).eq('artifact_id', id)
  check(deleteError, 'unshare')
  await audit(membership.workspaceId, membership.telegramId, 'artifact.unshare', id, { sharedBy: share.shared_by })
  return { ok: true as const }
}
