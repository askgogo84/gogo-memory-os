// Gogo Spaces store (six docs §5). Load, create from a template, apply one edit as a new version with compare-and-set
// on the version number (a stale editor reloads instead of overwriting), list history. Owner ids stay strings.
// A missing table is 'spaces_not_enabled' (the migration has not been run); callers show "not set up yet".
import { editSpace, templateSpace, validateSpace, type Space, type SpaceEdit, type SpaceScope, type SpaceTemplate } from './schema'

type Db = { from: (t: string) => any }
const missing = (e: any) => /does not exist|42P01|PGRST205/i.test(String(e?.message || e?.code || ''))
export class SpacesError extends Error { constructor(public code: 'spaces_not_enabled' | 'spaces_db_failed' | 'not_found' | 'stale_version' | 'invalid' | 'exists', detail = '') { super(detail ? `${code}: ${detail}` : code) } }
const check = (error: any, ctx: string) => { if (!error) return; if (missing(error)) throw new SpacesError('spaces_not_enabled'); throw new SpacesError('spaces_db_failed', `${ctx}: ${String(error.message || '').slice(0, 120)}`) }

const ownerCols = (scope: SpaceScope) => scope.kind === 'user' ? { owner_telegram_id: String(scope.telegramId), workspace_id: null } : { owner_telegram_id: null, workspace_id: scope.workspaceId }
const scoped = (q: any, scope: SpaceScope) => scope.kind === 'user' ? q.eq('owner_telegram_id', String(scope.telegramId)) : q.eq('workspace_id', scope.workspaceId)
const fromRow = (r: any): Space & { rowId: string } => ({ ...(r.doc as Space), version: r.version, rowId: r.id })

export type SkillLookup = (id: string) => { exactActionApproval: boolean } | null

export async function listSpaces(db: Db, scope: SpaceScope): Promise<{ slug: string; title: string; template: SpaceTemplate; version: number; updatedAt: string; refreshMinutes: number }[]> {
  const { data, error } = await scoped(db.from('spaces').select('slug,template,version,doc,updated_at'), scope).order('updated_at', { ascending: false }).limit(50)
  check(error, 'list')
  return (data || []).map((r: any) => ({ slug: r.slug, title: String(r.doc?.title || r.slug), template: r.template, version: r.version, updatedAt: r.updated_at, refreshMinutes: Number(r.doc?.refreshMinutes) || 15 }))
}

export async function getSpace(db: Db, scope: SpaceScope, slug: string): Promise<(Space & { rowId: string }) | null> {
  const { data, error } = await scoped(db.from('spaces').select('*'), scope).eq('slug', slug).maybeSingle()
  check(error, 'get')
  return data ? fromRow(data) : null
}

/** Creates a Space from a template (once per slug per owner). */
export async function createFromTemplate(db: Db, scope: SpaceScope, template: Exclude<SpaceTemplate, 'custom'>, by: string, skills: SkillLookup, now = Date.now()) {
  const space = templateSpace(template, scope, now)
  const problems = validateSpace(space, skills); if (problems.length) throw new SpacesError('invalid', problems.map(p => `${p.path}: ${p.problem}`).join('; '))
  if (await getSpace(db, scope, space.id)) throw new SpacesError('exists', space.id)
  const { data, error } = await db.from('spaces').insert({ ...ownerCols(scope), slug: space.id, template, version: 1, doc: space }).select('id').maybeSingle()
  check(error, 'create')
  const { error: ve } = await db.from('space_versions').insert({ space_id: data.id, version: 1, doc: space, changed_by: by, change: space.history[0].change })
  check(ve, 'create_version')
  return { ...space, rowId: data.id as string }
}

/** One edit → version+1, written only if nobody saved since `expectedVersion`. */
export async function applyEdit(db: Db, scope: SpaceScope, slug: string, expectedVersion: number, edit: SpaceEdit, by: string, skills: SkillLookup, now = Date.now()) {
  const cur = await getSpace(db, scope, slug)
  if (!cur) throw new SpacesError('not_found', slug)
  if (cur.version !== expectedVersion) throw new SpacesError('stale_version', `have ${cur.version}, editor had ${expectedVersion}`)
  const { rowId, ...space } = cur
  const r = editSpace(space, edit, by, skills, now)
  if ('problems' in r) throw new SpacesError('invalid', r.problems.map(p => `${p.path}: ${p.problem}`).join('; '))
  const next = r.space
  const { data, error } = await db.from('spaces').update({ version: next.version, doc: next, updated_at: next.updatedAt }).eq('id', rowId).eq('version', expectedVersion).select('id').maybeSingle()
  check(error, 'update')
  if (!data) throw new SpacesError('stale_version', 'saved by someone else just now')
  const { error: ve } = await db.from('space_versions').insert({ space_id: rowId, version: next.version, doc: next, changed_by: by, change: next.history.at(-1)!.change })
  check(ve, 'version')
  return { ...next, rowId }
}

export async function spaceHistory(db: Db, scope: SpaceScope, slug: string, limit = 20) {
  const cur = await getSpace(db, scope, slug)
  if (!cur) throw new SpacesError('not_found', slug)
  const { data, error } = await db.from('space_versions').select('version,changed_by,change,created_at').eq('space_id', cur.rowId).order('version', { ascending: false }).limit(limit)
  check(error, 'history')
  return data || []
}
