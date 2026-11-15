import { NextResponse } from 'next/server'
import { runReengagePass } from '@/lib/agent/reengage'
import { isCronBearerAuthorized } from '@/lib/security/cron-auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// 15 Nov audit: the shared, constant-time check (was a local copy with a plain ===).
const authorized = (request: Request) => isCronBearerAuthorized(request)

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const result = await runReengagePass()
    if (!result.ok) console.error('REENGAGE_PASS_SKIPPED:', (result as any).reason)
    else console.log('REENGAGE_PASS:', JSON.stringify(result))
    return NextResponse.json(result)
  } catch (err: any) {
    console.error('REENGAGE_CRON_FAILED:', String(err?.message || err).slice(0, 200))
    return NextResponse.json({ ok: false, error: 'reengage_failed' }, { status: 500 })
  }
}
