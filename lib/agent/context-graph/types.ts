// Same Brain 3.0 Phase 2: the decision context pack. Small, bounded, typed; every item carries why it is here.
import type { EvidenceClass } from '@/lib/semantic/types'
import type { RecallHypothesis, RecallItem } from './recall'

export type ObjectiveKind = 'live_status' | 'prepare' | 'report' | 'action' | 'question' | 'other'
export type ObjectiveDomain = 'travel' | 'calendar' | 'email' | 'payments' | 'reminders' | 'shopping' | 'dining' | 'enterprise' | 'memory' | 'other'

export type Objective = {
  text: string
  normalized: string
  kind: ObjectiveKind
  domain: ObjectiveDomain
  /** Current-state questions need a live provider read; notes, however recent, are not an answer. */
  liveDataRequired: boolean
  /** Capabilities the objective needs (names from lib/agent/policy capabilities). */
  requiresCapabilities: string[]
  /** Whether fulfilling it would be a consequential action (approval card territory). */
  consequential: boolean
}

export type PackEntity = { id: string; type: string; key: string; label: string }
export type PackAssertion = {
  subject: string; predicate: string; value: string; objectId?: string | null
  evidenceClass: EvidenceClass; status: 'verified_provider' | 'user_stated' | 'user_preference' | 'inferred' | 'unverified'
  temporal: 'historical' | 'current' | 'future'; sourceRef: string; freshnessMs: number | null; why: string
}
export type PackFact = { id: string; source: string; summary: string; score: number; confidence: number; inferred: boolean; freshnessMs: number | null; why: string }
export type Deadline = { label: string; at: string; source: string; inHours: number }
export type Conflict = { about: string; values: { value: string; status: string; sourceRef: string }[]; resolution: 'provider_wins' | 'owner_statement_wins' | 'unresolved'; chosen: string | null }

export type Budget = { maxNodes: number; maxEdges: number; maxReads: number; maxChars: number; maxMs: number }
export const DEFAULT_BUDGET: Budget = { maxNodes: 40, maxEdges: 80, maxReads: 6, maxChars: 3200, maxMs: 2500 }

export type DecisionContextPack = {
  version: 'decision-context-v1'
  decisionId: string
  actor: { scopeType: 'user' | 'workspace'; scopeId: string; timezone: string }
  objective: Objective
  entities: PackEntity[]
  assertions: PackAssertion[]
  facts: PackFact[]
  /** Hybrid recall: related memories (reported, relevance inferred). Never authoritative; never authorizes an action. */
  recall: { items: RecallItem[]; hypotheses: RecallHypothesis[]; dropped: { stale: number; sensitive: number; duplicate: number; foreign: number; lowScore: number }; probes: string[]; mode: 'off' | 'shadow' | 'on' }
  taskState: { openTasks: string[]; pendingApprovals: string[]; watches: string[]; reminders: string[]; travel: string[]; calendar: string[] }
  deadlines: Deadline[]
  priorDecisions: string[]
  conflicts: Conflict[]
  missing: string[]
  boundaries: { capabilities: Record<string, string>; approvalRequired: boolean; blockedCapabilities: string[] }
  generatedAt: string
  expiresAt: string
  freshness: { newestMs: number | null; oldestMs: number | null; stale: boolean }
  size: { nodes: number; edges: number; reads: number; chars: number; estTokens: number; ms: number }
  budget: Budget
  warnings: string[]
  evidenceRefs: string[]
}
