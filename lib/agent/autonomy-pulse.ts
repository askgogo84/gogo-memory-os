import { createHash, randomUUID } from 'node:crypto'
import { allowedByTopic, dueForCheck, getAlertPreferences, isQuietHour, topicForPulse, DEFAULT_ALERT_PREFERENCES, type AlertPreferences, type AlertTopic } from './alert-preferences'
import { browserFailureSummary } from './browser-failure-notice'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendWhatsApp, sendWhatsAppReminderTemplate } from '@/lib/whatsapp'
import { retiredRunReason, isRelevantOpenLoop } from './task-lifecycle'
import { decodeHtmlEntities } from './google-workspace-read'
import { isEmailLoop, selectProactiveEmails, formatProactiveEmailCard, type EmailLoop } from '@/lib/email/proactive'

const PULSE_COOLDOWN_MINUTES=180
const MAX_USERS_PER_PASS=80

// Exact owner (P0.1): a safe id is queried as its exact number, a larger id as its exact decimal string.
function ownerKey(telegramId:string):number|string{const n=Number(telegramId);return Number.isSafeInteger(n)&&String(n)===telegramId?n:telegramId}
function clean(value:unknown,max=500){return String(value??'').replace(/\s+/g,' ').trim().slice(0,max)}
function fingerprint(parts:string[]){return createHash('sha256').update(parts.join('|')).digest('hex').slice(0,32)}

function localHour(timezone:string){
  try{
    const part=new Intl.DateTimeFormat('en-GB',{timeZone:timezone||'Asia/Kolkata',hour:'2-digit',hour12:false}).formatToParts(new Date()).find(x=>x.type==='hour')
    return Number(part?.value||12)
  }catch{return 12}
}
function fmtWhen(iso:string|null|undefined,timezone:string){
  if(!iso)return ''
  try{return new Intl.DateTimeFormat('en-IN',{timeZone:timezone||'Asia/Kolkata',weekday:'short',day:'numeric',month:'short',hour:'numeric',minute:'2-digit',hour12:true}).format(new Date(iso))}catch{return ''}
}

// Duet reviewers' worry: a polished brief can silently drop the email that mattered. Every surfaced item links to
// its source so the person can check it in one tap. Only ids Gogo stored itself; never a link taken from email text.
export function openLoopSourceLink(loop:{source_type?:string|null;source_id?:string|null}):string{
  const type=String(loop?.source_type||''),id=String(loop?.source_id||'').trim()
  if((type==='gmail_thread'||type==='gmail_service_notice')&&/^[A-Za-z0-9_-]{6,64}$/.test(id))return `Open email: https://mail.google.com/mail/u/0/#all/${id}`
  if(type==='calendar_conflict')return 'Open calendar: https://app.askgogo.in/dashboard/calendar'
  return ''
}

type PulseItem={key:string;score:number;line:string;kind:string;topic?:AlertTopic|null}

function usefulOpenLoopTitle(value:unknown){
  const title=clean(value,170)
  if(!title)return''
  const generic=/^(?:waiting on me|waiting|pending|open loop|follow up|follow-up|needs attention)$/i
  return generic.test(title)?'':title
}

async function candidateUserIds(){
  const since=new Date(Date.now()-72*3600_000).toISOString()
  const future=new Date(Date.now()+7*86400_000).toISOString()
  const queries=[
    supabaseAdmin.from('agent_approvals').select('telegram_id').eq('status','pending').gte('requested_at',since).limit(500),
    supabaseAdmin.from('agent_ideas').select('telegram_id').eq('status','new').gte('created_at',since).limit(500),
    supabaseAdmin.from('agent_runs').select('telegram_id').in('status',['waiting_approval','paused','outcome_unknown','failed']).gte('updated_at',since).limit(500),
    supabaseAdmin.from('life_events').select('telegram_id').gte('start_at',new Date().toISOString()).lte('start_at',future).limit(500),
    supabaseAdmin.from('agent_open_loops').select('telegram_id').eq('status','active').gte('priority',0.85).or(`next_check_at.is.null,next_check_at.lte.${new Date().toISOString()}`).or(`proactive_backoff_until.is.null,proactive_backoff_until.lte.${new Date().toISOString()}`).limit(500),
  ]
  const results=await Promise.all(queries)
  const ids=new Set<string>()
  for(const result of results){
    if(result.error)console.error('AUTONOMY_PULSE_CANDIDATE_READ_FAILED:',result.error.message)
    for(const row of result.data||[])if(row.telegram_id)ids.add(String(row.telegram_id))
  }
  // Rotate fairly across the eligible population: users already processed inside
  // the pulse cooldown do not consume this pass's capacity.
  const cooldownCutoff=new Date(Date.now()-PULSE_COOLDOWN_MINUTES*60_000).toISOString()
  const {data:recent,error:recentError}=await supabaseAdmin.from('agent_activity')
    .select('telegram_id')
    .eq('event_type','autonomy_pulse_sent')
    .gte('created_at',cooldownCutoff)
    .limit(5000)
  if(recentError)console.error('AUTONOMY_PULSE_RECENT_READ_FAILED:',recentError.message)
  const recentlyProcessed=new Set((recent||[]).map((row:any)=>String(row.telegram_id||'')).filter(Boolean))
  return Array.from(ids).filter(id=>!recentlyProcessed.has(id)).sort().slice(0,MAX_USERS_PER_PASS)
}

async function lastPulseAt(telegramId:string,withinMinutes:number):Promise<string|null>{
  const {data,error}=await supabaseAdmin.from('agent_activity').select('created_at')
    .eq('telegram_id',telegramId).in('event_type',['autonomy_pulse_sent','autonomy_email_sent'])
    .gte('created_at',new Date(Date.now()-withinMinutes*60_000).toISOString())
    .order('created_at',{ascending:false}).limit(1).maybeSingle()
  if(error)console.error('AUTONOMY_PULSE_LAST_READ_FAILED:',error.message)
  return (data as any)?.created_at||null
}

async function lastPulse(telegramId:string){
  const cutoff=new Date(Date.now()-PULSE_COOLDOWN_MINUTES*60_000).toISOString()
  const {data}=await supabaseAdmin.from('agent_activity')
    .select('metadata_json,created_at')
    .eq('telegram_id',telegramId)
    .eq('event_type','autonomy_pulse_sent')
    .gte('created_at',cutoff)
    .order('created_at',{ascending:false})
    .limit(1)
    .maybeSingle()
  return data||null
}

async function fetchPulseIdeas(telegramId:string){
  const rows:any[]=[]
  const pageSize=200
  for(let from=0;;from+=pageSize){
    const {data,error}=await supabaseAdmin.from('agent_ideas')
      .select('id,title,reason,expected_value,value_score,action_label,created_at,snoozed_until,source_refs')
      .eq('telegram_id',telegramId).eq('status','new')
      .order('value_score',{ascending:false}).range(from,from+pageSize-1)
    if(error)throw new Error(`autonomy_pulse_idea_read_failed:${error.message}`)
    rows.push(...(data||[]))
    if((data||[]).length<pageSize)break
  }
  return rows
}

// Notification grouping only: never merge/delete tasks. Keep different goals,
// parent comparisons and failure explanations separate, even on the same site.
function browserBlocker(run:any){
  const meta=run.metadata_json||{}
  if(run.status!=='failed'||meta.mode!=='read'||meta.plan_type!=='secure_browser')return null
  const summary=browserFailureSummary(run.error)
  const objective=clean(meta.objective,1800).toLowerCase()
  const identity=objective?[String(meta.commerce_parent_id||''),String(meta.url||''),objective]:[String(run.id)]
  return {key:`browser_blocker:${fingerprint([...identity,summary])}`,summary}
}

async function recentBrowserNotices(telegramId:string){
  // Cover the entire 48h candidate horizon, not just the 3h send cooldown.
  const {data,error}=await supabaseAdmin.from('agent_activity').select('metadata_json')
    .eq('telegram_id',telegramId).eq('event_type','autonomy_pulse_sent')
    .gte('created_at',new Date(Date.now()-48*3600_000).toISOString())
    .order('created_at',{ascending:false}).limit(100)
  if(error)throw new Error('autonomy_pulse_history_read_failed')
  return new Set<string>((data||[]).flatMap((row:any)=>Array.isArray(row.metadata_json?.item_keys)?row.metadata_json.item_keys:[]))
}

// Keys of everything surfaced proactively in the last `hours` (pulse lines and email cards).
async function recentSurfacedKeys(telegramId:string,hours:number){
  const {data,error}=await supabaseAdmin.from('agent_activity').select('event_type,metadata_json,created_at')
    .eq('telegram_id',telegramId).in('event_type',['autonomy_pulse_sent','autonomy_email_sent'])
    .gte('created_at',new Date(Date.now()-hours*3600_000).toISOString())
    .order('created_at',{ascending:false}).limit(300)
  if(error)throw new Error('autonomy_pulse_history_read_failed')
  return (data||[]).map((row:any)=>({type:String(row.event_type),at:String(row.created_at||''),keys:Array.isArray(row.metadata_json?.item_keys)?row.metadata_json.item_keys.map(String):[] as string[]}))
}

function localDay(iso:string|number,timezone:string){
  try{return new Intl.DateTimeFormat('en-CA',{timeZone:timezone||'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(iso))}catch{return ''}
}

const EVENT_BADGE:Record<string,string>={flight:'✈️',travel:'✈️',train:'🚆',hotel:'🏨',stay:'🏨',hotel_stay:'🏨',reservation:'🍽️',dining:'🍽️',meeting:'📅',appointment:'📅',event:'🎟️',movie:'🎬',cab:'🚕'}
function eventBadge(type:unknown){return EVENT_BADGE[String(type||'').toLowerCase()]||'📅'}

async function buildPulse(telegramId:string,timezone:string,prefs:AlertPreferences=DEFAULT_ALERT_PREFERENCES):Promise<{items:PulseItem[];fingerprint:string}>{
  const nowIso=new Date().toISOString()
  const future72=new Date(Date.now()+72*3600_000).toISOString()
  const since48=new Date(Date.now()-48*3600_000).toISOString()
  const [approvalRes,ideas,runsRes,eventsRes,openLoopsRes]=await Promise.all([
    supabaseAdmin.from('agent_approvals').select('id,title,risk_level,requested_at').eq('telegram_id',telegramId).eq('status','pending').order('requested_at',{ascending:false}).limit(3),
    fetchPulseIdeas(telegramId),
    supabaseAdmin.from('agent_runs').select('id,status,title,summary,updated_at,error,metadata_json').eq('telegram_id',telegramId).in('status',['waiting_approval','paused','outcome_unknown','failed']).gte('updated_at',since48).order('updated_at',{ascending:false}).limit(6),
    supabaseAdmin.from('life_events').select('id,event_type,title,start_at,location,lifecycle_state,next_action_at').eq('telegram_id',telegramId).gte('start_at',nowIso).lte('start_at',future72).order('start_at',{ascending:true}).limit(5),
    supabaseAdmin.from('agent_open_loops').select('id,kind,title,summary,priority,due_at,next_check_at,proactive_backoff_until,source_type,source_id').eq('telegram_id',telegramId).eq('status','active').gte('priority',0.85).not('source_type','in','(approval,agent_run,life_event_action)').or(`next_check_at.is.null,next_check_at.lte.${nowIso}`).or(`proactive_backoff_until.is.null,proactive_backoff_until.lte.${nowIso}`).order('priority',{ascending:false}).limit(8),
  ])
  const approvals=approvalRes.data||[]
  const runs=runsRes.data||[]
  const seenBrowserNotices=runs.some(browserBlocker)?await recentBrowserNotices(telegramId):new Set<string>()
  // Recognize previously sent run-ID keys during rollout without rewriting history.
  for(const run of runs){
    const blocker=browserBlocker(run)
    if(blocker&&seenBrowserNotices.has(`run:${run.id}:${run.status}`))seenBrowserNotices.add(blocker.key)
  }
  const events=eventsRes.data||[]
  const openLoops=openLoopsRes.data||[]
  const items:PulseItem[]=[]
  const ideaWatcherIds=[...new Set((ideas||[]).flatMap((idea:any)=>{
    const refs=Array.isArray(idea.source_refs)?idea.source_refs:[]
    return refs.filter((ref:any)=>String(ref?.type||'')==='watcher').map((ref:any)=>String(ref?.id||'')).filter(Boolean)
  }))]
  const surfacableIdeaWatchers=new Set<string>()
  if(ideaWatcherIds.length){
    const {data:watcherRows,error:watcherError}=await supabaseAdmin.from('agent_watchers')
      .select('id,active,last_state_json').in('id',ideaWatcherIds).eq('telegram_id',telegramId)
    if(watcherError)console.error('AUTONOMY_PULSE_IDEA_WATCHER_READ_FAILED:',watcherError.message)
    for(const row of watcherRows||[]){
      const state:any=row.last_state_json||{}
      // Active watchers are current. Inactive one-shot watchers remain surfacable only
      // when they actually triggered successfully; manually stopped/stale watchers are not.
      if(row.active===true || state.triggered===true)surfacableIdeaWatchers.add(String(row.id))
    }
  }

  for(const a of approvals||[]){
    items.push({key:`approval:${a.id}`,score:100,line:`🛡️ *Needs your approval*: ${clean(a.title,160)}`,kind:'approval'})
  }
  for(const loop of openLoops||[]){
    if(!isRelevantOpenLoop(loop))continue
    // Email goes only through the selective email card (at most 2 a day), never as a pulse line.
    if(isEmailLoop(loop))continue
    if(loop.next_check_at && Date.parse(String(loop.next_check_at))>Date.now())continue
    const score=Math.round(Math.max(0,Math.min(1,Number(loop.priority||0.8)))*100)
    const title=usefulOpenLoopTitle(loop.title)
    if(!title)continue
    const badge=loop.kind==='followup'?'📨':loop.kind==='waiting_on'?'⏳':loop.kind==='approval'?'🛡️':loop.kind==='life_event'?'✈️':'•'
    const action=clean(loop.summary,160)
    const source=openLoopSourceLink(loop)
    items.push({key:`open_loop:${loop.id}`,score,line:`${badge} ${title}${action&&action.toLowerCase()!==title.toLowerCase()?` — ${action}`:''}${source?`\n   ${source}`:''}`,kind:'open_loop',topic:topicForPulse('open_loop',loop)})
  }
  // 1 Nov live: the same hotel stay was repeated in every pulse. An upcoming event is mentioned once a day.
  const eventKeysToday=events.length?new Set((await recentSurfacedKeys(telegramId,20)).flatMap(r=>r.keys).filter(k=>k.startsWith('event:'))):new Set<string>()
  for(const e of events||[]){
    if(eventKeysToday.has(`event:${e.id}:${e.start_at}`))continue
    const hours=(new Date(e.start_at).getTime()-Date.now())/3600_000
    const score=hours<=24?94:hours<=48?84:76
    const when=fmtWhen(e.start_at,timezone)
    const where=clean(e.location,100)
    items.push({key:`event:${e.id}:${e.start_at}`,score,line:`${eventBadge(e.event_type)} ${clean(e.title,150)} — ${when}${where?` · ${where}`:''}`,kind:'life_event'})
  }
  const suppressedRunErrors=new Set([
    'stale_provider_access_limited',
    'background_browser_resume_expired',
    'stale_run_recovered',
    'background_browser_actor_missing',
  ])
  const seenRunTitles=new Set<string>()
  for(const r of runs||[]){
    if(retiredRunReason(r))continue
    // The owner already got this run's one outcome message (run-notify); don't announce it again.
    if((r.metadata_json as any)?.outcome_notified_at)continue
    if(String(r.status)==='waiting_approval')continue
    const errorCode=clean(r.error,160)
    if(suppressedRunErrors.has(errorCode))continue
    const ageHours=(Date.now()-Date.parse(String(r.updated_at||0)))/3600_000
    if(String(r.status)==='failed'&&ageHours>6)continue
    if(String(r.status)==='paused'&&ageHours>24)continue
    // 10 Oct: three identical "huggingface.co needs verification" lines from superseded sign-up
    // attempts. One line per task title, and unverified outcomes stop repeating after two days.
    if(String(r.status)==='outcome_unknown'&&ageHours>48)continue
    const blocker=browserBlocker(r)
    if(blocker){
      if(seenBrowserNotices.has(blocker.key))continue
      items.push({key:blocker.key,score:86,line:`*${clean(r.title,150)}*: ${blocker.summary}\nTask details: https://app.askgogo.in/dashboard/activity/${encodeURIComponent(String(r.id))}`,kind:'browser_blocker'})
      continue
    }
    const titleKey=clean(r.title,150).toLowerCase()
    if(seenRunTitles.has(titleKey))continue
    seenRunTitles.add(titleKey)
    const score=String(r.status)==='outcome_unknown'?92:String(r.status)==='failed'?86:80
    const label=String(r.status)==='outcome_unknown'?'needs verification':String(r.status)==='failed'?'hit a blocker':'is paused'
    items.push({key:`run:${r.id}:${r.status}`,score,line:`🧠 *${clean(r.title,150)}* ${label}. ${clean(r.summary,190)}`,kind:'run'})
  }
  const now=Date.now()
  for(const idea of ideas||[]){
    if(idea.snoozed_until && Date.parse(String(idea.snoozed_until))>now)continue
    const score=Math.round(Math.max(0,Math.min(1,Number(idea.value_score||0.75)))*100)
    const refs=Array.isArray(idea.source_refs)?idea.source_refs:[]
    const watcherRefs=refs.filter((ref:any)=>String(ref?.type||'')==='watcher').map((ref:any)=>String(ref?.id||'')).filter(Boolean)
    if(watcherRefs.length&&!watcherRefs.some((id:string)=>surfacableIdeaWatchers.has(id)))continue
    const fromMemoryTwin=refs.some((ref:any)=>String(ref?.type||'')==='memory_twin')
    // Memory Twin suggestions are useful in the dashboard, but only exceptionally
    // strong ones should interrupt the user proactively.
    if(fromMemoryTwin&&score<90)continue
    if(!fromMemoryTwin&&score<85)continue
    items.push({key:`idea:${idea.id}`,score,line:`${clean(idea.title,150)} — ${clean(idea.reason||idea.expected_value,200)}`,kind:'idea'})
  }

  const dedup=new Map<string,PulseItem>()
  // Duet parity: only the topics this person chose (approvals they are waiting on are never muted).
  for(const item of items.filter(item=>allowedByTopic(prefs,item.topic===undefined?topicForPulse(item.kind):item.topic)).sort((a,b)=>b.score-a.score))if(!dedup.has(item.key))dedup.set(item.key,item)
  // Two threads with the same sender and subject (two JioFiber surveys) read as one line, so show it once.
  const seenLines=new Set<string>()
  const top=Array.from(dedup.values()).filter(item=>{const k=item.line.toLowerCase().replace(/\s+/g,' ').trim();if(seenLines.has(k))return false;seenLines.add(k);return true}).slice(0,3)
  return {items:top,fingerprint:fingerprint(top.map(x=>x.key))}
}

async function hasRecentWhatsAppSession(telegramId:string){
  const cutoff=new Date(Date.now()-23*3600_000).toISOString()
  const {data,error}=await supabaseAdmin.from('agent_activity')
    .select('id')
    .eq('telegram_id',telegramId)
    .eq('event_type','shadow_brain_observation')
    .contains('metadata_json',{surface:'whatsapp'})
    .gte('created_at',cutoff)
    .order('created_at',{ascending:false})
    .limit(1)
  if(error){
    console.error('AUTONOMY_PULSE_SESSION_READ_FAILED:',error.message)
    return false
  }
  return Boolean(data?.length)
}

async function sendPulse(telegramId:string){
  const {data:user,error}=await supabaseAdmin.from('users')
    .select('telegram_id,whatsapp_id,name,timezone,gmail_email')
    .eq('telegram_id',ownerKey(telegramId))
    .maybeSingle()
  if(error||!user?.whatsapp_id||String(user.telegram_id)!==telegramId)return {sent:false,reason:'user_unavailable'}
  const timezone=String(user.timezone||'Asia/Kolkata')
  const hour=localHour(timezone)
  // Duet parity: the person's own quiet hours (default 10 pm–7 am, as before) and check frequency.
  const prefs=await getAlertPreferences(telegramId)
  if(isQuietHour(prefs,hour))return {sent:false,reason:'quiet_hours'}
  if(!dueForCheck(prefs,await lastPulseAt(telegramId,prefs.checkEveryMinutes)))return {sent:false,reason:'frequency'}

  const activeSession=await hasRecentWhatsAppSession(telegramId)
  const emailCard=await sendProactiveEmailCard(telegramId,user,timezone,prefs,activeSession)
  // An unknown provider outcome or broken receipt is not permission to send another alert in this pass.
  if(emailCard.sent||emailCard.reason==='outcome_unknown'||emailCard.reason==='recording_failed')return emailCard

  const pulse=await buildPulse(telegramId,timezone,prefs)
  if(!pulse.items.length)return {sent:false,reason:'nothing_material'}
  const previous=await lastPulse(telegramId)
  if(String(previous?.metadata_json?.fingerprint||'')===pulse.fingerprint)return {sent:false,reason:'duplicate'}

  // Email subjects and snippets can arrive HTML-escaped ("company&#39;s"); never show the raw entity.
  const message=decodeHtmlEntities([
    ...pulse.items.map(x=>x.line),
    '',
    'If you want the full status, ask *what are you working on for me?*',
  ].join('\n'))
    // 16 Oct live: a demat statement's subject put the full account number on WhatsApp. Long digit runs
    // (account, folio, card numbers) show only their last four.
    .replace(/\b\d{9,20}\b/g,(digits:string)=>'••••'+digits.slice(-4))
  // Use natural free-form copy while the WhatsApp service window is open.
  // Outside the window we must fall back to an approved Utility template.
  let delivered:any=null
  if(activeSession){
    delivered=await sendWhatsApp(String(user.whatsapp_id),message)
  }else{
    const templateLabel=[
      'Gogo update',
      ...pulse.items.map(item=>item.line.replace(/[*_]/g,'').replace(/^\S+\s*/,'').trim()),
    ].join(' · ').slice(0,400)
    delivered=await sendWhatsAppReminderTemplate(String(user.whatsapp_id),templateLabel)
  }
  if(!delivered?.sid)throw new Error('autonomy_pulse_delivery_not_accepted')
  const surfacedOpenLoopIds=pulse.items
    .map(item=>item.key.match(/^open_loop:(.+)$/)?.[1]||'')
    .filter(Boolean)
  if(surfacedOpenLoopIds.length){
    const nextAttentionAt=new Date(Date.now()+24*3600_000).toISOString()
    const {error:attentionError}=await supabaseAdmin.from('agent_open_loops')
      .update({proactive_backoff_until:nextAttentionAt,updated_at:new Date().toISOString()})
      .in('id',surfacedOpenLoopIds)
      .eq('telegram_id',telegramId)
      .eq('status','active')
    if(attentionError)console.error('AUTONOMY_PULSE_OPEN_LOOP_BACKOFF_FAILED:',attentionError.message)
  }
  await supabaseAdmin.from('agent_activity').insert({
    telegram_id:telegramId,
    event_type:'autonomy_pulse_sent',
    message:'Background Gogo proactively surfaced high-signal items.',
    metadata_json:{fingerprint:pulse.fingerprint,item_keys:pulse.items.map(x=>x.key),kinds:pulse.items.map(x=>x.kind),delivery_mode:activeSession?'freeform':'template',open_loop_backoff_ids:surfacedOpenLoopIds},
  })
  return {sent:true,count:pulse.items.length}
}

// The selective email card: only email that clearly needs the person, at most 2 a day, each email once.
// Proactive notifications use a DB-atomic owner/day reservation BEFORE the first provider attempt.
// A lost/unknown provider outcome leaves the reservation permanently fenced: manual review only.
async function sendProactiveEmailCard(telegramId:string,user:any,timezone:string,prefs:AlertPreferences,activeSession:boolean):Promise<{sent:boolean;reason?:string;count?:number}>{
  if(!user?.whatsapp_id||String(user.telegram_id??'')!==telegramId)
    return {sent:false,reason:'recipient_owner_unverified'}
  const {data:loops,error:loopError}=await supabaseAdmin.from('agent_open_loops')
    .select('id,kind,title,summary,source_type,source_id,evidence_json,created_at')
    .eq('telegram_id',telegramId).eq('status','active').in('source_type',['gmail_thread','gmail_service_notice'])
    .order('updated_at',{ascending:false}).limit(40)
  if(loopError){console.error('AUTONOMY_EMAIL_LOOP_READ_FAILED:',loopError.message);return {sent:false,reason:'email_read_failed'}}
  const allowed=((loops||[]) as EmailLoop[]).filter(loop=>allowedByTopic(prefs,topicForPulse('open_loop',loop)))
  if(!allowed.length)return {sent:false,reason:'no_email'}
  const history=await recentSurfacedKeys(telegramId,30*24)
  const alreadySurfaced=new Set(history.flatMap(r=>r.keys))
  const today=localDay(Date.now(),timezone)
  if(!/^\d{4}-\d{2}-\d{2}$/.test(today))return {sent:false,reason:'local_day_invalid'}
  const sentToday=history.filter(r=>r.type==='autonomy_email_sent'&&localDay(r.at,timezone)===today).reduce((n,r)=>n+r.keys.length,0)
  const {data:ruleRows,error:ruleError}=await supabaseAdmin.from('email_attention_rules').select('kind,match_type,match_value,category,label,source').eq('telegram_id',ownerKey(telegramId)).eq('active',true).limit(300)
  if(ruleError)return {sent:false,reason:'email_rules_unavailable'}
  const rules=(ruleRows||[]).map((r:any)=>({kind:r.kind,matchType:r.match_type,matchValue:String(r.match_value||''),category:r.category,label:String(r.label||''),source:r.source}))
  const picked=selectProactiveEmails(allowed,{rules,ownEmail:String(user.gmail_email||'').toLowerCase()||null,alreadySurfaced,sentToday})
  if(!picked.length)return {sent:false,reason:'no_important_email'}

  // Claims are unique by exact owner and thread across all time, and the DB serializes
  // the two-item local-day budget. Activity history alone is NOT a concurrency lock.
  const claimToken=randomUUID()
  const threadKeys=picked.map(p=>`email:${p.threadId||p.loopId}`)
  const {data:claimed,error:claimError}=await supabaseAdmin.rpc('claim_autonomy_email_card',{
    p_owner:telegramId,p_day:today,p_threads:threadKeys,p_token:claimToken,p_prior_count:sentToday,
  })
  if(claimError){console.error('AUTONOMY_EMAIL_CLAIM_FAILED:',claimError.message);return {sent:false,reason:'claim_unavailable'}}
  if(claimed!==true)return {sent:false,reason:'already_claimed_or_daily_cap'}

  const text=decodeHtmlEntities(formatProactiveEmailCard(picked,{timezone})).replace(/\b\d{9,20}\b/g,(digits:string)=>'••••'+digits.slice(-4))
  let delivered:any
  try{
    delivered=activeSession
      ?await sendWhatsApp(String(user.whatsapp_id),text)
      :await sendWhatsAppReminderTemplate(String(user.whatsapp_id),['Gogo update',...picked.map(p=>`${p.senderName}: ${p.why}`)].join(' · ').slice(0,400))
  }catch{
    // Provider may have accepted an apparently failed request. Never reclaim or resend.
    console.error('AUTONOMY_EMAIL_PROVIDER_OUTCOME_UNKNOWN')
    return {sent:false,reason:'outcome_unknown'}
  }
  if(!delivered?.sid)return {sent:false,reason:'outcome_unknown'}
  const {data:accepted,error:acceptError}=await supabaseAdmin.rpc('finish_autonomy_email_card',{
    p_owner:telegramId,p_token:claimToken,p_provider_id:String(delivered.sid),
  })
  if(acceptError||accepted!==true){
    console.error('AUTONOMY_EMAIL_ACCEPTANCE_RECORD_FAILED:',acceptError?.message||'not_recorded')
    return {sent:false,reason:'recording_failed'}
  }
  const key=ownerKey(telegramId)
  // "open 1" / "not important 1" bind to the latest 📬 reply, not merely the provider SID.
  const [convo,shown]=await Promise.all([
    supabaseAdmin.from('conversations').insert({telegram_id:key,role:'assistant',content:text}),
    supabaseAdmin.from('email_attention_events').insert({telegram_id:key,kind:'shown',payload:{proactive:true,gmailEmail:user.gmail_email||null,items:picked.map((p,i)=>({
      index:i+1,id:p.email.id,threadId:p.threadId,messageId:null,from:p.email.from,subject:clean(p.email.subject,200),snippet:clean(p.email.snippet,500),
      category:p.category,senderEmail:p.senderEmail,senderName:p.senderName,why:p.why,ask:p.ask,source:'gmail',score:p.score,
    }))}}),
  ])
  if(convo.error)console.error('AUTONOMY_EMAIL_CONVERSATION_FAILED:',convo.error.message)
  if(shown.error)console.error('AUTONOMY_EMAIL_SHOWN_FAILED:',shown.error.message)
  if(convo.error||shown.error)return {sent:false,reason:'recording_failed'}
  const loopIds=picked.map(p=>p.loopId)
  const {error:backoffError}=await supabaseAdmin.from('agent_open_loops')
    .update({proactive_backoff_until:new Date(Date.now()+30*86400_000).toISOString(),updated_at:new Date().toISOString()})
    .in('id',loopIds).eq('telegram_id',telegramId).eq('status','active')
  if(backoffError)console.error('AUTONOMY_EMAIL_BACKOFF_FAILED:',backoffError.message)
  const {error:activityError}=await supabaseAdmin.from('agent_activity').insert({
    telegram_id:telegramId,event_type:'autonomy_email_sent',
    message:'Background Gogo surfaced email that clearly needs the person.',
    metadata_json:{item_keys:threadKeys,open_loop_ids:loopIds,scores:picked.map(p=>p.score),categories:picked.map(p=>p.category),
      delivery_mode:activeSession?'freeform':'template',provider_acceptance_only:true},
  })
  if(activityError){console.error('AUTONOMY_EMAIL_ACTIVITY_WRITE_FAILED:',activityError.message);return {sent:false,reason:'recording_failed'}}
  // "sent" means provider accepted AND local durable records exist, not recipient-visible delivery.
  return {sent:true,count:picked.length}
}

export async function processAutonomyPulse(){
  const ids=await candidateUserIds()
  let sent=0,skipped=0,failed=0
  const results:any[]=[]
  for(const telegramId of ids){
    try{
      const result=await sendPulse(telegramId)
      if(result.sent)sent++;else skipped++
      results.push({telegramId,status:result.sent?'sent':result.reason})
    }catch(err:any){
      failed++
      console.error('AUTONOMY_PULSE_USER_FAILED:',telegramId,err?.message||err)
      results.push({telegramId,status:'failed'})
    }
  }
  return {considered:ids.length,sent,skipped,failed,results}
}
