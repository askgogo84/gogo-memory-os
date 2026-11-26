import type { SupabaseClient } from '@supabase/supabase-js'
/** Bounded, privacy-safe task measurements. Missing observations never become zero cost. */
export function percentile(values: number[], fraction: number): number | null {
  const sorted = values.filter(v => Number.isFinite(v) && v >= 0).sort((a, b) => a - b)
  if (!sorted.length) return null
  return sorted[Math.max(0, Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1))]
}
const valid = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0
const currency = (v: unknown) => (typeof v === 'number' || (typeof v === 'string' && /^\d+(?:\.\d+)?$/.test(v))) && valid(Number(v))
const measured = (v: unknown): number | null => valid(v) ? v : null

type MeasuredRun={id:string;telegram_id?:string|number;status?:string;started_at?:string;completed_at?:string}
type MeasuredEvent={id?:string|number;telegram_id?:string|number;vendor?:string;category?:string;model?:string;input_tokens?:unknown;output_tokens?:unknown;cost_inr?:unknown;ok?:boolean;metadata?:{run_id?:string;pricing_status?:string;[key:string]:unknown};[key:string]:unknown}
export function summarizeMeteredTasks(owner: string, runs: MeasuredRun[], rows: MeasuredEvent[], truncated = false) {
  const owned = runs.filter(r => String(r.telegram_id) === owner)
  const completed = owned.filter(r => r.status === 'completed' && r.completed_at)
  const ownedRunIds = new Set(owned.map(r => r.id))
  const seen = new Set<string>()
  const events = rows.filter(row => {
    if (String(row.telegram_id) !== owner) return false
    if (row.id != null) { const id = String(row.id); if (seen.has(id)) return false; seen.add(id) }
    return true
  })
  const associated = events.filter(e => ownedRunIds.has(e.metadata?.run_id))
  const elapsed = completed.map(r => Date.parse(r.completed_at) - Date.parse(r.started_at)).filter(valid)
  const modelLatencies = associated.filter(e => e.category === 'llm').map(e => measured(e.metadata?.latency_ms)).filter(valid)
  const prices: number[] = [], knownSubtotals: number[] = []
  let unpricedTasks = 0, missingTasks = 0
  for (const run of completed) {
    const taskEvents = associated.filter(e => e.metadata?.run_id === run.id)
    if (!taskEvents.length) { missingTasks++; continue }
    const priced = taskEvents.filter(e => e.metadata?.pricing_status === 'estimated' && currency(e.cost_inr))
    const total = priced.reduce((sum, e) => sum + Number(e.cost_inr), 0)
    knownSubtotals.push(total)
    if (priced.length === taskEvents.length) prices.push(total)
    else unpricedTasks++
  }
  const tokens = (key: string, meta = false) => {
    const calls = associated.filter(e => e.category === 'llm')
    const values = calls.map(e => measured(meta ? e.metadata?.[key] : e[key])).filter(valid)
    return { total: values.length ? values.reduce((sum, n) => sum + n, 0) : null, measuredCalls: values.length, calls: calls.length }
  }
  const models = new Map<string, number>()
  for (const e of associated.filter(e => e.category === 'llm')) {
    const label = `${String(e.vendor || 'unknown').slice(0, 50)}/${String(e.model || 'unknown').slice(0, 100)}`
    models.set(label, (models.get(label) || 0) + 1)
  }
  return {
    schema: 'task-measurements-v1', coverage: 'attributed_events_only', truncated,
    completedTasks: completed.length, observedRuns: owned.length,
    attributedEvents: associated.length, unattributedEvents: events.length - associated.length,
    measuredCompletedTasks: completed.length - missingTasks, missingCompletedTasks: missingTasks,
    pricedAttributedTasks: prices.length, unpricedTasks,
    meanAttributedCostInrPerPricedTask: !truncated && prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : null,
    knownCompletedTaskCostInrSubtotal: !truncated && knownSubtotals.length ? knownSubtotals.reduce((a, b) => a + b, 0) : null,
    observedCostCoverageComplete: !truncated && completed.length > 0 && !missingTasks && !unpricedTasks,
    // This flag concerns observed rows only; uninstrumented calls cannot be proven absent.
    costScope: 'observed vendor estimates; excludes unattributed and uninstrumented calls',
    elapsedMs: { p50: truncated ? null : percentile(elapsed, .5), p95: truncated ? null : percentile(elapsed, .95), samples: elapsed.length, includesApprovalWait: true },
    modelLatencyMs: { p50: truncated ? null : percentile(modelLatencies, .5), p95: truncated ? null : percentile(modelLatencies, .95), samples: modelLatencies.length, scope: 'HTTP response headers, not full streamed completion' },
    inputTokens: tokens('input_tokens'), outputTokens: tokens('output_tokens'),
    cachedReadTokens: tokens('cached_read_tokens', true), cachedWriteTokens: tokens('cached_write_tokens', true),
    modelCalls: [...models].map(([model, calls]) => ({ model, calls })),
    failedAttempts: associated.filter(e => e.ok === false).length,
  }
}

/** Bound the report independently of the database's per-response row cap. */
export async function loadTaskMeasurements(owner: string, db: Pick<SupabaseClient,'from'>, now = new Date()) {
  const since = new Date(now.getTime() - 30 * 86400_000).toISOString()
  const until = now.toISOString()
  const runLimit = 100
  const eventLimit = 5000
  const pageSize = 1000
  const pageLimit = 10
  const readEvents = (offset: number, size: number, count?: 'exact') =>
    db.from('admin_cost_events').select('id,telegram_id,vendor,category,model,input_tokens,output_tokens,cost_inr,ok,metadata', { count })
      .eq('telegram_id', owner).gte('created_at', since).lte('created_at', until)
      .order('created_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + size - 1)

  const [{ data: runs, count: runCount, error: runError }, firstPage] = await Promise.all([
    db.from('agent_runs').select('id,telegram_id,status,started_at,completed_at', { count: 'exact' })
      .eq('telegram_id', owner).gte('updated_at', since).lte('updated_at', until)
      .order('updated_at', { ascending: false }).order('id', { ascending: false }).limit(runLimit),
    readEvents(0, pageSize, 'exact'),
  ])
  if (runError || !runs || runCount == null || firstPage.error || !firstPage.data || firstPage.count == null) {
    throw new Error('task_measurements_unavailable')
  }

  const expectedEvents = Math.min(firstPage.count, eventLimit)
  const rows: MeasuredEvent[] = [...firstPage.data]
  // Advance by the returned rows because the server may cap the requested range.
  for (let pages = 1; rows.length && rows.length < expectedEvents && pages < pageLimit; pages++) {
    const { data, error } = await readEvents(rows.length, Math.min(pageSize, expectedEvents - rows.length))
    if (error || !data) throw new Error('task_measurements_unavailable')
    if (!data.length) break
    rows.push(...data)
  }

  const duplicateEvents = new Set(rows.map(row => String(row.id))).size !== rows.length
  const truncated = runCount > runLimit || runs.length !== runCount
    || firstPage.count > eventLimit || rows.length !== expectedEvents || duplicateEvents
  return { ...summarizeMeteredTasks(owner, runs, rows, truncated), windowStart: since, windowEnd: until }
}
