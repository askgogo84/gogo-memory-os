import { NextResponse } from 'next/server'
import { isCronAuthorized } from '@/lib/security/cron-auth'
import { managedBrowserEnabled } from '@/lib/agent/managed-browser'
import { sweepOrphanManagedSessions } from '@/lib/agent/browser-session-sweeper'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Orphan sweep: releases RUNNING Browserbase sessions older than the keepAlive window +
// margin that are NOT owned by an active handoff (checked against agent_runs). Guards
// the leak paths the PR-0 investigation found that can't be caught in-process (sandbox
// or function death, abandoned takeover). NOT scheduled in vercel.json yet — enable
// after review. Cron/internal-secret protected via lib/security/cron-auth.ts.
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!managedBrowserEnabled()) return NextResponse.json({ ok: true, skipped: 'managed_mode_disabled' })
  try {
    const result = await sweepOrphanManagedSessions()
    return NextResponse.json({ ok: true, ...result })
  } catch (err: any) {
    console.error('BROWSER_SESSION_SWEEP_FAILED:', err?.message || err)
    return NextResponse.json({ ok: false, error: 'browser_session_sweep_failed' }, { status: 500 })
  }
}
