// Make v2 (Duet parity): saved results are editable, versioned and refreshable. Everything lives inside
// agent_artifacts.content_json (schema_version stays 1, no migration):
//   versions[]   previous {title, content_json, updated_at, by}, newest last, capped at MAX_VERSIONS
//   userEdits[]  section titles the owner changed — a Gogo regeneration keeps the owner's text for these
//   notes        the owner's own notes; never overwritten by Gogo
//   editedAt/editedBy, regeneratedAt, lastWriter ('owner' | 'gogo')
// Pure helpers only, so the merge and validation are unit-testable without a database.

export const MAX_VERSIONS = 10
export const MAX_TITLE = 180
export const MAX_NOTES = 4000
export const MAX_SECTION_TITLE = 180
export const MAX_SECTION_TEXT = 20000
export const MAX_EDIT_SECTIONS = 10

export type ArtifactWriter = 'owner' | 'gogo'
export type ArtifactVersion = { title: string; content_json: Record<string, unknown>; updated_at: string | null; by: ArtifactWriter }
export type ArtifactRow = { title?: string | null; content_json?: any; updated_at?: string | null }
export type ArtifactEdit = { title?: string; notes?: string; sections?: { title: string; text: string }[] }

const obj = (v: unknown): Record<string, any> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, any> : {})
const oneLine = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
// Keep the owner's line breaks; drop control characters other than tab/newline.
const prose = (v: string) => v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')

/** The content without its own history, so a snapshot never nests earlier snapshots. */
export function contentWithoutHistory(content: unknown): Record<string, unknown> {
  const { versions: _versions, ...rest } = obj(content)
  return rest
}

export function writerOf(content: unknown): ArtifactWriter {
  return obj(content).lastWriter === 'owner' ? 'owner' : 'gogo'
}

/** Previous version appended to the existing history, newest last, last MAX_VERSIONS kept. */
export function pushVersion(prev: ArtifactRow, by: ArtifactWriter = writerOf(prev?.content_json)): ArtifactVersion[] {
  const content = obj(prev?.content_json)
  const history = (Array.isArray(content.versions) ? content.versions : []).filter((v: any) => v && typeof v === 'object')
  const snapshot: ArtifactVersion = {
    title: String(prev?.title ?? ''), content_json: contentWithoutHistory(content),
    updated_at: prev?.updated_at ? String(prev.updated_at) : null, by,
  }
  return [...history, snapshot].slice(-MAX_VERSIONS)
}

export function userEditsOf(content: unknown): string[] {
  const edits = obj(content).userEdits
  return Array.isArray(edits) ? [...new Set(edits.map(e => String(e)).filter(Boolean))] : []
}

/** Strict validation of the owner's PATCH body. Unknown keys, wrong types and over-long values are rejected, not trimmed. */
export function parseArtifactEdit(raw: unknown): { ok: true; edit: ArtifactEdit } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'invalid_body' }
  const body = raw as Record<string, unknown>
  for (const key of Object.keys(body)) if (!['title', 'notes', 'sections'].includes(key)) return { ok: false, error: 'unknown_field' }
  const edit: ArtifactEdit = {}
  if (body.title !== undefined) {
    if (typeof body.title !== 'string') return { ok: false, error: 'invalid_title' }
    const title = oneLine(body.title, MAX_TITLE + 1)
    if (!title || title.length > MAX_TITLE) return { ok: false, error: 'invalid_title' }
    edit.title = title
  }
  if (body.notes !== undefined) {
    if (typeof body.notes !== 'string' || body.notes.length > MAX_NOTES) return { ok: false, error: 'invalid_notes' }
    edit.notes = prose(body.notes).trim()
  }
  if (body.sections !== undefined) {
    if (!Array.isArray(body.sections) || body.sections.length > MAX_EDIT_SECTIONS) return { ok: false, error: 'invalid_sections' }
    const seen = new Set<string>()
    const sections: { title: string; text: string }[] = []
    for (const s of body.sections) {
      if (!s || typeof s !== 'object' || Array.isArray(s)) return { ok: false, error: 'invalid_sections' }
      const keys = Object.keys(s)
      if (keys.some(k => k !== 'title' && k !== 'text')) return { ok: false, error: 'invalid_sections' }
      const { title, text } = s as any
      if (typeof title !== 'string' || typeof text !== 'string') return { ok: false, error: 'invalid_sections' }
      const t = oneLine(title, MAX_SECTION_TITLE + 1)
      if (!t || t.length > MAX_SECTION_TITLE || text.length > MAX_SECTION_TEXT || seen.has(t)) return { ok: false, error: 'invalid_sections' }
      seen.add(t)
      sections.push({ title: t, text: prose(text) })
    }
    edit.sections = sections
  }
  if (edit.title === undefined && edit.notes === undefined && !edit.sections?.length) return { ok: false, error: 'nothing_to_change' }
  return { ok: true, edit }
}

/** Applies the owner's edit to the current row. Section titles must match an existing section (by title). */
export function applyOwnerEdit(prev: ArtifactRow, edit: ArtifactEdit, actorId: string, now: string = new Date().toISOString()):
  { ok: true; title: string; content_json: Record<string, unknown>; changedSections: string[] } | { ok: false; error: string } {
  const content = obj(prev?.content_json)
  const sections: any[] = Array.isArray(content.sections) ? content.sections.map((s: any) => ({ ...obj(s), result: { ...obj(obj(s).result) } })) : []
  const changed: string[] = []
  for (const e of edit.sections || []) {
    const target = sections.find(s => oneLine(s.title, MAX_SECTION_TITLE) === e.title)
    if (!target) return { ok: false, error: 'unknown_section' }
    const current = typeof target.result.reply === 'string' ? target.result.reply : typeof target.result.text === 'string' ? target.result.text : ''
    if (current === e.text) continue
    delete target.result.reply
    target.result.text = e.text
    target.editedBy = 'owner'
    target.editedAt = now
    changed.push(e.title)
  }
  const title = edit.title ?? String(prev?.title ?? '')
  const notesChanged = edit.notes !== undefined && edit.notes !== String(content.notes ?? '')
  if (!changed.length && !notesChanged && title === String(prev?.title ?? '')) return { ok: false, error: 'nothing_to_change' }
  const next: Record<string, unknown> = {
    ...content, sections,
    versions: pushVersion(prev),
    userEdits: [...new Set([...userEditsOf(content), ...changed])],
    editedAt: now, editedBy: 'owner', editedByActor: String(actorId || '').slice(0, 80), lastWriter: 'owner',
  }
  if (edit.notes !== undefined) next.notes = edit.notes
  return { ok: true, title, content_json: next, changedSections: changed }
}

/** Gogo regenerated the artifact: new sections win, except every section the owner edited (owner text wins) and
 *  the owner's notes. An owner-edited section missing from the new run is kept, not dropped. */
export function mergeRegenerated(prev: ArtifactRow, next: Record<string, unknown>, now: string = new Date().toISOString()): Record<string, unknown> {
  const before = obj(prev?.content_json)
  const edits = userEditsOf(before)
  const ownerSections = (Array.isArray(before.sections) ? before.sections : []).filter((s: any) => edits.includes(oneLine(s?.title, MAX_SECTION_TITLE)))
  const fresh: any[] = Array.isArray(next.sections) ? [...next.sections] : []
  const kept = new Set<string>()
  const sections = fresh.map(s => {
    const t = oneLine(s?.title, MAX_SECTION_TITLE)
    const owner = ownerSections.find((o: any) => oneLine(o?.title, MAX_SECTION_TITLE) === t)
    if (owner && !kept.has(t)) { kept.add(t); return owner }
    return s
  })
  for (const o of ownerSections) if (!kept.has(oneLine(o?.title, MAX_SECTION_TITLE))) sections.push(o)
  const merged: Record<string, unknown> = {
    ...contentWithoutHistory(next), sections,
    versions: pushVersion(prev),
    regeneratedAt: now, lastWriter: 'gogo',
  }
  if (edits.length) merged.userEdits = edits
  for (const key of ['notes', 'editedAt', 'editedBy', 'editedByActor'] as const) if (before[key] !== undefined) merged[key] = before[key]
  return merged
}

/** View-only history for the report page: newest first. */
export function versionSummaries(content: unknown): { at: string | null; by: ArtifactWriter; title: string }[] {
  const history = obj(content).versions
  return (Array.isArray(history) ? history : []).filter((v: any) => v && typeof v === 'object')
    .map((v: any) => ({ at: v.updated_at ? String(v.updated_at) : null, by: (v.by === 'owner' ? 'owner' : 'gogo') as ArtifactWriter, title: oneLine(v.title, MAX_TITLE) }))
    .reverse()
}

// ---- Refresh: only a finished general plan whose every step only reads can be re-run without a person deciding.
// A plan that would create tasks, reminders, lists, memories or calendar changes is refused (409), because re-running
// it could duplicate them. Approval gates still apply inside the run either way.
const READ_ONLY_TOOLS = new Set(['web_search', 'artifact'])
const ACTIVE_RUN = new Set(['queued', 'running', 'waiting_approval', 'paused'])
export const REFRESH_COOLDOWN_MS = 2 * 60_000

export function agentRunRefOf(sourceRefs: unknown): string | null {
  const refs = Array.isArray(sourceRefs) ? sourceRefs : []
  const ref = refs.find((r: any) => r && r.type === 'agent_run' && /^[0-9a-f-]{36}$/i.test(String(r.id || '')))
  return ref ? String((ref as any).id) : null
}

function stepIsReadOnly(step: any): boolean {
  const tool = String(step?.tool || '')
  if (READ_ONLY_TOOLS.has(tool)) return true
  const instruction = String(step?.instruction || '')
  if (tool === 'tasks') return /^(?:please\s+)?(?:list|show|read|find|review|check|get)\b/i.test(instruction.trim()) && !/\b(?:create|add|delete|remove|update|complete|mark|change)\b/i.test(instruction)
  return false
}

/** Plain reason when a plan's steps are not all read-only (or it has no artifact step to update). */
export function planRefreshBlock(plan: any): string | null {
  const steps: any[] = Array.isArray(plan?.steps) ? plan.steps : []
  if (!steps.length) return 'Gogo could not rebuild a plan for this result.'
  if (!steps.some(s => s?.tool === 'artifact')) return 'The refreshed plan would not save a result, so there is nothing to update.'
  if (!steps.every(stepIsReadOnly)) return 'Refreshing would repeat steps that change things (tasks, reminders, lists, calendar or messages). Ask Gogo in chat instead.'
  return null
}

export type RefreshCheck = { ok: true; runId: string; missionText: string } | { ok: false; reason: string }

/** Decides whether a saved result can be refreshed from its original run. Pure: callers pass the rows. */
export function refreshCheck(artifact: { source_refs?: unknown; content_json?: any; updated_at?: string | null }, run: any, now: number = Date.now()): RefreshCheck {
  const runId = agentRunRefOf(artifact?.source_refs)
  if (!runId) return { ok: false, reason: 'This result was not made by a Gogo run, so there is nothing to refresh it from.' }
  if (!run) return { ok: false, reason: 'The run that made this result is no longer available.' }
  if (ACTIVE_RUN.has(String(run.status || ''))) return { ok: false, reason: 'Gogo is still working on the run behind this result.' }
  const meta = obj(run.metadata_json)
  if (meta.plan_type !== 'general_multi_tool') return { ok: false, reason: 'Only research results can be refreshed for now.' }
  const missionText = String(meta.input_text || '').trim()
  if (!missionText) return { ok: false, reason: 'The original request was not saved, so Gogo cannot repeat it safely.' }
  const block = planRefreshBlock(meta.plan)
  if (block) return { ok: false, reason: block }
  const last = Date.parse(String(obj(artifact?.content_json).refreshRequestedAt || ''))
  if (Number.isFinite(last) && now - last < REFRESH_COOLDOWN_MS) return { ok: false, reason: 'A refresh was just started. Give it a couple of minutes.' }
  return { ok: true, runId, missionText: missionText.slice(0, 2000) }
}

/** Public source links saved in the artifact (research sections' sourceUrls), de-duplicated. */
export function artifactSourceUrls(content: unknown): string[] {
  const sections = obj(content).sections
  const urls: string[] = []
  for (const s of Array.isArray(sections) ? sections : []) {
    const list = obj(obj(s).result).sourceUrls
    if (Array.isArray(list)) for (const u of list) if (typeof u === 'string' && /^https?:\/\//i.test(u)) urls.push(u)
  }
  return [...new Set(urls)].slice(0, 30)
}
