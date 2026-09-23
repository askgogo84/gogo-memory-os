import { supabaseAdmin } from '@/lib/supabase-admin'
import { getCostBudget } from '@/lib/services/cost-guard'
import { buildGmailConnectUrl } from '@/lib/services/google-gmail'
import { clearFollowupState, getLatestFollowupState, isStrictlyFreshFollowupState, saveFollowupState } from '@/lib/bot/handlers/followup-state'
import type { AgentActor } from './actor'
import type { AgentSurface } from './orchestrator'
import { createInboxTriageWatcher, createProductStockWatcher, createWebPageWatcher, createWebSearchWatcher, normalizeProductStockWatcher, normalizeWebPageWatcher, normalizeWebSearchWatcher } from './watchers'
import { initialWatcherCadence, isUrgentWatchRequest, watcherUpgradeMessage } from './watch-cost-policy'

function clean(value: unknown, max = 1000) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max)
}


function canonicalWatchUrl(value:string) {
  try {
    const u=new URL(value)
    if(!['http:','https:'].includes(u.protocol))return ''
    u.hash=''
    return u.toString()
  } catch { return '' }
}

export function parseWebPageWatchCommand(text:string) {
  const raw=clean(text,2000)
  if(!raw)return null
  const urlMatch=raw.match(/https?:\/\/[^\s<>]+/i)
  const url=canonicalWatchUrl(String(urlMatch?.[0]||'').replace(/[),.;!?]+$/g,''))
  if(!url)return null
  const watcherIntent=/\b(watch|monitor|track|keep\s+an\s+eye|let\s+me\s+know|tell\s+me|notify\s+me|alert\s+me)\b/i.test(raw)
  if(!watcherIntent)return null
  const titleIntent=/\b(page\s+title|title)\b/i.test(raw)
  const changeIntent=/\b(change|changes|changed|update|updates|different|modified)\b/i.test(raw)
  if(!changeIntent && !/\bwatch|monitor|track\b/i.test(raw))return null
  let label='Web page'
  try{label=new URL(url).hostname.replace(/^www\./,'')}catch{}
  return normalizeWebPageWatcher({
    title:`Watch: ${label}`,
    url,
    watch:titleIntent?'title':'content',
    delivery:'both',
    cadenceMinutes:60,
  })
}

function isWatcherStatusQuery(text:string) {
  const raw=clean(text,400).toLowerCase()
  return /^(?:what|which)\s+(?:are\s+you\s+)?(?:monitoring|watching|tracking)(?:\s+for\s+me)?\??$/.test(raw)
    || /^(?:show|list)\s+(?:my\s+)?(?:monitors?|watchers?|watches)\??$/.test(raw)
    || /^what\s+(?:monitors?|watchers?|watches)\s+(?:do\s+i\s+have|are\s+active)\??$/.test(raw)
}

export async function tryGetWatcherStatusFromCommand(params:{actor:AgentActor;text:string}) {
  if(!isWatcherStatusQuery(params.text))return null
  const tg=String(params.actor.legacyTelegramId)
  const {data,error}=await supabaseAdmin.from('agent_watchers')
    .select('id,type,condition_json,cadence_minutes,last_checked_at,next_check_at,active,created_at,updated_at')
    .eq('telegram_id',tg)
    .eq('active',true)
    .order('created_at',{ascending:false})
    .limit(12)
  if(error)throw new Error(`watcher_status_read_failed:${error.message}`)
  if(!data?.length) {
    return {
      runId:'watcher-status-none',status:'completed' as const,capability:'browser' as const,risk:'low' as const,
      text:'You do not have any active background monitors right now.',
      handledBy:'watcher-status',
    }
  }
  const lines=data.map((row:any,index:number)=>{
    const condition:any=row.condition_json||{}
    let label=String(condition.title||row.type||'Watch')
    if(row.type==='web_page') label=`${label} — ${condition.watch==='title'?'page title':'page content'}`
    else if(row.type==='web_search') label=`${label} — web search`
    else if(row.type==='product_stock') label=`${label} — ${condition.variant||'stock'}`
    else if(row.type==='email_triage') label='Inbox action watch'
    const cadence=Math.max(1,Number(row.cadence_minutes||60))
    return `${index+1}. ${label} — active, checking about every ${cadence} min`
  })
  return {
    runId:'watcher-status-active',status:'watching' as const,capability:'browser' as const,risk:'low' as const,
    text:`🔎 *Active background monitors*\n\n${lines.join('\n')}\n\nSay *stop monitoring that* to stop the most recent one.`,
    handledBy:'watcher-status',
  }
}

function stopWatcherIntent(text:string) {
  const raw=clean(text,400).toLowerCase()
  if(/^(?:stop|cancel|remove|disable)\s+(?:all\s+)?(?:monitoring|watching|tracking|monitors?|watchers?|watches)\b/.test(raw))return raw.includes('all')?'all':'latest'
  if(/^(?:stop|cancel|remove|disable)\s+(?:monitoring|watching|tracking)\s+(?:that|it|this)\b/.test(raw))return 'latest'
  if(/^(?:stop|cancel)\s+(?:that|this)\s+(?:watch|monitor)\b/.test(raw))return 'latest'
  return null
}

export async function tryStopWatcherFromCommand(params:{actor:AgentActor;text:string}) {
  const intent=stopWatcherIntent(params.text)
  if(!intent)return null
  const tg=String(params.actor.legacyTelegramId)
  if(intent==='all'){
    const {data,error}=await supabaseAdmin.from('agent_watchers').update({active:false,next_check_at:null,updated_at:new Date().toISOString()})
      .eq('telegram_id',tg).eq('active',true).select('id')
    if(error)throw new Error(`watcher_stop_failed:${error.message}`)
    return {runId:'watcher-stop-all',status:'completed' as const,capability:'browser' as const,risk:'low' as const,text:`Stopped ${data?.length||0} active background monitor${data?.length===1?'':'s'}.`,handledBy:'watcher-stop'}
  }
  const {data:latest,error:readError}=await supabaseAdmin.from('agent_watchers')
    .select('id,type,condition_json,created_at').eq('telegram_id',tg).eq('active',true).order('created_at',{ascending:false}).limit(1).maybeSingle()
  if(readError)throw new Error(`watcher_stop_read_failed:${readError.message}`)
  if(!latest?.id)return {runId:'watcher-stop-none',status:'completed' as const,capability:'browser' as const,risk:'low' as const,text:'There is no active background monitor to stop.',handledBy:'watcher-stop'}
  const {error}=await supabaseAdmin.from('agent_watchers').update({active:false,next_check_at:null,updated_at:new Date().toISOString()}).eq('id',latest.id).eq('telegram_id',tg)
  if(error)throw new Error(`watcher_stop_failed:${error.message}`)
  return {runId:`watcher-stop-${latest.id}`,status:'completed' as const,capability:'browser' as const,risk:'low' as const,text:`Stopped ${String((latest.condition_json as any)?.title||'that monitor')}.`,handledBy:'watcher-stop'}
}

export function parseWebWatchCommand(text: string) {
  const raw = clean(text, 2000)
  if (!raw) return null

  const patterns = [
    /^(?:please\s+)?(?:watch|monitor|track)\s+(?:the\s+)?(?:web|internet|online)\s+(?:for\s+)?(.+)$/i,
    /^(?:please\s+)?watch\s+(.+?)\s+(?:online|on\s+the\s+web)(?:\s+.*)?$/i,
  ]
  let query = ''
  for (const re of patterns) {
    const m = raw.match(re)
    if (m?.[1]) { query = m[1]; break }
  }
  if (!query) return null

  query = query
    .replace(/\s+(?:and\s+)?(?:tell|notify|alert|let)\s+me\s+(?:know\s+)?(?:when|if)\b.*$/i, '')
    .replace(/\s+and\s+message\s+me\b.*$/i, '')
    .trim()
  if (query.length < 3) return null

  const keywordMatch = raw.match(/(?:when|if)\s+(?:you\s+)?(?:see|find|spot|there(?:'s|\s+is))\s+(.+)$/i)
  const triggerKeywords = keywordMatch?.[1]
    ? keywordMatch[1].split(/,|\bor\b/i).map(x => x.trim()).filter(x => x.length >= 2).slice(0, 8)
    : []

  return normalizeWebSearchWatcher({
    title: `Watch: ${query.slice(0, 120)}`,
    query,
    triggerKeywords,
    delivery: 'both',
    cadenceMinutes: 15,
  })
}


export function parseInboxTriageWatchCommand(text:string) {
  const raw=clean(text,1200)
  if(!raw)return null
  const mailbox=/\b(mail|email|emails|gmail|inbox)\b/i.test(raw)
  const persistent=/\b(quietly|keep\s+an\s+eye|watch|monitor|scan|check|read)\b/i.test(raw)
  const actionFocus=/\b(action|actions|actionable|needs?\s+(?:my\s+)?attention|need\s+to\s+do|steps?\s+to\s+take|tell\s+me\s+what\s+to\s+do|important)\b/i.test(raw)
  if(!mailbox||!persistent||!actionFocus)return null
  return {title:'Inbox action watch',delivery:'whatsapp' as const,cadenceMinutes:60}
}

export async function tryCreateInboxTriageWatchFromCommand(params:{
  actor:AgentActor
  surface:AgentSurface
  text:string
}) {
  const parsed=parseInboxTriageWatchCommand(params.text)
  if(!parsed)return null
  const tg=String(params.actor.legacyTelegramId)

  const {data:user,error:userError}=await supabaseAdmin.from('users')
    .select('gmail_connected')
    .eq('telegram_id',params.actor.legacyTelegramId)
    .maybeSingle()
  if(userError)throw new Error(`inbox_watch_user_read_failed:${userError.message}`)
  if(!user?.gmail_connected) {
    const connect=buildGmailConnectUrl(params.actor.legacyTelegramId)
    return {
      runId:'inbox-watch-needs-google',
      status:'paused' as const,
      capability:'email' as const,
      risk:'low' as const,
      text:connect
        ? `I can do that, but Google Workspace needs to be connected first. Connect it here: ${connect}\n\nI’ll only request read-only Gmail access for this inbox watch.`
        : 'I can do that, but Google Workspace needs to be connected first.',
      blockedReason:'workspace_not_connected',
      handledBy:'inbox-triage-watch',
    }
  }

  const {data:existing,error:existingError}=await supabaseAdmin.from('agent_watchers')
    .select('id,active')
    .eq('telegram_id',tg)
    .eq('type','email_triage')
    .eq('active',true)
    .limit(1)
    .maybeSingle()
  if(existingError)throw new Error(`inbox_watch_read_failed:${existingError.message}`)
  if(existing?.id) {
    return {
      runId:`inbox-watch-existing-${existing.id}`,
      status:'completed' as const,
      capability:'email' as const,
      risk:'low' as const,
      text:'Your inbox watch is already active. I’m quietly checking hourly and I’ll only message when a new email looks like it needs action.',
      handledBy:'inbox-triage-watch',
    }
  }

  const condition={...parsed}
  const now=new Date().toISOString()
  const {data:run,error:runError}=await supabaseAdmin.from('agent_runs').insert({
    telegram_id:tg,type:'watcher',capability:'email',status:'completed',
    title:'Watch inbox for action items',
    summary:'Gogo will quietly scan recent inbox mail and surface only new action items.',
    progress:100,
    why:'You asked Gogo to keep an eye on your inbox and tell you what needs action.',
    source:params.surface,
    metadata_json:{input_text:clean(params.text,1200),watcher_type:'email_triage',cadence_minutes:60,read_only:true},
    started_at:now,updated_at:now,
  }).select('id').single()
  if(runError||!run?.id)throw new Error(`agent_run_create_failed:${runError?.message||'unknown'}`)

  const watcher=await createInboxTriageWatcher({telegramId:tg,condition})
  await supabaseAdmin.from('agent_activity').insert({
    telegram_id:tg,run_id:String(run.id),event_type:'watcher_created',
    message:'Gogo started a quiet read-only inbox action watch.',
    metadata_json:{watcher_id:watcher.id,type:'email_triage',cadence_minutes:60,read_only:true},
  })

  return {
    runId:String(run.id),
    status:'completed' as const,
    capability:'email' as const,
    risk:'low' as const,
    text:'Done — I’ll quietly check your inbox hourly and only message when a new email looks like it needs your attention. I’ll give you the next steps. I will not reply, send, delete, archive, approve, pay, or change anything without you.',
    handledBy:'inbox-triage-watch',
  }
}

function canonicalProductUrl(value: string) {
  try {
    const url = new URL(value)
    if (!['http:','https:'].includes(url.protocol)) return ''
    url.hash = ''
    for (const key of Array.from(url.searchParams.keys())) {
      if (/^(utm_|fbclid|gclid|mc_)/i.test(key)) url.searchParams.delete(key)
    }
    return url.toString()
  } catch {
    return ''
  }
}

function productLabelFromUrl(value: string) {
  try {
    const url = new URL(value)
    const slug = url.pathname.split('/').filter(Boolean).pop() || url.hostname
    return slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase()).slice(0, 100)
  } catch {
    return 'Product'
  }
}

export function parseProductStockWatchCommand(text: string): ReturnType<typeof normalizeProductStockWatcher> {
  const raw = clean(text, 2500)
  if (!raw) return null
  const urlMatch = raw.match(/https?:\/\/[^\s<>]+/i)
  const productUrl = canonicalProductUrl(String(urlMatch?.[0] || '').replace(/[),.;!?]+$/g, ''))
  if (!productUrl) return null

  const watcherIntent = /\b(alert|notify|tell\s+me|let\s+me\s+know|watch|monitor|track)\b/i.test(raw)
  const availabilityIntent = /\b(in\s+stock|back\s+in\s+stock|available|availability|comes?\s+(?:back\s+)?up|becomes?\s+available)\b/i.test(raw)
  if (!watcherIntent || !availabilityIntent) return null

  const variantMatch =
    raw.match(/\b(?:in\s+)?(XXXS|XXS|XS|S|M|L|XL|XXL|XXXL|3XL|4XL|5XL)\s+size\b/i)
    || raw.match(/\bsize\s*[:=-]?\s*(XXXS|XXS|XS|S|M|L|XL|XXL|XXXL|3XL|4XL|5XL)\b/i)
  const variant = clean(variantMatch?.[1] || '', 40).toUpperCase()
  if (!variant) return null

  const addToCart = /\b(?:add|put)\s+(?:it|this|the\s+(?:item|product))\s+(?:to|in)\s+(?:my\s+)?(?:cart|bag|basket)\b/i.test(raw)
    || /\badd\s+to\s+(?:my\s+)?(?:cart|bag|basket)\b/i.test(raw)

  return normalizeProductStockWatcher({
    title: `${productLabelFromUrl(productUrl)} — ${variant}`,
    productUrl,
    variant,
    addToCart,
    delivery:'both',
    cadenceMinutes:60,
  })
}

async function browserWatchAllowed(telegramId: number) {
  const { data, error } = await supabaseAdmin.from('agent_permissions')
    .select('level')
    .eq('telegram_id', String(telegramId))
    .eq('capability', 'browser')
    .maybeSingle()
  if (error) throw new Error(`agent_permission_unavailable:${error.message}`)
  return String(data?.level || 'draft') !== 'off'
}


export async function tryCreateProductStockWatchFromCommand(params: {
  actor: AgentActor
  surface: AgentSurface
  text: string
}) {
  const tg = String(params.actor.legacyTelegramId)
  let parsed = parseProductStockWatchCommand(params.text)
  let recoveredWatcher:any = null

  // Natural follow-up: allow users to restart a known product watch without
  // pasting the URL again ("Monitor the Senses ... page for size XL").
  if (!parsed) {
    const raw=clean(params.text,1800)
    const watcherIntent=/\b(alert|notify|tell\s+me|let\s+me\s+know|watch|monitor|track)\b/i.test(raw)
    const availabilityIntent=/\b(in\s+stock|back\s+in\s+stock|available|availability|comes?\s+(?:back\s+)?up|becomes?\s+available)\b/i.test(raw)
    const vm=raw.match(/\b(?:in\s+)?(XXXS|XXS|XS|S|M|L|XL|XXL|XXXL|3XL|4XL|5XL)\s+size\b/i)
      ||raw.match(/\bsize\s*[:=-]?\s*(XXXS|XXS|XS|S|M|L|XL|XXL|XXXL|3XL|4XL|5XL)\b/i)
    const wantedVariant=clean(vm?.[1]||'',40).toUpperCase()
    if(watcherIntent&&availabilityIntent&&wantedVariant){
      const {data:recent,error:recentError}=await supabaseAdmin.from('agent_watchers')
        .select('id,active,condition_json,updated_at')
        .eq('telegram_id',tg).eq('type','product_stock')
        .order('updated_at',{ascending:false}).limit(12)
      if(recentError)throw new Error(`agent_watcher_context_read_failed:${recentError.message}`)
      const textTokens=new Set(raw.toLowerCase().replace(/[^a-z0-9]+/g,' ').split(/\s+/).filter(t=>t.length>3&&!['monitor','watch','alert','notify','available','availability','size','page','when','this','that'].includes(t)))
      const ranked=(recent||[]).map((row:any)=>{
        const condition=normalizeProductStockWatcher(row.condition_json)
        if(!condition||condition.variant.toUpperCase()!==wantedVariant)return null
        const titleTokens=String(condition.title||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').split(/\s+/).filter((t:string)=>t.length>3)
        const overlap=titleTokens.filter((t:string)=>textTokens.has(t)).length
        return {row,condition,overlap}
      }).filter(Boolean).sort((a:any,b:any)=>b.overlap-a.overlap)
      const best:any=ranked[0]
      if(best&&best.overlap>=2){
        parsed={...best.condition,addToCart:/\badd\s+(?:it|this|the\s+(?:item|product))?\s*(?:to|in)\s+(?:my\s+)?(?:cart|bag|basket)\b/i.test(raw)||best.condition.addToCart}
        recoveredWatcher=best.row
      }
    }
    if(!parsed)return null
  }

  if (!(await browserWatchAllowed(params.actor.legacyTelegramId))) {
    return {
      runId:'product-watch-blocked',
      status:'paused' as const,
      capability:'browser' as const,
      risk:'low' as const,
      text:'Browser monitoring is off in Gogo Safe Mode. Turn Browser access back on to watch this product.',
      blockedReason:'browser_permission_off',
      handledBy:'product-stock-watch',
    }
  }

  const budget = await getCostBudget(tg)
  if (budget.activeWebWatchersMax <= 0) {
    return {
      runId:'product-watch-plan-blocked',
      status:'paused' as const,
      capability:'browser' as const,
      risk:'low' as const,
      text:watcherUpgradeMessage(budget.planCode),
      blockedReason:'plan_background_watch_unavailable',
      handledBy:'product-stock-watch',
    }
  }

  if(recoveredWatcher?.id){
    if(recoveredWatcher.active){
      return {
        runId:`product-watch-existing-${recoveredWatcher.id}`,
        status:'completed' as const, capability:'browser' as const, risk:'low' as const,
        text:`I’m already watching ${parsed.title}. I’ll alert you only when ${parsed.variant} is verifiably available.`,
        handledBy:'product-stock-watch',
      }
    }
    const now=new Date().toISOString()
    const {error:restartError}=await supabaseAdmin.from('agent_watchers').update({
      active:true,next_check_at:now,last_checked_at:null,
      condition_json:{...parsed,cadenceMinutes:60},
      last_state_json:{availability:'unknown',blockedNotified:false,cartAttempted:false,quietChecks:0,restartedAt:now},
      updated_at:now,
    }).eq('id',recoveredWatcher.id).eq('telegram_id',tg)
    if(restartError)throw new Error(`agent_watcher_restart_failed:${restartError.message}`)
    await supabaseAdmin.from('agent_activity').insert({
      telegram_id:tg,event_type:'watcher_restarted',
      message:`Gogo restarted ${parsed.title} for ${parsed.variant} availability.`.slice(0,900),
      metadata_json:{watcher_id:recoveredWatcher.id,type:'product_stock',variant:parsed.variant,product_url:parsed.productUrl},
    })
    return {
      runId:`product-watch-restarted-${recoveredWatcher.id}`,
      status:'completed' as const,capability:'browser' as const,risk:'low' as const,
      text:`Restarted — I’ll check hourly and alert you only when ${parsed.variant} is verifiably available on ${parsed.title}.`,
      handledBy:'product-stock-watch',
    }
  }

  const { data: existing, error: existingError } = await supabaseAdmin.from('agent_watchers')
    .select('id, condition_json')
    .eq('telegram_id', tg)
    .eq('type', 'product_stock')
    .eq('active', true)
  if (existingError) throw new Error(`agent_watcher_read_failed:${existingError.message}`)
  const duplicate = (existing || []).find((row:any) => {
    const condition = normalizeProductStockWatcher(row.condition_json)
    return condition
      && condition.productUrl === parsed.productUrl
      && condition.variant.toLowerCase() === parsed.variant.toLowerCase()
  })
  if (duplicate) {
    return {
      runId:`product-watch-existing-${duplicate.id}`,
      status:'completed' as const,
      capability:'browser' as const,
      risk:'low' as const,
      text:`I’m already watching ${parsed.title}. I’ll alert you when ${parsed.variant} is available${parsed.addToCart ? ' and try to add it to your cart' : ''}. I will not checkout or pay without your approval.`,
      handledBy:'product-stock-watch',
    }
  }

  const { count, error: countError } = await supabaseAdmin.from('agent_watchers')
    .select('id', { count:'exact', head:true })
    .eq('telegram_id', tg)
    .in('type', ['web_search','web_page','product_stock'])
    .eq('active', true)
  if (countError) throw new Error(`agent_watcher_count_failed:${countError.message}`)
  const activeWatcherCount = count || 0
  if (activeWatcherCount >= budget.activeWebWatchersMax) {
    return {
      runId:'product-watch-plan-limit',
      status:'paused' as const,
      capability:'browser' as const,
      risk:'low' as const,
      text:watcherUpgradeMessage(budget.planCode),
      blockedReason:'plan_background_watch_limit',
      handledBy:'product-stock-watch',
    }
  }

  // Product-stock watches deliberately use an hourly baseline. This is frequent
  // enough to be useful without hammering merchant sites or making account/bot
  // protection more likely to trigger. The cost guard may defer checks when the
  // user's plan is exhausted, but ordinary stock watches stay hourly.
  const cadenceMinutes = 60
  const condition = { ...parsed, cadenceMinutes }
  const now = new Date().toISOString()
  const { data: run, error: runError } = await supabaseAdmin.from('agent_runs').insert({
    telegram_id:tg,
    type:'watcher',
    capability:'browser',
    status:'completed',
    title:`Watch ${condition.title}`,
    summary:`Gogo will monitor ${condition.variant} availability and alert you when the condition is met.`,
    progress:100,
    why:'You asked Gogo to keep watching a product instead of checking the shop manually.',
    source:params.surface,
    metadata_json:{
      input_text:clean(params.text, 2000),
      watcher_type:'product_stock',
      product_url:condition.productUrl,
      variant:condition.variant,
      add_to_cart:condition.addToCart,
      plan_code:budget.planCode,
    },
    started_at:now,
    updated_at:now,
  }).select('id').single()
  if (runError || !run?.id) throw new Error(`agent_run_create_failed:${runError?.message || 'unknown'}`)

  const watcher = await createProductStockWatcher({ telegramId:tg, condition })
  await supabaseAdmin.from('agent_activity').insert({
    telegram_id:tg,
    run_id:String(run.id),
    event_type:'watcher_created',
    message:`Gogo is watching ${condition.title} for availability.`.slice(0, 900),
    metadata_json:{
      watcher_id:watcher.id,
      type:'product_stock',
      product_url:condition.productUrl,
      variant:condition.variant,
      add_to_cart:condition.addToCart,
      cadence_minutes:condition.cadenceMinutes,
    },
  })

  return {
    runId:String(run.id),
    status:'completed' as const,
    capability:'browser' as const,
    risk:'low' as const,
    text:`Got it — I’ll check hourly for ${condition.variant} availability on ${condition.title}.${condition.addToCart ? ` If it comes back, I’ll add ${condition.variant} to your cart and alert you.` : ' I’ll alert you when it comes back.'} I won’t place the order, checkout, or make a payment without your approval.`,
    handledBy:'product-stock-watch',
  }
}

function isProductWatchStatusQuery(text:string) {
  const raw = clean(text, 300).toLowerCase()
  return /^(?:is\s+(?:this|it)\s+done|did\s+(?:this|it)\s+work|what(?:'s|\s+is)\s+the\s+status|status\s+(?:on|of)\s+(?:this|it)|any\s+update(?:s)?(?:\s+on\s+(?:this|it))?)\??$/.test(raw)
}

export async function tryGetProductStockWatchStatusFromCommand(params: {
  actor: AgentActor
  text: string
}) {
  if (!isProductWatchStatusQuery(params.text)) return null

  const tg = String(params.actor.legacyTelegramId)
  const { data, error } = await supabaseAdmin.from('agent_watchers')
    .select('id, active, condition_json, last_state_json, cadence_minutes, last_checked_at, next_check_at, updated_at')
    .eq('telegram_id', tg)
    .eq('type', 'product_stock')
    .order('updated_at', { ascending:false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`product_watch_status_read_failed:${error.message}`)
  if (!data) return null

  const condition = normalizeProductStockWatcher(data.condition_json)
  if (!condition) return null
  const state:any = data.last_state_json || {}
  const variant = condition.variant
  const cadence = Math.max(60, Number(data.cadence_minutes || condition.cadenceMinutes || 60))
  const cadenceText = cadence === 60 ? 'hourly' : `about every ${cadence} minutes`

  if (data.active) {
    if (state.blockReason) {
      return {
        runId:`product-watch-status-${data.id}`,
        status:'watching' as const,
        capability:'browser' as const,
        risk:'low' as const,
        text:`The watch is active. This store blocked Gogo’s cloud browser on the last check, so I haven’t been able to verify ${variant} stock yet. I’ll keep retrying in the background and alert you as soon as I can verify availability.`,
        handledBy:'product-stock-watch-status',
      }
    }
    const availability = String(state.availability || 'unknown')
    const availabilityText = availability === 'unavailable'
      ? `${variant} hasn’t come back yet, so nothing has been added to the cart.`
      : `I haven’t verified ${variant} as available yet, so nothing has been added to the cart.`
    return {
      runId:`product-watch-status-${data.id}`,
      status:'watching' as const,
      capability:'browser' as const,
      risk:'low' as const,
      text:`The watch is active and checking ${cadenceText}. ${availabilityText} I’ll alert you as soon as it does.`,
      handledBy:'product-stock-watch-status',
    }
  }

  if (state.triggered === true && String(state.availability || '') === 'available') {
    const cartText = condition.addToCart
      ? state.cartVerified === true
        ? `I also added ${variant} to your cart and verified it. I did not checkout or place the order.`
        : `I found ${variant} available, but I could not verify that the cart step completed.`
      : 'I alerted you when it became available.'
    return {
      runId:`product-watch-status-${data.id}`,
      status:'completed' as const,
      capability:'browser' as const,
      risk:'low' as const,
      text:`Yes — ${variant} became available. ${cartText}`,
      handledBy:'product-stock-watch-status',
    }
  }

  return {
    runId:`product-watch-status-${data.id}`,
    status:'paused' as const,
    capability:'browser' as const,
    risk:'low' as const,
    text:`The product watch is no longer active, and I don’t have a verified ${variant} availability event to report. I won’t claim it was available without verification.`,
    handledBy:'product-stock-watch-status',
  }
}

export async function tryCreateWebPageWatchFromCommand(params:{
  actor:AgentActor
  surface:AgentSurface
  text:string
}) {
  const parsed=parseWebPageWatchCommand(params.text)
  if(!parsed)return null
  const tg=String(params.actor.legacyTelegramId)
  if(!(await browserWatchAllowed(params.actor.legacyTelegramId))) {
    return {runId:'page-watch-blocked',status:'paused' as const,capability:'browser' as const,risk:'low' as const,text:'Browser monitoring is off in Gogo Safe Mode. Turn Browser access back on to create this watch.',blockedReason:'browser_permission_off',handledBy:'web-page-watch'}
  }
  const budget=await getCostBudget(tg)
  if(budget.activeWebWatchersMax<=0) {
    return {runId:'page-watch-plan-blocked',status:'paused' as const,capability:'browser' as const,risk:'low' as const,text:watcherUpgradeMessage(budget.planCode),blockedReason:'plan_background_watch_unavailable',handledBy:'web-page-watch'}
  }
  const {count,error:countError}=await supabaseAdmin.from('agent_watchers').select('id',{count:'exact',head:true}).eq('telegram_id',tg).in('type',['web_search','web_page','product_stock']).eq('active',true)
  if(countError)throw new Error(`agent_watcher_count_failed:${countError.message}`)
  if((count||0)>=budget.activeWebWatchersMax) {
    return {runId:'page-watch-plan-limit',status:'paused' as const,capability:'browser' as const,risk:'low' as const,text:watcherUpgradeMessage(budget.planCode),blockedReason:'plan_background_watch_limit',handledBy:'web-page-watch'}
  }
  const cadenceMinutes=Math.max(60,Number(budget.baseWatcherCadenceMinutes||60))
  const condition={...parsed,cadenceMinutes}
  const now=new Date().toISOString()
  const {data:run,error:runError}=await supabaseAdmin.from('agent_runs').insert({
    telegram_id:tg,type:'watcher',capability:'browser',status:'completed',title:condition.title,
    summary:`Background Gogo will inspect ${condition.url} and alert only when the verified ${condition.watch} changes.`,
    progress:100,why:'You asked Gogo to keep monitoring a specific web page in the background.',source:params.surface,
    metadata_json:{input_text:clean(params.text,2000),watcher_type:'web_page',url:condition.url,watch:condition.watch,cadence_minutes:cadenceMinutes},
    started_at:now,updated_at:now,
  }).select('id').single()
  if(runError||!run?.id)throw new Error(`agent_run_create_failed:${runError?.message||'unknown'}`)
  const watcher=await createWebPageWatcher({telegramId:tg,condition})
  await supabaseAdmin.from('agent_activity').insert({
    telegram_id:tg,run_id:String(run.id),event_type:'watcher_created',
    message:`Background Gogo started a browser-backed page watch: ${condition.url}`.slice(0,900),
    metadata_json:{watcher_id:watcher.id,type:'web_page',url:condition.url,watch:condition.watch,cadence_minutes:cadenceMinutes},
  })
  return {
    runId:String(run.id),status:'completed' as const,capability:'browser' as const,risk:'low' as const,
    text:`Background Gogo is now monitoring ${condition.url}. I’ll establish a verified baseline with the persistent browser, then check about every ${cadenceMinutes} minutes and alert you only if the page ${condition.watch} changes. You can ask *what are you monitoring for me?* or say *stop monitoring that*.`,
    handledBy:'web-page-watch',
  }
}

export async function tryCreateWebWatchFromCommand(params: {
  actor: AgentActor
  surface: AgentSurface
  text: string
}) {
  const parsed = parseWebWatchCommand(params.text)
  if (!parsed) return null

  const tg = String(params.actor.legacyTelegramId)
  if (!(await browserWatchAllowed(params.actor.legacyTelegramId))) {
    return {
      runId: 'watch-blocked',
      status: 'paused' as const,
      capability: 'browser' as const,
      risk: 'low' as const,
      text: 'Browser monitoring is off in Gogo Safe Mode. Turn Browser access back on to create this watch.',
      blockedReason: 'browser_permission_off',
    }
  }

  const budget = await getCostBudget(tg)
  if (budget.activeWebWatchersMax <= 0) {
    return {
      runId: 'watch-plan-blocked',
      status: 'paused' as const,
      capability: 'browser' as const,
      risk: 'low' as const,
      text: watcherUpgradeMessage(budget.planCode),
      blockedReason: 'plan_background_watch_unavailable',
    }
  }

  const { count, error: countError } = await supabaseAdmin.from('agent_watchers')
    .select('id', { count:'exact', head:true })
    .eq('telegram_id', tg)
    .in('type', ['web_search','web_page','product_stock'])
    .eq('active', true)
  if (countError) throw new Error(`agent_watcher_count_failed:${countError.message}`)
  const activeWatcherCount = count || 0
  if (activeWatcherCount >= budget.activeWebWatchersMax) {
    return {
      runId: 'watch-plan-limit',
      status: 'paused' as const,
      capability: 'browser' as const,
      risk: 'low' as const,
      text: watcherUpgradeMessage(budget.planCode),
      blockedReason: 'plan_background_watch_limit',
    }
  }

  const urgent = isUrgentWatchRequest(params.text)
  const cadenceMinutes = initialWatcherCadence({
    budget,
    urgent,
    activeWatcherCount: activeWatcherCount + 1,
  })
  const burstUntil = urgent && budget.burstHours > 0
    ? new Date(Date.now() + budget.burstHours * 3600_000).toISOString()
    : null
  const condition = {
    ...parsed,
    cadenceMinutes,
    burstUntil,
  }

  const now = new Date().toISOString()
  const { data: run, error: runError } = await supabaseAdmin.from('agent_runs').insert({
    telegram_id: tg,
    type: 'watcher',
    capability: 'browser',
    status: 'completed',
    title: condition.title,
    summary: `Background Gogo is watching adaptively. It starts around every ${condition.cadenceMinutes} minutes and slows down when nothing changes.`,
    progress: 100,
    why: 'You asked Gogo to keep watching instead of repeatedly checking the web yourself.',
    source: params.surface,
    metadata_json: {
      input_text: clean(params.text, 2000), watcher_type:'web_search', query:condition.query,
      plan_code:budget.planCode, adaptive:true, burst_until:burstUntil,
    },
    started_at: now,
    updated_at: now,
  }).select('id').single()
  if (runError || !run?.id) throw new Error(`agent_run_create_failed:${runError?.message || 'unknown'}`)

  const watcher = await createWebSearchWatcher({ telegramId:tg, condition })
  await supabaseAdmin.from('agent_activity').insert({
    telegram_id: tg,
    run_id: String(run.id),
    event_type: 'watcher_created',
    message: `Background Gogo is watching the web adaptively: ${condition.query}`.slice(0, 900),
    metadata_json: {
      watcher_id:watcher.id, type:'web_search', cadence_minutes:condition.cadenceMinutes,
      plan_code:budget.planCode, burst_until:burstUntil,
    },
  })

  return {
    runId: String(run.id),
    status: 'completed' as const,
    capability: 'browser' as const,
    risk: 'low' as const,
    text: `Background Gogo is now watching “${condition.query}”. I’ll establish a baseline first, then adapt the check frequency based on changes and your plan so quiet watches don’t waste your Gogo capacity. Meaningful updates appear in Ideas${condition.delivery !== 'app' ? ' and WhatsApp' : ''}.`,
    handledBy: 'background-web-watch',
  }
}

type PendingFlightWatch = {
  destination: string
  dateText: string
  originalText: string
  created_at: string
}

const FLIGHT_CODE_STOPWORDS = new Set([
  'AT', 'AM', 'PM', 'ON', 'TO', 'IN', 'BY', 'OF', 'OR', 'AN', 'AS', 'IF', 'IS', 'IT', 'ME', 'MY', 'WE', 'US', 'GO', 'DO', 'NO', 'SO', 'UP',
])

function looksLikeIndependentCommand(text: string) {
  const raw = clean(text, 2000)
  if (!raw) return false
  return /^(?:please\s+)?(?:create|make|add|save|remind|schedule|show|list|find|search|look\s+for|check|book|reserve|order|buy|purchase|watch|monitor|track|send|email|message|plan|compare|open|go\s+to|cancel|delete|remove|update|change|move|call|tell|give|get)\b/i.test(raw)
    || /\b(?:then|and then)\s+(?:create|make|add|save|remind|schedule|show|find|search|check|book|reserve|order|buy|watch|monitor|send|plan|compare)\b/i.test(raw)
}

export function parseFlightIdentifier(text: string) {
  const raw = clean(text, 500)
  const match = raw.match(/\b([A-Z0-9]{2,3})\s*-?\s*(\d{1,4}[A-Z]?)\b/i)
  if (!match) return null
  const code = match[1].toUpperCase()
  const number = match[2].toUpperCase()

  if (FLIGHT_CODE_STOPWORDS.has(code)) return null
  const matchedEnd = (match.index || 0) + match[0].length
  if (raw.slice(matchedEnd).trimStart().startsWith(':')) return null

  const before = raw.slice(0, match.index || 0).trim().replace(/[-–—,:]+$/g, '').trim()
  const airline = before && before.length <= 80 ? before : ''
  return {
    code,
    number,
    flightNumber: `${code} ${number}`,
    airline,
    label: clean(`${airline ? `${airline} ` : ''}${code} ${number}`, 120),
  }
}

function parseFlightWatchRequest(text: string): PendingFlightWatch | null {
  const raw = clean(text, 2000)
  if (!/^(?:please\s+)?(?:watch|monitor|track)\s+(?:my\s+|the\s+)?flights?\b/i.test(raw)) return null

  const destinationMatch = raw.match(/\bto\s+(.+?)\s+on\s+(.+?)(?=\s+(?:and\s+)?(?:alert|notify|tell|let)\s+me\b|$)/i)
  const destination = clean(destinationMatch?.[1] || '', 120)
  const dateText = clean(destinationMatch?.[2] || '', 120)
  if (!destination || !dateText) return null

  return {
    destination,
    dateText,
    originalText: raw,
    created_at: new Date().toISOString(),
  }
}

function flightWatchPrompt() {
  return (
    `I need your flight details to track it, boss.\n\n` +
    `Reply with your airline and flight number (e.g. “AI 101” or “United 456”), ` +
    `or forward me the booking confirmation — I’ll pull the details and start monitoring ` +
    `for delays, gate changes and cancellations.`
  )
}

async function createFlightWatcherFromPending(params: {
  actor: AgentActor
  surface: AgentSurface
  pending: PendingFlightWatch
  identifier: ReturnType<typeof parseFlightIdentifier> extends infer T ? Exclude<T, null> : never
}) {
  const { actor, surface, pending, identifier } = params
  const synthesized =
    `watch the web for ${identifier.label} flight status to ${pending.destination} on ${pending.dateText} ` +
    `and alert me if you see delay, cancellation, gate change, schedule change, departure change or arrival change`

  const result = await tryCreateWebWatchFromCommand({ actor, surface, text: synthesized })
  if (!result) return null

  if (result.status === 'completed' && result.runId && !String(result.runId).includes('blocked') && !String(result.runId).includes('limit')) {
    await clearFollowupState(actor.legacyTelegramId, 'pending_flight_watch')
    return {
      ...result,
      text:
        `✅ *Flight watch started*\n\n` +
        `${identifier.label}\n` +
        `${pending.dateText} — ${pending.destination}\n\n` +
        `I’ll watch for important changes such as delays, cancellations, gate changes and schedule updates, ` +
        `and alert you when something materially changes.`,
      handledBy: 'flight-watch',
    }
  }

  return { ...result, handledBy: 'flight-watch' }
}

export async function tryCreateFlightWatchFromCommand(params: {
  actor: AgentActor
  surface: AgentSurface
  text: string
}) {
  const raw = clean(params.text, 2000)
  if (!raw) return null

  const freshPending = await getLatestFollowupState(params.actor.legacyTelegramId, 'pending_flight_watch')
  if (freshPending && isStrictlyFreshFollowupState(freshPending, 30) && !looksLikeIndependentCommand(raw)) {
    const identifier = parseFlightIdentifier(raw)
    if (identifier) {
      const pending = freshPending.payload as PendingFlightWatch
      if (pending?.destination && pending?.dateText) {
        return await createFlightWatcherFromPending({ actor:params.actor, surface:params.surface, pending, identifier })
      }
    }
  }

  const request = parseFlightWatchRequest(raw)
  if (!request) return null

  const identifier = parseFlightIdentifier(raw)
  if (identifier) {
    return await createFlightWatcherFromPending({ actor:params.actor, surface:params.surface, pending:request, identifier })
  }

  await saveFollowupState(params.actor.legacyTelegramId, 'pending_flight_watch', request)
  return {
    runId: 'flight-watch-awaiting-details',
    status: 'paused' as const,
    capability: 'browser' as const,
    risk: 'low' as const,
    text: flightWatchPrompt(),
    handledBy: 'flight-watch-followup',
  }
}
