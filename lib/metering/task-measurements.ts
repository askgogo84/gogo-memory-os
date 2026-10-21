/** Bounded, privacy-safe task measurements. Missing observations never become zero cost. */
export function percentile(values: number[], fraction: number): number | null {
  const sorted = values.filter(v => Number.isFinite(v) && v >= 0).sort((a, b) => a - b)
  if (!sorted.length) return null
  return sorted[Math.max(0, Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1))]
}
const valid = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0
const currency = (v: unknown) => (typeof v === 'number' || (typeof v === 'string' && /^\d+(?:\.\d+)?$/.test(v))) && valid(Number(v))
const measured = (v: unknown): number | null => valid(v) ? v : null

export function summarizeMeteredTasks(owner: string, runs: any[], rows: any[], truncated = false) {
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

/** Fail closed on read errors and expose partial sampling, rather than silently report complete totals. */
export async function loadTaskMeasurements(owner: string, db: any, now = new Date()) {
  const since = new Date(now.getTime() - 30 * 86400_000).toISOString()
  const [{ data: runs, error: runError }, { data: rows, error: eventError }] = await Promise.all([
    db.from('agent_runs').select('id,telegram_id,status,started_at,completed_at').eq('telegram_id', owner)
      .gte('updated_at', since).order('updated_at', { ascending: false }).limit(101),
    db.from('admin_cost_events').select('id,telegram_id,vendor,category,model,input_tokens,output_tokens,cost_inr,ok,metadata')
      .eq('telegram_id', owner).gte('created_at', since).order('created_at', { ascending: false }).limit(5001),
  ])
  if (runError || eventError) throw new Error('task_measurements_unavailable')
  return { ...summarizeMeteredTasks(owner, (runs || []).slice(0, 100), (rows || []).slice(0, 5000), (runs || []).length > 100 || (rows || []).length > 5000), windowStart: since, windowEnd: now.toISOString() }
}
