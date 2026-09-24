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
    || /^(?:show|list)\s+(?:my\s+)?(?:active\s+)?(?:monitors?|watchers?|watches)\??$/.test(raw)
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
  if(/^(?:stop|cancel|remove|disable)\s+.+?\s+(?:watcher|watch|monitor)\b/.test(raw))return 'named'
  if(/^(?:stop|cancel|remove|disable)\s+(?:all\s+)?(?:monitoring|watching|tracking|monitors?|watchers?|watches)\b/.test(raw))return raw.includes('all')?'all':'latest'
  if(/^(?:stop|cancel|remove|disable)\s+(?:monitoring|watching|tracking)\s+(?:that|it|this)\b/.test(raw))return 'latest'
  if(/^(?:stop|cancel)\s+(?:that|this)\s+(?:watch|monitor)\b/.test(raw))return 'latest'
  return null
}

async function dismissIdeasForWatcherIds(telegramId:string,watcherIds:string[]){
  const ids=[...new Set(watcherIds.map(String).filter(Boolean))]
  if(!ids.length)return 0
  let dismissed=0
  for(const watcherId of ids){
    const pageSize=200
    for(let from=0;;from+=pageSize){
      const {data,error}=await supabaseAdmin.from('agent_ideas')
        .select('id').eq('telegram_id',telegramId).eq('status','new')
        .contains('source_refs',[{type:'watcher',id:watcherId}])
        .order('created_at',{ascending:true}).range(from,from+pageSize-1)
      if(error){console.error('WATCHER_STOP_IDEA_READ_FAILED:',error.message);break}
      const ideaIds=(data||[]).map((row:any)=>row.id).filter(Boolean)
      if(ideaIds.length){
        const {error:updateError}=await supabaseAdmin.from('agent_ideas')
          .update({status:'dismissed'}).in('id',ideaIds)
          .eq('telegram_id',telegramId).eq('status','new')
        if(updateError){console.error('WATCHER_STOP_IDEA_DISMISS_FAILED:',updateError.message);break}
        dismissed+=ideaIds.length
      }
      if((data||[]).length<pageSize)break
    }
  }
  return dismissed
}

export async function tryStopWatcherFromCommand(params:{actor:AgentActor;text:string}) {
  const intent=stopWatcherIntent(params.text)
  if(!intent)return null
  const tg=String(params.actor.legacyTelegramId)
  if(intent==='named'){
    const target=clean(params.text,400).toLowerCase().replace(/^(?:stop|cancel|remove|disable)\s+/,'').replace(/\s+(?:watcher|watch|monitor).*$/,'').trim()
    const {data:rows,error:readError}=await supabaseAdmin.from('agent_watchers')
      .select('id,type,condition_json,created_at').eq('telegram_id',tg).eq('active',true).order('created_at',{ascending:false}).limit(30)
    if(readError)throw new Error(`watcher_stop_read_failed:${readError.message}`)
    const norm=(v:unknown)=>clean(v,300).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()
    const q=norm(target)
    const matches=(rows||[]).filter((row:any)=>norm((row.condition_json as any)?.title||row.type).includes(q)||q.includes(norm((row.condition_json as any)?.title||row.type)))
    if(matches.length!==1)return {runId:'watcher-stop-ambiguous',status:'paused' as const,capability:'browser' as const,risk:'low' as const,text:matches.length?'I found more than one matching active watcher. Please be more specific.':'I could not find that active watcher.',handledBy:'watcher-stop'}
    const chosen:any=matches[0]
    const {error}=await supabaseAdmin.from('agent_watchers').update({active:false,next_check_at:null,updated_at:new Date().toISOString()}).eq('id',chosen.id).eq('telegram_id',tg)
    if(error)throw new Error(`watcher_stop_failed:${error.message}`)
    await dismissIdeasForWatcherIds(tg,[String(chosen.id)])
    return {runId:`watcher-stop-${chosen.id}`,status:'completed' as const,capability:'browser' as const,risk:'low' as const,text:`Stopped ${String((chosen.condition_json as any)?.title||'that monitor')}.`,handledBy:'watcher-stop'}
  }
  if(intent==='all'){
    const {data,error}=await supabaseAdmin.from('agent_watchers').update({active:false,next_check_at:null,updated_at:new Date().toISOString()})
      .eq('telegram_id',tg).eq('active',true).select('id')
    if(error)throw new Error(`watcher_stop_failed:${error.message}`)
    await dismissIdeasForWatcherIds(tg,(data||[]).map((row:any)=>String(row.id)))
    return {runId:'watcher-stop-all',status:'completed' as const,capability:'browser' as const,risk:'low' as const,text:`Stopped ${data?.length||0} active background monitor${data?.length===1?'':'s'}.`,handledBy:'watcher-stop'}
  }
  const {data:latest,error:readError}=await supabaseAdmin.from('agent_watchers')
    .select('id,type,condition_json,created_at').eq('telegram_id',tg).eq('active',true).order('created_at',{ascending:false}).limit(1).maybeSingle()
  if(readError)throw new Error(`watcher_stop_read_failed:${readError.message}`)
  if(!latest?.id)return {runId:'watcher-stop-none',status:'completed' as const,capability:'browser' as const,risk:'low' as const,text:'There is no active background monitor to stop.',handledBy:'watcher-stop'}
  const {error}=await supabaseAdmin.from('agent_watchers').update({active:false,next_check_at:null,updated_at:new Date().toISOString()}).eq('id',latest.id).eq('telegram_id',tg)
  if(error)throw new Error(`watcher_stop_failed:${error.message}`)
  await dismissIdeasForWatcherIds(tg,[String(latest.id)])
  return {runId:`watcher-stop-${latest.id}`,status:'completed' as const,capability:'browser' as const,risk:'low' as const,text:`Stopped ${String((latest.condition_json as any)?.title||'that monitor')}.`,handledBy:'watcher-stop'}
}

export function parsePriceWatchCommand(text:string){
  const raw=clean(text,1200)
  const m=raw.match(/^(?:please\s+)?(?:watch|monitor|track)\s+(?:the\s+)?price\s+of\s+(.+?)\s+(?:and\s+)?(?:tell|notify|alert|let)\s+me\s+(?:know\s+)?if\s+(?:it|the\s+price)\s+(?:drops?|falls?|goes?)\s+below\s+([^\s]+(?:\s*[^\s]+)?)/i)
  if(!m?.[1]||!m?.[2])return null
  const product=clean(m[1],160)
  const threshold=clean(m[2],80)
  return normalizeWebSearchWatcher({
    title:`Price watch: ${product}`,
    query:`${product} price India`,
    triggerKeywords:[product,'price',threshold],
    delivery:'both',
    cadenceMinutes:60,
  })
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