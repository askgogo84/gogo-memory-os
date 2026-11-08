// Gogo Spaces (8 Nov) — a Space is a declarative JSON document the owner can edit; a trusted renderer draws it.
// Nothing in a Space is executable: no HTML, no scripts, no SQL, no URLs to fetch. Blocks name *registered* data
// sources (a fixed list here) and *registered* skills (lib/agent/skill-registry) for actions, and every consequential
// action still goes through its own exact approval at run time. Editing produces a new version with a history entry.
import type { AgentCapability } from '@/lib/agent/policy'

export const SPACE_SCHEMA_VERSION = 1

export type SpaceScope = { kind: 'user'; telegramId: string } | { kind: 'workspace'; workspaceId: string }
export type SpaceTemplate = 'my_day' | 'trip_board' | 'tipplr_exceptions' | 'custom'

/** The only places a block may read from. Each names the capability the owner must have granted for it to refresh. */
export const SPACE_SOURCES = {
  'today.calendar': { capability: 'calendar' as AgentCapability, description: "Today's events" },
  'today.reminders': { capability: 'reminders' as AgentCapability, description: 'Open reminders due today' },
  'today.open_loops': { capability: 'memory' as AgentCapability, description: 'Open loops and follow-ups' },
  'mail.attention': { capability: 'email' as AgentCapability, description: 'Emails that need you' },
  'trip.next': { capability: 'travel' as AgentCapability, description: 'Next trip: legs, stays, checklist' },
  'trip.fares': { capability: 'travel' as AgentCapability, description: 'Fare watch for the next trip' },
  'tipplr.exceptions': { capability: 'merchant' as AgentCapability, description: 'Orders needing a merchant decision' },
  'tipplr.oos_today': { capability: 'merchant' as AgentCapability, description: 'Out-of-stock cancellations today by outlet' },
  'tipplr.digest': { capability: 'merchant' as AgentCapability, description: "Yesterday's digest" },
} as const
export type SpaceSourceId = keyof typeof SPACE_SOURCES

export type BlockType = 'header' | 'stat' | 'list' | 'timeline' | 'table' | 'actions' | 'note'
export type SpaceAction = { label: string; skillId: string; input: Record<string, string | number | boolean>; requiresApproval: true }
export type SpaceBlock = {
  id: string
  type: BlockType
  title?: string
  source?: { id: SpaceSourceId; params?: Record<string, string | number | boolean> }
  /** Static text for note/header blocks. Plain text only. */
  text?: string
  columns?: string[]
  actions?: SpaceAction[]
  /** 1 = full width, 2 = half (two-up on desktop; always full on a phone). */
  span?: 1 | 2
}
export type SpaceHistory = { version: number; at: string; by: string; change: string }
export type Space = {
  schema: typeof SPACE_SCHEMA_VERSION
  id: string
  title: string
  template: SpaceTemplate
  scope: SpaceScope
  version: number
  blocks: SpaceBlock[]
  refreshMinutes: number
  createdAt: string
  updatedAt: string
  history: SpaceHistory[]
}

// ── validation: fail closed ────────────────────────────────────────────────────────────────────────────────────
const ID = /^[a-z][a-z0-9_]{0,40}$/
const UNSAFE_TEXT = /<[a-z!/?]|javascript:|data:text\/html|\bon[a-z]+\s*=|\{\{|\$\{|<%|%>/i
const SQLISH = /\b(?:select|insert|update|delete|drop|alter|union|exec|execute)\b[\s\S]*\b(?:from|into|table|where|set)\b|;\s*--|\/\*/i
const URLISH = /https?:\/\/|wss?:\/\/|ftp:\/\//i
const MAX_BLOCKS = 24, MAX_TEXT = 2000, MAX_ACTIONS = 6

export type SpaceProblem = { path: string; problem: string }

function checkText(path: string, v: unknown, out: SpaceProblem[], max = MAX_TEXT) {
  if (v === undefined) return
  if (typeof v !== 'string') { out.push({ path, problem: 'must be text' }); return }
  if (v.length > max) out.push({ path, problem: `longer than ${max}` })
  if (UNSAFE_TEXT.test(v)) out.push({ path, problem: 'markup, script or template syntax is not allowed' })
  if (SQLISH.test(v)) out.push({ path, problem: 'SQL is not allowed' })
  if (URLISH.test(v)) out.push({ path, problem: 'URLs are not allowed in a Space; use a source' })
}

/** Structural + safety validation of a Space. `knownSkill` decides whether an action's skill is registered and approval-gated. Pure. */
export function validateSpace(space: unknown, knownSkill: (id: string) => { exactActionApproval: boolean } | null): SpaceProblem[] {
  const p: SpaceProblem[] = []
  if (!space || typeof space !== 'object' || Array.isArray(space)) return [{ path: '', problem: 'space must be an object' }]
  const s = space as Record<string, any>
  if (s.schema !== SPACE_SCHEMA_VERSION) p.push({ path: 'schema', problem: `must be ${SPACE_SCHEMA_VERSION}` })
  if (!ID.test(String(s.id))) p.push({ path: 'id', problem: 'lower-case id' })
  checkText('title', s.title, p, 80); if (!s.title) p.push({ path: 'title', problem: 'required' })
  if (!['my_day', 'trip_board', 'tipplr_exceptions', 'custom'].includes(s.template)) p.push({ path: 'template', problem: 'unknown template' })
  const sc = s.scope
  if (!sc || (sc.kind === 'user' ? !/^-?\d{1,20}$/.test(String(sc.telegramId)) : sc.kind === 'workspace' ? !/^[0-9a-f-]{36}$/i.test(String(sc.workspaceId)) : true)) p.push({ path: 'scope', problem: 'user (telegramId digits) or workspace (uuid)' })
  if (!Number.isInteger(s.version) || s.version < 1) p.push({ path: 'version', problem: 'positive integer' })
  if (!Number.isInteger(s.refreshMinutes) || s.refreshMinutes < 5 || s.refreshMinutes > 1440) p.push({ path: 'refreshMinutes', problem: '5..1440' })
  if (!Array.isArray(s.blocks)) { p.push({ path: 'blocks', problem: 'array' }); return p }
  if (s.blocks.length > MAX_BLOCKS) p.push({ path: 'blocks', problem: `more than ${MAX_BLOCKS}` })
  const seen = new Set<string>()
  s.blocks.forEach((b: any, i: number) => {
    const at = `blocks[${i}]`
    if (!b || typeof b !== 'object') { p.push({ path: at, problem: 'object' }); return }
    if (!ID.test(String(b.id))) p.push({ path: `${at}.id`, problem: 'lower-case id' })
    if (seen.has(b.id)) p.push({ path: `${at}.id`, problem: 'duplicate' }); seen.add(b.id)
    if (!['header', 'stat', 'list', 'timeline', 'table', 'actions', 'note'].includes(b.type)) p.push({ path: `${at}.type`, problem: 'unknown block type' })
    checkText(`${at}.title`, b.title, p, 80); checkText(`${at}.text`, b.text, p)
    if (b.span !== undefined && b.span !== 1 && b.span !== 2) p.push({ path: `${at}.span`, problem: '1 or 2' })
    for (const k of Object.keys(b)) if (!['id', 'type', 'title', 'source', 'text', 'columns', 'actions', 'span'].includes(k)) p.push({ path: `${at}.${k}`, problem: 'unknown field' })
    if (b.source !== undefined) {
      if (!b.source || !(b.source.id in SPACE_SOURCES)) p.push({ path: `${at}.source.id`, problem: 'not a registered source' })
      for (const [k, v] of Object.entries(b.source?.params || {})) { if (!ID.test(k)) p.push({ path: `${at}.source.params.${k}`, problem: 'bad key' }); if (typeof v === 'string') checkText(`${at}.source.params.${k}`, v, p, 200); else if (typeof v !== 'number' && typeof v !== 'boolean') p.push({ path: `${at}.source.params.${k}`, problem: 'scalar only' }) }
    }
    if (['stat', 'list', 'timeline', 'table'].includes(b.type) && !b.source) p.push({ path: `${at}.source`, problem: `${b.type} needs a source` })
    if (['header', 'note'].includes(b.type) && b.source) p.push({ path: `${at}.source`, problem: `${b.type} takes text, not a source` })
    if (b.columns !== undefined) { if (!Array.isArray(b.columns) || b.columns.length > 8) p.push({ path: `${at}.columns`, problem: 'up to 8' }); else b.columns.forEach((c: unknown, j: number) => checkText(`${at}.columns[${j}]`, c, p, 40)) }
    if (b.actions !== undefined) {
      if (!Array.isArray(b.actions) || b.actions.length > MAX_ACTIONS) { p.push({ path: `${at}.actions`, problem: `up to ${MAX_ACTIONS}` }); return }
      b.actions.forEach((a: any, j: number) => {
        const ap = `${at}.actions[${j}]`
        checkText(`${ap}.label`, a?.label, p, 40); if (!a?.label) p.push({ path: `${ap}.label`, problem: 'required' })
        const sk = knownSkill(String(a?.skillId || ''))
        if (!sk) p.push({ path: `${ap}.skillId`, problem: 'not a registered skill' })
        if (a?.requiresApproval !== true) p.push({ path: `${ap}.requiresApproval`, problem: 'must be true: a Space never pre-approves' })
        for (const [k, v] of Object.entries(a?.input || {})) { if (!/^[a-zA-Z]\w{0,40}$/.test(k)) p.push({ path: `${ap}.input.${k}`, problem: 'bad key' }); if (typeof v === 'string') checkText(`${ap}.input.${k}`, v, p, 200); else if (typeof v !== 'number' && typeof v !== 'boolean') p.push({ path: `${ap}.input.${k}`, problem: 'scalar only' }) }
      })
    }
  })
  return p
}

/** The capabilities a Space needs to refresh. Pure. */
export function spaceCapabilities(space: Space): AgentCapability[] {
  return [...new Set(space.blocks.flatMap(b => b.source ? [SPACE_SOURCES[b.source.id].capability] : []))]
}

/** Which sources may refresh given the owner's permission levels; blocks whose capability is 'off' render as "not connected". Pure. */
export function refreshableBlocks(space: Space, permission: (c: AgentCapability) => 'off' | 'read' | 'draft' | 'ask' | 'auto'): { ok: SpaceBlock[]; blocked: { block: SpaceBlock; capability: AgentCapability }[] } {
  const ok: SpaceBlock[] = [], blocked: { block: SpaceBlock; capability: AgentCapability }[] = []
  for (const b of space.blocks) { if (!b.source) { ok.push(b); continue } const c = SPACE_SOURCES[b.source.id].capability; if (permission(c) === 'off') blocked.push({ block: b, capability: c }); else ok.push(b) }
  return { ok, blocked }
}

// ── versioned edits ───────────────────────────────────────────────────────────────────────────────────────────
export type SpaceEdit =
  | { op: 'rename'; title: string }
  | { op: 'add_block'; block: SpaceBlock; after?: string }
  | { op: 'remove_block'; id: string }
  | { op: 'move_block'; id: string; after: string | null }
  | { op: 'set_refresh'; minutes: number }
  | { op: 'set_text'; id: string; text: string }

/** Applies one edit as a new version (history appended), or returns the problems. Only the owner edits; the caller checks `by` is the owner. Pure. */
export function editSpace(space: Space, edit: SpaceEdit, by: string, knownSkill: (id: string) => { exactActionApproval: boolean } | null, now = Date.now()): { space: Space } | { problems: SpaceProblem[] } {
  const next: Space = JSON.parse(JSON.stringify(space))
  let change = ''
  switch (edit.op) {
    case 'rename': next.title = edit.title; change = `renamed to "${edit.title}"`; break
    case 'add_block': { const i = edit.after ? next.blocks.findIndex(b => b.id === edit.after) : next.blocks.length - 1; if (edit.after && i < 0) return { problems: [{ path: 'after', problem: 'no such block' }] }; next.blocks.splice(i + 1, 0, edit.block); change = `added ${edit.block.type} "${edit.block.title || edit.block.id}"`; break }
    case 'remove_block': { const i = next.blocks.findIndex(b => b.id === edit.id); if (i < 0) return { problems: [{ path: 'id', problem: 'no such block' }] }; const [r] = next.blocks.splice(i, 1); change = `removed "${r.title || r.id}"`; break }
    case 'move_block': { const i = next.blocks.findIndex(b => b.id === edit.id); if (i < 0) return { problems: [{ path: 'id', problem: 'no such block' }] }; const [b] = next.blocks.splice(i, 1); const j = edit.after === null ? -1 : next.blocks.findIndex(x => x.id === edit.after); if (edit.after !== null && j < 0) return { problems: [{ path: 'after', problem: 'no such block' }] }; next.blocks.splice(j + 1, 0, b); change = `moved "${b.title || b.id}"`; break }
    case 'set_refresh': next.refreshMinutes = edit.minutes; change = `refresh every ${edit.minutes} min`; break
    case 'set_text': { const b = next.blocks.find(x => x.id === edit.id); if (!b) return { problems: [{ path: 'id', problem: 'no such block' }] }; b.text = edit.text; change = `edited "${b.title || b.id}"`; break }
  }
  next.version = space.version + 1
  next.updatedAt = new Date(now).toISOString()
  next.history = [...space.history, { version: next.version, at: next.updatedAt, by, change }].slice(-50)
  const problems = validateSpace(next, knownSkill)
  return problems.length ? { problems } : { space: next }
}

// ── templates ─────────────────────────────────────────────────────────────────────────────────────────────────
export function templateSpace(template: Exclude<SpaceTemplate, 'custom'>, scope: SpaceScope, now = Date.now()): Space {
  const at = new Date(now).toISOString()
  const base = { schema: SPACE_SCHEMA_VERSION as 1, scope, version: 1, createdAt: at, updatedAt: at, history: [{ version: 1, at, by: 'template', change: `created from ${template}` }] }
  if (template === 'my_day') return { ...base, id: 'my_day', title: 'My Day & Open Loops', template, refreshMinutes: 15, blocks: [
    { id: 'today', type: 'timeline', title: 'Today', source: { id: 'today.calendar' } },
    { id: 'due', type: 'list', title: 'Due today', source: { id: 'today.reminders' }, span: 2 },
    { id: 'loops', type: 'list', title: 'Open loops', source: { id: 'today.open_loops' }, span: 2 },
    { id: 'mail', type: 'list', title: 'Needs you', source: { id: 'mail.attention' } },
  ] }
  if (template === 'trip_board') return { ...base, id: 'trip_board', title: 'Trip Board', template, refreshMinutes: 60, blocks: [
    { id: 'trip', type: 'timeline', title: 'Next trip', source: { id: 'trip.next' } },
    { id: 'fares', type: 'table', title: 'Fare watch', source: { id: 'trip.fares' }, columns: ['Flight', 'Depart', 'Fare', 'Change'] },
    { id: 'notes', type: 'note', title: 'Packing', text: 'Passport · chargers · Divya\'s lens case' },
  ] }
  return { ...base, id: 'tipplr_exceptions', title: 'Tipplr Outlet Exceptions', template, refreshMinutes: 5, blocks: [
    { id: 'oos', type: 'stat', title: 'Out of stock today', source: { id: 'tipplr.oos_today' } },
    { id: 'exceptions', type: 'table', title: 'Needs a decision', source: { id: 'tipplr.exceptions' }, columns: ['Order', 'Outlet', 'Items', 'Waiting'] },
    { id: 'digest', type: 'note', title: 'Yesterday', source: undefined, text: 'Digest arrives at 9:00 on the ops number.' },
  ] }
}
