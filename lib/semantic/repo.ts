// The semantic repository: the only way facts enter or leave the graph. Scope comes from a verified AgentActor or a
// workspace id the caller has already authorized (requireWorkspaceRole); never from request input.
//
// Rules (tests: scripts/verify-semantic-spine-nov9.mts):
//   - Supersession, not overwrite: a new value for the same subject+predicate marks the old assertion superseded and
//     records which one replaced it. History stays readable; recall sees only 'current'.
//   - Authority: a lower-authority source (inferred/unverified) never supersedes a verified or user-stated fact. The
//     attempt is recorded as a non-current assertion with metadata.conflict, so it can be reviewed.
//   - Temporal: valid_from/valid_until decide whether a current assertion is historical, current or future at `now`.
//   - Secrets never become literal values.
import type { AgentActor } from '@/lib/agent/actor'
import { AUTHORITY, literalIsSafe, temporalStatus, type Assertion, type AssertionInput, type Entity, type EntityInput, type SemanticScope, type Source, type SourceInput, type VerificationStatus } from './types'
import type { SemanticStore } from './store'

export function scopeForActor(actor: Pick<AgentActor, 'legacyTelegramId'>): SemanticScope {
  const id = actor.legacyTelegramId
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id === 0) throw new Error('semantic_scope_invalid_actor')
  return { scope_type: 'user', scope_id: String(id) }
}
/** Only after the caller has verified membership (lib/workspaces/access requireWorkspaceRole). */
export function scopeForWorkspace(workspaceId: string): SemanticScope {
  if (!/^[0-9a-f-]{36}$/i.test(String(workspaceId))) throw new Error('semantic_scope_invalid_workspace')
  return { scope_type: 'workspace', scope_id: String(workspaceId).toLowerCase() }
}

export type AssertResult = { assertion: Assertion; changed: boolean; superseded: Assertion | null; conflict: boolean }
export type CurrentFact = { assertion: Assertion; subject: Entity; object: Entity | null; source: Source; temporal: 'historical' | 'current' | 'future' }

const sameLiteral = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

export class SemanticRepo {
  constructor(private store: SemanticStore, readonly scope: SemanticScope) {}

  async ensureEntity(input: EntityInput, now = new Date().toISOString()): Promise<Entity> {
    if (!input.canonical_key || !input.entity_type) throw new Error('semantic_entity_invalid')
    const found = await this.store.findEntity(this.scope, input.entity_type, input.canonical_key)
    if (found) {
      const merged = { ...(found.attributes || {}), ...(input.attributes || {}) }
      if (JSON.stringify(merged) !== JSON.stringify(found.attributes || {}) || found.retired_at) { await this.store.updateEntity(this.scope, found.id, { attributes: merged, retired_at: null, updated_at: now }); found.attributes = merged; found.retired_at = null }
      return found
    }
    return this.store.insertEntity(this.scope, { entity_type: input.entity_type, canonical_key: input.canonical_key, attributes: input.attributes || {}, sensitivity: input.sensitivity || 'normal' })
  }

  async recordSource(input: SourceInput): Promise<Source> {
    const found = await this.store.findSource(this.scope, input.source_type, input.source_object_ref)
    if (found) return found
    return this.store.insertSource(this.scope, { source_type: input.source_type, source_object_ref: input.source_object_ref, observed_at: input.observed_at || null, verification_status: input.verification_status, sensitivity: input.sensitivity || 'normal', metadata: input.metadata || {} })
  }

  /** Assert a fact. Idempotent for an unchanged value; supersedes a changed one; refuses to let a weak source beat a strong one. */
  async assert(input: AssertionInput, now = new Date().toISOString()): Promise<AssertResult> {
    if ((input.object ? 1 : 0) + (input.literal !== undefined ? 1 : 0) !== 1) throw new Error('semantic_assertion_needs_one_object')
    if (input.literal !== undefined && !literalIsSafe(input.literal)) throw new Error('semantic_literal_unsafe')
    if (!(input.confidence >= 0 && input.confidence <= 1)) throw new Error('semantic_confidence_range')
    const subject = await this.ensureEntity(input.subject, now)
    const object = input.object ? await this.ensureEntity(input.object, now) : null
    const source = await this.recordSource(input.source)
    const existing = await this.store.currentAssertions(this.scope, subject.id, input.predicate)
    // Relationship assertions may have several objects; the one to compare is the same object. Scalars: one per predicate.
    const prior = object ? existing.find(a => a.object_entity_id === object.id) || null : existing.find(a => a.literal_value_json !== null) || null
    const priorSource = prior ? (await this.store.sourcesById(this.scope, [prior.source_id]))[0] : null
    const row = { subject_entity_id: subject.id, predicate: input.predicate, object_entity_id: object?.id || null, literal_value_json: object ? null : (input.literal ?? null), source_id: source.id, confidence: input.confidence, valid_from: input.valid_from || null, valid_until: input.valid_until || null, metadata_json: input.metadata || {} }
    if (prior) {
      const same = object ? true : sameLiteral(prior.literal_value_json, input.literal)
      if (same && (prior.valid_until || null) === (input.valid_until || null) && (prior.valid_from || null) === (input.valid_from || null)) return { assertion: prior, changed: false, superseded: null, conflict: false }
      const priorAuthority = priorSource ? AUTHORITY[priorSource.verification_status as VerificationStatus] : 0
      if (AUTHORITY[input.source.verification_status] < priorAuthority && priorAuthority >= AUTHORITY.user_stated) {
        // Recorded for review, never current: an inference does not replace what the provider or the owner said.
        const a = await this.store.insertAssertion(this.scope, { ...row, assertion_status: 'superseded', supersedes_assertion_id: null, metadata_json: { ...row.metadata_json, conflict: true, conflicts_with: prior.id } })
        return { assertion: a, changed: false, superseded: null, conflict: true }
      }
      const closeAt = prior.valid_until && Date.parse(prior.valid_until) < Date.parse(now) ? prior.valid_until : now
      await this.store.updateAssertion(this.scope, prior.id, { assertion_status: 'superseded', valid_until: closeAt })
      const a = await this.store.insertAssertion(this.scope, { ...row, assertion_status: 'current', supersedes_assertion_id: prior.id })
      return { assertion: a, changed: true, superseded: { ...prior, assertion_status: 'superseded', valid_until: closeAt }, conflict: false }
    }
    const a = await this.store.insertAssertion(this.scope, { ...row, assertion_status: 'current', supersedes_assertion_id: null })
    return { assertion: a, changed: true, superseded: null, conflict: false }
  }

  /** Current facts about a subject at `now`, with source and temporal status. Historical ones are included but labelled. */
  async factsFor(subject: EntityInput, now = Date.now(), predicate?: string): Promise<CurrentFact[]> {
    const ent = await this.store.findEntity(this.scope, subject.entity_type, subject.canonical_key)
    if (!ent || ent.retired_at) return []
    const rows = await this.store.currentAssertions(this.scope, ent.id, predicate)
    const objIds = rows.map(r => r.object_entity_id).filter((x): x is string => !!x)
    const [objects, sources] = await Promise.all([this.store.entitiesById(this.scope, objIds), this.store.sourcesById(this.scope, rows.map(r => r.source_id))])
    return rows.map(a => ({ assertion: a, subject: ent, object: a.object_entity_id ? objects.find(o => o.id === a.object_entity_id) || null : null, source: sources.find(s => s.id === a.source_id)!, temporal: temporalStatus(a, now) })).filter(f => f.source)
  }

  /** Everything the owner asked to forget: retract current assertions and retire entities. Nothing is deleted. */
  async forgetEverything(now = new Date().toISOString()) { return this.store.retireScope(this.scope, now) }
}

/** The production repository for a verified actor; null when the flag is off (so callers skip every read). */
export async function semanticRepoFor(actor: Pick<AgentActor, 'legacyTelegramId'>, env: Record<string, string | undefined> = process.env): Promise<SemanticRepo | null> {
  if (!semanticEnabledFor(String(actor.legacyTelegramId), env)) return null
  const { supabaseAdmin } = await import('@/lib/supabase-admin'); const { SupabaseSemanticStore } = await import('./store')
  return new SemanticRepo(new SupabaseSemanticStore(supabaseAdmin), scopeForActor(actor))
}

/** Phase 1 flag: GOGO_SEMANTIC=1 for everyone, or GOGO_SEMANTIC_OWNERS=<ids>. Off by default. */
export function semanticEnabledFor(owner: string, env: Record<string, string | undefined> = process.env): boolean {
  if (env.GOGO_SEMANTIC === '1') return true
  return String(env.GOGO_SEMANTIC_OWNERS || '').split(',').map(s => s.trim()).filter(Boolean).includes(String(owner))
}
