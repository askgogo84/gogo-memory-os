// Duet parity (23 Oct): every task shows ONE owner-facing state in plain words, instead of raw run statuses like
// "completed · browser". Pure mapping. Gogo finishing a run ('gogo_thinks_done') and the owner confirming it
// ('done') are deliberately different states: only the owner marks a task done (owner-confirmation.ts).
import { ownerConfirmationOf } from '@/lib/agent/owner-confirmation'

export type TaskState =
  | 'running' | 'waiting' | 'needs_you' | 'blocked' | 'done' | 'gogo_thinks_done'
  | 'unknown' | 'cancelled' | 'could_not_finish'

export const TASK_STATE_LABEL: Record<TaskState, string> = {
  running: 'Working now',
  waiting: 'Waiting',
  needs_you: 'Needs you',
  blocked: 'Blocked',
  done: 'Done',
  gogo_thinks_done: "Gogo thinks it's done",
  unknown: 'Not sure it happened',
  cancelled: 'Cancelled',
  could_not_finish: 'Could not finish',
}

/** Runs the owner can still cancel (same set as chat cancel, lib/agent/run-cancel.ts). */
export const OWNER_CANCELLABLE_STATUSES = ['queued', 'running', 'waiting_approval', 'paused'] as const
export function canOwnerCancel(run: any): boolean {
  return (OWNER_CANCELLABLE_STATUSES as readonly string[]).includes(String(run?.status || '')) && !isCancelled(run)
}

const PROVIDER_BLOCK = /\b(?:provider_access_limited|provider_blocked|browser_blocked|provider_cloudflare\w*|cloudflare\w*|access_denied|captcha\w*)\b/i
const MISSING_INPUT = /\b(?:delivery_location_required|missing_input|needs_input|input_required|missing_details?|missing_fields?)\b/i

function metaOf(run: any) {
  return run?.metadata_json || run?.metadata || {}
}

function isCancelled(run: any) {
  const meta = metaOf(run)
  return String(run?.status || '') === 'cancelled' || String(run?.error || '') === 'user_cancelled'
    || meta.closure_reason === 'user_cancelled'
}

function blockReasons(run: any): string {
  const meta = metaOf(run)
  return [run?.error, meta.blockReason, meta.block_reason, meta.blocked_reason, meta.blockedReason, meta.browser?.blockReason, meta.handoff?.reason]
    .filter(Boolean).map(String).join(' ')
}

function providerBlocked(run: any) {
  const meta = metaOf(run)
  return meta.provider_blocked === true || meta.handoff?.mode === 'device' || PROVIDER_BLOCK.test(blockReasons(run))
}

function missingInput(run: any) {
  const meta = metaOf(run)
  const listed = (v: any) => Array.isArray(v) ? v.length > 0 : Boolean(v)
  return listed(meta.missing_input) || listed(meta.missing_fields) || listed(meta.missingInput) || MISSING_INPUT.test(blockReasons(run))
}

function outcomeUnknown(run: any) {
  const meta = metaOf(run)
  const outcome = String(meta.outcome_status || '')
  return String(run?.status || '') === 'outcome_unknown' || outcome === 'unknown' || outcome === 'outcome_unknown' || meta.outcome_unknown === true
}

/** The one owner-facing state of an agent_runs row (raw row with metadata_json, or a dashboard run with metadata). */
export function taskStateOf(run: any): TaskState {
  const status = String(run?.status || '')
  if (isCancelled(run)) return 'cancelled'
  if (outcomeUnknown(run)) return 'unknown'
  if (status === 'running') return 'running'
  if (status === 'queued' || status === 'scheduled' || status === 'watching') return 'waiting'
  if (status === 'waiting_approval') return 'needs_you'
  if (status === 'paused') return providerBlocked(run) || missingInput(run) ? 'blocked' : 'needs_you'
  if (status === 'failed') return providerBlocked(run) || missingInput(run) ? 'blocked' : 'could_not_finish'
  if (status === 'completed') {
    const decision = ownerConfirmationOf(run)?.decision
    if (decision === 'done') return 'done'
    if (decision === 'not_done') return 'needs_you'
    // Same rule as needsOwnerConfirmation: a run whose own recorded outcome is not completed is not done.
    const outcome = String(metaOf(run).outcome_status || '')
    if (outcome && outcome !== 'completed') {
      if (outcome === 'failed') return 'could_not_finish'
      if (outcome === 'paused' || outcome === 'waiting_approval') return providerBlocked(run) || missingInput(run) ? 'blocked' : 'needs_you'
      if (outcome === 'running') return 'running'
      if (outcome === 'queued') return 'waiting'
      return 'unknown'
    }
    return 'gogo_thinks_done'
  }
  // 'closed' is the dashboard's name for a retired run (superseded, stale session) that was not cancelled by the owner.
  if (status === 'closed') return 'could_not_finish'
  return 'waiting'
}

export function taskStateLabel(run: any): string {
  return TASK_STATE_LABEL[taskStateOf(run)]
}
