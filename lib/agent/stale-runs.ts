// A run left "running" for hours with no update means the worker that owned it died (a browser task from 3 Oct still
// showing "Gogo is working on it" on 15 Oct). Such runs must not count as active work, and the cron closes them.
import { supabaseAdmin } from '@/lib/supabase-admin'

export const STALE_RUNNING_HOURS = 12
export const STALE_RUN_ERROR = 'stale_run_recovered'
export const STALE_RUN_SUMMARY = 'Gogo stopped this task because it stopped responding. Ask again if you still need it.'

/** The oldest updated_at a running run can have and still count as live work. */
export function staleRunningCutoff(now = new Date()) {
  return new Date(now.getTime() - STALE_RUNNING_HOURS * 3600_000).toISOString()
}

export function isStaleRunning(run: { status?: string | null; updated_at?: string | null }, now = new Date()) {
  if (!['running', 'queued'].includes(String(run?.status || ''))) return false
  const at = Date.parse(String(run?.updated_at || ''))
  return Number.isFinite(at) && at < Date.parse(staleRunningCutoff(now))
}

/** Close every run stuck in "running" past the cutoff. Queued runs are left alone: they may be waiting for their time. */
export async function sweepStaleRunningRuns() {
  const at = new Date().toISOString()
  const { data, error } = await supabaseAdmin.from('agent_runs')
    .update({ status: 'failed', error: STALE_RUN_ERROR, summary: STALE_RUN_SUMMARY, completed_at: at, updated_at: at })
    .eq('status', 'running')
    .lt('updated_at', staleRunningCutoff())
    .select('id')
  if (error) { console.error('STALE_RUN_SWEEP_FAILED:', error.message); return 0 }
  const ids = (data || []).map((row: any) => String(row.id))
  // The run's own steps stop too, so the task page no longer says "Gogo is working on this step now".
  if (ids.length) {
    const { error: stepError } = await supabaseAdmin.from('agent_steps')
      .update({ status: 'failed', error: STALE_RUN_ERROR, completed_at: at })
      .in('run_id', ids).in('status', ['running', 'queued'])
    if (stepError) console.error('STALE_RUN_STEP_SWEEP_FAILED:', stepError.message)
  }
  return ids.length
}
