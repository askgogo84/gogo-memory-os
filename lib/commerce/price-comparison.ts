import {supabaseAdmin} from '@/lib/supabase-admin'
import {acquireBrainUserLease, releaseBrainUserLease} from '@/lib/agent/brain-runtime-guard'
import type {AgentActor} from '@/lib/agent/actor'
import {commerceOrigin} from './providers'
import {COMPARISON_PROVIDERS, comparisonObjective, comparisonSource, comparisonState, comparisonSummary, isPriceComparisonStatus, parsePriceComparison, providerObservation, type PriceComparison} from './comparison-model'

const TYPE = 'price_comparison'
const SELECT = 'id,status,title,source,updated_at,metadata_json'
export const comparisonLink = (id: string) => commerceOrigin() + '/dashboard/comparisons/' + encodeURIComponent(id)

export async function readPriceComparison(owner: string, id: string): Promise<PriceComparison|null> {
  const {data, error} = await supabaseAdmin.from('agent_runs').select(SELECT)
    .eq('id', id).eq('telegram_id', owner).eq('type', TYPE).maybeSingle()
  if (error) throw new Error('comparison_read_failed')
  if (!data || !Array.isArray(data.metadata_json?.providers)) return null
  const task = data as PriceComparison
  const rows = []
  for (const row of task.metadata_json.providers) {
    if (!COMPARISON_PROVIDERS[row.provider]) continue
    if (!row.runId) { rows.push(row); continue }
    const {data: child, error: childError} = await supabaseAdmin.from('agent_runs')
      .select('id,status,summary,error,updated_at,metadata_json').eq('id', row.runId).eq('telegram_id', owner).eq('type', 'secure_browser').maybeSingle()
    if (childError) throw new Error('comparison_child_read_failed')
    if (!child || child.metadata_json?.comparison_parent_id !== id || child.metadata_json?.mode !== 'read' ||
      child.metadata_json?.url !== (comparisonSource(row.provider, row.startUrl) || COMPARISON_PROVIDERS[row.provider].url)) {
      rows.push({...row, status: 'failed' as const, evidence: undefined, sourceUrl: undefined, reason: 'The saved provider task is unavailable.'}); continue
    }
    if (row.status === 'checking' && !child.error && ['paused', 'running'].includes(child.status)) {
      if (Date.now() - Date.parse(row.startedAt || '') > 10 * 60_000) {
        rows.push({...row, status: 'failed' as const, reason: 'The browser check was interrupted; it is not still working.'})
      } else rows.push(row)
      continue
    }
    const {data: step, error: stepError} = await supabaseAdmin.from('agent_steps').select('status,output_json')
      .eq('run_id', child.id).eq('telegram_id', owner).eq('tool_name', 'secure_browser').limit(1).maybeSingle()
    if (stepError) throw new Error('comparison_evidence_read_failed')
    rows.push({...providerObservation(row.provider, child, step), startUrl: row.startUrl})
  }
  task.metadata_json = {...task.metadata_json, providers: rows}
  task.status = comparisonState(rows)
  return task
}

function reply(task: PriceComparison) {
  return {runId: task.id, status: task.status, capability: 'browser' as const, risk: 'low' as const,
    handledBy: 'price-comparison', text: comparisonSummary(task) + '\n\nSaved comparison: ' + comparisonLink(task.id)}
}

export async function tryPriceComparison(params: {telegramId: number; text: string; surface?: string}) {
  const parsed = parsePriceComparison(params.text)
  const status = isPriceComparisonStatus(params.text)
  if (!parsed && !status) return null
  const owner = String(params.telegramId)
  // Serialize duplicate inbound requests across dashboard and WhatsApp.
  const key = 'comparison-create:' + owner
  const lease = await acquireBrainUserLease(key, 30)
  if (!lease) return {runId: '', status: 'paused', capability: 'browser' as const, risk: 'low' as const,
    handledBy: 'price-comparison', text: 'A comparison request is being saved. Please check your latest price comparison shortly.'}
  try {
    let query = supabaseAdmin.from('agent_runs').select('id').eq('telegram_id', owner).eq('type', TYPE)
    if (parsed) query = query.eq('metadata_json->>request', parsed.request).in('status', ['queued', 'running'])
    const {data: existing, error: lookupError} = await query.order('started_at', {ascending: false}).limit(1).maybeSingle()
    if (lookupError) throw new Error('comparison_lookup_failed')
    if (existing) {
      const current = await readPriceComparison(owner, existing.id)
      if (current) return reply(current)
    }
    // Let existing food/grocery tasks answer their own status when there is no
    // saved multi-store comparison. Never manufacture a new task for a status read.
    if (!parsed && !/\b(?:price|shopping)\b/i.test(params.text)) return null
    if (!parsed) return {runId: '', status: 'paused', capability: 'browser' as const, risk: 'low' as const,
      handledBy: 'price-comparison', text: 'There is no saved price comparison yet.'}
    const now = new Date().toISOString()
    const {data, error} = await supabaseAdmin.from('agent_runs').insert({
      telegram_id: owner, type: TYPE, capability: 'browser', status: 'queued', title: parsed.subject,
      summary: 'Store checks are queued. No prices or delivered totals have been verified yet.',
      source: params.surface || 'whatsapp', progress: 0, started_at: now, updated_at: now,
      metadata_json: {request: parsed.request, subject: parsed.subject, providers: parsed.providers.map(provider => ({provider, status: 'pending'}))},
    }).select(SELECT).single()
    if (error || !data) throw new Error('comparison_create_failed')
    return reply(data as PriceComparison)
  } finally { await releaseBrainUserLease(key, lease.ownerToken) }
}

async function saveProgress(owner: string, task: PriceComparison) {
  const status = comparisonState(task.metadata_json.providers)
  const pending = task.metadata_json.providers.filter(row => ['pending', 'checking'].includes(row.status)).length
  const {error} = await supabaseAdmin.from('agent_runs').update({metadata_json: task.metadata_json,
    status, summary: comparisonSummary(task), progress: Math.round(100 * (1 - pending / task.metadata_json.providers.length)),
    updated_at: new Date().toISOString(), completed_at: pending ? null : new Date().toISOString(),
  }).eq('id', task.id).eq('telegram_id', owner).eq('type', TYPE)
  if (error) throw new Error('comparison_progress_save_failed')
}

// One provider per invocation fits the browser's bounded deadline. Durable child
// identity is stored BEFORE execution; a worker restart cannot repeat a purchase
// or create an untracked replacement. All work here is read-only.
export async function advancePriceComparison(actor: AgentActor, id: string) {
  const owner = String(actor.legacyTelegramId)
  const key = 'commerce-browser:' + owner
  const lease = await acquireBrainUserLease(key, 600)
  if (!lease) return null
  try {
    let task = await readPriceComparison(owner, id)
    if (!task) return null
    if (task.metadata_json.providers.some(row => row.status === 'checking')) return task
    const next = task.metadata_json.providers.find(row => row.status === 'pending')
    if (next) {
      const {prepareLinkedBrowserRead, resumePausedBrowserRun} = await import('@/lib/agent/browser-command')
      const startedAt = new Date().toISOString()
      let childId: string
      let startUrl: string = COMPARISON_PROVIDERS[next.provider].url
      if (['amazon', 'flipkart', 'croma'].includes(next.provider)) {
        const {searchWebResults} = await import('@/lib/web-search')
        const leads = await searchWebResults(task.metadata_json.subject, {includeDomains: [COMPARISON_PROVIDERS[next.provider].domain], timeoutMs: 10_000})
        // Discovery is not price evidence. Only observed retailer URLs are used;
        // never synthesize a product ID or trust a search snippet's price.
        const productPath = next.provider === 'amazon' ? /\/(?:dp|gp\/product)\// : next.provider === 'flipkart' ? /\/p\// : /\/p\//
        const candidate = leads.map(lead => comparisonSource(next.provider, lead.url)).find(url => url && productPath.test(new URL(url).pathname))
        if (candidate) startUrl = candidate
      }
      try {
        childId = await prepareLinkedBrowserRead({actor, surface: 'web', parentRunId: task.id, parentKind: 'comparison',
          url: startUrl, objective: comparisonObjective(task, next.provider)})
      } catch {
        task.metadata_json.providers = task.metadata_json.providers.map(row => row === next
          ? {...row, status: 'failed', reason: 'The provider browser could not be started.'} : row)
        await saveProgress(owner, task)
        return task
      }
      task.metadata_json.providers = task.metadata_json.providers.map(row => row === next
        ? {...row, runId: childId, status: 'checking', startedAt, startUrl} : row)
      await saveProgress(owner, task)
      // A failed provider must not throw away other providers or reroute to an LLM.
      try { await resumePausedBrowserRun({actor, runId: childId}) }
      catch {
        const {error} = await supabaseAdmin.from('agent_runs').update({status: 'failed', error: 'comparison_browser_failed',
          summary: 'The provider check could not finish.', updated_at: new Date().toISOString()})
          .eq('id', childId).eq('telegram_id', owner).in('status', ['running', 'paused'])
        if (error) throw new Error('comparison_failure_save_failed')
      }
      task = await readPriceComparison(owner, id)
      if (!task) throw new Error('comparison_missing_after_read')
    }
    await saveProgress(owner, task)
    return task
  } finally { await releaseBrainUserLease(key, lease.ownerToken) }
}

export async function assertComparisonChild(owner: string, parentId: string, childId: string) {
  const {data, error} = await supabaseAdmin.from('agent_runs').select('metadata_json')
    .eq('id', parentId).eq('telegram_id', owner).eq('type', TYPE).maybeSingle()
  if (error || !data?.metadata_json?.providers?.some((row: any) => row.runId === childId)) throw new Error('comparison_parent_unavailable')
}
