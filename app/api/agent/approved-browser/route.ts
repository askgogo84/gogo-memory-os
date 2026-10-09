import { after, NextResponse } from 'next/server'
import { runApprovedBrowserRun } from '@/lib/agent/approved-browser-worker'

// Internal trigger, called by the WhatsApp webhook right after the user approves a browser
// action. It answers 202 immediately and runs the approved browser work in `after()`, so the
// webhook never waits on the browser. Protected by the same CRON_SECRET as the cron routes.
export const dynamic = 'force-dynamic'
export const maxDuration = 300

function authorized(request: Request) {
  const expected = process.env.CRON_SECRET
  if (!expected) return false
  const bearer = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
  return bearer === expected
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const body: any = await request.json().catch(() => null)
  const runId = String(body?.runId || '').trim()
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(runId)) return NextResponse.json({ error: 'invalid_run_id' }, { status: 400 })
  after(async () => {
    try {
      const outcome = await runApprovedBrowserRun(runId)
      console.log('APPROVED_BROWSER_RUN_DONE:', runId, outcome)
    } catch (err: any) {
      console.error('APPROVED_BROWSER_RUN_CRASHED:', runId, err?.message || err)
    }
  })
  return NextResponse.json({ accepted: true, runId }, { status: 202 })
}
