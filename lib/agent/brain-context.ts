import { supabaseAdmin } from '@/lib/supabase-admin'
import { redactSecretShapedText } from '@/lib/bot/memory-redaction'
import { listVaultCredentials } from '@/lib/vault/credential-store'
import type { AgentActor } from './actor'
import { completeAgentPlanPrompt } from './planner-provider'

export type BrainFocus =
  | { kind:'trip'; ref:string; summary:string; bookingGroup?:string|null }
  | { kind:'mission'; ref:string; summary:string; runId:string; status:string }
  | { kind:'conversation'; ref:string; summary:string }

export type BrainSnapshot = {
  focus: BrainFocus | null
  recentTrips: Array<{ bookingGroup:string|null; from:string|null; to:string|null; departAt:string|null; flightNo:string|null; airline:string|null; pnr:string|null }>
  recentRuns:Array<{id:string;status:string;type:string;title:string;summary:string;inputText:string}>
  recentConversation:Array<{role:string;content:string}>
  vault:Array<{provider:string;domains:string[];status:string;accountLabel:string}>
}

export type BrainTurnResolution = {
  originalText:string
  resolvedText:string
  usedContext:boolean
  focus:BrainFocus|null
  actionFamily:'ask'|'save'|'remind'|'calendar'|'monitor'|'research'|'book'|'buy'|'send'|'other'
  confidence:number
  requiresClarification:boolean
  source:'deterministic'|'model'|'none'
}

function safe(value:unknown,max=900){
  return redactSecretShapedText(String(value??'').replace(/\s+/g,' ').trim()).slice(0,max)
}

function actionFamily(text:string):BrainTurnResolution['actionFamily']{
  const t=String(text||'').toLowerCase()
  if(/\b(calendar|schedule|diary)\b/.test(t)&&/\b(add|save|put|block|schedule)\b/.test(t))return 'calendar'
  if(/\b(remind|reminder|alert|notify)\b/.test(t))return 'remind'
  if(/\b(monitor|watch|track|keep an eye|let me know when|tell me when)\b/.test(t))return 'monitor'
  if(/\b(book|reserve|reservation|check[- ]?in)\b/.test(t))return 'book'
  if(/\b(buy|purchase|checkout|order it|pay for)\b/.test(t))return 'buy'
  if(/\b(send|forward|email|message|reply)\b/.test(t))return 'send'
  if(/\b(save|remember|keep this|store this)\b/.test(t))return 'save'
  if(/\b(check|find|research|look up|requirements?|what do i need|what about|show|compare|search)\b/.test(t))return 'research'
  if(/[?]$/.test(t)||/^(what|when|where|who|why|how|can|is|are|do|does|will)\b/.test(t))return 'ask'
  return 'other'
}

export function needsBrainContext(text:string){
  const t=String(text||'').trim().toLowerCase()
  if(!t)return false
  if(/\b(it|this|that|these|those|them|there|same|above|earlier|previous|last one|the trip|the flight|the booking|the document|the file|the order|the hotel|the ticket)\b/.test(t))return true
  if(t.length<=80 && /^(save|add|put|monitor|watch|track|book|reserve|check|find|remind|send|forward|open|continue|proceed)\b/.test(t))return true
  return false
}

function tripRef(rows:any[]){
  if(!rows.length)return null
  const first=rows[0]
  const last=rows[rows.length-1]
  const route=[safe(first.from_city,80),safe(last.to_city,80)].filter(Boolean).join(' to ')
  const flights=rows.map((r:any)=>safe(r.flight_no,30)).filter(Boolean).join(' / ')
  const date=first.depart_at?new Date(first.depart_at).toISOString().slice(0,10):''
  const summary=[route,date,flights?'flights '+flights:'',first.booking_group?'booking '+safe(first.booking_group,40):''].filter(Boolean).join(', ')
  return {kind:'trip' as const,ref:'trip:'+safe(first.booking_group||first.id||'latest',80),summary,bookingGroup:first.booking_group||null}
}

async function loadTrips(actor:AgentActor){
  try{
    const cutoff=new Date(Date.now()-48*60*60*1000).toISOString()
    const {data,error}=await supabaseAdmin.from('travel_tickets')
      .select('id,booking_group,leg_index,from_city,to_city,depart_at,flight_no,airline,pnr')
      .eq('telegram_id',actor.legacyTelegramId)
      .gte('depart_at',cutoff)
      .order('depart_at',{ascending:true})
      .limit(12)
    if(error)throw error
    const rows=data||[]
    const groups=new Map<string,any[]>()
    for(const row of rows){
      const key=String(row.booking_group||row.pnr||row.id)
      const arr=groups.get(key)||[];arr.push(row);groups.set(key,arr)
    }
    const grouped=Array.from(groups.values())
    const latest=grouped[0]||[]
    return {
      focus:tripRef(latest),
      trips:rows.map((row:any)=>({bookingGroup:row.booking_group||null,from:row.from_city||null,to:row.to_city||null,departAt:row.depart_at||null,flightNo:row.flight_no||null,airline:row.airline||null,pnr:row.pnr||null})),
    }
  }catch(error:any){
    console.error('BRAIN_TRIP_CONTEXT_FAILED:',safe(error?.message||error,180))
    return {focus:null,trips:[]}
  }
}

async function loadRuns(actor:AgentActor){
  try{
    const {data,error}=await supabaseAdmin.from('agent_runs')
      .select('id,status,type,title,summary,metadata_json,updated_at')
      .eq('telegram_id',String(actor.legacyTelegramId))
      .order('updated_at',{ascending:false})
      .limit(8)
    if(error)throw error
    const runs=(data||[]).map((row:any)=>({id:String(row.id),status:String(row.status||''),type:String(row.type||''),title:safe(row.title,160),summary:safe(row.summary,500),inputText:safe(row?.metadata_json?.input_text||row?.metadata_json?.objective||'',500)}))
    const live=runs.find((r:any)=>['queued','running','waiting_approval','paused'].includes(r.status))
    return {focus:live?{kind:'mission' as const,ref:'run:'+live.id,summary:[live.title,live.summary].filter(Boolean).join(' — '),runId:live.id,status:live.status}:null,runs}
  }catch(error:any){
    console.error('BRAIN_RUN_CONTEXT_FAILED:',safe(error?.message||error,180))
    return {focus:null,runs:[]}
  }
}

async function loadConversation(actor:AgentActor){
  try{
    const {data,error}=await supabaseAdmin.from('conversations')
      .select('role,content,created_at')
      .eq('telegram_id',actor.legacyTelegramId)
      .order('created_at',{ascending:false})
      .limit(10)
    if(error)throw error
    return (data||[]).reverse().map((row:any)=>({role:String(row.role||''),content:safe(row.content,700)}))
  }catch(error:any){
    console.error('BRAIN_CONVERSATION_CONTEXT_FAILED:',safe(error?.message||error,180))
    return []
  }
}

async function loadVault(actor:AgentActor){
  try{
    const rows=await listVaultCredentials(String(actor.legacyTelegramId))
    return rows.slice(0,12).map(row=>({provider:safe(row.provider,80),domains:(row.allowedDomains||[]).map(domain=>safe(domain,120)).filter(Boolean),status:String(row.status||'active'),accountLabel:safe(row.accountLabel,100)}))
  }catch(error:any){
    console.error('BRAIN_VAULT_METADATA_FAILED:',safe(error?.message||error,180))
    return []
  }
}

export async function loadBrainSnapshot(actor:AgentActor):Promise<BrainSnapshot>{
  const [tripState,runState,recentConversation,vault]=await Promise.all([loadTrips(actor),loadRuns(actor),loadConversation(actor),loadVault(actor)])
  let focus:BrainFocus|null=runState.focus||tripState.focus||null
  if(!focus){
    const last=recentConversation.slice().reverse().find(row=>row.role==='assistant'||row.role==='user')
    if(last?.content)focus={kind:'conversation',ref:'conversation:latest',summary:safe(last.content,500)}
  }
  return {focus,recentTrips:tripState.trips,recentRuns:runState.runs,recentConversation,vault}
}

function deterministicResolution(text:string,snapshot:BrainSnapshot):BrainTurnResolution|null{
  if(!needsBrainContext(text)||!snapshot.focus)return null
  const family=actionFamily(text)
  const focus=snapshot.focus
  const original=safe(text,1200)
  const resolved=original+'\n\nSame Brain context: “it/this/that” refers to '+focus.summary+'. Continue the same user outcome; do not create unrelated work.'
  return {originalText:original,resolvedText:resolved,usedContext:true,focus,actionFamily:family,confidence:0.92,requiresClarification:false,source:'deterministic'}
}

function parseJsonLoose(text:string){
  const clean=String(text||'').replace(/\`\`\`json|\`\`\`/g,'').trim()
  try{return JSON.parse(clean)}catch{}
  const m=clean.match(/\{[\s\S]*\}/)
  if(!m)return null
  try{return JSON.parse(m[0])}catch{return null}
}

async function modelResolution(text:string,snapshot:BrainSnapshot):Promise<BrainTurnResolution|null>{
  if(!snapshot.focus)return null
  const safeSnapshot={
    focus:snapshot.focus,
    recentRuns:snapshot.recentRuns.slice(0,4).map(r=>({status:r.status,type:r.type,title:r.title,summary:r.summary,inputText:r.inputText})),
    recentTrips:snapshot.recentTrips.slice(0,6),
    vault:snapshot.vault.map(v=>({provider:v.provider,domains:v.domains,status:v.status,accountLabel:v.accountLabel})),
    recentConversation:snapshot.recentConversation.slice(-6),
  }
  const prompt=[
    "You are AskGogo's context resolver, not an executor.",
    "Resolve ONLY what the user's current turn refers to using the supplied Same Brain snapshot.",
    "Never invent a booking, person, date, account, credential, approval, payment, or completed action.",
    "Vault entries are metadata only. They mean a secure credential MAY be available to the trusted browser broker; never ask for or output a password, OTP, token or username.",
    "Do not downgrade consequential actions. If the user asks to book, buy, send, submit, check in, or otherwise mutate something, keep that explicit in resolvedText so deterministic approval/Sentinel gates can handle it.",
    "If the current turn is already self-contained, return it unchanged with usedContext=false.",
    "If the referent is ambiguous, set requiresClarification=true and do not choose one.",
    'Return JSON only: {"resolvedText":"...","usedContext":true,"actionFamily":"ask|save|remind|calendar|monitor|research|book|buy|send|other","confidence":0.0,"requiresClarification":false}',
    'Current turn: '+JSON.stringify(safe(text,1600)),
    'Same Brain snapshot: '+JSON.stringify(safeSnapshot),
  ].join('\n')
  try{
    const out=await completeAgentPlanPrompt(prompt)
    const parsed=parseJsonLoose(out)
    if(!parsed||typeof parsed.resolvedText!=='string')return null
    const requiresClarification=parsed.requiresClarification===true
    return {
      originalText:safe(text,1200),
      resolvedText:requiresClarification?safe(text,1200):safe(parsed.resolvedText,1800),
      usedContext:parsed.usedContext===true&&!requiresClarification,
      focus:snapshot.focus,
      actionFamily:['ask','save','remind','calendar','monitor','research','book','buy','send','other'].includes(parsed.actionFamily)?parsed.actionFamily:actionFamily(text),
      confidence:Math.max(0,Math.min(1,Number(parsed.confidence)||0)),
      requiresClarification,
      source:'model',
    }
  }catch(error:any){
    console.error('BRAIN_CONTEXT_MODEL_FAILED:',safe(error?.message||error,180))
    return null
  }
}

export async function resolveBrainTurn(params:{actor:AgentActor;text:string}):Promise<{snapshot:BrainSnapshot;resolution:BrainTurnResolution}>{
  const snapshot=await loadBrainSnapshot(params.actor)
  const deterministic=deterministicResolution(params.text,snapshot)
  if(deterministic)return {snapshot,resolution:deterministic}
  if(needsBrainContext(params.text)){
    const model=await modelResolution(params.text,snapshot)
    if(model)return {snapshot,resolution:model}
  }
  return {snapshot,resolution:{originalText:safe(params.text,1200),resolvedText:safe(params.text,1600),usedContext:false,focus:snapshot.focus,actionFamily:actionFamily(params.text),confidence:1,requiresClarification:false,source:'none'}}
}
