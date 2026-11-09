import { NextResponse } from 'next/server'
import { runOpsAlertsPass } from '@/lib/ops/run'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function authorized(request: Request) {
  const expected = process.env.CRON_SECRET
  if (!expected) return false
  const bearer = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
  return bearer === expected
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const result = await runOpsAlertsPass()
    if (!result.ok) console.error('OPS_ALERTS_PASS_SKIPPED:', result.reason)
    return NextResponse.json(result)
  } catch (err: any) {
    console.error('OPS_ALERTS_CRON_FAILED:', String(err?.message || err).slice(0, 200))
    return NextResponse.json({ ok: false, error: 'ops_alerts_failed' }, { status: 500 })
  }
}
