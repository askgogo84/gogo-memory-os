import { createHash } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'
import type { AgentActor } from './actor'

export type OpenLoopKind='followup'|'waiting_on'|'commitment'|'approval'|'mission'|'life_event'|'meeting_action'|'other'

export type OpenLoopInput={
  telegramId:string|number
  kind:OpenLoopKind
  title:string
  summary?:string
  priority?:number
  dueAt?:string|null
  nextCheckAt?:string|null
  sourceType:string
  sourceId?:string|null
  sourceRefs?:Record<string,unknown>[]
  evidence?:Record<string,unknown>
  observedAt?:string|null
}

function clean(value:unknown,max=500){
  return String(value??'').replace(/\s+/g,' ').trim().slice(0,max)
}
function normalize(value:unknown){
  return clean(value,500).toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim()
}
function normalizedPhone(value:unknown){
  return String(value||'').replace(/^whatsapp:/i,'').replace(/\D/g,'').slice(-15)
}
function hash(value:string){
  return createHash('sha256').update(value).digest('hex').slice(0,40)
}
function fingerprintFor(input:OpenLoopInput){
  const stable=[input.kind,input.sourceType,input.sourceId||'',normalize(input.title)].join('|')
  return hash(stable)
}
function isoPlusHours(hours:number){
  return new Date(Date.now()+Math.max(1,hours)*3600_000).toISOString()
}
function isoPlusHoursFrom(base:string|null|undefined,hours:number){
  const start=Date.parse(String(base||''))
  return new Date((Number.isFinite(start)?start:Date.now())+Math.max(1,hours)*3600_000).toISOString()
}
function clampPriority(value:number|undefined,fallback=0.75){
  const n=Number(value)
  return Number.isFinite(n)?Math.max(0,Math.min(1,n)):fallback
}

export function parseExplicitOpenLoop(text:string):{
  kind:'followup'|'waiting_on'|'commitment'
  title:string
  summary:string
  priority:number
}|null{
  const raw=clean(text,1200)
  if(!raw)return null

  const waiting=raw.match(/\b(?:still\s+)?waiting\s+(?:on|for)\s+(.{3,240})/i)
  if(waiting?.[1]){
    const subject=clean(waiting[1].replace(/[.?!]+$/,''),220)
    if(subject)return {kind:'waiting_on',title:`Waiting on ${subject}`,summary:raw,priority:0.86}
  }

  const follow=raw.match(/\b(?:need\s+to\s+|have\s+to\s+|should\s+|please\s+)?follow\s*up\s+with\s+(.{2,220})/i)
  if(follow?.[1]){
    const subject=clean(follow[1].replace(/[.?!]+$/,''),200)
    if(subject)return {kind:'followup',title:`Follow up with ${subject}`,summary:raw,priority:0.9}
  }

  const noReply=raw.match(/^(.{2,100}?)\s+(?:hasn't|has not|haven't|have not)\s+(?:replied|responded)(?:\s+yet)?\b/i)
  if(noReply?.[1]){
    const subject=clean(noReply[1],100)
    if(subject)return {kind:'followup',title:`Follow up with ${subject}`,summary:raw,priority:0.9}
  }

  const commitment=raw.match(/\b(?:i\s+need\s+to|i\s+have\s+to|i\s+must|i\s+should)\s+(.{3,240})/i)
  if(commitment?.[1]){
    const action=clean(commitment[1].replace(/[.?!]+$/,''),220)
    if(/^(?:send|call|reply|respond|submit|review|share|check|finish|complete|prepare|book|pay|renew|follow|update|finalize|finalise|confirm|schedule)\b/i.test(action)){
      return {kind:'commitment',title:`Need to ${action}`,summary:raw,priority:0.82}
    }
  }

  return null
}

async function upsertOpenLoop(input:OpenLoopInput){
  const telegramId=String(input.telegramId)
  const fingerprint=fingerprintFor(input)
  const observedAt=input.observedAt&&Number.isFinite(Date.parse(input.observedAt))?input.observedAt:new Date().toISOString()
  const {data:existing,error:readError}=await supabaseAdmin.from('agent_open_loops')
    .select('id,status,resolved_at,last_seen_at')
    .eq('telegram_id',telegramId)
    .eq('fingerprint',fingerprint)
    .maybeSingle()
  if(readError)throw new Error(`open_loop_read_failed:${readError.message}`)

  if(existing?.id){
    const resolvedAt=existing.resolved_at?Date.parse(String(existing.resolved_at)):NaN
    const evidenceAt=Date.parse(observedAt)
    if(['resolved','dismissed'].includes(String(existing.status))&&Number.isFinite(resolvedAt)&&Number.isFinite(evidenceAt)&&evidenceAt<=resolvedAt){
      return {id:String(existing.id),fingerprint,ignoredHistorical:true}
    }
    const {error}=await supabaseAdmin.from('agent_open_loops').update({
      kind:input.kind,
      title:clean(input.title,240),
      summary:clean(input.summary||input.title,1200),
      status:'active',
      priority:clampPriority(input.priority),
      due_at:input.dueAt||null,
      next_check_at:input.nextCheckAt||null,
      source_type:clean(input.sourceType,80),
      source_id:input.sourceId?clean(input.sourceId,180):null,
      source_refs:input.sourceRefs||[],
      evidence_json:input.evidence||{},
      last_seen_at:observedAt,
      resolved_at:null,
      updated_at:new Date().toISOString(),
    }).eq('id',existing.id).eq('telegram_id',telegramId)
    if(error)throw new Error(`open_loop_update_failed:${error.message}`)
    return {id:String(existing.id),fingerprint,updated:true}
  }

  const {data,error}=await supabaseAdmin.from('agent_open_loops').insert({
    telegram_id:telegramId,
    kind:input.kind,
    title:clean(input.title,240),
    summary:clean(input.summary||input.title,1200),
    status:'active',
    priority:clampPriority(input.priority),
    due_at:input.dueAt||null,
    next_check_at:input.nextCheckAt||null,
    source_type:clean(input.sourceType,80),
    source_id:input.sourceId?clean(input.sourceId,180):null,
    source_refs:input.sourceRefs||[],
    evidence_json:input.evidence||{},
    fingerprint,
    last_seen_at:observedAt,
    updated_at:new Date().toISOString(),
  }).select('id').single()
  if(error||!data?.id)throw new Error(`open_loop_insert_failed:${error?.message||'unknown'}`)
  return {id:String(data.id),fingerprint,created:true}
}

async function userConnection(telegramId:string){
  const {data,error}=await supabaseAdmin.from('users')
    .select('whatsapp_id')
    .eq('telegram_id',Number(telegramId))
    .maybeSingle()
  if(error)throw new Error(`open_loop_user_read_failed:${error.message}`)
  return data||null
}

async function syncFollowups(telegramId:string,current:Set<string>){
  const user=await userConnection(telegramId)
  const phone=normalizedPhone(user?.whatsapp_id)
  if(!phone)return
  const variants=[phone,`+${phone}`,`whatsapp:+${phone}`,`whatsapp:${phone}`]
  const {data,error}=await supabaseAdmin.from('followups')
    .select('id,contact_name,context,check_at,status,created_at,whatsapp_id')
    .in('whatsapp_id',variants)
    .in('status',['pending','fired'])
    .order('check_at',{ascending:true})
    .limit(50)
  if(error)throw new Error(`open_loop_followup_read_failed:${error.message}`)
  for(const row of data||[]){
    const input:OpenLoopInput={
      telegramId,kind:'followup',
      title:`Follow up with ${clean(row.contact_name,160)}`,
      summary:clean(row.context||`Waiting to follow up with ${row.contact_name}`,1000),
      priority:Date.parse(String(row.check_at||''))<=Date.now()?0.96:0.88,
      dueAt:row.check_at||null,
      nextCheckAt:row.check_at||null,
      sourceType:'followup',sourceId:String(row.id),
      sourceRefs:[{type:'followup',id:String(row.id)}],
      evidence:{status:row.status},
      observedAt:row.created_at||null,
    }
    const fp=fingerprintFor(input);current.add(fp);await upsertOpenLoop(input)
  }
}

async function syncApprovals(telegramId:string,current:Set<string>){
  const {data,error}=await supabaseAdmin.from('agent_approvals')
    .select('id,title,description,risk_level,requested_at,action_type')
    .eq('telegram_id',telegramId).eq('status','pending')
    .order('requested_at',{ascending:true}).limit(30)
  if(error)throw new Error(`open_loop_approval_read_failed:${error.message}`)
  for(const row of data||[]){
    const input:OpenLoopInput={
      telegramId,kind:'approval',title:clean(row.title,220),
      summary:clean(row.description||'Gogo is waiting for your approval.',1000),
      priority:1,nextCheckAt:new Date().toISOString(),
      sourceType:'approval',sourceId:String(row.id),
      sourceRefs:[{type:'agent_approval',id:String(row.id)}],
      evidence:{risk_level:row.risk_level,action_type:row.action_type},
      observedAt:row.requested_at||null,
    }
    const fp=fingerprintFor(input);current.add(fp);await upsertOpenLoop(input)
  }
}

function suppressRun(row:any){
  const error=clean(row?.error,160)
  if(['stale_provider_access_limited','background_browser_resume_expired','stale_run_recovered','background_browser_actor_missing'].includes(error))return true
  const age=Date.now()-Date.parse(String(row?.updated_at||0))
  if(String(row?.status)==='paused'&&age>7*86400_000)return true
  return false
}

async function syncRuns(telegramId:string,current:Set<string>){
  const {data,error}=await supabaseAdmin.from('agent_runs')
    .select('id,status,title,summary,error,updated_at,started_at,capability')
    .eq('telegram_id',telegramId)
    .in('status',['waiting_approval','paused','outcome_unknown'])
    .order('updated_at',{ascending:false}).limit(30)
  if(error)throw new Error(`open_loop_run_read_failed:${error.message}`)
  for(const row of data||[]){
    if(suppressRun(row))continue
    const status=String(row.status)
    const input:OpenLoopInput={
      telegramId,kind:'mission',title:clean(row.title,220),
      summary:clean(row.summary||`Mission is ${status}.`,1000),
      priority:status==='outcome_unknown'?0.97:status==='waiting_approval'?0.96:0.8,
      nextCheckAt:status==='paused'?isoPlusHours(6):new Date().toISOString(),
      sourceType:'agent_run',sourceId:String(row.id),
      sourceRefs:[{type:'agent_run',id:String(row.id)}],
      evidence:{status,capability:row.capability,error:row.error||null},
      observedAt:row.updated_at||row.started_at||null,
    }
    const fp=fingerprintFor(input);current.add(fp);await upsertOpenLoop(input)
  }
}

async function syncLifeActions(telegramId:string,current:Set<string>){
  const {data,error}=await supabaseAdmin.from('life_event_actions')
    .select('id,life_event_id,action_key,title,status,due_at,requires_approval,updated_at,capability')
    .eq('telegram_id',telegramId)
    .in('status',['waiting_approval','blocked'])
    .order('updated_at',{ascending:false}).limit(30)
  if(error)throw new Error(`open_loop_life_action_read_failed:${error.message}`)
  for(const row of data||[]){
    const input:OpenLoopInput={
      telegramId,kind:'life_event',title:clean(row.title,220),
      summary:String(row.status)==='blocked'?'A life-event step is blocked and needs attention.':'A life-event step is waiting for your approval.',
      priority:row.requires_approval?0.95:0.84,
      dueAt:row.due_at||null,nextCheckAt:row.due_at||new Date().toISOString(),
      sourceType:'life_event_action',sourceId:String(row.id),
      sourceRefs:[{type:'life_event_action',id:String(row.id)},{type:'life_event',id:String(row.life_event_id)}],
      evidence:{status:row.status,action_key:row.action_key,capability:row.capability},
      observedAt:row.updated_at||null,
    }
    const fp=fingerprintFor(input);current.add(fp);await upsertOpenLoop(input)
  }
}

async function syncConversationSignals(telegramId:string){
  const {data:consent}=await supabaseAdmin.from('user_consent_settings')
    .select('memory_enabled').eq('telegram_id',Number(telegramId)).maybeSingle()
  if(consent?.memory_enabled===false)return 0
  const since=new Date(Date.now()-7*86400_000).toISOString()
  const {data,error}=await supabaseAdmin.from('conversations')
    .select('id,content,created_at')
    .eq('telegram_id',Number(telegramId)).eq('role','user')
    .gte('created_at',since).order('created_at',{ascending:false}).limit(80)
  if(error)throw new Error(`open_loop_conversation_read_failed:${error.message}`)
  let captured=0
  for(const row of (data||[]).slice().reverse()){
    const parsed=parseExplicitOpenLoop(String(row.content||''))
    if(!parsed)continue
    await upsertOpenLoop({
      telegramId,kind:parsed.kind,title:parsed.title,summary:parsed.summary,priority:parsed.priority,
      nextCheckAt:parsed.kind==='followup'||parsed.kind==='waiting_on'
        ? isoPlusHoursFrom(row.created_at,24)
        : isoPlusHoursFrom(row.created_at,12),
      sourceType:'conversation',sourceId:null,
      sourceRefs:[{type:'conversation',id:String(row.id)}],
      evidence:{conversation_id:String(row.id)},
      observedAt:row.created_at||null,
    })
    captured++
  }
  return captured
}

async function resolveMissingSourceLoops(telegramId:string,current:Set<string>,sourceTypes:string[]){
  if(!sourceTypes.length)return 0
  const {data,error}=await supabaseAdmin.from('agent_open_loops')
    .select('id,fingerprint,source_type')
    .eq('telegram_id',telegramId).eq('status','active').in('source_type',sourceTypes).limit(200)
  if(error)throw new Error(`open_loop_active_read_failed:${error.message}`)
  const stale=(data||[]).filter((row:any)=>!current.has(String(row.fingerprint)))
  if(!stale.length)return 0
  const now=new Date().toISOString()
  const ids=stale.map((row:any)=>row.id)
  const {error:updateError}=await supabaseAdmin.from('agent_open_loops')
    .update({status:'resolved',resolved_at:now,updated_at:now})
    .in('id',ids).eq('telegram_id',telegramId).eq('status','active')
  if(updateError)throw new Error(`open_loop_resolve_missing_failed:${updateError.message}`)
  return ids.length
}

export async function syncOpenLoopsForUser(telegramId:string|number){
  const tg=String(telegramId)
  const current=new Set<string>()
  const sourceTypes=['followup','approval','agent_run','life_event_action'] as const
  const results=await Promise.allSettled([
    syncFollowups(tg,current),
    syncApprovals(tg,current),
    syncRuns(tg,current),
    syncLifeActions(tg,current),
    syncConversationSignals(tg),
  ])
  const failures=results.filter((x):x is PromiseRejectedResult=>x.status==='rejected').map(x=>clean(x.reason?.message||x.reason,180))
  const successfulSourceTypes=sourceTypes.filter((_,index)=>results[index]?.status==='fulfilled')
  // Reconcile only sources that were read successfully. A transient provider/DB
  // failure must never make an existing open loop disappear.
  const resolved=await resolveMissingSourceLoops(tg,current,[...successfulSourceTypes]).catch(err=>{failures.push(clean(err?.message||err,180));return 0})
  return {telegramId:tg,resolved,failures}
}

export async function captureExplicitOpenLoopFromTurn(params:{actor:AgentActor;text:string;observedAt?:string|null}){
  const parsed=parseExplicitOpenLoop(params.text)
  if(!parsed)return null
  const {data:consent}=await supabaseAdmin.from('user_consent_settings')
    .select('memory_enabled').eq('telegram_id',params.actor.legacyTelegramId).maybeSingle()
  if(consent?.memory_enabled===false)return null
  return upsertOpenLoop({
    telegramId:params.actor.legacyTelegramId,
    kind:parsed.kind,title:parsed.title,summary:parsed.summary,priority:parsed.priority,
    nextCheckAt:parsed.kind==='followup'||parsed.kind==='waiting_on'?isoPlusHours(24):isoPlusHours(12),
    sourceType:'conversation',
    sourceRefs:[{type:'whatsapp_turn'}],
    evidence:{surface:'whatsapp'},
    observedAt:params.observedAt||new Date().toISOString(),
  })
}

export function isOpenLoopQuery(text:string){
  const t=clean(text,500).toLowerCase().replace(/[?!.]+$/g,'')
  return /^(?:what|which|show|list)\s+(?:are\s+)?(?:my\s+)?(?:open loops|pending follow[- ]?ups|follow[- ]?ups|things i(?:'m| am) waiting on|things still pending|pending items|unresolved items)$/.test(t)
    || /^what\s+(?:am i waiting on|still needs follow[- ]?up|is still pending)$/.test(t)
}

export function isOpenLoopResolutionCandidate(text:string){
  const raw=clean(text,400)
  return /^(?:mark|close|resolve|finish|dismiss)\s+(?:open\s+loop\s+)?#?\d{1,2}(?:\s+(?:done|resolved|complete|completed))?$/i.test(raw)
    || /^#?\d{1,2}\s+(?:is\s+)?(?:done|resolved|complete|completed)$/i.test(raw)
}

export function parseOpenLoopResolution(text:string,{allowGeneric=false}:{allowGeneric?:boolean}={}){
  const raw=clean(text,400)
  const explicit=raw.match(/^(?:mark|close|resolve|finish|dismiss)\s+open\s+loop\s+#?(\d{1,2})\s*(?:done|resolved|complete|completed)?$/i)
  if(explicit?.[1])return {index:Number(explicit[1]),mode:/dismiss/i.test(raw)?'dismissed' as const:'resolved' as const}
  if(!allowGeneric)return null
  const numbered=raw.match(/^(?:mark|close|resolve|finish|dismiss)\s+#?(\d{1,2})\s+(?:done|resolved|complete|completed)$/i)
    || raw.match(/^#?(\d{1,2})\s+(?:is\s+)?(?:done|resolved|complete|completed)$/i)
  if(numbered?.[1])return {index:Number(numbered[1]),mode:/dismiss/i.test(raw)?'dismissed' as const:'resolved' as const}
  return null
}

async function recentOpenLoopListShown(telegramId:string|number){
  const cutoff=new Date(Date.now()-10*60_000).toISOString()
  const {data,error}=await supabaseAdmin.from('agent_activity')
    .select('id')
    .eq('telegram_id',String(telegramId))
    .eq('event_type','open_loops_list_shown')
    .gte('created_at',cutoff)
    .order('created_at',{ascending:false})
    .limit(1)
  if(error)throw new Error(`open_loop_recent_list_read_failed:${error.message}`)
  return Boolean(data?.length)
}

export async function listOpenLoops(telegramId:string|number,limit=10){
  await syncOpenLoopsForUser(telegramId)
  const {data,error}=await supabaseAdmin.from('agent_open_loops')
    .select('id,kind,title,summary,priority,due_at,next_check_at,source_type,updated_at')
    .eq('telegram_id',String(telegramId)).eq('status','active')
    .order('priority',{ascending:false}).order('updated_at',{ascending:false}).limit(limit)
  if(error)throw new Error(`open_loop_list_failed:${error.message}`)
  return data||[]
}

export async function handleOpenLoopQuery(params:{actor:AgentActor;text:string}){
  if(!isOpenLoopQuery(params.text))return null
  const loops=await listOpenLoops(params.actor.legacyTelegramId,12)
  if(!loops.length){
    return {runId:'open-loops-none',status:'completed' as const,capability:'orchestrator' as const,risk:'low' as const,text:'✅ You have no active open loops right now.',handledBy:'open-loops'}
  }
  const lines=loops.map((loop:any,index:number)=>{
    const badge=loop.kind==='approval'?'🛡️':loop.kind==='followup'?'📨':loop.kind==='waiting_on'?'⏳':loop.kind==='mission'?'🧠':loop.kind==='life_event'?'✈️':'•'
    return `${index+1}. ${badge} ${clean(loop.title,180)}`
  })
  await supabaseAdmin.from('agent_activity').insert({
    telegram_id:String(params.actor.legacyTelegramId),
    event_type:'open_loops_list_shown',
    message:'Gogo showed the current open-loop list.',
    metadata_json:{open_loop_ids:loops.map((loop:any)=>String(loop.id)).slice(0,12)},
  }).then(({error})=>{if(error)console.error('OPEN_LOOP_LIST_ACTIVITY_FAILED:',error.message)})
  return {
    runId:'open-loops-list',status:'completed' as const,capability:'orchestrator' as const,risk:'low' as const,
    text:`🧠 *Your open loops*\n\n${lines.join('\n')}\n\nSay *mark 2 done* to close one.`,
    handledBy:'open-loops',
  }
}

export async function handleOpenLoopResolution(params:{actor:AgentActor;text:string}){
  let parsed=parseOpenLoopResolution(params.text)
  if(!parsed&&isOpenLoopResolutionCandidate(params.text)){
    if(!(await recentOpenLoopListShown(params.actor.legacyTelegramId)))return null
    parsed=parseOpenLoopResolution(params.text,{allowGeneric:true})
  }
  if(!parsed)return null
  const loops=await listOpenLoops(params.actor.legacyTelegramId,20)
  const target=loops[parsed.index-1] as any
  if(!target){
    return {runId:'open-loop-resolve-missing',status:'completed' as const,capability:'orchestrator' as const,risk:'low' as const,text:`I don't have an active open loop #${parsed.index}. Ask *what are my open loops?* to see the current list.`,handledBy:'open-loops'}
  }
  const at=new Date().toISOString()
  const {error}=await supabaseAdmin.from('agent_open_loops').update({
    status:parsed.mode,resolved_at:at,updated_at:at,
  }).eq('id',target.id).eq('telegram_id',String(params.actor.legacyTelegramId)).eq('status','active')
  if(error)throw new Error(`open_loop_resolve_failed:${error.message}`)
  return {runId:`open-loop-${target.id}`,status:'completed' as const,capability:'orchestrator' as const,risk:'low' as const,text:`✅ Closed: ${clean(target.title,180)}`,handledBy:'open-loops'}
}

export async function processOpenLoopScoutPass(limit=80){
  const since=new Date(Date.now()-72*3600_000).toISOString()
  const [conversationResult,approvalResult,runResult,lifeResult,followupResult,userResult]=await Promise.all([
    supabaseAdmin.from('conversations').select('telegram_id').eq('role','user').gte('created_at',since).order('created_at',{ascending:false}).limit(3000),
    supabaseAdmin.from('agent_approvals').select('telegram_id').eq('status','pending').limit(1000),
    supabaseAdmin.from('agent_runs').select('telegram_id').in('status',['waiting_approval','paused','outcome_unknown']).limit(1000),
    supabaseAdmin.from('life_event_actions').select('telegram_id').in('status',['waiting_approval','blocked']).limit(1000),
    supabaseAdmin.from('followups').select('whatsapp_id').in('status',['pending','fired']).limit(1000),
    supabaseAdmin.from('users').select('telegram_id,whatsapp_id').not('whatsapp_id','is',null).limit(3000),
  ])
  const ids=new Set<string>()
  for(const result of [conversationResult,approvalResult,runResult,lifeResult]){
    if(result.error)console.error('OPEN_LOOP_SCOUT_CANDIDATE_FAILED:',result.error.message)
    for(const row of result.data||[])if((row as any).telegram_id)ids.add(String((row as any).telegram_id))
  }
  const phoneToTelegram=new Map<string,string>()
  for(const user of userResult.data||[]){
    const phone=normalizedPhone((user as any).whatsapp_id)
    if(phone&&(user as any).telegram_id)phoneToTelegram.set(phone,String((user as any).telegram_id))
  }
  for(const follow of followupResult.data||[]){
    const tg=phoneToTelegram.get(normalizedPhone((follow as any).whatsapp_id))
    if(tg)ids.add(tg)
  }

  let processed=0,failed=0,resolved=0
  const failures:string[]=[]
  const sorted=Array.from(ids).sort()
  const bucket=Math.floor(Date.now()/(30*60_000))
  const offset=sorted.length?bucket%sorted.length:0
  const rotated=[...sorted.slice(offset),...sorted.slice(0,offset)].slice(0,Math.max(1,limit))
  for(const telegramId of rotated){
    try{
      const result=await syncOpenLoopsForUser(telegramId)
      processed++;resolved+=result.resolved
      failures.push(...result.failures.map(x=>`${telegramId}:${x}`))
    }catch(err:any){
      failed++;failures.push(`${telegramId}:${clean(err?.message||err,140)}`)
    }
  }
  return {considered:ids.size,processed,failed,resolved,failures:failures.slice(0,20)}
}
