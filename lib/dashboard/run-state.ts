// Shared run-state indicator logic for dashboard surfaces.
//
// "Working" must mean Gogo is ACTIVELY executing. A production Blinkit run that ended
// blocked (status 'paused') still showed "Working" on the dashboard because paused /
// waiting_approval runs were treated as active. Separate genuinely-running work from
// work that is waiting on the user so the indicator reflects the real task state.

import { retiredRunReason } from '../agent/task-lifecycle'

export type RunStatusLike = { status?: string | null; summary?: string | null; error?: string | null; metadata?: any; metadata_json?: any }
export type RunStateSummary = {
  working: number
  waiting: number
  label: 'Working' | 'Waiting for you' | 'Ready'
  tone: 'working' | 'waiting' | 'idle'
}

const WORKING = new Set(['running', 'queued'])
// An explicit approval wait is unambiguously "waiting on the user". A bare `paused`
// run is ambiguous — a REJECTED approval leaves it paused too — so `paused` alone is
// neither "Working" (the bug we fix) nor a standing "Waiting for you" prompt. But a
// `paused` run that stopped at a real human-action boundary (sign-in / secure handoff)
// IS actionable and should read "Waiting for you", not "Ready".
const ACTIONABLE_PAUSE = /human_auth_required|secondary_auth|awaiting_user|take[_\s-]?control|handoff|resume/i

export function isActionablePause(run: RunStatusLike): boolean {
  if(retiredRunReason(run))return false
  if (String(run?.status || '') !== 'paused') return false
  const meta = (run?.metadata || run?.metadata_json || {}) as any
  // Actionable pauses can be signalled by metadata (handoff, secure-browser waiting,
  // auth-resume) OR by an error reason, and some producers clear one while setting the
  // other — so check both.
  if (meta && (meta.handoff || meta.awaiting || meta.secondary_auth || meta.browser_waiting || meta.auth_resume)) return true
  return ACTIONABLE_PAUSE.test(String(run?.error || ''))
}

export function summarizeActiveRunState(runs: RunStatusLike[] | null | undefined): RunStateSummary {
  const list = Array.isArray(runs) ? runs.filter(r=>!retiredRunReason(r)) : []
  const working = list.filter(r => WORKING.has(String(r?.status || ''))).length
  const waiting = list.filter(r => String(r?.status || '') === 'waiting_approval' || isActionablePause(r)).length
  const label: RunStateSummary['label'] = working ? 'Working' : waiting ? 'Waiting for you' : 'Ready'
  const tone: RunStateSummary['tone'] = working ? 'working' : waiting ? 'waiting' : 'idle'
  return { working, waiting, label, tone }
}
