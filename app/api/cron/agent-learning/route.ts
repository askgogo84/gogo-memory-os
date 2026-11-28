import { NextResponse } from 'next/server'
import { processLearningPass } from '@/lib/agent/learning-worker'
import { isCronBearerAuthorized } from '@/lib/security/cron-auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// 15 Nov audit: the shared, constant-time check (was a local copy with a plain ===).
const authorized = (request: Request) => isCronBearerAuthorized(request)

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  try {
    // 60 s limit: learning gets up to 40 s, then semantic sync runs only if at least 12 s remain.
    const started = Date.now()
    // Separate retention flag: expired audit records still need pruning when
    // execution is disabled. Never modify the existing cron schedule.
    let hachiRetention:unknown=null
    if(process.env.GOGO_HACHI_RETENTION_ENABLED==='1'){
      try{
        const {supabaseAdmin}=await import('@/lib/supabase-admin')
        const r=await supabaseAdmin.rpc('gogo_prune_memory_block_events').abortSignal(AbortSignal.timeout(2000))
        const candidates=await supabaseAdmin.rpc('gogo_prune_skill_learning_candidates').abortSignal(AbortSignal.timeout(1500))
        hachiRetention=r.error||candidates.error?{error:'retention_unverified'}:{removed:r.data,candidatesRemoved:candidates.data}
      }catch{hachiRetention={error:'retention_unverified'}}
    }
    let hachiLearning:unknown=null
    if(process.env.GOGO_HACHI_LEARNING_ENABLED==='1'&&Date.now()-started<5000){
      try{
        const {generateGovernedLearningCandidates}=await import('@/lib/agent/governed-learning-candidates')
        hachiLearning=await generateGovernedLearningCandidates(process.env,started+7000)
      }catch{hachiLearning={error:'candidate_generation_unavailable'}}
    }
    const result = await processLearningPass({ budgetMs: Math.max(1000,40_000-(Date.now()-started)) })
    if (result.deferred > 0) console.log('AGENT_LEARNING_DEFERRED:', JSON.stringify({ deferred: result.deferred, processed: result.processed, ms: result.ms }))
    // Same Brain 3.0 Phase 1: semantic graph sync for flagged owners only (GOGO_SEMANTIC / GOGO_SEMANTIC_OWNERS). Never fails the pass.
    let semantic: unknown = null
    // 17 Nov: this job hit the 60 s limit 48 times. The semantic step now stops starting owners at 50 s, and the
    // route answers by 55 s even if one owner's sync is still running (it is picked up again next hour).
    if ((process.env.GOGO_SEMANTIC === '1' || process.env.GOGO_SEMANTIC_OWNERS) && Date.now() - started < 60_000 - 12_000) {
      try {
        const { syncSemanticForEnabledOwners } = await import('@/lib/semantic/sync')
        let timer: ReturnType<typeof setTimeout> | undefined
        const cutoff = new Promise<{ timedOut: true }>(resolve => { timer = setTimeout(() => resolve({ timedOut: true }), Math.max(0, started + 55_000 - Date.now())) })
        const work = syncSemanticForEnabledOwners(process.env, started + 50_000)
        work.catch(() => {}) // a late failure after the cutoff is not an unhandled rejection
        try { semantic = await Promise.race([work, cutoff]) } finally { if (timer) clearTimeout(timer) }
        if ((semantic as any)?.timedOut || (semantic as any)?.deferred) console.log('SEMANTIC_SYNC_DEFERRED:', JSON.stringify(semantic))
      } catch (e: any) { console.error('SEMANTIC_SYNC_CRON_FAILED', e?.message || e); semantic = { error: 'semantic_sync_failed' } }
    }
    return NextResponse.json({ ok: true, ...result, semantic, ...(hachiRetention?{hachiRetention}:{}),...(hachiLearning?{hachiLearning}:{}) })
  } catch (err: any) {
    console.error('AGENT_LEARNING_CRON_FAILED:', err?.message || err)
    return NextResponse.json({ ok: false, error: 'learning_worker_failed' }, { status: 500 })
  }
}
