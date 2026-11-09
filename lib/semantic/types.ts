// Same Brain 3.0 — semantic spine types. A fact is an assertion: subject --predicate--> object (entity) or literal,
// backed by one source with a verification status, a confidence, a validity window and a status that is never
// overwritten (superseded, not deleted). Scope is a verified user or an authorized workspace; never a caller string.

export type ScopeType = 'user' | 'workspace'
export type SemanticScope = { scope_type: ScopeType; scope_id: string }

/** How much the source can be trusted. An inference never silently becomes a verified fact. */
export type VerificationStatus = 'verified_provider' | 'user_stated' | 'user_preference' | 'inferred' | 'unverified'
export type AssertionStatus = 'current' | 'superseded' | 'retracted'
export type Sensitivity = 'normal' | 'sensitive'

export type EntityInput = { entity_type: string; canonical_key: string; attributes?: Record<string, unknown>; sensitivity?: Sensitivity }
export type Entity = EntityInput & { id: string; scope_type: ScopeType; scope_id: string; retired_at?: string | null }

export type SourceInput = { source_type: string; source_object_ref: string; observed_at?: string | null; verification_status: VerificationStatus; sensitivity?: Sensitivity; metadata?: Record<string, unknown> }
export type Source = SourceInput & { id: string }

export type AssertionInput = {
  subject: EntityInput
  predicate: string
  object?: EntityInput
  literal?: unknown
  source: SourceInput
  confidence: number
  valid_from?: string | null
  valid_until?: string | null
  metadata?: Record<string, unknown>
}
export type Assertion = {
  id: string; subject_entity_id: string; predicate: string; object_entity_id: string | null; literal_value_json: unknown
  source_id: string; confidence: number; assertion_status: AssertionStatus; valid_from: string | null; valid_until: string | null
  recorded_at: string; supersedes_assertion_id: string | null; metadata_json: Record<string, unknown>
}

/** Learning evidence classes (Phase 4) derived from the source status. Only 'verified' strengthens success stats. */
export type EvidenceClass = 'verified' | 'reported' | 'inferred'
export function evidenceClassOf(v: VerificationStatus): EvidenceClass {
  return v === 'verified_provider' ? 'verified' : v === 'user_stated' || v === 'user_preference' ? 'reported' : 'inferred'
}

/** Ordering for "which assertion wins when two are current": higher is more authoritative. Pure. */
export const AUTHORITY: Record<VerificationStatus, number> = { verified_provider: 4, user_stated: 3, user_preference: 3, inferred: 1, unverified: 0 }

/** Temporal status of an assertion at `now`. A booking valid last month is historical, not current. Pure. */
export function temporalStatus(a: { valid_from?: string | null; valid_until?: string | null }, now = Date.now()): 'historical' | 'current' | 'future' {
  const from = a.valid_from ? Date.parse(a.valid_from) : NaN
  const until = a.valid_until ? Date.parse(a.valid_until) : NaN
  if (Number.isFinite(until) && until < now) return 'historical'
  if (Number.isFinite(from) && from > now) return 'future'
  return 'current'
}

const SECRET = /\b(?:otp|password|passcode|cvv|pin)\b\s*[:=]?\s*\S+|\b\d{12,19}\b|(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{8,}|eyJ[A-Za-z0-9_-]{20,}/i
/** Literal values must never carry secrets, tokens or full card/ID numbers. Pure. */
export function literalIsSafe(v: unknown): boolean {
  const s = typeof v === 'string' ? v : JSON.stringify(v ?? null)
  return !SECRET.test(s) && s.length <= 2000
}
