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
  for (const savedRow of task.metadata_json.providers) {
    // A persisted waiting reference is never proof of a current handoff. Clear
    // it first, then reconstruct it from this owner's live reservation below.
    const {waitingForRunId: _waiting, ...row} = savedRow
    if (row.reason === 'waiting for my browser to be free; it will start shortly.' ||
      (_waiting && row.reason === 'another browser task needs your attention. Finish or release it to let this store check start.')) delete row.reason
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
    rows.push({...providerObservation(row.provider, child, step,task.metadata_json.subject), startUrl: row.startUrl, ...(row.attempts ? {attempts: row.attempts} : {}), ...(row.leadUrl ? {leadUrl: row.leadUrl} : {})})
  }
  const blocker = rows.some(row => row.status === 'pending' && !PARALLEL_COMPARISON_PROVIDERS.has(row.provider))
    ? await sharedBrowserHandoffPending(owner) : null
  task.metadata_json = {...task.metadata_json, providers: rows.map(row => blocker && row.status === 'pending' && !PARALLEL_COMPARISON_PROVIDERS.has(row.provider)
    ? {...row, waitingForRunId: blocker, reason: 'another browser task needs your attention. Finish or release it to let this store check start.'} : row)}
  task.status = comparisonState(rows)
  return task
}

// Keep results in the reply; only a required human browser step needs an app link.
function reply(task: PriceComparison, intro?: string) {
  return {runId: task.id, status: task.status, capability: 'browser' as const, risk: 'low' as const,
    handledBy: 'price-comparison', text: intro || comparisonWhatsAppSummary(task, commerceOrigin())}
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

/** 19 Oct live: "Compare iPhone 17 prices" defaulted to 128GB although the owner's own price watch is for the
 *  iPhone 17 256GB (Instinct asked "256GB, any colour?"). When no size is named, reuse the size from the owner's
 *  active watch for exactly the same model and tier, and say where it came from. */
export function storageFromWatchTexts(subject: string, watchTexts: string[]): string | null {
  if (/\d\s*(?:gb|tb)\b/i.test(subject)) return null
  const m = subject.match(/\biPhone\s*(\d{1,2})((?:\s+(?:pro|max|plus|mini|air|e))*)\b/i)
  if (!m) return null
  const tier = m[2].trim().toLowerCase().split(/\s+/).filter(Boolean)
  const tierRe = tier.length ? '\\s+' + tier.join('\\s+') : ''
  const re = new RegExp(`\\biphone\\s*${m[1]}${tierRe}(?!\\s+(?:pro|max|plus|mini|air|e)\\b)\\s*(?:\\(|,|-)?\\s*(\\d{2,4})\\s*(gb|tb)\\b`, 'i')
  const sizes = new Set<string>()
  for (const text of watchTexts) { const hit = String(text || '').match(re); if (hit) sizes.add(`${hit[1]}${hit[2].toUpperCase()}`) }
  return sizes.size === 1 ? [...sizes][0] : null
}

async function ownerWatchStorage(owner: string, subject: string): Promise<string | null> {
  if (!/\biPhone\s*\d/i.test(subject) || /\d\s*(?:gb|tb)\b/i.test(subject)) return null
  const {data} = await supabaseAdmin.from('agent_watchers').select('condition_json').eq('telegram_id', owner).eq('active', true).limit(50)
  return storageFromWatchTexts(subject, (data || []).map((row: any) => JSON.stringify(row?.condition_json || {})))
}

function startedText(subject: string, providers: ComparisonProvider[], looks: Record<string, {quickPrice?: string}>, remembered: string | null = null) {
  const names = providers.map(p => COMPARISON_PROVIDERS[p].label)
  const list = names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] : names[0]
  const quick = providers.filter(p => looks[p]?.quickPrice).map(p => `• ${COMPARISON_PROVIDERS[p].label}: about ${looks[p].quickPrice}`)
  // 16 Oct: say which variant is compared (the base model when no size was named) and the pincode used, so the person can correct it.
  const pin = /^\d{6}$/.test(String(process.env.COMPARISON_PINCODE || '')) ? ` for PIN ${process.env.COMPARISON_PINCODE}` : ''
  // Default and say so: no size → 128GB; no tier word → the base model, never Pro/Pro Max/Air.
  const isPhone = /\biPhone\b/i.test(subject)
  const plainModel = isPhone && !/\b(?:pro|max|plus|mini|air|e)\b/i.test(subject)
  const base = isPhone && (plainModel || !/\d\s*(?:gb|tb)\b/i.test(subject))
    ? ` (${plainModel ? 'the standard model, not Pro/Pro Max/Air' : 'this model'}${/\d\s*(?:gb|tb)\b/i.test(subject) ? '' : ', 128GB'}, any colour; to change it, send the full name like “compare iPhone 17 Pro 256GB”)` : ''
  const why = remembered ? ` (${remembered} like your price watch, any colour; say a different size to change it)` : base
  return [`Checking *${subject}*${why} on ${list}${pin} now. I’ll send the confirmed prices here in about 2 minutes.`,
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
    const remembered = await ownerWatchStorage(owner, parsed.subject).catch(() => null)
    if (remembered) parsed.subject = `${parsed.subject} ${remembered}`
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
    const current = await readPriceComparison(owner, String(data.id))
    if (!current) throw new Error('comparison_missing_after_create')
    return reply(current, current.metadata_json.providers.some(row => row.waitingForRunId)
      ? undefined : startedText(parsed.subject, parsed.providers, looks, remembered))
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
  return probes.find((_row: unknown, index: number) => live[index])?.id || null
}

// Electronics stores are public product pages, each read in its own browser, so they run at the same time.
// Grocery and food stores share one browser that keeps the person's delivery location, so they run one by one.
const MAX_STORE_ATTEMPTS = 3
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
    const next = task.metadata_json.providers.find(row => row.status === 'pending' && (PARALLEL_COMPARISON_PROVIDERS.has(row.provider) || !sharedBusy) && !row.waitingForRunId)
    if (!next) { await saveProgress(owner, task); return {task, next: null as null} }
    const parallel = PARALLEL_COMPARISON_PROVIDERS.has(next.provider)
    const {prepareLinkedBrowserRead} = await import('@/lib/agent/browser-command')
    const startedAt = new Date().toISOString()
    let startUrl: string = COMPARISON_PROVIDERS[next.provider].url
    if (parallel) {
      // The quick web look at request time may already have found the product page.
      // A retry alternates between the found product page and the store's own search, so a bad start is not repeated.
      const known = (next.attempts || 1) % 2 === 1 && next.leadUrl && comparisonSource(next.provider, next.leadUrl)
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
    } else startUrl = comparisonSearchUrl(next.provider, task.metadata_json.subject) || startUrl
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
    // 16 Oct: "the page didn't finish loading" is not an answer. A store that failed is tried again (up to
    // three reads) before it is reported; one that needs the person's input or sign-in is not retried.
    task.metadata_json.providers = task.metadata_json.providers.map(row => row.status === 'failed' && (row.attempts || 1) < MAX_STORE_ATTEMPTS
      ? {provider: row.provider, status: 'pending' as const, attempts: (row.attempts || 1) + 1, ...(row.leadUrl ? {leadUrl: row.leadUrl} : {})} : row)
    task.metadata_json.providers = withStoreFallback(task.metadata_json) as any
    await saveProgress(owner, task)
    return task
  })
}

/** 23 Oct (owner): "If Amazon is not accessible, try the others." A single-store read whose store blocked the
 *  browser (not a sign-in or location ask) also checks the other electronics stores, once. */
export function withStoreFallback(meta: any) {
  const rows = Array.isArray(meta?.providers) ? meta.providers : []
  const only = rows.length === 1 ? rows[0] : null
  if (!only || meta.storeFallback || only.status !== 'blocked' || only.needsInput || !PARALLEL_COMPARISON_PROVIDERS.has(only.provider)) return rows
  meta.storeFallback = only.provider
  const others = ['flipkart', 'croma', 'reliance', 'amazon'].filter(p => p !== only.provider)
  return [...rows, ...others.map(provider => ({provider, status: 'pending', attempts: 1}))]
}

/** Run every store that can start now, at the same time, then send the result if it is finished. */
export async function advancePriceComparisonAll(actor: AgentActor, id: string) {
  const owner = String(actor.legacyTelegramId)
  for (let round = 0; round < 4; round++) {
    const task = await readPriceComparison(owner, id)
    if (!task) return null
    let pending = task.metadata_json.providers.filter(row => row.status === 'pending')
    if (!pending.length) {
      // 18 Oct: a store whose browser was cut off at the 300 s limit is read back as "interrupted" but was never
      // saved, so the comparison stayed "running" forever and the one-at-a-time cron kept picking it. Save it,
      // and give a store that has tries left another go.
      const settled = await withComparisonState(id, async () => {
        const fresh = await readPriceComparison(owner, id)
        if (!fresh) return null
        fresh.metadata_json.providers = fresh.metadata_json.providers.map(row => row.status === 'failed' && !row.evidence && (row.attempts || 1) < MAX_STORE_ATTEMPTS
          && /interrupted|lost/.test(String(row.reason || '')) ? {provider: row.provider, status: 'pending' as const, attempts: (row.attempts || 1) + 1, ...(row.leadUrl ? {leadUrl: row.leadUrl} : {})} : row)
        await saveProgress(owner, fresh)
        return fresh
      })
      if (!settled) return task
      pending = settled.metadata_json.providers.filter(row => row.status === 'pending')
      if (!pending.length) return settled
    }
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

