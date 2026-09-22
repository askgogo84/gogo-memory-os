import { createHash } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendWhatsApp, sendWhatsAppReminderTemplate } from '@/lib/whatsapp'

const PULSE_COOLDOWN_MINUTES=180
const MAX_USERS_PER_PASS=80

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

type PulseItem={key:string;score:number;line:string;kind:string}

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

async function buildPulse(telegramId:string,timezone:string):Promise<{items:PulseItem[];fingerprint:string}>{
  const nowIso=new Date().toISOString()
  const future72=new Date(Date.now()+72*3600_000).toISOString()
  const since48=new Date(Date.now()-48*3600_000).toISOString()
  const [{data:approvals},{data:ideas},{data:runs},{data:events},{data:openLoops}]=await Promise.all([
    supabaseAdmin.from('agent_approvals').select('id,title,risk_level,requested_at').eq('telegram_id',telegramId).eq('status','pending').order('requested_at',{ascending:false}).limit(3),
    supabaseAdmin.from('agent_ideas').select('id,title,reason,expected_value,value_score,action_label,created_at,snoozed_until,source_refs').eq('telegram_id',telegramId).eq('status','new').order('value_score',{ascending:false}).limit(8),
    supabaseAdmin.from('agent_runs').select('id,status,title,summary,updated_at,error').eq('telegram_id',telegramId).in('status',['waiting_approval','paused','outcome_unknown','failed']).gte('updated_at',since48).order('updated_at',{ascending:false}).limit(6),
    supabaseAdmin.from('life_events').select('id,event_type,title,start_at,location,lifecycle_state,next_action_at').eq('telegram_id',telegramId).gte('start_at',nowIso).lte('start_at',future72).order('start_at',{ascending:true}).limit(5),
    supabaseAdmin.from('agent_open_loops').select('id,kind,title,summary,priority,due_at,next_check_at,proactive_backoff_until,source_type').eq('telegram_id',telegramId).eq('status','active').gte('priority',0.85).not('source_type','in','(approval,agent_run,life_event_action)').or(`next_check_at.is.null,next_check_at.lte.${nowIso}`).or(`proactive_backoff_until.is.null,proactive_backoff_until.lte.${nowIso}`).order('priority',{ascending:false}).limit(8),
  ])
  const items:PulseItem[]=[]

  for(const a of approvals||[]){
    items.push({key:`approval:${a.id}`,score:100,line:`🛡️ *Needs your approval*: ${clean(a.title,160)}`,kind:'approval'})
  }
  for(const loop of openLoops||[]){
    if(loop.next_check_at && Date.parse(String(loop.next_check_at))>Date.now())continue
    const score=Math.round(Math.max(0,Math.min(1,Number(loop.priority||0.8)))*100)
    const badge=loop.kind==='followup'?'📨':loop.kind==='waiting_on'?'⏳':loop.kind==='approval'?'🛡️':loop.kind==='life_event'?'✈️':'🧠'
    items.push({key:`open_loop:${loop.id}`,score,line:`${badge} *Open loop*: ${clean(loop.title,170)}`,kind:'open_loop'})
  }
  for(const e of events||[]){
    const hours=(new Date(e.start_at).getTime()-Date.now())/3600_000
    const score=hours<=24?94:hours<=48?84:76
    const when=fmtWhen(e.start_at,timezone)
    const where=clean(e.location,100)
    items.push({key:`event:${e.id}:${e.start_at}`,score,line:`✈️ *Upcoming*: ${clean(e.title,150)} — ${when}${where?` · ${where}`:''}`,kind:'life_event'})
  }
  const suppressedRunErrors=new Set([
    'stale_provider_access_limited',
    'background_browser_resume_expired',
    'stale_run_recovered',
    'background_browser_actor_missing',
  ])
  for(const r of runs||[]){
    if(String(r.status)==='waiting_approval')continue
    const errorCode=clean(r.error,160)
    if(suppressedRunErrors.has(errorCode))continue
    const ageHours=(Date.now()-Date.parse(String(r.updated_at||0)))/3600_000
    if(String(r.status)==='failed'&&ageHours>6)continue
    if(String(r.status)==='paused'&&ageHours>24)continue
    const score=String(r.status)==='outcome_unknown'?92:String(r.status)==='failed'?86:80
    const label=String(r.status)==='outcome_unknown'?'needs verification':String(r.status)==='failed'?'hit a blocker':'is paused'
    items.push({key:`run:${r.id}:${r.status}`,score,line:`🧠 *${clean(r.title,150)}* ${label}. ${clean(r.summary,190)}`,kind:'run'})
  }
  const now=Date.now()
  for(const idea of ideas||[]){
    if(idea.snoozed_until && Date.parse(String(idea.snoozed_until))>now)continue
    const score=Math.round(Math.max(0,Math.min(1,Number(idea.value_score||0.75)))*100)
    const refs=Array.isArray(idea.source_refs)?idea.source_refs:[]
    const fromMemoryTwin=refs.some((ref:any)=>String(ref?.type||'')==='memory_twin')
    // Memory Twin suggestions are useful in the dashboard, but only exceptionally
    // strong ones should interrupt the user proactively.
    if(fromMemoryTwin&&score<90)continue
    if(!fromMemoryTwin&&score<85)continue
    items.push({key:`idea:${idea.id}`,score,line:`💡 *${clean(idea.title,150)}*: ${clean(idea.reason||idea.expected_value,200)}`,kind:'idea'})
  }

  const dedup=new Map<string,PulseItem>()
  for(const item of items.sort((a,b)=>b.score-a.score))if(!dedup.has(item.key))dedup.set(item.key,item)
  const top=Array.from(dedup.values()).slice(0,3)
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
    .select('telegram_id,whatsapp_id,name,timezone')
    .eq('telegram_id',Number(telegramId))
    .maybeSingle()
  if(error||!user?.whatsapp_id)return {sent:false,reason:'user_unavailable'}
  const timezone=String(user.timezone||'Asia/Kolkata')
  const hour=localHour(timezone)
  if(hour<7||hour>=22)return {sent:false,reason:'quiet_hours'}

  const pulse=await buildPulse(telegramId,timezone)
  if(!pulse.items.length)return {sent:false,reason:'nothing_material'}
  const previous=await lastPulse(telegramId)
  if(String(previous?.metadata_json?.fingerprint||'')===pulse.fingerprint)return {sent:false,reason:'duplicate'}

  const name=clean(user.name,80).split(' ')[0]||'there'
  const message=[
    `🧠 *Gogo is staying on top of things, ${name}*`,
    '',
    ...pulse.items.map(x=>x.line),
    '',
    'Reply *what are you working on for me?* for the full live status.',
  ].join('\n')
  // Use natural free-form copy while the WhatsApp service window is open.
  // Outside the window we must fall back to an approved Utility template.
  const activeSession=await hasRecentWhatsAppSession(telegramId)
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
