// Read-time interpretation of recorded lifecycle evidence. Never infer completion
// from age, a repeated title, or an expired human handoff.
// A booking-calendar approval ("Add Jailer 2 to calendar") for an event that has already ended can never be
// acted on: blocking a past slot is meaningless. 20 Oct live: task status still said it was "waiting for approval to
// block the calendar" a day after the show. This reads the event's own recorded end (or start), which is lifecycle
// evidence, not the run's age.
export const PAST_EVENT_CALENDAR_REASON = 'Event already happened — calendar block dropped'
export function pastEventCalendarRun(run: any, now: number = Date.now()): boolean {
  const meta = run?.metadata_json || run?.metadata || {}
  if (meta.plan_type !== 'booking_event_calendar') return false
  if (!['waiting_approval', 'paused', 'queued'].includes(String(run?.status || ''))) return false
  const ev = meta.proposedEvent || {}
  const end = Date.parse(String(ev.endAt || ''))
  const start = Date.parse(String(ev.startAt || ''))
  const over = Number.isFinite(end) ? end : Number.isFinite(start) ? start + 3 * 3600_000 : NaN
  return Number.isFinite(over) && over <= now
}

export function retiredRunReason(run: any, now: number = Date.now()): string | null {
  const meta = run?.metadata_json || run?.metadata || {}
  if (pastEventCalendarRun(run, now)) return PAST_EVENT_CALENDAR_REASON
  if(meta.plan_type==='food_comparison'&&meta.state==='closed')return meta.closure_reason==='user_cancelled'?'Cancelled by you':'Replaced comparison'
  // Chat cancel (run-cancel.ts): the status check has no 'cancelled', so it is failed + user_cancelled.
  if (String(run?.error || '') === 'user_cancelled' || String(run?.status || '') === 'cancelled' || (meta.state === 'closed' && meta.closure_reason === 'user_cancelled')) return 'Cancelled by you'
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
