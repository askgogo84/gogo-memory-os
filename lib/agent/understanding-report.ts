// Read-only report: pairs understand-first shadow readings with what production actually did
// (shadow_router_outcome, by event id) and computes agreement per action. No message text is selected.
import { supabaseAdmin } from '@/lib/supabase-admin'
import { compareUnderstandingToActual, type UnderstandingComparisonRow } from './understanding'

export async function getUnderstandingShadowReport(params: { hours?: number; limit?: number } = {}) {
  const hours = Math.max(1, Math.min(Number(params.hours || 24), 168))
  const limit = Math.max(20, Math.min(Number(params.limit || 2000), 5000))
  const since = new Date(Date.now() - hours * 3600_000).toISOString()
  const { data, error } = await supabaseAdmin.from('agent_activity')
    // Plain column select: the typed JSON-path select string (metadata_json->x) trips a TypeScript inference
    // quirk elsewhere in the program (reminder-read.ts / flight-status.ts read as never). Fields are picked below.
    .select('event_type,created_at,metadata_json')
    .in('event_type', ['understanding_shadow', 'shadow_router_outcome'])
    .gte('created_at', since)
    .order('created_at', { ascending: true })
    .limit(limit)
  if (error) throw new Error(`understanding_report_read_failed:${error.message}`)
  const readings = new Map<string, any>()
  const outcomes = new Map<string, string>()
  const latencies: number[] = []
  const sourceTimeouts = new Map<string, number>()
  for (const raw of (data || []) as any[]) {
    const m = raw.metadata_json || {}
    // Only these fields are read; user_text and slots in the same row are never touched by the report.
    const row = { event_type: raw.event_type, event_id: m.event_id, action: m.action, confidence: m.confidence, live: m.live, actual_handler: m.actual_handler, total_ms: m.total_ms, context_sources: m.context_sources }
    const id = String(row.event_id || '')
    if (!id) continue
    if (row.event_type === 'understanding_shadow') {
      readings.set(id, row)
      if (Number.isFinite(Number(row.total_ms))) latencies.push(Number(row.total_ms))
      for (const [name, status] of Object.entries(row.context_sources || {})) if (status === 'timeout' || status === 'error') sourceTimeouts.set(`${name}:${status}`, (sourceTimeouts.get(`${name}:${status}`) || 0) + 1)
    } else if (row.actual_handler && !outcomes.has(id)) outcomes.set(id, String(row.actual_handler))
  }
  const rows: UnderstandingComparisonRow[] = [...readings.entries()].map(([eventId, r]) => ({
    eventId,
    action: r.action ? String(r.action) : null,
    confidence: Number(r.confidence || 0),
    liveDispatched: r.live?.dispatched === true,
    actualHandler: outcomes.get(eventId) || null,
  }))
  latencies.sort((a, b) => a - b)
  const pct = (p: number) => latencies.length ? latencies[Math.min(latencies.length - 1, Math.floor(p * latencies.length))] : null
  return {
    windowHours: hours,
    generatedAt: new Date().toISOString(),
    comparison: compareUnderstandingToActual(rows),
    latencyMs: { p50: pct(0.5), p90: pct(0.9), p99: pct(0.99), samples: latencies.length },
    contextSourceFailures: Object.fromEntries(sourceTimeouts),
  }
}
