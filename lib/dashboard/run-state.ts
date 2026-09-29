// Shared run-state indicator logic for dashboard surfaces.
//
// "Working" must mean Gogo is ACTIVELY executing. A production Blinkit run that ended
// blocked (status 'paused') still showed "Working" on the dashboard because paused /
// waiting_approval runs were treated as active. Separate genuinely-running work from
// work that is waiting on the user so the indicator reflects the real task state.

export type RunStatusLike = { status?: string | null }
export type RunStateSummary = {
  working: number
  waiting: number
  label: 'Working' | 'Waiting for you' | 'Ready'
  tone: 'working' | 'waiting' | 'idle'
}

const WORKING = new Set(['running', 'queued'])
const WAITING = new Set(['paused', 'waiting_approval'])

export function summarizeActiveRunState(runs: RunStatusLike[] | null | undefined): RunStateSummary {
  const list = Array.isArray(runs) ? runs : []
  const working = list.filter(r => WORKING.has(String(r?.status || ''))).length
  const waiting = list.filter(r => WAITING.has(String(r?.status || ''))).length
  const label: RunStateSummary['label'] = working ? 'Working' : waiting ? 'Waiting for you' : 'Ready'
  const tone: RunStateSummary['tone'] = working ? 'working' : waiting ? 'waiting' : 'idle'
  return { working, waiting, label, tone }
}
