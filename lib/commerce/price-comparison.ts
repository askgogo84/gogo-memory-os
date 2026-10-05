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
    if (status) {
      const {data: saved, error} = await supabaseAdmin.from('agent_runs').select(SELECT).eq('telegram_id', owner).eq('type', TYPE)
        .order('started_at', {ascending: false}).limit(20)
      if (error) throw new Error('comparison_lookup_failed')
      const category = (row: PriceComparison) => row.metadata_json.providers.every(p => ['swiggy', 'zomato'].includes(p.provider)) ? 'food'
        : row.metadata_json.providers.every(p => ['instamart', 'zepto', 'blinkit'].includes(p.provider)) ? 'grocery' : 'shopping'
      const requestedProviders = Object.keys(COMPARISON_PROVIDERS).filter(key => new RegExp('\\b' + key + '\\b', 'i').test(params.text))
      const matching = (saved || []).filter(row => Array.isArray(row.metadata_json?.providers)
        && requestedProviders.every(key => row.metadata_json.providers.some((p: any) => p.provider === key))) as PriceComparison[]
      // A single readback may ask for several saved subjects across categories.
      // Match each named focus to its latest owned report, preserving request order.
      // Only saved comparison rows are read; this path never schedules a new check.
      const focusSpan = params.text.match(/\b(?:my|the)\s+(?:latest|saved|last|previous)\s+(.+?)\s+comparisons?\b/i)?.[1]
        || params.text.split(/[.!?\n]/)[0]
      const ignored = new Set(['show','check','what','which','tell','the','my','latest','saved','last','previous','final','status','of','for','and','or','price','prices','comparison','comparisons','provider','providers','verified','blocked','each','on','from','at','in','with','all','shopping','electronics'])
      const focuses = (focusSpan.match(/[a-z0-9]+(?:-[a-z0-9]+)*/gi) || []).map(word => word.toLowerCase())
        .filter(word => word.length >= 3 && !ignored.has(word) && !requestedProviders.includes(word))
      const selected:PriceComparison[]=[]
      for(const focus of focuses){
        const kind = /^(?:grocery|groceries)$/.test(focus) ? 'grocery' : focus === 'food' ? 'food' : null
        const row = matching.find(candidate => !selected.some(existing => existing.id === candidate.id) && (kind ? category(candidate) === kind
          : category(candidate) === 'shopping' && (candidate.metadata_json.subject || candidate.title || '').toLowerCase().match(/[a-z0-9]+(?:-[a-z0-9]+)*/g)?.includes(focus)))
        if(row) selected.push(row)
      }
      if(!selected.length){
        const requestedCategory = /\b(?:grocery|groceries)\b/i.test(params.text) ? 'grocery'
          : /\bfood\b/i.test(params.text) ? 'food' : /\b(?:shopping|electronics)\b/i.test(params.text) ? 'shopping' : null
        const row = matching.find(candidate => !requestedCategory || category(candidate) === requestedCategory)
        if(row)selected.push(row)
      }
      const reports = []
      for (const row of selected) {
        const current = await readPriceComparison(owner, row.id)
        if (current) reports.push(reply(current))
      }
      if (reports.length) return {...reports[0], text: reports.map(report => report.text).join('\n\n—\n\n')}
      if (!/\b(?:price|shopping)\b/i.test(params.text)) return null
      return {runId: '', status: 'paused', capability: 'browser' as const, risk: 'low' as const,
        handledBy: 'price-comparison', text: 'There is no matching saved price comparison yet.'}
    }
    let query = supabaseAdmin.from('agent_runs').select('id').eq('telegram_id', owner).eq('type', TYPE)
    if (parsed) query = query.eq('metadata_json->>request', parsed.request).in('status', ['queued', 'running'])
    const {data: existing, error: lookupError} = await query.order('started_at', {ascending: false}).limit(1).maybeSingle()
    if (lookupError) throw new Error('comparison_lookup_failed')
    if (existing) {
      const current = await readPriceComparison(owner, existing.id)
      if (current) return reply(current)
    }
    if (!parsed) return null
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

// The shared per-owner commerce browser can be reserved for a human takeover
// (e.g. a paused delivery-location handoff that preserves its reservation). While
// that reservation is live, starting another provider read only hits
// browser_handoff_in_use and looks like a failed retailer. Detect the reservation
// so dependent checks stay queued and resume automatically once it is released.
async function sharedBrowserHandoffPending(owner: string) {
  const {data, error} = await supabaseAdmin.from('agent_runs').select('id,metadata_json')
    .eq('telegram_id', owner).eq('type', 'secure_browser').eq('status', 'paused')
    .order('updated_at', {ascending: false}).limit(25)
  if (error) throw new Error('comparison_lease_probe_failed')
  return (data || []).some((row: any) => Boolean(row.metadata_json?.handoff?.releaseUrl))
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
      // Queue, do not fail, while a human handoff still reserves the shared browser.
      if (await sharedBrowserHandoffPending(owner)) {
        task.metadata_json.providers = task.metadata_json.providers.map(row => row.status === 'pending'
          ? {...row, reason: 'Waiting for the shared secure browser; another task is mid-handoff. This store stays queued and is not a failed retailer.'} : row)
        await saveProgress(owner, task)
        return task
      }
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

