// SecondBrain for Business — pure workspace rules (no database access), so tests and client
// components can import them without a Supabase client.

export const WORKSPACE_ROLES = ['owner', 'admin', 'member', 'viewer'] as const
export type WorkspaceRole = typeof WORKSPACE_ROLES[number]

export const ROLE_RANK: Record<WorkspaceRole, number> = { owner: 4, admin: 3, member: 2, viewer: 1 }

export type WorkspaceAction = 'view' | 'share_artifact' | 'invite' | 'change_role' | 'remove_member' | 'rename'

/** Lowest role allowed to take each action. */
export const ACTION_MIN_ROLE: Record<WorkspaceAction, WorkspaceRole> = {
  view: 'viewer',
  share_artifact: 'member',
  invite: 'admin',
  change_role: 'admin',
  remove_member: 'admin',
  rename: 'admin',
}

export const MAX_WORKSPACES_PER_USER = 5
export const MAX_MEMBERS_PER_WORKSPACE = 50
/** Roles an admin+ may hand out by invitation. Owner is never granted by invite. */
export const INVITABLE_ROLES: WorkspaceRole[] = ['admin', 'member', 'viewer']

export function isWorkspaceRole(value: unknown): value is WorkspaceRole {
  return typeof value === 'string' && (WORKSPACE_ROLES as readonly string[]).includes(value)
}

export function canRole(role: WorkspaceRole | null | undefined, action: WorkspaceAction): boolean {
  if (!role || !isWorkspaceRole(role)) return false
  return ROLE_RANK[role] >= ROLE_RANK[ACTION_MIN_ROLE[action]]
}

export type MemberChange = { kind: 'remove' } | { kind: 'role'; to: WorkspaceRole }

/**
 * Whether `actor` may apply `change` to `target`. Returns an error code or null when allowed.
 *  - Anyone may leave (remove themselves), except the last owner.
 *  - Admins manage members and viewers, and may raise them to admin. Only owners touch owners or admins,
 *    and only owners grant owner.
 *  - The last owner can never be removed or demoted.
 */
export function memberChangeProblem(input: {
  actorTelegramId: string
  actorRole: WorkspaceRole
  targetTelegramId: string
  targetRole: WorkspaceRole
  ownerCount: number
  change: MemberChange
}): string | null {
  const { actorTelegramId, actorRole, targetTelegramId, targetRole, ownerCount, change } = input
  const self = actorTelegramId === targetTelegramId
  if (wouldRemoveLastOwner(targetRole, ownerCount, change)) return 'last_owner'
  if (change.kind === 'remove' && self) return null
  if (!canRole(actorRole, change.kind === 'remove' ? 'remove_member' : 'change_role')) return 'workspace_forbidden'
  if (change.kind === 'role' && !isWorkspaceRole(change.to)) return 'invalid_role'
  const touchesSenior = ROLE_RANK[targetRole] >= ROLE_RANK.admin && !self
  if (touchesSenior && actorRole !== 'owner') return 'workspace_forbidden'
  if (change.kind === 'role' && change.to === 'owner' && actorRole !== 'owner') return 'workspace_forbidden'
  return null
}

/** True when a write would leave the workspace with no owner (pure helper for the last-owner rule). */
export function wouldRemoveLastOwner(targetRole: WorkspaceRole, ownerCount: number, change: MemberChange): boolean {
  return targetRole === 'owner' && ownerCount <= 1 && (change.kind === 'remove' || change.to !== 'owner')
}

export function cleanWorkspaceName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const name = raw.replace(/\s+/g, ' ').trim()
  return name.length >= 1 && name.length <= 80 ? name : null
}

/** Every stored spelling a WhatsApp number may have in users.whatsapp_id ("9198…", "+9198…"). */
export function whatsappIdCandidates(raw: unknown): string[] {
  const digits = String(raw ?? '').replace(/[^\d+]/g, '')
  let bare = digits.replace(/^\+/, '')
  if (bare.length === 10) bare = `91${bare}`
  else if (!(bare.length >= 11 && bare.length <= 15)) return []
  return [bare, `+${bare}`]
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** PostgREST / Postgres signals that a table is absent (migration not yet run). */
export function isMissingTableError(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false
  return /42P01|PGRST205/.test(String(error.code || '')) || /does not exist|schema cache/i.test(String(error.message || ''))
}

export const ROLE_LABEL: Record<WorkspaceRole, string> = { owner: 'Owner', admin: 'Admin', member: 'Member', viewer: 'Viewer' }
