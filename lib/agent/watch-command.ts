import { supabaseAdmin } from '@/lib/supabase-admin'
import { latestTypedContext, selectedTypedObject, rememberTypedObjects } from './typed-object-context'
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

export function isWatcherStatusQuery(text:string) {
  const raw=clean(text,2000).toLowerCase().replace(/^please\s+/,'')
  // Read questions can include a subject and follow-up sentences. Keep them
  // separate from create/update/stop commands and recommendations to watch.
  return /^(?:what|which)\s+(?:are\s+you\s+)?(?:monitoring|watching|tracking)(?:\s+for\s+me)?(?:\s+and\s+why)?\??$/.test(raw)
    || /^(?:show|list)\s+(?:my\s+)?(?:active\s+)?(?:monitors?|watchers?|watches)\b/.test(raw)
    || /^what\s+(?:monitors?|watchers?|watches)\s+(?:do\s+i\s+have|are\s+active)\??$/.test(raw)
    || /^(?:what|which)\b[^.!?]*\b(?:am\s+i|are\s+you)\s+(?:monitoring|watching|tracking)\b/.test(raw)
    || /^(?:what|when|how|is|are|do)\b[^.!?]*\bmy\b[^.!?]*\b(?:watches|watch|watchers?|monitors?)\b/.test(raw)
}

function watchStatusSubject(text:string){
  const raw=clean(text,2000)
  return raw.match(/\bwhat\s+are\s+my\s+(.+?)\s+(?:criteria|conditions|requirements)\b/i)?.[1]
    || raw.match(/\b(?:what|which)\s+(.+?)\s+(?:am\s+i|are\s+you)\s+(?:watching|monitoring|tracking)\b/i)?.[1]
    || raw.match(/\bmy\s+(.+?)\s+(?:watch|monitor)\b/i)?.[1]
    || ''
}

function watchSubjectTokens(value:string){
  return clean(value).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
    .map(word=>word.length>4?word.replace(/s$/,''):word)
    .filter(word=>!['the','my','for','all','active','current','saved','watch','watche','watcher','monitor','background'].includes(word))
}

function watchCheckTime(value:unknown){
  const time=Date.parse(String(value||''))
  return Number.isFinite(time)?new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',day:'numeric',month:'short',hour:'numeric',minute:'2-digit',hour12:true}).format(new Date(time))+' IST':null
}

export async function tryGetWatcherStatusFromCommand(params:{actor:AgentActor;text:string}) {
  if(!isWatcherStatusQuery(params.text))return null
  const tg=String(params.actor.legacyTelegramId)
  const {data,error}=await supabaseAdmin.from('agent_watchers')
    .select('id,type,condition_json,last_state_json,cadence_minutes,last_checked_at,next_check_at,active,created_at,updated_at')
    .eq('telegram_id',tg)
    .eq('active',true)
    .order('created_at',{ascending:false})
    .limit(12)
  if(error)throw new Error(`watcher_status_read_failed:${error.message}`)
  const subject=watchStatusSubject(params.text)
  const tokens=watchSubjectTokens(subject)
  if(tokens.length && data?.length){
    const matches=(value:string)=>tokens.some(token=>watchSubjectTokens(value).includes(token))
    let selected=data.filter((row:any)=>matches([row.condition_json?.title,row.condition_json?.query,row.condition_json?.originalRequest,row.condition_json?.variant].filter(Boolean).join(' ')))
    if(!selected.length){
      // Resolve category follow-ups only from the recent, explicitly named watch
      // conversation. Re-read current owner rows; never infer a product category.
      const context=await latestTypedContext(params.actor.legacyTelegramId)
      const ids=context?.domain==='watchers'?context.items.filter(item=>matches(item.title)).map(item=>item.id):[]
      selected=data.filter((row:any)=>ids.includes(String(row.id)))
    }
    if(!selected.length)return {
      runId:'watcher-status-clarify',status:'paused' as const,capability:'browser' as const,risk:'low' as const,
      text:`I have saved watches, but couldn’t match “${clean(subject,100)}” to one. Say “show my watches” to see them, or give me the product name.`,handledBy:'watcher-status',
    }
    await rememberTypedObjects(params.actor.legacyTelegramId,'watchers',selected.map((row:any)=>({id:String(row.id),title:`${clean(subject,80)} — ${String(row.condition_json?.title||row.type)}`})))
    const blocks=selected.map((row:any,index:number)=>{
      const c=row.condition_json||{}
      const criteria=clean(c.query||c.originalRequest||c.productUrl||c.url||c.title||row.type,700)
      const delivery=row.last_state_json?.alertDelivery?.state
      const alert=delivery==='outcome_unknown'?'\nAlert delivery is unconfirmed.':delivery==='failed'?'\nThe last alert could not be delivered.':row.last_state_json?.pendingAlert?'\nAn alert is waiting to be retried.':''
      return `${selected.length>1?`${index+1}. `:''}${criteria}\nLast checked: ${watchCheckTime(row.last_checked_at)||'not yet recorded'}\nNext check: ${watchCheckTime(row.next_check_at)||'not scheduled'} (about every ${Math.max(1,Number(row.cadence_minutes||60))} min)${alert}`
    })
    return {
      runId:'watcher-status-active',status:'completed' as const,capability:'browser' as const,risk:'low' as const,
      text:`${selected.length===1?'I’m watching this for you:':`You have ${selected.length} matching watches active:`}\n\n${blocks.join('\n\n')}`,
      handledBy:'watcher-status',verification:{verified:true,source:'canonical_watchers',kind:'read',objectKind:'watcher_collection',objectRef:selected.map((row:any)=>String(row.id)).join(',')},
    }
  }
  await rememberTypedObjects(params.actor.legacyTelegramId,'watchers',(data||[]).map((row:any)=>({id:String(row.id),title:String(row.condition_json?.title||row.type||'Watch')})))
  if(!data?.length) {
    return {
      runId:'watcher-status-none',status:'completed' as const,capability:'browser' as const,risk:'low' as const,
      text:'You do not have any active background monitors right now.',
      handledBy:'watcher-status',
      verification:{verified:true,source:'canonical_watchers',kind:'read',objectKind:'watcher_collection',objectRef:(data||[]).map((w:any)=>String(w.id)).join(',')||'empty'},
    }
  }
  const formatWatcher=(row:any,index:number)=>{
    const condition:any=row.condition_json||{}
    let label=String(condition.title||row.type||'Watch')
    if(row.type==='web_page') label=`${label} — ${condition.watch==='title'?'page title':'page content'}`
    else if(row.type==='web_search') label=`${label} — web search`
    else if(row.type==='product_stock') label=`${label} — ${condition.variant||'stock'}`
    else if(row.type==='email_triage') label=condition.title||'Inbox action watch'
    const cadence=Math.max(1,Number(row.cadence_minutes||60))
    const contextual=condition.contextual===true
    const criteria=condition.query||condition.productUrl||condition.url||condition.originalRequest
    const criteriaLine=criteria?`\n   Criteria: ${clean(criteria,1000)}`:''
    const why=contextual&&condition.reason?`\n   Why: ${String(condition.reason)}`:''
    const source=contextual?`\n   Source: saved ${condition.contextualKind||'context'}`:`\n   Source: your existing watch`
    const expires=contextual&&condition.expiresAt&&Number.isFinite(Date.parse(String(condition.expiresAt)))
      ? `\n   Expires: ${new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',day:'numeric',month:'short',hour:'numeric',minute:'2-digit',hour12:true}).format(new Date(condition.expiresAt))}`
      : contextual?'':'\n   Expires: stays active until you stop it'
    const delivery=row.last_state_json?.alertDelivery?.state
    const notification=delivery==='outcome_unknown'?'\n   WhatsApp alert: delivery is unconfirmed; no blind resend.'
      :delivery==='failed'?'\n   WhatsApp alert: failed after bounded attempts; result remains in the app.'
      :row.last_state_json?.pendingAlert?'\n   WhatsApp alert: pending retry.':''
    const checkTime=(value:unknown)=>{
      const time=Date.parse(String(value||''))
      return Number.isFinite(time)?new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',day:'numeric',month:'short',hour:'numeric',minute:'2-digit',hour12:true}).format(new Date(time))+' IST':null
    }
    const last='\n   Last checked: '+(checkTime(row.last_checked_at)||'no completed check recorded')
    const next='\n   Next check: '+(checkTime(row.next_check_at)||'not scheduled')
    return `${index+1}. ${label} — active, checking about every ${cadence} min${criteriaLine}${why}${source}${expires}${last}${next}${notification}`
  }
  const contextualRows=data.filter((row:any)=>row.condition_json?.contextual===true)
  const manualRows=data.filter((row:any)=>row.condition_json?.contextual!==true)
  const contextualLines=contextualRows.map((row:any,index:number)=>formatWatcher(row,index))
  const manualLines=manualRows.map((row:any,index:number)=>formatWatcher(row,index))
  const contextualBlock=contextualLines.length?`🧭 *Contextual watches created from your current context*\n\n${contextualLines.join('\n')}`:''
  const manualBlock=manualLines.length?`👤 *Your other existing watches*\n\n${manualLines.join('\n')}`:''
  const watcherBlocks=[contextualBlock,manualBlock].filter(Boolean).join('\n\n')
  const {data:tripSteps}=await supabaseAdmin.from('life_event_actions')
    .select('id,title,action_key,status,due_at')
    .eq('telegram_id',tg)
    .in('action_key',['prepare-web-checkin','watch-boarding-pass-email','travel-disruption-watch'])
    .in('status',['ready','waiting_approval','blocked','running'])
    .order('due_at',{ascending:true}).limit(6)
  const itinerary=(tripSteps||[]).map((row:any)=>`• ${row.title} — ${String(row.status).replace(/_/g,' ')} (itinerary-owned)`)
  const itineraryBlock=itinerary.length?`\n\n✈️ *Itinerary-owned trip steps*\n${itinerary.join('\n')}\n_These are tied to the saved itinerary rather than duplicated as extra monitors._`:''
  return {
    runId:'watcher-status-active',status:'completed' as const,capability:'browser' as const,risk:'low' as const,
    text:`🔎 *Active background monitors*\n\n${watcherBlocks}${itineraryBlock}\n\nSelect a watcher from this list before saying *stop it*, or stop a watcher by name.`,
    handledBy:'watcher-status',
      verification:{verified:true,source:'canonical_watchers',kind:'read',objectKind:'watcher_collection',objectRef:(data||[]).map((w:any)=>String(w.id)).join(',')||'empty'},
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

function watcherIdentityTokens(value:unknown){
  return clean(value,400).toLowerCase().replace(/[^a-z0-9]+/g,' ').split(/\s+/)
    .filter(t=>t.length>2&&!['watch','watcher','monitor','monitoring','price','india','web','search'].includes(t))
}

async function canonicalActiveWatchers(telegramId:string){
  const {data,error}=await supabaseAdmin.from('agent_watchers')
    .select('id,type,condition_json,cadence_minutes,last_checked_at,next_check_at,active,created_at,updated_at')
    .eq('telegram_id',telegramId).eq('active',true).order('created_at',{ascending:false}).limit(100)
  if(error)throw new Error(`watcher_canonical_read_failed:${error.message}`)
  return data||[]
}

function restartWatcherIntent(text:string){
  const raw=clean(text,400).toLowerCase()
  return /^(?:restart|resume|reactivate|re-enable|reenable|start)\s+.+?\s+(?:watcher|watch|monitor)\b/.test(raw)?'named':null
}

export async function tryRestartWatcherFromCommand(params:{actor:AgentActor;text:string}){
  if(!restartWatcherIntent(params.text))return null
  const tg=String(params.actor.legacyTelegramId)
  const target=clean(params.text,400).toLowerCase()
    .replace(/^(?:restart|resume|reactivate|re-enable|reenable|start)\s+/,'')
    .replace(/\s+(?:watcher|watch|monitor).*$/,'').trim()
  const {data:rows,error:readError}=await supabaseAdmin.from('agent_watchers')
    .select('id,type,condition_json,cadence_minutes,active,created_at,updated_at')
    .eq('telegram_id',tg).eq('active',false).order('updated_at',{ascending:false}).limit(100)
  if(readError)throw new Error(`watcher_restart_read_failed:${readError.message}`)
  const tokens=watcherIdentityTokens(target)
  const ranked=(rows||[]).map((row:any)=>{
    const label=String((row.condition_json as any)?.title||row.type)
    const labelTokens=new Set(watcherIdentityTokens(label))
    const score=tokens.filter(t=>labelTokens.has(t)).length
    return {row,label,score}
  }).filter((x:any)=>x.score>0).sort((a:any,b:any)=>b.score-a.score)
  const best:any=ranked[0],second:any=ranked[1]
  if(!best||second?.score===best.score){
    return {runId:'watcher-restart-ambiguous',status:'paused' as const,capability:'browser' as const,risk:'low' as const,
      text:best?'I found more than one plausible stopped watcher. Please be more specific.':'I could not find that stopped watcher in persistent watcher state.',handledBy:'watcher-restart'}
  }
  const chosen=best.row
  const now=new Date().toISOString()
  const chosenCondition:any=chosen.condition_json||{}
  const {data:updated,error}=await supabaseAdmin.from('agent_watchers')
    .update({active:true,next_check_at:now,updated_at:now,condition_json:{...chosenCondition,userStoppedAt:null}})
    .eq('id',chosen.id).eq('telegram_id',tg).eq('active',false)
    .select('id,active').maybeSingle()
  if(error)throw new Error(`watcher_restart_failed:${error.message}`)
  if(!updated?.id||updated.active!==true)throw new Error('watcher_restart_no_row_mutated')
  const active=await canonicalActiveWatchers(tg)
  if(!active.some((row:any)=>String(row.id)===String(chosen.id)))throw new Error('watcher_restart_read_after_write_failed')
  await supabaseAdmin.from('agent_activity').insert({telegram_id:tg,event_type:'watcher_restarted',
    message:`Gogo restarted ${best.label}.`.slice(0,900),metadata_json:{watcher_id:chosen.id,type:chosen.type}})
  return {runId:`watcher-restart-${chosen.id}`,status:'completed' as const,capability:'browser' as const,risk:'low' as const,
    text:`Watch restarted: ${best.label} — active, checking about every ${Math.max(1,Number(chosen.cadence_minutes||60))} min. Persistent state now shows ${active.length} active monitor${active.length===1?'':'s'}.`,handledBy:'watcher-restart'}
}

// Explicit replacement criteria, not a guessed edit to an ambiguous watch.
export async function tryUpdateWebWatchFromCommand(params:{actor:AgentActor;text:string}) {
  const match=clean(params.text,2000).match(/^(?:please\s+)?(?:update|change|correct)\s+(?:my\s+)?(.+?)\s+(?:watch|monitor)\s+to\s*:?\s*(.+)$/i)
  if(!match)return null
  const target=watcherIdentityTokens(match[1]), query=clean(match[2],500)
  const tg=String(params.actor.legacyTelegramId)
  const rows=await canonicalActiveWatchers(tg)
  const matches=rows.filter((row:any)=>row.type==='web_search'&&row.condition_json?.contextual!==true&&
    target.length>0&&target.every(token=>watcherIdentityTokens(row.condition_json?.title+' '+row.condition_json?.query).includes(token)))
  if(matches.length!==1||query.length<3)return {
    runId:'watcher-update-clarify',status:'paused' as const,capability:'browser' as const,risk:'low' as const,
    text:'Please identify one active search watch and give its complete replacement criteria, including the product or journey, budget and exclusions.',handledBy:'watcher-update',
  }
  const chosen=matches[0],now=new Date().toISOString()
  const condition=normalizeWebSearchWatcher({...chosen.condition_json,originalRequest:chosen.condition_json.originalRequest||chosen.condition_json.query,title:'Watch: '+query.slice(0,120),query,triggerKeywords:[],notifyOnFirstMatch:true})
  if(!condition)throw new Error('watcher_update_invalid')
  const {data:updated,error}=await supabaseAdmin.from('agent_watchers').update({
    condition_json:condition,last_state_json:{criteriaCorrectedAt:now},next_check_at:now,updated_at:now,
  }).eq('id',chosen.id).eq('telegram_id',tg).eq('active',true)
    .eq('condition_json',JSON.stringify(chosen.condition_json)).select('id,condition_json,active').maybeSingle()
  if(error||!updated?.active||updated.condition_json?.query!==query)throw new Error('watcher_update_unverified')
  await supabaseAdmin.from('agent_activity').insert({telegram_id:tg,event_type:'watcher_updated',
    message:'Saved corrected watch criteria: '+query,metadata_json:{watcher_id:chosen.id,previous_query:chosen.condition_json?.query,query}})
  return {runId:'watcher-update-'+chosen.id,status:'completed' as const,capability:'browser' as const,risk:'low' as const,
    text:'Updated the same saved watch: '+query+'. I’ll use these criteria on future checks. The next check is queued; search leads still need provider verification.',handledBy:'watcher-update'}
}

export async function tryStopWatcherFromCommand(params:{actor:AgentActor;text:string}) {
  const intent=stopWatcherIntent(params.text)
  if(!intent)return null
  const tg=String(params.actor.legacyTelegramId)
  if(intent==='named'){    const target=clean(params.text,400).toLowerCase().replace(/^(?:stop|cancel|remove|disable)\s+/,'').replace(/\s+(?:watcher|watch|monitor).*$/,'').trim()
    const rows=await canonicalActiveWatchers(tg)
    const tokens=watcherIdentityTokens(target)
    const ranked=rows.map((row:any)=>{
      const label=String((row.condition_json as any)?.title||row.type)
      const labelTokens=new Set(watcherIdentityTokens(label))
      const score=tokens.filter(t=>labelTokens.has(t)).length
      return {row,label,score}
    }).filter((x:any)=>x.score>0).sort((a:any,b:any)=>b.score-a.score)
    const best:any=ranked[0],second:any=ranked[1]
    if(!best||second?.score===best.score){
      return {runId:'watcher-stop-ambiguous',status:'paused' as const,capability:'browser' as const,risk:'low' as const,text:best?'I found more than one plausible active watcher. Please be more specific.':'I could not find that active watcher in persistent watcher state.',handledBy:'watcher-stop'}
    }
    const chosen=best.row
    const now=new Date().toISOString()
    const chosenCondition:any=chosen.condition_json||{}
    const {data:updated,error}=await supabaseAdmin.from('agent_watchers')
      .update({
        active:false,next_check_at:null,updated_at:now,
        condition_json:chosenCondition.contextual===true?{...chosenCondition,userStoppedAt:now}:chosenCondition,
      })
      .eq('id',chosen.id).eq('telegram_id',tg).eq('active',true)
      .select('id,active,next_check_at').maybeSingle()
    if(error)throw new Error(`watcher_stop_failed:${error.message}`)
    if(!updated?.id)throw new Error('watcher_stop_no_row_mutated')
    const remaining=await canonicalActiveWatchers(tg)
    if(remaining.some((row:any)=>String(row.id)===String(chosen.id)))throw new Error('watcher_stop_read_after_write_failed')
    await dismissIdeasForWatcherIds(tg,[String(chosen.id)])
    return {runId:`watcher-stop-${chosen.id}`,status:'completed' as const,capability:'browser' as const,risk:'low' as const,
      text:`Stopped ${String((chosen.condition_json as any)?.title||'that monitor')}. Persistent state now shows ${remaining.length} active monitor${remaining.length===1?'':'s'}.`,handledBy:'watcher-stop'}
  }
  if(intent==='all'){
    const rows=await canonicalActiveWatchers(tg)
    const now=new Date().toISOString()
    for(const row of rows){
      const condition:any=row.condition_json||{}
      if(condition.contextual===true){
        await supabaseAdmin.from('agent_watchers').update({condition_json:{...condition,userStoppedAt:now},updated_at:now})
          .eq('id',row.id).eq('telegram_id',tg).eq('active',true)
      }
    }
    const {data,error}=await supabaseAdmin.from('agent_watchers').update({active:false,next_check_at:null,updated_at:now})
      .eq('telegram_id',tg).eq('active',true).select('id')
    if(error)throw new Error(`watcher_stop_failed:${error.message}`)
    await dismissIdeasForWatcherIds(tg,(data||[]).map((row:any)=>String(row.id)))
    return {runId:'watcher-stop-all',status:'completed' as const,capability:'browser' as const,risk:'low' as const,text:`Stopped ${data?.length||0} active background monitor${data?.length===1?'':'s'}.`,handledBy:'watcher-stop'}
  }
  const context=await latestTypedContext(params.actor.legacyTelegramId)
  const selected=context?.domain==='watchers'?selectedTypedObject(context,params.text):null
  if(!selected)return {runId:'watcher-stop-selection',status:'paused' as const,capability:'browser' as const,risk:'low' as const,text:'Select the exact watcher from a current list or stop it by name. I will not choose the most recent watcher for this reference.',handledBy:'watcher-stop'}
  const now=new Date().toISOString()
  const {data:selectedRow,error:selectedReadError}=await supabaseAdmin.from('agent_watchers').select('id,condition_json')
    .eq('id',selected.id).eq('telegram_id',tg).eq('active',true).maybeSingle()
  if(selectedReadError||!selectedRow?.id)throw new Error('watcher_stop_selected_read_failed')
  const selectedCondition:any=selectedRow.condition_json||{}
  const {data:updated,error}=await supabaseAdmin.from('agent_watchers').update({
      active:false,next_check_at:null,updated_at:now,
      condition_json:selectedCondition.contextual===true?{...selectedCondition,userStoppedAt:now}:selectedCondition,
    })
    .eq('id',selected.id).eq('telegram_id',tg).eq('active',true).select('id,active,next_check_at').maybeSingle()
  if(error||!updated||updated.active!==false)throw new Error('watcher_stop_update_unverified')
  const {data:verified,error:verifyError}=await supabaseAdmin.from('agent_watchers').select('id,active,next_check_at').eq('id',selected.id).eq('telegram_id',tg).maybeSingle()
  if(verifyError||!verified||verified.active!==false||verified.next_check_at!==null)throw new Error('watcher_stop_read_after_write_failed')
  await dismissIdeasForWatcherIds(tg,[selected.id])
  return {runId:`watcher-stop-${selected.id}`,status:'completed' as const,capability:'browser' as const,risk:'low' as const,text:`Stopped ${selected.title}.`,handledBy:'watcher-stop'}
}

// A storage/capacity variant is a real slot ONLY for products that actually ship in
// multiple capacities (phones, tablets, laptops, drives, consoles…). Headphones,
// watches, shoes, etc. have none — asking about storage there invents an attribute
// (live DEFECT 1, 30 Sep 2026). Evidence = the product name already cites a capacity, or
// names a category that is sold in capacity variants. With no evidence we never ask, and
// never carry a storage token into the watcher query.
const STORAGE_VARIANT_PRODUCT=/\b(iphone|ipad|macbook|imac|mac\s?mini|galaxy\s+(?:s\d|z\s?(?:fold|flip)|tab|book|note|a\d)|pixel|oneplus|redmi|xiaomi|realme|vivo|oppo|nothing\s+phone|tablet|laptop|notebook|ultrabook|chromebook|ssd|hdd|hard\s+dis[kc]|pen\s*drive|thumb\s+drive|usb\s+(?:drive|stick|flash)|flash\s+drive|memory\s+card|micro\s?sd|sd\s+card|kindle|surface|steam\s+deck|playstation|ps5|ps4|xbox|nintendo\s+switch|nvme|smartphone|\bphone\b)\b/i

function storageTokenIn(text:string):string|null{
  const gb=String(text||'').match(/\b(16|32|64|128|256|512)\s*GB\b/i)?.[1]
  if(gb)return `${gb}GB`
  const tb=String(text||'').match(/\b(\d+)\s*TB\b/i)?.[1]
  if(tb)return `${tb}TB`
  return null
}

function productHasStorageEvidence(product:string){
  return Boolean(storageTokenIn(product))||STORAGE_VARIANT_PRODUCT.test(product)
}

// Offers basis from free text. Exclusion MUST win even though the phrase names
// "bank"/"card"/"offers": the live DEFECT 3 was that "exclude bank and card offers" was
// stored (and confirmed back) as INCLUDED. "listed selling price only" is exclusion.
// Returns null when the text does not decide the basis.
export function parseOffersBasis(text:string):'included'|'excluded'|null{
  const raw=clean(text,600).toLowerCase()
  if(/\blisted?\s+(?:selling\s+)?price\s+only\b/.test(raw))return 'excluded'
  if(/\bselling\s+price\s+only\b/.test(raw))return 'excluded'
  if(/\b(?:exclude|excluding|without|no|not|don'?t|do\s+not|ignore|ignoring|skip)\b[^.!?]*\boffers?\b/.test(raw))return 'excluded'
  if(/\boffers?\b[^.!?]*\b(?:excluded|not\s+included|do\s*n'?t\s+count|should\s*n'?t\s+count)\b/.test(raw))return 'excluded'
  if(/\b(?:include|including|count|with|apply|factor\s+in)\b[^.!?]*\boffers?\b/.test(raw))return 'included'
  if(/\boffers?\b[^.!?]*\b(?:included|should\s+count|do\s+count)\b/.test(raw))return 'included'
  return null
}

// The user can declare the storage slot inapplicable ("no storage variant", "it is
// headphones", "N/A"). Such a slot is recorded N/A and never re-asked (live DEFECT 2).
export function declaresStorageNotApplicable(text:string){
  const raw=clean(text,600).toLowerCase()
  if(/\bno\s+storage\b/.test(raw))return true
  if(/\bno\s+(?:storage\s+)?variant\b/.test(raw))return true
  if(/\bstorage\b[^.!?]*\b(?:n\/?a|not\s+applicable|does\s*n'?t\s+apply|doesn'?t\s+exist|not\s+relevant|no\s+such|irrelevant)\b/.test(raw))return true
  if(/\b(?:it\s+is|it'?s|they\s+are|they'?re|these\s+are)\s+(?:a\s+pair\s+of\s+)?(?:headphones?|earphones?|earbuds?|headset)\b/.test(raw))return true
  return false
}

export function parsePriceWatchCommand(text:string){
  const raw=clean(text,1200)
  const m=raw.match(/^(?:please\s+)?(?:watch|monitor|track)\s+(?:the\s+)?price\s+of\s+(.+?)\s+(?:and\s+)?(?:tell|notify|alert|let)\s+me\s+(?:know\s+)?if\s+(?:it|the\s+price)\s+(?:drops?|falls?|goes?)\s+below\s+(.+)$/i)
  if(!m?.[1]||!m?.[2])return null
  const product=clean(m[1],160)
  const threshold=clean(m[2],80)
  return {
    product,
    threshold,
    storage:storageTokenIn(product),
    storageEvidenced:productHasStorageEvidence(product),
    offers:(parseOffersBasis(raw)||'unspecified') as 'included'|'excluded'|'unspecified',
  }
}

type PendingPriceWatch={
  product:string
  threshold:string
  storage:string|null
  storageNA:boolean
  storageEvidenced:boolean
  offers:'included'|'excluded'|'unspecified'
  asks:number
  created_at:string
}

function openPriceSlots(p:PendingPriceWatch){
  // A storage slot is only open when it is evidenced for THIS product, still unanswered,
  // and the user has not declared it inapplicable. An unevidenced product never opens the
  // storage slot, so we never invent "512GB" for headphones.
  const storage=p.storageEvidenced&&!p.storage&&!p.storageNA
  const offers=p.offers==='unspecified'
  return {storage,offers,any:storage||offers}
}

function priceClarifyQuestion(p:PendingPriceWatch,open:{storage:boolean;offers:boolean}){
  const parts:string[]=[]
  if(open.storage)parts.push('which storage should I track (for example 256GB or 512GB)')
  if(open.offers)parts.push(`should the ${p.threshold} threshold include bank/card offers or use the listed selling price only`)
  return {
    runId:'price-watch-clarify',status:'paused' as const,capability:'browser' as const,risk:'low' as const,
    text:`Before I start the persistent watch: ${parts.join(', and ')}?`,handledBy:'price-watch-clarification',
  }
}

async function persistPriceClarification(tg:number,p:PendingPriceWatch){
  await clearFollowupState(tg,'price_watch_clarification')
  await saveFollowupState(tg,'price_watch_clarification',p)
}

// Render the confirmation from the PERSISTED watcher record and verify it agrees with the
// user's explicit constraints (live DEFECT 3, FIX 7/8). The watch query itself carries the
// threshold and the offers basis (phrased so parseWebWatchCommand cannot strip them), so
// the persisted record — not a drifting template — is the single source of truth. A
// mismatch is a FAILED creation, never a formatting problem: we do not announce success.
async function finalizePriceWatch(params:{actor:AgentActor;surface:AgentSurface},p:PendingPriceWatch){
  const offers:'included'|'excluded'=p.offers==='included'?'included':'excluded'
  const storageNA=p.storageNA||!p.storage
  const storageToken=(!storageNA&&p.storage)?` ${p.storage}`:''
  const basisPhrase=offers==='included'?'including bank/card offers':'excluding bank/card offers'
  const synthetic=`watch the web for ${p.product}${storageToken} price in India below ${p.threshold} ${basisPhrase}`
  const created=await tryCreateWebWatchFromCommand({actor:params.actor,surface:params.surface,text:synthetic})
  if(!created)return null
  // Permission / plan / limit gates return a paused result — surface it, never claim success.
  if(created.status!=='completed'||/blocked|limit/i.test(String(created.runId))){
    return {...created,handledBy:'price-watch-clarification'}
  }
  const tg=String(params.actor.legacyTelegramId)
  const {data:persisted,error}=await supabaseAdmin.from('agent_watchers')
    .select('id,condition_json,active')
    .eq('telegram_id',tg).eq('type','web_search').eq('active',true)
    .order('created_at',{ascending:false}).limit(1).maybeSingle()
  if(error||!persisted?.id)throw new Error('price_watch_readback_failed')
  const persistedQuery=String((persisted.condition_json as any)?.query||'')
  const persistedOffers:'included'|'excluded'|'unknown'=
    persistedQuery.includes('including bank/card offers')?'included'
    :persistedQuery.includes('excluding bank/card offers')?'excluded':'unknown'
  const persistedStorage=storageTokenIn(persistedQuery)
  if(persistedOffers!==offers){
    // The saved watch does not match the user's explicit constraint. Do not announce
    // success; deactivate the mis-saved watch so no wrong background watch runs.
    await supabaseAdmin.from('agent_watchers').update({active:false,next_check_at:null,updated_at:new Date().toISOString()})
      .eq('id',persisted.id).eq('telegram_id',tg)
    return {
      runId:'price-watch-verify-failed',status:'paused' as const,capability:'browser' as const,risk:'low' as const,
      text:'I could not confirm the watch was saved with your exact settings (the bank/card offers rule did not match what you asked), so I have not started it. Please try again.',
      handledBy:'price-watch-clarification',
    }
  }
  const basisText=persistedOffers==='included'?'including bank/card offers':'excluding bank/card offers'
  const storageText=persistedStorage?persistedStorage:'no storage variant (N/A)'
  return {
    ...created,
    text:`Persistent watch created: ${p.product}, ${storageText}, India, threshold ${p.threshold}, ${basisText}. ${created.text}`,
    handledBy:'price-watch-clarification',
  }
}

export async function tryRunPriceWatchClarification(params:{actor:AgentActor;surface:AgentSurface;text:string}){
  const tg=params.actor.legacyTelegramId
  const parsed=parsePriceWatchCommand(params.text)

  // A fresh, explicit price command starts (or restarts) the clarification.
  if(parsed){
    const p:PendingPriceWatch={
      product:parsed.product,threshold:parsed.threshold,
      storage:parsed.storage,storageNA:false,storageEvidenced:parsed.storageEvidenced,
      offers:parsed.offers,asks:0,created_at:new Date().toISOString(),
    }
    const open=openPriceSlots(p)
    if(open.any){
      p.asks=1
      await persistPriceClarification(tg,p)
      return priceClarifyQuestion(p,open)
    }
    // Nothing to clarify — proceed with what the command already specified.
    return await finalizePriceWatch(params,p)
  }

  // Otherwise, treat this as a possible reply to a pending clarification.
  const state=await getLatestFollowupState(tg,'price_watch_clarification')
  if(!state||!isStrictlyFreshFollowupState(state,30)||!state.payload)return null
  const p={...(state.payload as PendingPriceWatch)}
  if(typeof p.asks!=='number')p.asks=1

  const replyStorage=storageTokenIn(params.text)
  const replyOffers=parseOffersBasis(params.text)
  const replyNA=declaresStorageNotApplicable(params.text)
  // If the reply advances no open slot it is unrelated to this clarification — let normal
  // routing handle it rather than hijacking the message.
  if(!replyStorage&&!replyOffers&&!replyNA)return null

  if(replyStorage){p.storage=replyStorage;p.storageNA=false}
  if(replyNA){p.storageNA=true;p.storage=null}
  if(replyOffers)p.offers=replyOffers

  const open=openPriceSlots(p)
  // Cap clarification: ask a still-open slot at most one further time, then proceed with
  // what is known. This retains an already-answered slot and re-asks only the remaining
  // one (FIX 3), and can never deadlock a user who corrected a false premise (FIX 2/5).
  if(open.any&&p.asks<2){
    p.asks+=1
    await persistPriceClarification(tg,p)
    return priceClarifyQuestion(p,open)
  }
  await clearFollowupState(tg,'price_watch_clarification')
  // Proceed with what is known. Never invent a storage value; default an unresolved offers
  // basis to EXCLUDED (the literal selling price), the safe reading of an ambiguous reply.
  if(p.offers==='unspecified')p.offers='excluded'
  if(!p.storage)p.storageNA=true
  return await finalizePriceWatch(params,p)
}

export function parseWebWatchCommand(text: string) {
  const raw = clean(text, 2000)
  if (!raw) return null

  const patterns = [
    /^(?:please\s+)?keep\s+(?:searching|looking)\s+(?:the\s+web\s+)?for\s+(.+)$/i,
    /^(?:please\s+)?(?:watch|monitor|track)\s+(?:the\s+)?(?:web|internet|online)\s+(?:for\s+)?(.+)$/i,
    /^(?:please\s+)?watch\s+(.+?)\s+(?:online|on\s+the\s+web)(?:\s+.*)?$/i,
    // Muse parity case 01 (10 Oct live run): "Watch the news on humanoid robots and Indian AI
    // startups. Tell me when something big happens" was answered once as a web search, no watch.
    /^(?:please\s+)?(?:watch|monitor|track|follow)\s+(?:the\s+)?(?:latest\s+)?news\s+(?:on|about|for|around)\s+(.+)$/i,
    /^(?:please\s+)?(?:watch|monitor|track|follow)\s+(.+?)\s+news\b(.*)$/i,
    /^(?:please\s+)?(?:set\s+up\s+|create\s+)?(?:a\s+)?news\s+alerts?\s+(?:on|about|for)\s+(.+)$/i,
    /^(?:please\s+)?keep\s+me\s+(?:updated|posted)\s+(?:on|about)\s+(?:the\s+)?(?:news\s+(?:on|about)\s+)?(.+)$/i,
  ]
  let query = ''
  for (const re of patterns) {
    const m = raw.match(re)
    if (m?.[1]) { query = m[1]; break }
  }
  if (!query) return null

  const news = /\bnews\b|\bkeep\s+me\s+(?:updated|posted)\b/i.test(raw)
  query = query
    .replace(/[.!?]\s+[\s\S]*$/, '')
    .replace(/\s+(?:and\s+)?(?:tell|notify|alert|let)\s+me\s+(?:know\s+)?(?:when|if)\b.*$/i, '')
    .replace(/\s+and\s+message\s+me\b.*$/i, '')
    .trim()
  if (query.length < 3) return null

  const keywordMatch = raw.match(/(?:when|if)\s+(?:you\s+)?(?:see|find|spot|there(?:'s|\s+is))\s+(.+)$/i)
  const triggerKeywords = keywordMatch?.[1]
    ? keywordMatch[1].split(/,|\bor\b/i).map(x => x.trim()).filter(x => x.length >= 2).slice(0, 8)
    : []

  query = query.replace(/[.!?,;:\s]+$/, '').trim()
  if (query.length < 3) return null
  return normalizeWebSearchWatcher({
    title: `${news ? 'News' : 'Watch'}: ${query.slice(0, 120)}`,
    query: news && !/\bnews\b/i.test(query) ? `${query} news` : query,
    triggerKeywords,
    delivery: 'both',
    // News changes over hours, not minutes; a 15-minute search cadence would only add cost.
    cadenceMinutes: news ? 180 : 15,
    originalRequest:raw,
    notifyOnFirstMatch:true,
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

  const {data:consent,error:consentError}=await supabaseAdmin.from('user_consent_settings')
    .select('gmail_enabled').eq('telegram_id',params.actor.legacyTelegramId).maybeSingle()
  if(consentError)throw new Error('inbox_watch_consent_read_failed')
  if(consent?.gmail_enabled===false)return {
    runId:'inbox-watch-reading-disabled',status:'paused' as const,capability:'email' as const,risk:'low' as const,
    text:'Gmail reading is disabled in your saved privacy preference. Connecting Google does not change that preference. I haven’t started an inbox watch or read any mail.',
    blockedReason:'workspace_email_reading_disabled',handledBy:'inbox-triage-watch',
  }
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
      runId:`inbox-watch-existing-${existing.id}`,      status:'completed' as const,
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
  const availabilityIntent = /\b(in\s+stock|back\s+in\s+stock|on\s+stock|comes?\s+(?:on|back\s+in)\s+stock|available|availability|comes?\s+(?:back\s+)?up|becomes?\s+available)\b/i.test(raw)
  if (!watcherIntent || !availabilityIntent) return null

  const variantMatch =
    raw.match(/\b(?:in\s+)?(XXXS|XXS|XS|S|M|L|XL|XXL|XXXL|3XL|4XL|5XL)\s+size\b/i)
    || raw.match(/\bsize\s*[:=-]?\s*(XXXS|XXS|XS|S|M|L|XL|XXL|XXXL|3XL|4XL|5XL)\b/i)
    || raw.match(/\b(?:when|if)\s+(?:size\s+)?(XXXS|XXS|XS|S|M|L|XL|XXL|XXXL|3XL|4XL|5XL)\s+(?:comes?|is|becomes?)\s+(?:on|in|back\s+in)\s+stock\b/i)
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
      const second:any=ranked[1]
      const uniqueBest=best&&best.overlap>=2&&(!second||best.overlap>second.overlap)
      if(uniqueBest){
        parsed={...best.condition,addToCart:/\badd\s+(?:it|this|the\s+(?:item|product))?\s*(?:to|in)\s+(?:my\s+)?(?:cart|bag|basket)\b/i.test(raw)||best.condition.addToCart}
        recoveredWatcher=best.row
      } else if(best&&best.overlap>=2&&second&&best.overlap===second.overlap) {
        return {
          runId:'product-watch-ambiguous',
          status:'paused' as const, capability:'browser' as const, risk:'low' as const,
          text:'I found more than one matching product watch for that size. Please send the product link so I restart the correct one.',
          blockedReason:'ambiguous_product_watch',
          handledBy:'product-stock-watch',
        }
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
    const { count:activeCount, error:activeCountError } = await supabaseAdmin.from('agent_watchers')
      .select('id', { count:'exact', head:true })
      .eq('telegram_id', tg)
      .in('type', ['web_search','web_page','product_stock'])
      .eq('active', true)
    if(activeCountError)throw new Error(`agent_watcher_count_failed:${activeCountError.message}`)
    if((activeCount||0)>=budget.activeWebWatchersMax){
      return {
        runId:'product-watch-plan-limit',
        status:'paused' as const, capability:'browser' as const, risk:'low' as const,        text:watcherUpgradeMessage(budget.planCode),
        blockedReason:'plan_background_watch_limit',
        handledBy:'product-stock-watch',
      }
    }
    await dismissIdeasForWatcherIds(tg,[String(recoveredWatcher.id)])
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
    risk:'low' as const,    text:`The product watch is no longer active, and I don’t have a verified ${variant} availability event to report. I won’t claim it was available without verification.`,
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
    text: `Background Gogo is now watching “${condition.query}”. Your request is saved. I’ll check about every ${condition.cadenceMinutes} minutes initially and send the first relevant result with its source link${condition.delivery !== 'app' ? ' in WhatsApp and Ideas' : ' in Ideas'}. Quiet checks may slow down within your plan. Search results are leads; prices, availability and offer terms need provider verification. Say “show my watches” for status or stop a watch by name.`,
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

  // Same paused-train / product-code hijack family (documented in train-research.ts):
  // "...drops below 22000" and model codes like WH-1000XM5 must never be read as a
  // flight. A real flight code is airline letters + up to 4 digits; a bare run of 5+
  // digits is a price, PIN, amount or model number. Reject a purely numeric 5+ digit
  // identifier (longer-token rule), and reject any identifier with a currency / price /
  // quantity token adjacent to it (adjacency rule).
  const digitCount = (code + number).replace(/\D/g, '').length
  if (!/[A-Z]/.test(code) && digitCount >= 5) return null
  const start = match.index || 0
  const PRICE_QTY_TOKEN = /(?:₹|\brs\b|\brupees?\b|\binr\b|\bprices?\b|\bcosts?\b|\bunder\b|\bbelow\b|\babove\b|\bdrops?\b|\bamounts?\b|\bpin\b|\botp\b|\bcode\b)/i
  if (PRICE_QTY_TOKEN.test(raw.slice(Math.max(0, start - 16), start)) || PRICE_QTY_TOKEN.test(raw.slice(matchedEnd, matchedEnd + 16))) return null

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
