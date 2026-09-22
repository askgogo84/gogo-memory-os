import { createHash } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'
import type { AgentActor } from './actor'
import type { JevShadowResult } from '@/lib/typesafe/jev-shadow'
import { decryptGoogleToken } from '@/lib/security/google-token-crypto'
import { fetchGmailAttentionThreads, refreshGmailAccessToken } from '@/lib/services/google-gmail'

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
  const stable=input.sourceId
    ? [input.kind,input.sourceType,input.sourceId].join('|')
    : [input.kind,input.sourceType,normalize(input.title)].join('|')
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

  const noResponse=raw.match(/^(?:still\s+)?no\s+(?:reply|response|update)\s+from\s+(.{2,120})[.?!]*$/i)
  if(noResponse?.[1]){
    const subject=clean(noResponse[1],110)
    if(subject)return {kind:'followup',title:`Follow up with ${subject}`,summary:raw,priority:0.92}
  }

  const asked=raw.match(/\bi\s+(?:asked|requested)\s+(.{2,80}?)\s+to\s+(.{3,220})/i)
  if(asked?.[1]&&asked?.[2]){
    const subject=clean(asked[1],80)
    const action=clean(asked[2].replace(/[.?!]+$/,''),200)
    if(subject&&action)return {kind:'waiting_on',title:`Waiting on ${subject} to ${action}`,summary:raw,priority:0.86}
  }

  const promised=raw.match(/^(.{2,90}?)\s+(?:said\s+(?:he|she|they)?\s*(?:will|'ll|would)?|will|is\s+going\s+to)\s+(send|share|resend|reply|respond|get\s+back|confirm|approve|review|deliver|update|call)\s+(.{2,220})/i)
  if(promised?.[1]&&promised?.[2]){
    const subject=clean(promised[1].replace(/^(?:and\s+)?/i,''),90)
    const action=clean(`${promised[2]} ${promised[3]||''}`.replace(/[.?!]+$/,''),220)
    if(subject&&!/^(?:i|we|you)$/i.test(subject)&&action){
      return {kind:'waiting_on',title:`Waiting on ${subject} to ${action}`,summary:raw,priority:0.87}
    }
  }

  const expected=raw.match(/^(.{3,120}?)\s+is\s+expected\s+(?:today|tomorrow|by\s+.+?)[.?!]*$/i)
  if(expected?.[1]){
    const subject=clean(expected[1],110)
    if(subject)return {kind:'waiting_on',title:`Waiting on ${subject}`,summary:raw,priority:0.84}
  }

  return null
}

const COMPLETION_STEMS:Record<string,string>={
  sent:'send',sending:'send',shared:'share',sharing:'share',resend:'send',resent:'send',
  replied:'reply',responded:'respond',response:'respond',confirmed:'confirm',approved:'approve',
  reviewed:'review',delivered:'deliver',updated:'update',called:'call',received:'receive',
  completed:'complete',finished:'finish',resolved:'resolve',submitted:'submit',signed:'sign',
}
const LOOP_STOPWORDS=new Set(['waiting','follow','up','with','to','need','the','a','an','on','for','about','and','or','is','are','was','were','my','our','your','their','this','that','still','please','after','before','by','today','tomorrow'])

function loopTokens(value:unknown){
  return normalize(value).split(' ').map(token=>COMPLETION_STEMS[token]||token)
    .filter(token=>token.length>2&&!LOOP_STOPWORDS.has(token))
}

export function isUncertainOrNegatedCompletion(text:string){
  const raw=clean(text,1200)
  if(/[?]\s*$/.test(raw))return true
  if(/^(?:did|has|have|can|could|would|will|is|are|do|does|check|tell me|do you know)\b/i.test(raw))return true
  if(/\b(?:hasn't|has not|haven't|have not|didn't|did not|not yet|still waiting|no reply|no response|no update|waiting on|waiting for|if|whether)\b/i.test(raw))return true
  return false
}

function looksLikeCompletionStatement(text:string){
  if(isUncertainOrNegatedCompletion(text))return false
  return /\b(sent|shared|resent|replied|responded|got\s+back|confirmed|approved|reviewed|delivered|updated|called|received|got\s+(?:the|it)|completed|finished|resolved|submitted|signed|came\s+through|has\s+arrived|arrived)\b/i.test(text)
}

export async function autoResolveOpenLoopsFromTurn(params:{actor:AgentActor;text:string;jev?:JevShadowResult|null}){
  const raw=clean(params.text,1200)
  if(isUncertainOrNegatedCompletion(raw))return []
  const semanticCompletion=Boolean(
    params.jev?.ok &&
    String(params.jev.attentionState?.choice||'')==='completed' &&
    Number(params.jev.attentionState?.confidence||0)>=0.93
  )
  if(!raw||(!looksLikeCompletionStatement(raw)&&!semanticCompletion))return []
  const {data,error}=await supabaseAdmin.from('agent_open_loops')
    .select('id,kind,title,summary,source_type,updated_at')
    .eq('telegram_id',String(params.actor.legacyTelegramId))
    .eq('status','active')
    .in('kind',['followup','waiting_on','commitment','meeting_action'])
    .order('updated_at',{ascending:false})
    .limit(30)
  if(error)throw new Error(`open_loop_auto_resolve_read_failed:${error.message}`)
  const textTokens=new Set(loopTokens(raw))
  if(textTokens.size<2)return []

  const ranked=(data||[]).map((loop:any)=>{
    const tokens=loopTokens(`${loop.title} ${loop.summary||''}`)
    const unique=[...new Set(tokens)]
    const overlap=unique.filter(token=>textTokens.has(token))
    const score=unique.length?overlap.length/Math.min(unique.length,Math.max(3,textTokens.size)):0
    return {loop,overlap,score}
  }).filter((item:any)=>item.overlap.length>=2&&item.score>=0.55)
    .sort((a:any,b:any)=>b.score-a.score)

  if(!ranked.length)return []
  // Fail closed on ambiguity: a completion statement must identify one loop clearly.
  if(ranked[1]&&Math.abs(ranked[0].score-ranked[1].score)<0.12)return []

  const winner=ranked[0]
  const at=new Date().toISOString()
  const {error:updateError}=await supabaseAdmin.from('agent_open_loops').update({
    status:'resolved',resolved_at:at,updated_at:at,
    evidence_json:{auto_resolved_from:'conversation',completion_text:raw.slice(0,500),match_score:winner.score,matched_tokens:winner.overlap.slice(0,12)},
  }).eq('id',winner.loop.id).eq('telegram_id',String(params.actor.legacyTelegramId)).eq('status','active')
  if(updateError)throw new Error(`open_loop_auto_resolve_failed:${updateError.message}`)
  await supabaseAdmin.from('agent_activity').insert({
    telegram_id:String(params.actor.legacyTelegramId),
    event_type:'open_loop_auto_resolved',
    message:`Gogo resolved an open loop from new completion evidence: ${clean(winner.loop.title,180)}`,
    metadata_json:{open_loop_id:String(winner.loop.id),score:winner.score,matched_tokens:winner.overlap.slice(0,12)},
  }).then(({error})=>{if(error)console.error('OPEN_LOOP_AUTO_RESOLVE_ACTIVITY_FAILED:',error.message)})
  return [String(winner.loop.id)]
}

async function upsertOpenLoop(input:OpenLoopInput){
  const telegramId=String(input.telegramId)
  const fingerprint=fingerprintFor(input)

  if(input.sourceType==='conversation'){
    const {data:similar,error:similarError}=await supabaseAdmin.from('agent_open_loops')
      .select('id,title,status,resolved_at,last_seen_at,fingerprint')
      .eq('telegram_id',telegramId)
      .eq('source_type','conversation')
      .eq('kind',input.kind)
      .eq('status','active')
      .order('updated_at',{ascending:false})
      .limit(20)
    if(similarError)throw new Error(`open_loop_similarity_read_failed:${similarError.message}`)
    const incomingTokens=[...new Set(loopTokens(input.title))]
    const best=(similar||[]).map((row:any)=>{
      const existingTokens=[...new Set(loopTokens(row.title))]
      const overlap=incomingTokens.filter(token=>existingTokens.includes(token))
      const union=new Set([...incomingTokens,...existingTokens]).size
      return {row,overlap,score:union?overlap.length/union:0}
    }).filter((item:any)=>item.overlap.length>=2&&item.score>=0.62)
      .sort((a:any,b:any)=>b.score-a.score)[0]
    if(best?.row?.id){
      const {error:updateError}=await supabaseAdmin.from('agent_open_loops').update({
        title:clean(input.title,240),
        summary:clean(input.summary||input.title,1200),
        priority:Math.max(clampPriority(input.priority),0.7),
        next_check_at:input.nextCheckAt||null,
        due_at:input.dueAt||null,
        source_refs:input.sourceRefs||[],
        evidence_json:{...(input.evidence||{}),semantic_dedupe_score:best.score},
        last_seen_at:input.observedAt||new Date().toISOString(),
        updated_at:new Date().toISOString(),
      }).eq('id',best.row.id).eq('telegram_id',telegramId).eq('status','active')
      if(updateError)throw new Error(`open_loop_similarity_update_failed:${updateError.message}`)
      return {id:String(best.row.id),fingerprint:String(best.row.fingerprint),updated:true,semanticDedupe:true}
    }
  }
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

function headerEmail(value:unknown){
  const raw=clean(value,240).toLowerCase()
  const angle=raw.match(/<([^>]+@[^>]+)>/)
  if(angle?.[1])return angle[1].trim()
  const direct=raw.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i)
  return direct?.[0]?.toLowerCase()||''
}

function headerName(value:unknown){
  const raw=clean(value,180)
  const before=raw.split('<')[0]?.replace(/^["']|["']$/g,'').trim()
  return before||headerEmail(raw)||'the sender'
}

function looksLikeReplyExpected(text:string){
  return /\?|\b(?:please|could you|can you|would you|let me know|confirm|confirmation|share|send|update|status|review|approve|approval|feedback|thoughts|when can|when will|follow(?:ing)? up|revert|respond|reply)\b/i.test(text)
}

function looksLikeIncomingAction(text:string){
  return /\b(?:action required|please|could you|can you|need you to|kindly|confirm|approve|approval|review|sign|send|share|reply|respond|provide|submit|complete|urgent|by today|by tomorrow|deadline)\b/i.test(text)
}

function looksLikeIncomingPromise(text:string){
  return /\b(?:i(?:'ll| will)|we(?:'ll| will)|i\s+can|we\s+can)\s+(?:send|share|resend|reply|respond|confirm|approve|review|deliver|update|call|get\s+back|revert)\b/i.test(text)
}

function isAutomatedGmailMessage(message:any){
  const from=headerEmail(message?.from)
  if(/(?:^|[._+-])(no-?reply|do-?not-?reply|newsletter|digest|notifications?)(?:[._+-]|@)/i.test(from))return true
  if(clean(message?.listId,240))return true
  if(/\b(?:bulk|list|junk)\b/i.test(clean(message?.precedence,80)))return true
  const auto=clean(message?.autoSubmitted,120).toLowerCase()
  if(auto&&auto!=='no')return true
  return false
}

async function resolveOtherGmailLoopsForThread(telegramId:string,threadId:string,keepFingerprint:string|null){
  const {data,error}=await supabaseAdmin.from('agent_open_loops')
    .select('id,fingerprint')
    .eq('telegram_id',telegramId)
    .eq('source_type','gmail_thread')
    .eq('source_id',threadId)
    .eq('status','active')
    .limit(10)
  if(error)throw new Error(`open_loop_gmail_existing_failed:${error.message}`)
  const ids=(data||[]).filter((row:any)=>!keepFingerprint||String(row.fingerprint)!==keepFingerprint).map((row:any)=>row.id)
  if(!ids.length)return 0
  const at=new Date().toISOString()
  const {error:updateError}=await supabaseAdmin.from('agent_open_loops').update({
    status:'resolved',resolved_at:at,updated_at:at,
  }).in('id',ids).eq('telegram_id',telegramId).eq('status','active')
  if(updateError)throw new Error(`open_loop_gmail_resolve_failed:${updateError.message}`)
  return ids.length
}

async function syncGmailAttention(telegramId:string,current:Set<string>){
  const [{data:user,error:userError},{data:consent,error:consentError}]=await Promise.all([
    supabaseAdmin.from('users')
      .select('gmail_connected,gmail_email,gmail_access_token,gmail_refresh_token')
      .eq('telegram_id',Number(telegramId)).maybeSingle(),
    supabaseAdmin.from('user_consent_settings')
      .select('gmail_enabled').eq('telegram_id',Number(telegramId)).maybeSingle(),
  ])
  if(userError)throw new Error(`open_loop_gmail_user_failed:${userError.message}`)
  if(consentError)throw new Error(`open_loop_gmail_consent_failed:${consentError.message}`)
  if(!user?.gmail_connected||consent?.gmail_enabled===false)return 'skip' as const

  const ownEmail=String(user.gmail_email||'').trim().toLowerCase()
  if(!ownEmail)return 'skip' as const

  let accessToken=''
  const refreshToken=decryptGoogleToken(user.gmail_refresh_token)
  if(refreshToken){
    accessToken=String(await refreshGmailAccessToken(refreshToken)||'')
  }
  if(!accessToken)accessToken=decryptGoogleToken(user.gmail_access_token)
  if(!accessToken)throw new Error('open_loop_gmail_token_unavailable')

  const threads=await fetchGmailAttentionThreads(accessToken,12)
  for(const thread of threads){
    const messages=thread.messages||[]
    if(!messages.length)continue
    const last=messages[messages.length-1]
    const fromEmail=headerEmail(last.from)
    const ownLast=fromEmail===ownEmail
    const ageHours=(Date.now()-Number(last.internalDate||0))/3600_000
    const subject=clean(last.subject||thread.subject||'(No subject)',180)
    const combined=clean(`${subject} ${last.snippet||''}`,700)

    if(ownLast){
      if(ageHours<24||!looksLikeReplyExpected(combined)){
        await resolveOtherGmailLoopsForThread(telegramId,String(thread.id),null)
        continue
      }
      const recipient=headerName(last.to)
      const input:OpenLoopInput={
        telegramId,kind:'waiting_on',
        title:`Waiting for reply from ${recipient} — ${subject}`,
        summary:clean(last.snippet||`You sent the latest message in this email thread and are still waiting for a reply.`,900),
        priority:ageHours>=72?0.94:ageHours>=48?0.9:0.86,
        nextCheckAt:isoPlusHours(12),
        sourceType:'gmail_thread',sourceId:String(thread.id),
        sourceRefs:[{type:'gmail_thread',id:String(thread.id)}],
        evidence:{last_message_id:last.id,last_message_from:last.from,last_message_to:last.to,last_internal_date:last.internalDate,direction:'outbound_waiting'},
        observedAt:new Date(Number(last.internalDate||Date.now())).toISOString(),
      }
      const fp=fingerprintFor(input);current.add(fp);await upsertOpenLoop(input)
      await resolveOtherGmailLoopsForThread(telegramId,String(thread.id),fp)
      continue
    }

    if(looksLikeIncomingPromise(combined)&&!isAutomatedGmailMessage(last)){
      const sender=headerName(last.from)
      const input:OpenLoopInput={
        telegramId,kind:'waiting_on',
        title:`Waiting on ${sender} — ${subject}`,
        summary:clean(last.snippet||'The sender committed to a follow-up or deliverable in this email thread.',900),
        priority:/\b(?:today|eod|urgent)\b/i.test(combined)?0.94:0.88,
        nextCheckAt:isoPlusHours(12),
        sourceType:'gmail_thread',sourceId:String(thread.id),
        sourceRefs:[{type:'gmail_thread',id:String(thread.id)}],
        evidence:{last_message_id:last.id,last_message_from:last.from,last_internal_date:last.internalDate,direction:'incoming_promise',unread:last.isUnread},
        observedAt:new Date(Number(last.internalDate||Date.now())).toISOString(),
      }
      const fp=fingerprintFor(input);current.add(fp);await upsertOpenLoop(input)
      await resolveOtherGmailLoopsForThread(telegramId,String(thread.id),fp)
      continue
    }

    if(looksLikeIncomingAction(combined)&&!isAutomatedGmailMessage(last)){
      const sender=headerName(last.from)
      const input:OpenLoopInput={
        telegramId,kind:'commitment',
        title:`Reply to ${sender} — ${subject}`,
        summary:clean(last.snippet||'This email appears to ask for an action or response.',900),
        priority:/\b(?:urgent|action required|today|deadline)\b/i.test(combined)?0.96:(last.isUnread?0.9:0.87),
        nextCheckAt:isoPlusHours(6),
        sourceType:'gmail_thread',sourceId:String(thread.id),
        sourceRefs:[{type:'gmail_thread',id:String(thread.id)}],
        evidence:{last_message_id:last.id,last_message_from:last.from,last_internal_date:last.internalDate,direction:'inbound_action',unread:last.isUnread},
        observedAt:new Date(Number(last.internalDate||Date.now())).toISOString(),
      }
      const fp=fingerprintFor(input);current.add(fp);await upsertOpenLoop(input)
      await resolveOtherGmailLoopsForThread(telegramId,String(thread.id),fp)
      continue
    }

    // We successfully inspected this thread and its latest state no longer
    // represents a waiting/reply loop. Resolve only this verified thread.
    await resolveOtherGmailLoopsForThread(telegramId,String(thread.id),null)
  }
  return 'ok' as const
}

async function syncMeetingActionMemories(telegramId:string){
  const since=new Date(Date.now()-30*86400_000).toISOString()
  const {data,error}=await supabaseAdmin.from('memories')
    .select('id,content,created_at')
    .eq('telegram_id',Number(telegramId))
    .gte('created_at',since)
    .order('created_at',{ascending:false})
    .limit(120)
  if(error)throw new Error(`open_loop_meeting_memory_read_failed:${error.message}`)
  let captured=0
  for(const row of data||[]){
    let parsed:any=null
    try{parsed=JSON.parse(String(row.content||''))}catch{continue}
    if(parsed?.type!=='followup_state'||parsed?.kind!=='meeting_action_items')continue
    const items=Array.isArray(parsed?.payload?.items)?parsed.payload.items:[]
    for(let index=0;index<items.length;index++){
      const item=items[index]
      const message=clean(item?.message,220)
      if(!message)continue
      const due=String(item?.remindAtIso||'').trim()
      await upsertOpenLoop({
        telegramId,kind:'meeting_action',
        title:message,
        summary:`Meeting action item: ${message}`,
        priority:0.87,
        dueAt:Number.isFinite(Date.parse(due))?due:null,
        nextCheckAt:Number.isFinite(Date.parse(due))?due:isoPlusHoursFrom(row.created_at,24),
        sourceType:'meeting_action',
        sourceId:`${row.id}:${index}`,
        sourceRefs:[{type:'meeting_action_state',id:String(row.id),index}],
        evidence:{memory_id:String(row.id),item_index:index},
        observedAt:row.created_at||null,
      })
      captured++
    }
  }
  return captured
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
    syncGmailAttention(tg,current),
    syncMeetingActionMemories(tg),
    syncConversationSignals(tg),
  ])
  const failures=results.filter((x):x is PromiseRejectedResult=>x.status==='rejected').map(x=>clean(x.reason?.message||x.reason,180))
  const successfulSourceTypes=sourceTypes.filter((_,index)=>results[index]?.status==='fulfilled')
  // Reconcile only sources that were read successfully. A transient provider/DB
  // failure must never make an existing open loop disappear.
  const resolved=await resolveMissingSourceLoops(tg,current,[...successfulSourceTypes]).catch(err=>{failures.push(clean(err?.message||err,180));return 0})
  return {telegramId:tg,resolved,failures}
}

export async function captureJevOpenLoopFromTurn(params:{actor:AgentActor;text:string;jev?:JevShadowResult|null;observedAt?:string|null}){
  const jev=params.jev
  if(!jev?.ok)return null
  const choice=String(jev.attentionState?.choice||'')
  const confidence=Number(jev.attentionState?.confidence||0)
  if(confidence<0.93||!['waiting_on','followup','commitment'].includes(choice))return null
  if(parseExplicitOpenLoop(params.text))return null
  const {data:consent}=await supabaseAdmin.from('user_consent_settings')
    .select('memory_enabled').eq('telegram_id',params.actor.legacyTelegramId).maybeSingle()
  if(consent?.memory_enabled===false)return null
  const raw=clean(params.text,700)
  const kind=choice as 'waiting_on'|'followup'|'commitment'
  const title=kind==='waiting_on'
    ? `Waiting on: ${clean(raw,180)}`
    : kind==='followup'
      ? `Follow up: ${clean(raw,180)}`
      : `Need to follow through: ${clean(raw,180)}`
  return upsertOpenLoop({
    telegramId:params.actor.legacyTelegramId,
    kind,title,summary:raw,
    priority:kind==='followup'?0.88:kind==='waiting_on'?0.85:0.82,
    nextCheckAt:kind==='commitment'?isoPlusHours(12):isoPlusHours(24),
    sourceType:'conversation',
    sourceRefs:[{type:'whatsapp_turn',semantic:'jev'}],
    evidence:{surface:'whatsapp',jev_attention_state:choice,jev_confidence:confidence},
    observedAt:params.observedAt||new Date().toISOString(),
  })
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
    || /^what\s+(?:am i waiting on|still needs follow[- ]?up|is still pending|needs my attention|needs attention|should i follow up on)$/.test(t)
    || /^(?:show|give)\s+me\s+(?:what\s+)?needs\s+my\s+attention$/.test(t)
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
  const numbered=raw.match(/^dismiss\s+#?(\d{1,2})$/i)
    || raw.match(/^(?:mark|close|resolve|finish|dismiss)\s+#?(\d{1,2})\s+(?:done|resolved|complete|completed)$/i)
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
    .select('id,kind,title,summary,priority,due_at,next_check_at,source_type,source_id,updated_at')
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
  const attentionWording=/needs\s+(?:my\s+)?attention|should\s+i\s+follow\s+up/i.test(params.text)
  return {
    runId:'open-loops-list',status:'completed' as const,capability:'orchestrator' as const,risk:'low' as const,
    text:`🧠 *${attentionWording?'What needs your attention':'Your open loops'}*\n\n${lines.join('\n')}\n\nSay *mark 2 done* to close one.`,
    handledBy:'open-loops',
  }
}

export function isOpenLoopActionCandidate(text:string){
  const raw=clean(text,500)
  return /^(?:snooze|pause)\s+(?:open\s+loop\s+)?#?\d{1,2}\s+(?:for\s+\d{1,3}\s*(?:hours?|days?)|until\s+tomorrow)$/i.test(raw)
    || /^draft\s+(?:a\s+)?follow[- ]?up\s+(?:for\s+)?(?:open\s+loop\s+)?#?\d{1,2}$/i.test(raw)
}

function parseOpenLoopSnooze(text:string,{allowGeneric=false}:{allowGeneric?:boolean}={}){
  const raw=clean(text,500)
  const explicit=raw.match(/^(?:snooze|pause)\s+open\s+loop\s+#?(\d{1,2})\s+(?:for\s+(\d{1,3})\s*(hours?|days?)|until\s+(tomorrow))$/i)
  const generic=allowGeneric
    ? raw.match(/^(?:snooze|pause)\s+#?(\d{1,2})\s+(?:for\s+(\d{1,3})\s*(hours?|days?)|until\s+(tomorrow))$/i)
    : null
  const match=explicit||generic
  if(!match)return null
  const index=Number(match[1])
  if(!Number.isInteger(index)||index<1||index>20)return null
  let hours=24
  if(match[2]){
    const amount=Math.max(1,Math.min(30*24,Number(match[2])))
    const unit=String(match[3]||'hours').toLowerCase()
    hours=unit.startsWith('day')?amount*24:amount
  }
  return {index,hours}
}

function parseOpenLoopDraft(text:string,{allowGeneric=false}:{allowGeneric?:boolean}={}){
  const raw=clean(text,500)
  const explicit=raw.match(/^draft\s+(?:a\s+)?follow[- ]?up\s+(?:for\s+)?open\s+loop\s+#?(\d{1,2})$/i)
  const generic=allowGeneric
    ? raw.match(/^draft\s+(?:a\s+)?follow[- ]?up\s+(?:for\s+)?#?(\d{1,2})$/i)
    : null
  const match=explicit||generic
  if(!match)return null
  const index=Number(match[1])
  return Number.isInteger(index)&&index>=1&&index<=20?{index}:null
}

function draftFromOpenLoop(loop:any){
  const title=clean(loop?.title,240)
  let person=''
  let topic=''
  const patterns=[
    /^Follow up with (.+?)(?: about (.+)| — (.+)|$)/i,
    /^Waiting on (.+?)(?: to (.+)| — (.+)|$)/i,
    /^Waiting for reply from (.+?)(?: — (.+)|$)/i,
    /^Reply to (.+?)(?: — (.+)|$)/i,
  ]
  for(const pattern of patterns){
    const match=title.match(pattern)
    if(!match)continue
    person=clean(match[1],100)
    topic=clean(match[2]||match[3]||'',180)
    break
  }
  if(!topic){
    topic=clean(loop?.summary,180)
      .replace(/^(?:meeting action item|waiting to follow up with)\s*:?\s*/i,'')
  }
  if(!topic||topic.toLowerCase()===title.toLowerCase())topic=''
  const greeting=person?`Hi ${person},`:'Hi,'
  const subject=topic?` on ${topic}`:''
  return `${greeting} just following up${subject}. Please let me know when you get a chance. Thanks.`
}

export async function shouldHandleOpenLoopAction(params:{actor:AgentActor;text:string}){
  const raw=clean(params.text,500)
  if(/\bopen\s+loop\b/i.test(raw))return isOpenLoopActionCandidate(raw)
  if(!isOpenLoopActionCandidate(raw))return false
  return recentOpenLoopListShown(params.actor.legacyTelegramId)
}

export async function handleOpenLoopAction(params:{actor:AgentActor;text:string}){
  const raw=clean(params.text,500)
  const explicit=/\bopen\s+loop\b/i.test(raw)
  if(!explicit&&!(await recentOpenLoopListShown(params.actor.legacyTelegramId)))return null
  const snooze=parseOpenLoopSnooze(raw,{allowGeneric:!explicit})
  const draft=parseOpenLoopDraft(raw,{allowGeneric:!explicit})
  if(!snooze&&!draft)return null

  const loops=await listOpenLoops(params.actor.legacyTelegramId,20)
  const index=snooze?.index||draft?.index||0
  const target=loops[index-1] as any
  if(!target){
    return {runId:'open-loop-action-missing',status:'completed' as const,capability:'orchestrator' as const,risk:'low' as const,text:`I don't have an active open loop #${index}. Ask *what needs my attention?* to see the current list.`,handledBy:'open-loops'}
  }

  if(snooze){
    const until=new Date(Date.now()+snooze.hours*3600_000).toISOString()
    const {error}=await supabaseAdmin.from('agent_open_loops').update({
      proactive_backoff_until:until,
      updated_at:new Date().toISOString(),
    }).eq('id',target.id).eq('telegram_id',String(params.actor.legacyTelegramId)).eq('status','active')
    if(error)throw new Error(`open_loop_snooze_failed:${error.message}`)
    const human=snooze.hours%24===0?`${snooze.hours/24} day${snooze.hours===24?'':'s'}`:`${snooze.hours} hour${snooze.hours===1?'':'s'}`
    return {
      runId:`open-loop-${target.id}`,status:'completed' as const,capability:'orchestrator' as const,risk:'low' as const,
      text:`😴 Snoozed proactive nudges for *${clean(target.title,180)}* for ${human}. It stays in your open-loop list.`,
      handledBy:'open-loops',
    }
  }

  const sourceType=String(target.source_type||'')
  if(['approval','agent_run','life_event_action'].includes(sourceType)){
    return {
      runId:`open-loop-${target.id}`,status:'completed' as const,capability:'orchestrator' as const,risk:'low' as const,
      text:`That item is a system action rather than a follow-up message. Ask *what are you working on for me?* to see its current state.`,
      handledBy:'open-loops',
    }
  }
  const draftText=draftFromOpenLoop(target)
  return {
    runId:`open-loop-${target.id}`,status:'completed' as const,capability:'orchestrator' as const,risk:'low' as const,
    text:`📝 *Draft follow-up*\n\n${draftText}\n\n_Draft only — I haven't sent anything._`,
    handledBy:'open-loops',
  }
}

export async function shouldHandleOpenLoopResolution(params:{actor:AgentActor;text:string}){
  if(parseOpenLoopResolution(params.text))return true
  if(!isOpenLoopResolutionCandidate(params.text))return false
  return recentOpenLoopListShown(params.actor.legacyTelegramId)
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
  const sourceType=String(target.source_type||'')
  if(parsed.mode==='resolved'&&['approval','agent_run','life_event_action'].includes(sourceType)){
    const guidance=sourceType==='approval'
      ? 'This approval is still pending. Use *APPROVE* or *REJECT* so I can update the real action safely.'
      : 'The underlying task is still active. I won’t mark it complete just because the attention item was numbered.'
    return {runId:`open-loop-${target.id}`,status:'completed' as const,capability:'orchestrator' as const,risk:'low' as const,text:`⚠️ ${guidance}\n\n${clean(target.title,180)}`,handledBy:'open-loops'}
  }

  if(parsed.mode==='resolved'&&sourceType==='followup'&&target.source_id){
    const {error:followError}=await supabaseAdmin.from('followups').update({status:'resolved'}).eq('id',target.source_id).in('status',['pending','fired'])
    if(followError)throw new Error(`open_loop_followup_resolve_failed:${followError.message}`)
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
  const [conversationResult,approvalResult,runResult,lifeResult,followupResult,userResult,memoryResult]=await Promise.all([
    supabaseAdmin.from('conversations').select('telegram_id').eq('role','user').gte('created_at',since).order('created_at',{ascending:false}).limit(3000),
    supabaseAdmin.from('agent_approvals').select('telegram_id').eq('status','pending').limit(1000),
    supabaseAdmin.from('agent_runs').select('telegram_id').in('status',['waiting_approval','paused','outcome_unknown']).limit(1000),
    supabaseAdmin.from('life_event_actions').select('telegram_id').in('status',['waiting_approval','blocked']).limit(1000),
    supabaseAdmin.from('followups').select('whatsapp_id').in('status',['pending','fired']).limit(1000),
    supabaseAdmin.from('users').select('telegram_id,whatsapp_id,gmail_connected').limit(3000),
    supabaseAdmin.from('memories').select('telegram_id').gte('created_at',since).order('created_at',{ascending:false}).limit(3000),
  ])
  const ids=new Set<string>()
  for(const result of [conversationResult,approvalResult,runResult,lifeResult,memoryResult]){
    if(result.error)console.error('OPEN_LOOP_SCOUT_CANDIDATE_FAILED:',result.error.message)
    for(const row of result.data||[])if((row as any).telegram_id)ids.add(String((row as any).telegram_id))
  }
  const phoneToTelegram=new Map<string,string>()
  for(const user of userResult.data||[]){
    const phone=normalizedPhone((user as any).whatsapp_id)
    if(phone&&(user as any).telegram_id)phoneToTelegram.set(phone,String((user as any).telegram_id))
    if((user as any).gmail_connected&&(user as any).telegram_id)ids.add(String((user as any).telegram_id))
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
