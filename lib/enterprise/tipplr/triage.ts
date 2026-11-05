/**
 * AskGogo Enterprise x Tipplr: deterministic, side-effect-free shadow triage.
 * Supplied evidence is NOT authenticated by this module. Provider adapters
 * must validate signatures, tenant binding and source readback first.
 * Absolutely no external writes, refunds, cancellations or POS remapping.
 */
export type EnterpriseSource = 'flipkart' | 'ondc' | 'petpooja' | 'tipplr' | 'merchant' | 'buyer'
export type IncidentKind = 'order_cancelled' | 'order_rejected' | 'order_delayed' | 'refund_requested' | 'mapping_check' | 'other'
export type IncidentPriority = 'critical' | 'high' | 'normal'
export type IncidentCategory = 'mapping_discrepancy' | 'mapping_evidence_needed' | 'cancellation_investigation' | 'order_investigation' | 'refund_review' | 'general_triage' | 'invalid_input'

export interface VerifiedStoreId {
  value: string
  source: EnterpriseSource
  /** True only after the future authenticated adapter has read the source. */
  verified: boolean
  observedAt: string
}
export interface EnterpriseIncident {
  tenantId: string
  sourceEventId: string
  orderId: string
  merchantId: string
  marketplace: 'flipkart' | 'ondc' | 'direct'
  kind: IncidentKind
  /** Store ID targeted on the order, independently read back. */
  actualPosStoreId?: VerifiedStoreId | null
  /** Expected mapping from an authoritative merchant / POS source. */
  expectedPosStoreId?: VerifiedStoreId | null
  /** Free text is NEVER proof of a mapping error. */
  reportedReason?: string | null
}
export interface TriageResult {
  category: IncidentCategory
  priority: IncidentPriority
  humanReviewRequired: boolean
  safeAutomaticActions: readonly ('create_internal_case' | 'request_mapping_evidence' | 'read_only_status_lookup')[]
  proposedNextStep: string
  /** Caller must enforce exact tenant-scoped uniqueness in persistent DB. */
  idempotencyTuple: string | null
  externalMutationAuthorized: false
  evidenceVerified: boolean
}

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/
const SOURCES: readonly EnterpriseSource[] = ['flipkart', 'ondc', 'petpooja', 'tipplr', 'merchant', 'buyer']
const isIdentifier = (v: unknown): v is string => typeof v === 'string' && IDENTIFIER.test(v)
const isVerified = (e: VerifiedStoreId | null | undefined): e is VerifiedStoreId =>
  !!e && isIdentifier(e.value) && SOURCES.includes(e.source) && e.verified === true &&
  typeof e.observedAt === 'string' && !Number.isNaN(Date.parse(e.observedAt)) &&
  Date.parse(e.observedAt) <= Date.now() + 60_000 &&
  Date.parse(e.observedAt) >= Date.now() - 24 * 60 * 60_000

export function triageTipplrIncident(i: EnterpriseIncident): TriageResult {
  const valid = [i.tenantId, i.sourceEventId, i.orderId, i.merchantId].every(isIdentifier) &&
    ['flipkart', 'ondc', 'direct'].includes(i.marketplace) &&
    ['order_cancelled', 'order_rejected', 'order_delayed', 'refund_requested', 'mapping_check', 'other'].includes(i.kind)
  if (!valid) return {
    category: 'invalid_input', priority: 'high', humanReviewRequired: true,
    safeAutomaticActions: [],
    proposedNextStep: 'Reject ingestion and investigate missing or malformed tenant/order identifiers.',
    idempotencyTuple: null, externalMutationAuthorized: false, evidenceVerified: false,
  }
  const idempotencyTuple = JSON.stringify(['tipplr-v1', i.tenantId, i.marketplace, i.orderId, i.sourceEventId])
  if (i.kind === 'refund_requested') return {
    category: 'refund_review', priority: 'high', humanReviewRequired: true,
    safeAutomaticActions: ['create_internal_case'],
    proposedNextStep: 'Collect order evidence and route a proposed refund for authorized human review. Do not issue payment.',
    idempotencyTuple, externalMutationAuthorized: false, evidenceVerified: false,
  }
  const actual = isVerified(i.actualPosStoreId) ? i.actualPosStoreId.value : null
  const expected = isVerified(i.expectedPosStoreId) ? i.expectedPosStoreId.value : null
  const needsMapping = i.kind === 'mapping_check' || ['order_cancelled', 'order_rejected'].includes(i.kind)
  if (needsMapping && actual && expected && actual !== expected) return {
    category: 'mapping_discrepancy', priority: 'critical', humanReviewRequired: true,
    safeAutomaticActions: ['create_internal_case'],
    proposedNextStep: 'Open a store-ID discrepancy incident; confirm partner ownership and proposed correction with Petpooja/Tipplr before any write.',
    idempotencyTuple, externalMutationAuthorized: false, evidenceVerified: true,
  }
  if (needsMapping && (!actual || !expected)) return {
    category: 'mapping_evidence_needed', priority: 'high', humanReviewRequired: true,
    safeAutomaticActions: ['create_internal_case', 'request_mapping_evidence'],
    proposedNextStep: 'Read authenticated order target and authoritative POS mapping; do not call free-text allegations confirmed.',
    idempotencyTuple, externalMutationAuthorized: false, evidenceVerified: false,
  }
  if (i.kind === 'order_cancelled' || i.kind === 'order_rejected') return {
    category: 'cancellation_investigation', priority: 'high', humanReviewRequired: true,
    safeAutomaticActions: ['create_internal_case', 'read_only_status_lookup'],
    proposedNextStep: 'Store IDs agree; investigate acceptance, menu availability, timing and partner/provider cancellation codes.',
    idempotencyTuple, externalMutationAuthorized: false, evidenceVerified: !!actual && !!expected,
  }
  if (i.kind === 'order_delayed') return {
    category: 'order_investigation', priority: 'normal', humanReviewRequired: false,
    safeAutomaticActions: ['create_internal_case', 'read_only_status_lookup'],
    proposedNextStep: 'Read authoritative order and fulfillment statuses; escalate when an SLA threshold is independently verified.',
    idempotencyTuple, externalMutationAuthorized: false, evidenceVerified: false,
  }
  return {
    category: 'general_triage', priority: 'normal', humanReviewRequired: true,
    safeAutomaticActions: ['create_internal_case'],
    proposedNextStep: 'Classify with trusted policy sources and collect evidence; do not mutate provider or payment systems.',
    idempotencyTuple, externalMutationAuthorized: false, evidenceVerified: false,
  }
}
