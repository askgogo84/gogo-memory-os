import { NextResponse } from 'next/server'
import { processLearningPass } from '@/lib/agent/learning-worker'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function authorized(request: Request) {
  const expected = process.env.CRON_SECRET
  if (!expected) return false
  const bearer = (request.headers.get('authorization') || '')
    .replace(/^Bearer\s+/i, '')
    .trim()
  return bearer === expected
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  try {
    const result = await processLearningPass()
    return NextResponse.json({ ok: true, ...result })
  } catch (err: any) {
    console.error('AGENT_LEARNING_CRON_FAILED:', err?.message || err)
    return NextResponse.json({ ok: false, error: 'learning_worker_failed' }, { status: 500 })
  }
}
