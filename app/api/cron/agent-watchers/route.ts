import { NextResponse } from 'next/server'
import { processDueAgentWatchers } from '@/lib/agent/watchers'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function authorized(request: Request) {
  const expected = process.env.CRON_SECRET
  if (!expected) return false
  const url = new URL(request.url)
  const query = url.searchParams.get('secret')
  const bearer = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
  return query === expected || bearer === expected
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error:'unauthorized' }, { status:401 })
  try {
    const result = await processDueAgentWatchers()
    return NextResponse.json({ ok:true, ...result })
  } catch (err:any) {
    console.error('AGENT_WATCHER_CRON_FAILED:', err?.message || err)
    return NextResponse.json({ ok:false, error:'watcher_worker_failed' }, { status:500 })
  }
}
