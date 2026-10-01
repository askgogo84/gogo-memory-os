// Read-time interpretation of recorded lifecycle evidence. Never infer completion
// from age, a repeated title, or an expired human handoff.
export function retiredRunReason(run: any): string | null {
  const meta = run?.metadata_json || run?.metadata || {}
  if (meta.state === 'closed_stale') return 'Closed stale handoff'
  if (String(run?.summary || '').trim() === 'Superseded by duplicate mission submission') return 'Superseded task'
  if (['stale_provider_access_limited', 'background_browser_resume_expired', 'stale_run_recovered', 'background_browser_actor_missing'].includes(String(run?.error || ''))) return 'Closed session'
  return null
}

// Observed production questions were incorrectly captured as obligations:
// "Which ... are just waiting for me?" and "How many reminders do I have ...?".
export function isTaskInventoryQuestion(text: string): boolean {
  const raw = String(text || '').trim()
  return /^(?:which|what)\b[\s\S]*\b(?:running|waiting|pending|working on)\b/i.test(raw)
    || /^how many\s+(?:reminders?|tasks?|open loops)\b/i.test(raw)
}

export function isRelevantOpenLoop(loop: any): boolean {
  return !(loop?.source_type === 'conversation' && isTaskInventoryQuestion(String(loop.summary || '')))
}

export function openLoopStatus(loop: any): string {
  const state = String(loop?.evidence_json?.status || '')
  if (state === 'outcome_unknown') return 'Outcome unverified — check before retrying'
  if (state === 'waiting_approval' || loop.kind === 'approval') return 'Awaiting approval'
  if (state === 'blocked') return 'Blocked'
  if (state === 'paused') return 'Paused — not running'
  return 'Open'
}
