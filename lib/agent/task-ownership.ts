// Same Brain 3.0, Addendum 5 (Goal-to-Done): who does each task, and how sure Gogo is that it is done.
//
// Ownership is RESPONSIBILITY, never permission. It is read from what the records already say (run status, pending
// approvals, browser handoffs, drafts, what the owner said about it) and is only ever used to group and label work.
// Nothing here is read by Adaptive Trust, the Sentinel, the execution policy or any tool: a task shown under
// "Gogo handles" still goes through every approval it went through before.
//
// "Done" has degrees. A task only counts as "done, checked" when there is evidence that does not come from the agent
// that did it: the owner confirmed it (owner-confirmation.ts), or a check read the result back from the provider and
// recorded it on the run (metadata_json.verification, written by code, never by a model). Everything else that
// finished is "done, not checked". A draft is never done.
import { ownerConfirmationOf } from './owner-confirmation'

export type TaskOwnership = 'gogo_handles' | 'together' | 'your_turn'
export const OWNERSHIP_ORDER: readonly TaskOwnership[] = ['gogo_handles', 'together', 'your_turn']
export const OWNERSHIP_LABEL: Record<TaskOwnership, string> = { gogo_handles: 'Gogo handles', together: 'We do together', your_turn: 'Your turn' }
export const OWNERSHIP_HINT: Record<TaskOwnership, string> = {
  gogo_handles: 'Gogo does these on its own, within what you allowed.',
  together: 'Gogo prepares; nothing goes out until you say yes.',
  your_turn: 'Only you can do these. Gogo gets them ready.',
}

/** The eight states of Addendum 5, plus running, queued and cancelled, which the runtime already has. */
export type DoneState =
  | 'verified' | 'done_unverified' | 'draft' | 'waiting_approval' | 'waiting_external'
  | 'blocked' | 'failed' | 'unknown' | 'running' | 'queued' | 'cancelled'
export const DONE_STATE_LABEL: Record<DoneState, string> = {
  verified: 'Done, checked',
  done_unverified: 'Done, not checked',
  draft: 'Draft ready',
  waiting_approval: 'Needs your yes',
  waiting_external: 'Waiting',
  blocked: 'Blocked',
  failed: 'Could not finish',
  unknown: 'Not sure it happened',
  running: 'Working now',
  queued: 'Starting',
  cancelled: 'Cancelled',
}
/** States that still need something to happen (shown in the three ownership groups, not under "done"). */
export const OPEN_STATES: ReadonlySet<DoneState> = new Set(['draft', 'waiting_approval', 'waiting_external', 'blocked', 'unknown', 'running', 'queued'])
/** States where the owner has something to do or check. */
export const ATTENTION_STATES: ReadonlySet<DoneState> = new Set(['draft', 'waiting_approval', 'blocked', 'unknown'])

const metaOf = (run: any) => (run?.metadata_json || run?.metadata || {}) as Record<string, any>
const text = (v: unknown) => String(v ?? '')

const PROVIDER_BLOCK = /\b(?:provider_access_limited|provider_blocked|browser_blocked|cloudflare\w*|access_denied|captcha\w*|login_required|signin_required|otp_required|human_handoff\w*)\b/i
const MISSING_INPUT = /\b(?:delivery_location_required|missing_input|needs_input|input_required|missing_details?|missing_fields?)\b/i
function blockText(run: any) {
  const m = metaOf(run)
  return [run?.error, m.blockReason, m.block_reason, m.blocked_reason, m.blockedReason, m.browser?.blockReason, m.handoff?.reason].filter(Boolean).map(String).join(' ')
}
const needsOwnerHand = (run: any) => {
  const m = metaOf(run)
  return m.provider_blocked === true || Boolean(m.handoff) || m.human_handoff === true || PROVIDER_BLOCK.test(blockText(run))
}
const missingInput = (run: any) => {
  const m = metaOf(run), listed = (v: any) => (Array.isArray(v) ? v.length > 0 : Boolean(v))
  return listed(m.missing_input) || listed(m.missing_fields) || listed(m.missingInput) || MISSING_INPUT.test(blockText(run))
}
const cancelled = (run: any) => text(run?.status) === 'cancelled' || text(run?.error) === 'user_cancelled' || metaOf(run).closure_reason === 'user_cancelled'
const outcomeUnknown = (run: any) => {
  const m = metaOf(run), o = text(m.outcome_status)
  return text(run?.status) === 'outcome_unknown' || o === 'unknown' || o === 'outcome_unknown' || m.outcome_unknown === true
}
/** A run whose result is a prepared draft (an email not sent, a document awaiting review). Explicit markers only. */
export function isDraftRun(run: any): boolean {
  const m = metaOf(run), type = text(run?.type).toLowerCase()
  return m.mode === 'draft' || m.draft === true || m.draft_only === true || m.result_kind === 'draft' || /(?:^|_)draft$/.test(type)
}

/** Evidence that a finished run is done, from someone other than the agent that did it. */
export type DoneEvidence = { by: 'owner' | 'provider_check'; at: string; detail?: string }
export function doneEvidenceOf(run: any): DoneEvidence | null {
  const owner = ownerConfirmationOf(run)
  if (owner?.decision === 'done') return { by: 'owner', at: owner.at }
  // Written by a code check that read the result back from the provider (Addendum 5, P0 independent verification).
  // A model's own claim is never recorded here; `by` names the check, and anything claiming a model is refused.
  const v = metaOf(run).verification
  if (v && typeof v === 'object' && v.state === 'verified_completed' && typeof v.check === 'string' && v.check && !/model|llm|gpt|claude|sonnet|haiku|opus/i.test(v.check)
    && typeof v.at === 'string' && Number.isFinite(Date.parse(v.at))) return { by: 'provider_check', at: v.at, detail: v.check.slice(0, 60) }
  return null
}

/** The one state of an agent_runs row, as Addendum 5 names them. */
export function doneStateOf(run: any): DoneState {
  const status = text(run?.status)
  if (outcomeUnknown(run)) return 'unknown'
  if (cancelled(run)) return 'cancelled'
  // The owner said it is not done: it is back with them, whatever the run says.
  if (ownerConfirmationOf(run)?.decision === 'not_done') return 'blocked'
  switch (status) {
    case 'running': return 'running'
    case 'queued': return 'queued'
    case 'watching': case 'scheduled': return 'waiting_external'
    case 'waiting_approval': return isDraftRun(run) ? 'draft' : 'waiting_approval'
    case 'paused': return needsOwnerHand(run) || missingInput(run) ? 'blocked' : 'waiting_approval'
    case 'failed': return needsOwnerHand(run) || missingInput(run) ? 'blocked' : 'failed'
    case 'completed': {
      const o = text(metaOf(run).outcome_status)
      if (o && o !== 'completed') return o === 'failed' ? 'failed' : o === 'running' ? 'running' : o === 'queued' ? 'queued' : o === 'paused' || o === 'waiting_approval' ? 'waiting_approval' : 'unknown'
      if (isDraftRun(run)) return 'draft'
      return doneEvidenceOf(run) ? 'verified' : 'done_unverified'
    }
    default: return 'waiting_external'
  }
}

/** Who is responsible for the next step. The most hands-on of: what the plan said when the task was taken on, and what
 *  the task's state says now (a "Gogo handles" task that stopped for a sign-in is the owner's turn). */
export function ownershipOf(run: any, state: DoneState = doneStateOf(run)): TaskOwnership {
  const m = metaOf(run)
  const planned: TaskOwnership = OWNERSHIP_ORDER.includes(m.ownership) ? m.ownership : 'gogo_handles'
  let now: TaskOwnership = 'gogo_handles'
  if (state === 'blocked' && (needsOwnerHand(run) || missingInput(run) || ownerConfirmationOf(run)?.decision === 'not_done')) now = 'your_turn'
  else if (state === 'draft' || state === 'waiting_approval' || state === 'unknown') now = 'together'
  return OWNERSHIP_ORDER[Math.max(OWNERSHIP_ORDER.indexOf(planned), OWNERSHIP_ORDER.indexOf(now))]
}
