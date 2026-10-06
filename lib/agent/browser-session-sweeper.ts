import { supabaseAdmin } from '@/lib/supabase-admin'
import { listRunningManagedSessions, releaseManagedSessionById } from './managed-browser'

// An orphaned managed session is RUNNING, older than the keepAlive window + a safety
// margin, and NOT referenced by an active handoff in our own DB. Age alone is never
// sufficient: a session a live, unexpired handoff still owns is always skipped.
const KEEPALIVE_CAP_SECONDS = 1200 // KEEPALIVE_SESSION_TIMEOUT_SECONDS
const SAFETY_MARGIN_SECONDS = 300
export const ORPHAN_AGE_SECONDS = KEEPALIVE_CAP_SECONDS + SAFETY_MARGIN_SECONDS // 25 min

// Managed session ids currently owned by a paused/running handoff, read from our own
// agent_runs rows (metadata_json.handoff.managedSessionId). This is the DB-state check
// that prevents the sweep from killing a session a human is mid-takeover on.
export async function activeHandoffManagedSessionIds(): Promise<Set<string>> {
  const ids = new Set<string>()
  const { data, error } = await supabaseAdmin.from('agent_runs')
    .select('metadata_json')
    .in('status', ['paused', 'running', 'waiting_approval'])
  if (error) throw new Error(`browser_sweep_active_read_failed:${error.message}`)
  for (const row of data || []) {
    const sid = (row as any)?.metadata_json?.handoff?.managedSessionId
    if (sid) ids.add(String(sid))
  }
  return ids
}

export async function sweepOrphanManagedSessions(opts: {
  env?: Record<string, string | undefined>
  fetcher?: typeof fetch
  now?: number
  activeSessionIds?: Set<string>
} = {}) {
  const env = opts.env || process.env
  const fetcher = opts.fetcher || fetch
  const now = opts.now ?? Date.now()
  const active = opts.activeSessionIds ?? await activeHandoffManagedSessionIds()
  const running = await listRunningManagedSessions(env, fetcher)
  const cutoff = now - ORPHAN_AGE_SECONDS * 1000
  let released = 0, skippedActive = 0, skippedYoung = 0
  for (const session of running) {
    if (active.has(session.id)) { skippedActive++; continue } // never release an active handoff
    const started = Date.parse(String(session.startedAt || ''))
    if (!Number.isFinite(started) || started > cutoff) { skippedYoung++; continue }
    if (await releaseManagedSessionById(session.id, env, fetcher)) released++
  }
  return { inspected: running.length, released, skippedActive, skippedYoung, active: active.size }
}
