// Storage behind the semantic repository. One narrow interface, two implementations: Supabase (production) and an
// in-memory store (tests). Every Supabase call carries the scope twice (scope_type, scope_id); there is no method
// that reads or writes without one, so a caller cannot forget it.
import type { Assertion, Entity, SemanticScope, Source } from './types'

export interface SemanticStore {
  findEntity(scope: SemanticScope, entityType: string, canonicalKey: string): Promise<Entity | null>
  insertEntity(scope: SemanticScope, row: Omit<Entity, 'id' | 'scope_type' | 'scope_id'>): Promise<Entity>
  updateEntity(scope: SemanticScope, id: string, patch: Partial<Pick<Entity, 'attributes' | 'retired_at'>> & { updated_at: string }): Promise<void>
  findSource(scope: SemanticScope, sourceType: string, ref: string): Promise<Source | null>
  insertSource(scope: SemanticScope, row: Omit<Source, 'id'>): Promise<Source>
  currentAssertions(scope: SemanticScope, subjectEntityId: string, predicate?: string): Promise<Assertion[]>
  assertionsAbout(scope: SemanticScope, entityId: string, limit: number): Promise<Assertion[]>
  insertAssertion(scope: SemanticScope, row: Omit<Assertion, 'id' | 'recorded_at'>): Promise<Assertion>
  updateAssertion(scope: SemanticScope, id: string, patch: Partial<Pick<Assertion, 'assertion_status' | 'valid_until' | 'metadata_json'>>): Promise<void>
  sourcesById(scope: SemanticScope, ids: string[]): Promise<Source[]>
  entitiesById(scope: SemanticScope, ids: string[]): Promise<Entity[]>
  /** Forget everything / consent revoked: every assertion retracted, every entity retired. Nothing deleted, nothing readable as current. */
  retireScope(scope: SemanticScope, at: string): Promise<{ assertions: number; entities: number }>
}

type Db = { from: (t: string) => any }
const check = (error: any, op: string) => { if (error) throw new Error(`semantic_${op}_failed:${error.message || error}`) }
const entityRow = (r: any): Entity => ({ id: String(r.id), scope_type: r.scope_type, scope_id: String(r.scope_id), entity_type: r.entity_type, canonical_key: r.canonical_key, attributes: r.attributes_json || {}, sensitivity: r.sensitivity || 'normal', retired_at: r.retired_at || null })
const sourceRow = (r: any): Source => ({ id: String(r.id), source_type: r.source_type, source_object_ref: r.source_object_ref, observed_at: r.observed_at || null, verification_status: r.verification_status, sensitivity: r.sensitivity || 'normal', metadata: r.metadata_json || {} })
const assertionRow = (r: any): Assertion => ({ id: String(r.id), subject_entity_id: String(r.subject_entity_id), predicate: r.predicate, object_entity_id: r.object_entity_id ? String(r.object_entity_id) : null, literal_value_json: r.literal_value_json ?? null, source_id: String(r.source_id), confidence: Number(r.confidence), assertion_status: r.assertion_status, valid_from: r.valid_from || null, valid_until: r.valid_until || null, recorded_at: r.recorded_at, supersedes_assertion_id: r.supersedes_assertion_id ? String(r.supersedes_assertion_id) : null, metadata_json: r.metadata_json || {} })

export class SupabaseSemanticStore implements SemanticStore {
  constructor(private db: Db) {}
  private q(table: string, s: SemanticScope) { return this.db.from(table).select('*').eq('scope_type', s.scope_type).eq('scope_id', s.scope_id) }
  async findEntity(s: SemanticScope, t: string, k: string) { const { data, error } = await this.q('semantic_entities', s).eq('entity_type', t).eq('canonical_key', k).maybeSingle(); check(error, 'entity_read'); return data ? entityRow(data) : null }
  async insertEntity(s: SemanticScope, row: Omit<Entity, 'id' | 'scope_type' | 'scope_id'>) {
    const { data, error } = await this.db.from('semantic_entities').insert({ ...s, entity_type: row.entity_type, canonical_key: row.canonical_key, attributes_json: row.attributes || {}, sensitivity: row.sensitivity || 'normal' }).select('*').single(); check(error, 'entity_insert'); return entityRow(data)
  }
  async updateEntity(s: SemanticScope, id: string, patch: any) { const p: any = { updated_at: patch.updated_at }; if (patch.attributes) p.attributes_json = patch.attributes; if ('retired_at' in patch) p.retired_at = patch.retired_at; const { error } = await this.db.from('semantic_entities').update(p).eq('id', id).eq('scope_type', s.scope_type).eq('scope_id', s.scope_id); check(error, 'entity_update') }
  async findSource(s: SemanticScope, t: string, ref: string) { const { data, error } = await this.q('semantic_sources', s).eq('source_type', t).eq('source_object_ref', ref).maybeSingle(); check(error, 'source_read'); return data ? sourceRow(data) : null }
  async insertSource(s: SemanticScope, row: Omit<Source, 'id'>) { const { data, error } = await this.db.from('semantic_sources').insert({ ...s, source_type: row.source_type, source_object_ref: row.source_object_ref, observed_at: row.observed_at || null, verification_status: row.verification_status, sensitivity: row.sensitivity || 'normal', metadata_json: row.metadata || {} }).select('*').single(); check(error, 'source_insert'); return sourceRow(data) }
  async currentAssertions(s: SemanticScope, subject: string, predicate?: string) { let q = this.q('semantic_assertions', s).eq('subject_entity_id', subject).eq('assertion_status', 'current'); if (predicate) q = q.eq('predicate', predicate); const { data, error } = await q.order('recorded_at', { ascending: false }).limit(200); check(error, 'assertion_read'); return (data || []).map(assertionRow) }
  async assertionsAbout(s: SemanticScope, entityId: string, limit: number) { const { data, error } = await this.q('semantic_assertions', s).eq('assertion_status', 'current').or(`subject_entity_id.eq.${entityId},object_entity_id.eq.${entityId}`).order('recorded_at', { ascending: false }).limit(limit); check(error, 'assertion_about'); return (data || []).map(assertionRow) }
  async insertAssertion(s: SemanticScope, row: Omit<Assertion, 'id' | 'recorded_at'>) { const { data, error } = await this.db.from('semantic_assertions').insert({ ...s, ...row }).select('*').single(); check(error, 'assertion_insert'); return assertionRow(data) }
  async updateAssertion(s: SemanticScope, id: string, patch: any) { const { error } = await this.db.from('semantic_assertions').update(patch).eq('id', id).eq('scope_type', s.scope_type).eq('scope_id', s.scope_id); check(error, 'assertion_update') }
  async sourcesById(s: SemanticScope, ids: string[]) { if (!ids.length) return []; const { data, error } = await this.q('semantic_sources', s).in('id', ids); check(error, 'sources_read'); return (data || []).map(sourceRow) }
  async entitiesById(s: SemanticScope, ids: string[]) { if (!ids.length) return []; const { data, error } = await this.q('semantic_entities', s).in('id', ids); check(error, 'entities_read'); return (data || []).map(entityRow) }
  async retireScope(s: SemanticScope, at: string) {
    const a = await this.db.from('semantic_assertions').update({ assertion_status: 'retracted', metadata_json: { retracted_reason: 'owner_forget_everything', at } }).eq('scope_type', s.scope_type).eq('scope_id', s.scope_id).eq('assertion_status', 'current').select('id'); check(a.error, 'retire_assertions')
    const e = await this.db.from('semantic_entities').update({ retired_at: at, updated_at: at }).eq('scope_type', s.scope_type).eq('scope_id', s.scope_id).is('retired_at', null).select('id'); check(e.error, 'retire_entities')
    return { assertions: (a.data || []).length, entities: (e.data || []).length }
  }
}

/** In-memory store for tests and the Phase 2 shadow comparison. Enforces scope exactly like the SQL one. */
export class MemorySemanticStore implements SemanticStore {
  entities: Entity[] = []; sources: Source[] = []; assertions: Assertion[] = []; private n = 0
  private id(p: string) { return `${p}-${String(++this.n).padStart(4, '0')}` }
  private inScope = (s: SemanticScope) => (r: any) => r.scope_type === s.scope_type && r.scope_id === s.scope_id
  private sscope = new Map<string, SemanticScope>(); private ascope = new Map<string, SemanticScope>()
  async findEntity(s: SemanticScope, t: string, k: string) { return this.entities.find(e => this.inScope(s)(e) && e.entity_type === t && e.canonical_key === k) || null }
  async insertEntity(s: SemanticScope, row: any) { const e: Entity = { id: this.id('ent'), ...s, ...row, attributes: row.attributes || {}, sensitivity: row.sensitivity || 'normal', retired_at: null }; this.entities.push(e); return e }
  async updateEntity(s: SemanticScope, id: string, patch: any) { const e = this.entities.find(x => x.id === id && this.inScope(s)(x)); if (!e) throw new Error('semantic_entity_update_failed:not_in_scope'); if (patch.attributes) e.attributes = patch.attributes; if ('retired_at' in patch) e.retired_at = patch.retired_at }
  async findSource(s: SemanticScope, t: string, ref: string) { return this.sources.find(x => { const sc = this.sscope.get(x.id)!; return sc.scope_type === s.scope_type && sc.scope_id === s.scope_id && x.source_type === t && x.source_object_ref === ref }) || null }
  async insertSource(s: SemanticScope, row: any) { const x: Source = { id: this.id('src'), ...row }; this.sources.push(x); this.sscope.set(x.id, s); return x }
  private aIn = (s: SemanticScope) => (a: Assertion) => { const sc = this.ascope.get(a.id)!; return sc.scope_type === s.scope_type && sc.scope_id === s.scope_id }
  async currentAssertions(s: SemanticScope, subject: string, predicate?: string) { return this.assertions.filter(a => this.aIn(s)(a) && a.subject_entity_id === subject && a.assertion_status === 'current' && (!predicate || a.predicate === predicate)).sort((x, y) => y.recorded_at.localeCompare(x.recorded_at)) }
  async assertionsAbout(s: SemanticScope, id: string, limit: number) { return this.assertions.filter(a => this.aIn(s)(a) && a.assertion_status === 'current' && (a.subject_entity_id === id || a.object_entity_id === id)).slice(0, limit) }
  async insertAssertion(s: SemanticScope, row: any) { const a: Assertion = { id: this.id('asr'), recorded_at: new Date(this.n * 1000 + Date.parse('2026-11-09T00:00:00Z')).toISOString(), ...row }; this.assertions.push(a); this.ascope.set(a.id, s); return a }
  async updateAssertion(s: SemanticScope, id: string, patch: any) { const a = this.assertions.find(x => x.id === id && this.aIn(s)(x)); if (!a) throw new Error('semantic_assertion_update_failed:not_in_scope'); Object.assign(a, patch) }
  async sourcesById(s: SemanticScope, ids: string[]) { return this.sources.filter(x => ids.includes(x.id) && this.sscope.get(x.id)!.scope_id === s.scope_id) }
  async entitiesById(s: SemanticScope, ids: string[]) { return this.entities.filter(e => ids.includes(e.id) && this.inScope(s)(e)) }
  async retireScope(s: SemanticScope, at: string) { let a = 0, e = 0; for (const x of this.assertions) if (this.aIn(s)(x) && x.assertion_status === 'current') { x.assertion_status = 'retracted'; a++ } for (const x of this.entities) if (this.inScope(s)(x) && !x.retired_at) { x.retired_at = at; e++ } return { assertions: a, entities: e } }
}
