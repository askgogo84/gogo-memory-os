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
    // Same Brain 3.0 Phase 1: semantic graph sync for flagged owners only (GOGO_SEMANTIC / GOGO_SEMANTIC_OWNERS). Never fails the pass.
    let semantic: unknown = null
    if (process.env.GOGO_SEMANTIC === '1' || process.env.GOGO_SEMANTIC_OWNERS) {
      try { const { syncSemanticForEnabledOwners } = await import('@/lib/semantic/sync'); semantic = await syncSemanticForEnabledOwners() } catch (e: any) { console.error('SEMANTIC_SYNC_CRON_FAILED', e?.message || e); semantic = { error: 'semantic_sync_failed' } }
    }
    return NextResponse.json({ ok: true, ...result, semantic })
  } catch (err: any) {
    console.error('AGENT_LEARNING_CRON_FAILED:', err?.message || err)
    return NextResponse.json({ ok: false, error: 'learning_worker_failed' }, { status: 500 })
  }
}
