import {supabaseAdmin} from '@/lib/supabase-admin'
import {acquireBrainUserLease, releaseBrainUserLease} from '@/lib/agent/brain-runtime-guard'
import type {AgentActor} from '@/lib/agent/actor'
import {commerceOrigin} from './providers'
import {COMPARISON_PROVIDERS, type ComparisonProvider, comparisonSearchUrl, comparisonObjective, comparisonProductLead, comparisonSource, comparisonState, comparisonSummary, comparisonWhatsAppSummary, isPriceComparisonStatus, parsePriceComparison, providerObservation, type PriceComparison} from './comparison-model'
import {indiaShoppingSearch, searchWebResults} from '@/lib/web-search'

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
      child.metadata_json?.url !== (comparisonSource(row.provider, row.startUrl)
        // A run may also start from the store's own search page for this subject (never any other URL).
        || (row.startUrl && row.startUrl === comparisonSearchUrl(row.provider, task.metadata_json.subject) ? row.startUrl : null)
        || COMPARISON_PROVIDERS[row.provider].url)) {
      rows.push({...row, status: 'failed' as const, evidence: undefined, sourceUrl: undefined, reason: 'this store check was lost; ask again.'}); continue
    }
    if (row.status === 'checking' && !child.error && ['paused', 'running'].includes(child.status)) {
      if (Date.now() - Date.parse(row.startedAt || '') > 10 * 60_000) {
        rows.push({...row, status: 'failed' as const, reason: 'the check was interrupted; ask again.'})
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

// 16 Oct: no app.askgogo.in link in the reply; the answer itself is the result.
function reply(task: PriceComparison, intro?: string) {
  return {runId: task.id, status: task.status, capability: 'browser' as const, risk: 'low' as const,
    handledBy: 'price-comparison', text: intro || comparisonWhatsAppSummary(task)}
}

/** Request-time web look for electronics: the product page to start from and the price its search result showed.
 *  A search snippet is never presented as confirmed; it is labelled and replaced by the store-page check. */
async function quickWebLook(subject: string, providers: ComparisonProvider[]) {
  const looks = await Promise.all(providers.filter(p => PARALLEL_COMPARISON_PROVIDERS.has(p)).map(async provider => {
    const results = await searchWebResults(subject, {includeDomains: [COMPARISON_PROVIDERS[provider].domain], timeoutMs: 6_000}).catch(() => [] as any[])
    const lead = comparisonProductLead(provider, subject, results || [])
    if (!lead) return null
    const hit: any = (results || []).find((r: any) => comparisonSource(provider, r?.url) === lead)
    const price = String(`${hit?.title || ''} ${hit?.snippet || ''}`).match(/₹\s?\d[\d,]*(?:\.\d{1,2})?/)?.[0]?.replace(/\s+/g, '')
    return {provider, leadUrl: lead, ...(price ? {quickPrice: price} : {})}
  }))
  return Object.fromEntries(looks.filter(Boolean).map((look: any) => [look.provider, look])) as Record<string, {leadUrl: string; quickPrice?: string}>
}

function startedText(subject: string, providers: ComparisonProvider[], looks: Record<string, {quickPrice?: string}>) {
  const names = providers.map(p => COMPARISON_PROVIDERS[p].label)
  const list = names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] : names[0]
  const quick = providers.filter(p => looks[p]?.quickPrice).map(p => `• ${COMPARISON_PROVIDERS[p].label}: about ${looks[p].quickPrice}`)
  return [`Checking *${subject}* on ${list} now. I’ll send the confirmed prices here in about 2 minutes.`,
    ...(quick.length ? ['', 'Quick look from a web search (not yet confirmed on the store pages):', ...quick] : [])].join('\n')
}

/** Search is a labelled fallback only; a snippet is never a live retailer quote. */
export async function comparisonWebFallback(task: PriceComparison): Promise<string> {
  const failed = task.metadata_json.providers.filter(row => row.status === 'failed')
  if (!failed.length) return ''
  const lines: string[] = []
  for (const row of failed.slice(0, 3)) {
    const provider = COMPARISON_PROVIDERS[row.provider]
    const scoped = indiaShoppingSearch(`${task.metadata_json.subject} price on ${provider.label}`)
    const results = await searchWebResults(scoped.query, {includeDomains: [provider.domain], timeoutMs: 10_000})
    const product = comparisonProductLead(row.provider, task.metadata_json.subject, results)
    if (product) lines.push(`${provider.label}: ${product}`)
  }
  // Plain wording (16 Oct): the old fallback text read as jargon on WhatsApp.
  return lines.length
    ? `The browser could not verify a live price there, so here is the product page from a web search. Open it to check the price yourself:\n${lines.join('\n')}`
    : ''
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
    const looks = await quickWebLook(parsed.subject, parsed.providers).catch(() => ({} as Record<string, {leadUrl: string; quickPrice?: string}>))
    const {data, error} = await supabaseAdmin.from('agent_runs').insert({
      telegram_id: owner, type: TYPE, capability: 'browser', status: 'queued', title: parsed.subject,
      summary: 'Store checks are queued. No prices or delivered totals have been verified yet.',
      source: params.surface || 'whatsapp', progress: 0, started_at: now, updated_at: now,
      metadata_json: {request: parsed.request, subject: parsed.subject, providers: parsed.providers.map(provider => ({provider, status: 'pending', ...(looks[provider] || {})}))},
    }).select(SELECT).single()
    if (error || !data) throw new Error('comparison_create_failed')
    // Open the stores now rather than on the next cron minute; the cron still picks it up if this fails.
    try { const {triggerComparisonRun} = await import('@/lib/agent/approved-browser-worker'); await triggerComparisonRun(String((data as any).id)) } catch {}
    return reply(data as PriceComparison, startedText(parsed.subject, parsed.providers, looks))
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
  const {browserHandoffIsLive} = await import('@/lib/agent/browser-handoff-health')
  // 16 Oct live: Blinkit asked for a delivery location during one comparison and its paused handoff kept a
  // later iPhone comparison "still checking" with no browser run at all. A comparison store that stopped
  // for location or sign-in is already reported as blocked; it must not hold every other comparison.
  const probes = (data || []).filter((row: any) => Boolean(row.metadata_json?.handoff?.takeoverUrl) && !row.metadata_json?.comparison_parent_id)
  const live = await Promise.all(probes.map((row: any) => browserHandoffIsLive(row.metadata_json.handoff.takeoverUrl)))
  return live.some(Boolean)
}

// Electronics stores are public product pages, each read in its own browser, so they run at the same time.
// Grocery and food stores share one browser that keeps the person's delivery location, so they run one by one.
export const PARALLEL_COMPARISON_PROVIDERS = new Set(['amazon', 'flipkart', 'croma', 'reliance'])

async function withComparisonState<T>(id: string, fn: () => Promise<T>): Promise<T | null> {
  // Parallel store checks update one saved comparison; every read-modify-write holds this short lease.
  const key = 'comparison-state:' + id
  for (let attempt = 0; attempt < 20; attempt++) {
    const lease = await acquireBrainUserLease(key, 30)
    if (lease) { try { return await fn() } finally { await releaseBrainUserLease(key, lease.ownerToken) } }
    await new Promise<void>(resolve => typeof globalThis.setTimeout === 'function' ? globalThis.setTimeout(resolve, 300) : resolve())
  }
  return null
}

// One provider per invocation fits the browser's bounded deadline. Durable child
// identity is stored BEFORE execution; a worker restart cannot repeat a purchase
// or create an untracked replacement. All work here is read-only.
export async function advancePriceComparison(actor: AgentActor, id: string) {
  const owner = String(actor.legacyTelegramId)
  // Claim the next store under the state lease, so two workers never pick the same one.
  const claimed = await withComparisonState(id, async () => {
    const task = await readPriceComparison(owner, id)
    if (!task) return null
    const sharedBusy = task.metadata_json.providers.some(row => row.status === 'checking' && !PARALLEL_COMPARISON_PROVIDERS.has(row.provider))
    const next = task.metadata_json.providers.find(row => row.status === 'pending' && (PARALLEL_COMPARISON_PROVIDERS.has(row.provider) || !sharedBusy))
    if (!next) { await saveProgress(owner, task); return {task, next: null as null} }
    const parallel = PARALLEL_COMPARISON_PROVIDERS.has(next.provider)
    // Queue, do not fail, while a human handoff still reserves the shared browser.
    if (!parallel && await sharedBrowserHandoffPending(owner)) {
      task.metadata_json.providers = task.metadata_json.providers.map(row => row.status === 'pending'
        ? {...row, reason: 'waiting for my browser to be free; it will start shortly.'} : row)
      await saveProgress(owner, task)
      return {task, next: null as null}
    }
    const {prepareLinkedBrowserRead} = await import('@/lib/agent/browser-command')
    const startedAt = new Date().toISOString()
    let startUrl: string = COMPARISON_PROVIDERS[next.provider].url
    if (parallel) {
      // The quick web look at request time may already have found the product page.
      const known = next.leadUrl && comparisonSource(next.provider, next.leadUrl)
      let candidate: string | null = known || null
      if (!candidate) {
        const {searchWebResults} = await import('@/lib/web-search')
        const leads = await searchWebResults(task.metadata_json.subject, {includeDomains: [COMPARISON_PROVIDERS[next.provider].domain], timeoutMs: 10_000})
        // Discovery is not price evidence. Only observed retailer URLs are used;
        // never synthesize a product ID or trust a search snippet's price.
        candidate = comparisonProductLead(next.provider, task.metadata_json.subject, leads)
      }
      // 16 Oct live: with no product page found, Croma's home-page search box never ran the search.
      // Start from the store's own results page instead; the product page is still required as evidence.
      if (candidate) startUrl = candidate
      else startUrl = comparisonSearchUrl(next.provider, task.metadata_json.subject) || startUrl
    }
    let childId: string
    try {
      childId = await prepareLinkedBrowserRead({actor, surface: 'web', parentRunId: task.id, parentKind: 'comparison',
        url: startUrl, objective: comparisonObjective(task, next.provider)})
    } catch {
      task.metadata_json.providers = task.metadata_json.providers.map(row => row === next
        ? {...row, status: 'failed', reason: 'my browser couldn’t start for this store.'} : row)
      await saveProgress(owner, task)
      return {task, next: null as null}
    }
    task.metadata_json.providers = task.metadata_json.providers.map(row => row === next
      ? {...row, runId: childId, status: 'checking', startedAt, startUrl} : row)
    await saveProgress(owner, task)
    return {task, next: {provider: next.provider, childId, parallel}}
  })
  if (!claimed) return null
  if (!claimed.next) return claimed.task
  const {childId, parallel, provider} = claimed.next
  // The shared grocery browser takes one store at a time; each electronics store has its own browser lane.
  const laneKey = 'commerce-browser:' + owner + (parallel ? ':' + provider : '')
  const lane = await acquireBrainUserLease(laneKey, 600)
  if (!lane) return claimed.task
  try {
    const {resumePausedBrowserRun} = await import('@/lib/agent/browser-command')
    // A failed provider must not throw away other providers or reroute to an LLM.
    try { await resumePausedBrowserRun({actor, runId: childId}) }
    catch {
      const {error} = await supabaseAdmin.from('agent_runs').update({status: 'failed', error: 'comparison_browser_failed',
        summary: 'The provider check could not finish.', updated_at: new Date().toISOString()})
        .eq('id', childId).eq('telegram_id', owner).in('status', ['running', 'paused'])
      if (error) throw new Error('comparison_failure_save_failed')
    }
  } finally { await releaseBrainUserLease(laneKey, lane.ownerToken) }
  return withComparisonState(id, async () => {
    const task = await readPriceComparison(owner, id)
    if (!task) throw new Error('comparison_missing_after_read')
    await saveProgress(owner, task)
    return task
  })
}

/** Run every store that can start now, at the same time, then send the result if it is finished. */
export async function advancePriceComparisonAll(actor: AgentActor, id: string) {
  const owner = String(actor.legacyTelegramId)
  for (let round = 0; round < 4; round++) {
    const task = await readPriceComparison(owner, id)
    if (!task) return null
    const pending = task.metadata_json.providers.filter(row => row.status === 'pending')
    if (!pending.length) return task
    const lanes = pending.filter(row => PARALLEL_COMPARISON_PROVIDERS.has(row.provider)).length
      + (pending.some(row => !PARALLEL_COMPARISON_PROVIDERS.has(row.provider)) ? 1 : 0)
    await Promise.all(Array.from({length: Math.max(1, lanes)}, () => advancePriceComparison(actor, id).catch((error: any) => {
      console.error('PRICE_COMPARISON_LANE_FAILED:', {runId: id, error: error instanceof Error ? error.message : 'unknown'})
      return null
    })))
  }
  return readPriceComparison(owner, id)
}

/** Started right after the request (internal route), so the first store opens at once instead of on the next minute. */
export async function runComparisonNow(id: string) {
  const {data, error} = await supabaseAdmin.from('agent_runs').select('telegram_id').eq('id', id).eq('type', TYPE).maybeSingle()
  if (error || !data) return 'missing'
  const {resolveAgentActor} = await import('@/lib/agent/actor')
  const actor = await resolveAgentActor({telegramId: String(data.telegram_id), surface: 'web'})
  const task = await advancePriceComparisonAll(actor, id)
  if (!task || comparisonState(task.metadata_json.providers) === 'queued') return task ? 'queued' : 'missing'
  const {deliverCompletedComparison} = await import('./comparison-delivery')
  return deliverCompletedComparison(task, actor, Date.now() + 60_000)
}

export async function assertComparisonChild(owner: string, parentId: string, childId: string) {
  const {data, error} = await supabaseAdmin.from('agent_runs').select('metadata_json')
    .eq('id', parentId).eq('telegram_id', owner).eq('type', TYPE).maybeSingle()
  if (error || !data?.metadata_json?.providers?.some((row: any) => row.runId === childId)) throw new Error('comparison_parent_unavailable')
}

