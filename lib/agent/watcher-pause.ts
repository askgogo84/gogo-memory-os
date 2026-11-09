// G5: pause / resume a background watch. Pure patches; the route applies them owner-scoped.
export type WatcherRow = { active?: boolean | null; paused_at?: string | null; next_check_at?: string | null; cadence_minutes?: number | null }
export type WatcherState = 'active' | 'paused' | 'stopped'

export function watcherState(row: WatcherRow): WatcherState {
  if (row.active === false) return 'stopped'
  return row.paused_at ? 'paused' : 'active'
}

/** Pausing keeps the rule and the history; it only stops polling. */
export function pausePatch(now: Date = new Date()) {
  const iso = now.toISOString()
  return { paused_at: iso, next_check_at: null as string | null, updated_at: iso }
}

/** Resuming checks right away, then continues on the watch's own cadence. */
export function resumePatch(now: Date = new Date()) {
  const iso = now.toISOString()
  return { paused_at: null as string | null, next_check_at: iso, updated_at: iso }
}

export function parseWatcherAction(body: unknown): 'pause' | 'resume' | null {
  const a = body && typeof body === 'object' ? String((body as { action?: unknown }).action || '') : ''
  return a === 'pause' || a === 'resume' ? a : null
}

/** Postgres "column does not exist" (42703): the migration has not been run yet. */
export function isMissingColumnError(error: { code?: string | null; message?: string | null } | null | undefined) {
  return !!error && (error.code === '42703' || /column .*paused_at.* does not exist/i.test(String(error.message || '')))
}
