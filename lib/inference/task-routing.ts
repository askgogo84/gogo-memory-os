// Addendum 3 (10 Nov): task-aware model routing POLICY. Pure and side-effect free: it names which model answers and
// whether a cheaper candidate may be shadowed for measurement. It does not call a model and nothing imports it from a
// live route yet. Defaults are "primary only": a lower token price is not a lower cost per completed task, so no
// workload moves until the shadow evaluation shows it (docs/architecture/same-brain-3/02-addendum-3.md).
import { SONNET_MODEL, HAIKU_MODEL } from '@/lib/services/model-ids'

export const MODEL_TASKS = ['reminder_parse', 'intent_classification', 'memory_extraction', 'summarization', 'email_classification',
  'light_tool_decision', 'complex_reasoning', 'sensitive_workflow'] as const
export type ModelTask = typeof MODEL_TASKS[number]

export type RoutingMode = 'off' | 'shadow'
export type TaskPolicy = {
  /** The model that answers the user today. */
  primary: 'sonnet' | 'haiku'
  /** May a cheaper candidate be measured in shadow for this task at all? */
  candidateEligible: boolean
  /** The task's input is the owner's own data (mail, memory, chat). */
  personal: boolean
}

export const TASK_POLICIES: Record<ModelTask, TaskPolicy> = {
  reminder_parse:        { primary: 'haiku',  candidateEligible: true,  personal: true },
  intent_classification: { primary: 'haiku',  candidateEligible: true,  personal: true },
  memory_extraction:     { primary: 'haiku',  candidateEligible: true,  personal: true },
  summarization:         { primary: 'haiku',  candidateEligible: true,  personal: true },
  email_classification:  { primary: 'haiku',  candidateEligible: true,  personal: true },
  light_tool_decision:   { primary: 'sonnet', candidateEligible: true,  personal: true },
  complex_reasoning:     { primary: 'sonnet', candidateEligible: false, personal: true },
  sensitive_workflow:    { primary: 'sonnet', candidateEligible: false, personal: true },
}

export type CandidateTerms = { id: string; /** Written provider terms allow the owner's data (no training, bounded retention). */ personalDataApproved: boolean }
export type RouteInput = { task: ModelTask | string; containsPersonalData: boolean; syntheticFixture?: boolean; consequential?: boolean; previousFailure?: boolean }
export type ModelRoute = { answerModel: string; shadowCandidate: string | null; escalated: boolean; reason: string }

export function routingMode(env: Record<string, string | undefined> = process.env): RoutingMode {
  return String(env.GOGO_MODEL_ROUTER || '').trim() === 'shadow' ? 'shadow' : 'off'
}

/** Never returns the candidate as the answering model: promotion is a separate, reviewed change. */
export function routeModelTask(input: RouteInput, candidate: CandidateTerms | null, env: Record<string, string | undefined> = process.env): ModelRoute {
  const known = (MODEL_TASKS as readonly string[]).includes(String(input.task))
  const policy = known ? TASK_POLICIES[input.task as ModelTask] : TASK_POLICIES.sensitive_workflow
  const strong = SONNET_MODEL
  // Escalation: unknown task, anything consequential (sends, bookings, payments, approvals), or a retry after a failure.
  if (!known || input.consequential || input.previousFailure || !policy.candidateEligible) {
    return { answerModel: strong, shadowCandidate: null, escalated: policy.primary !== 'sonnet' || !known, reason: !known ? 'unknown_task' : input.consequential ? 'consequential' : input.previousFailure ? 'previous_failure' : 'strong_only_task' }
  }
  const answerModel = policy.primary === 'sonnet' ? SONNET_MODEL : HAIKU_MODEL
  if (routingMode(env) !== 'shadow' || !candidate) return { answerModel, shadowCandidate: null, escalated: false, reason: 'router_off' }
  // The owner's data reaches a candidate only under approved written terms; committed synthetic fixtures always may.
  if (input.containsPersonalData && !input.syntheticFixture && !candidate.personalDataApproved) return { answerModel, shadowCandidate: null, escalated: false, reason: 'candidate_terms_not_approved' }
  return { answerModel, shadowCandidate: candidate.id, escalated: false, reason: 'shadow' }
}
