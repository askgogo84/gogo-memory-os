// Production ingestion for one verified actor: reads the owner's existing rows (bounded, owner-scoped) and feeds them
// to the repository. Calendar is passed in by the caller that already read it (no second provider call). Flag-gated.
import type { AgentActor } from '@/lib/agent/actor'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { ingestBatch, type IngestReport } from './ingest'
import { semanticRepoFor } from './repo'

export async function syncSemanticForActor(actor: Pick<AgentActor, 'legacyTelegramId'>, opts: { calendarEvents?: any[]; sinceDays?: number } = {}): Promise<IngestReport | null> {
  const repo = await semanticRepoFor(actor)
  if (!repo) return null
  const tg = String(actor.legacyTelegramId)
  const since = new Date(Date.now() - (opts.sinceDays ?? 60) * 86_400_000).toISOString()
  const read = async (q: any) => { const { data, error } = await q; if (error) { console.error('SEMANTIC_SYNC_READ_FAILED:', error.message); return [] } return data || [] }
  const [memories, reminders, lifeEvents, openLoops] = await Promise.all([
    read(supabaseAdmin.from('memories').select('id,content,created_at').eq('telegram_id', tg).order('created_at', { ascending: false }).limit(150)),
    read(supabaseAdmin.from('reminders').select('id,message,remind_at,sent,created_at').eq('telegram_id', tg).eq('sent', false).order('remind_at', { ascending: true }).limit(80)),
    read(supabaseAdmin.from('life_events').select('id,event_type,subtype,title,start_at,end_at,location,provider,metadata_json,source,created_at').eq('telegram_id', tg).gte('start_at', since).order('start_at', { ascending: false }).limit(120)),
    read(supabaseAdmin.from('agent_open_loops').select('id,title,kind,due_at,source_type,created_at').eq('telegram_id', tg).eq('status', 'active').limit(60)),
  ])
  const report = await ingestBatch(repo, { memories, reminders, lifeEvents, openLoops, calendarEvents: opts.calendarEvents || [] })
  console.log('SEMANTIC_SYNC:', JSON.stringify({ owner: tg, ...report, errors: report.errors.length }))
  return report
}

/**
 * Cron entry: sync every owner the flag names (GOGO_SEMANTIC_OWNERS), or, with GOGO_SEMANTIC=1, owners with memories
 * written in the last day (bounded to 50). Returns per-owner reports; never throws, never touches a disabled owner.
 */
export async function syncSemanticForEnabledOwners(env: Record<string, string | undefined> = process.env): Promise<{ owners: number; synced: number; failed: number }> {
  const { semanticEnabledFor } = await import('./repo')
  let ids: string[] = String(env.GOGO_SEMANTIC_OWNERS || '').split(',').map(s => s.trim()).filter(s => /^-?\d{1,20}$/.test(s))
  if (env.GOGO_SEMANTIC === '1') {
    try {
      const { supabaseAdmin } = await import('@/lib/supabase-admin')
      const since = new Date(Date.now() - 24 * 3600_000).toISOString()
      const { data } = await supabaseAdmin.from('memories').select('telegram_id').gte('created_at', since).order('created_at', { ascending: false }).limit(400)
      ids = [...new Set([...ids, ...((data || []) as { telegram_id: unknown }[]).map(r => String(r.telegram_id)).filter(s => /^-?\d{1,20}$/.test(s))])].slice(0, 50)
    } catch (e) { console.error('SEMANTIC_SYNC_OWNER_LIST_FAILED', (e as Error).message) }
  }
  let synced = 0, failed = 0
  for (const id of ids) {
    if (!semanticEnabledFor(id, env)) continue
    const n = Number(id)
    if (!Number.isSafeInteger(n) || n === 0) { failed++; continue } // ids beyond 2^53 are not converted; they wait for the string-keyed actor path
    try { const r = await syncSemanticForActor({ legacyTelegramId: n }); if (r) synced++ } catch (e) { failed++; console.error('SEMANTIC_SYNC_OWNER_FAILED', id, (e as Error).message) }
  }
  return { owners: ids.length, synced, failed }
}
