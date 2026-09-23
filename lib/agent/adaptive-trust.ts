import { supabaseAdmin } from '@/lib/supabase-admin'
import type { AgentActor } from './actor'
import type { AgentCapability, AgentPermissionLevel } from './policy'

const DEFAULT_LEVEL:Record<AgentCapability,AgentPermissionLevel>={
  memory:'ask',files:'ask',reminders:'auto',lists:'auto',tasks:'auto',
  email:'draft',calendar:'ask',browser:'draft',contacts:'read',travel:'draft',payments:'ask',
}
const CAPABILITIES:AgentCapability[]=['memory','files','reminders','lists','tasks','email','calendar','browser','contacts','travel','payments']

function clean(value:unknown,max=500){return String(value??'').replace(/\s+/g,' ').trim().slice(0,max)}

export function isAdaptiveTrustQuery(text:string){
  const raw=clean(text,700)
  return /^(?:what should you do automatically|what can you learn from my approvals|show(?: me)? (?:my )?(?:autonomy|trust) suggestions|where can you be more autonomous|what can you stop asking me about)\??$/i.test(raw)
}

function capabilityFromActionType(actionType:string):AgentCapability|null{
  const t=String(actionType||'').toLowerCase()
  if(/calendar|meeting|appointment/.test(t))return 'calendar'
  if(/email|mail|send_message|message_send/.test(t))return 'email'
  if(/browser|web|form|cart/.test(t))return 'browser'
  if(/travel|flight|hotel|train|booking/.test(t))return 'travel'
  if(/payment|pay|purchase|checkout/.test(t))return 'payments'
  if(/reminder/.test(t))return 'reminders'
  if(/list/.test(t))return 'lists'
  if(/task/.test(t))return 'tasks'
  if(/file|drive|document/.test(t))return 'files'
  if(/contact/.test(t))return 'contacts'
  return null
}

async function currentPermissions(actor:AgentActor){
  const {data,error}=await supabaseAdmin.from('agent_permissions')
    .select('capability,level')
    .eq('telegram_id',String(actor.legacyTelegramId))
  if(error)throw new Error(`adaptive_trust_permission_read_failed:${error.message}`)
  const explicit=new Map<string,AgentPermissionLevel>((data||[]).map((r:any)=>[String(r.capability),String(r.level) as AgentPermissionLevel]))
  return new Map<AgentCapability,AgentPermissionLevel>(CAPABILITIES.map(cap=>[cap,explicit.get(cap)||DEFAULT_LEVEL[cap]]))
}

export async function buildAdaptiveTrustSuggestions(actor:AgentActor){
  const since=new Date(Date.now()-90*86400_000).toISOString()
  const approvals:any[]=[]
  const pageSize=200
  for(let from=0;;from+=pageSize){
    const {data,error}=await supabaseAdmin.from('agent_approvals')
      .select('id,run_id,action_type,status,risk_level,requested_at,execution_payload')
      .eq('telegram_id',String(actor.legacyTelegramId))
      .gte('requested_at',since)
      .order('requested_at',{ascending:false})
      .range(from,from+pageSize-1)
    if(error)throw new Error(`adaptive_trust_approval_read_failed:${error.message}`)
    approvals.push(...(data||[]))
    if((data||[]).length<pageSize)break
  }

  const runIds=[...new Set(approvals.map((a:any)=>String(a.run_id||'')).filter(Boolean))]
  const runCapability=new Map<string,AgentCapability>()
  for(let i=0;i<runIds.length;i+=100){
    const batch=runIds.slice(i,i+100)
    const {data:runs,error:runError}=await supabaseAdmin.from('agent_runs')
      .select('id,capability')
      .in('id',batch)
    if(runError)throw new Error(`adaptive_trust_run_read_failed:${runError.message}`)
    for(const run of runs||[]){
      const cap=String(run.capability||'') as AgentCapability
      if(CAPABILITIES.includes(cap))runCapability.set(String(run.id),cap)
    }
  }

  type TrustStat={lowRiskSuccess:number;mediumRiskSuccess:number;highRiskSuccess:number;rejected:number;failed:number;latest:string|null}
  const stats=new Map<AgentCapability,TrustStat>()
  for(const a of approvals){
    const payloadCap=String((a.execution_payload as any)?.capability||'') as AgentCapability
    const cap=(CAPABILITIES.includes(payloadCap)?payloadCap:null)
      ||capabilityFromActionType(String(a.action_type||''))
      ||runCapability.get(String(a.run_id||''))
    if(!cap)continue
    const s=stats.get(cap)||{lowRiskSuccess:0,mediumRiskSuccess:0,highRiskSuccess:0,rejected:0,failed:0,latest:null}
    const status=String(a.status||'')
    const risk=String(a.risk_level||'')
    if(status==='executed'){
      if(risk==='low')s.lowRiskSuccess++
      else if(risk==='medium')s.mediumRiskSuccess++
      else if(risk==='high')s.highRiskSuccess++
    }else if(status==='rejected')s.rejected++
    else if(['failed','expired'].includes(status))s.failed++
    if(!s.latest)s.latest=String(a.requested_at||'')||null
    stats.set(cap,s)
  }

  const permissions=await currentPermissions(actor)
  const suggestions:[AgentCapability,TrustStat][]=[]
  const patterns:[AgentCapability,TrustStat][]=[]
  for(const [cap,s] of stats.entries()){
    const current=permissions.get(cap)||DEFAULT_LEVEL[cap]
    if(current==='off')continue
    const cleanHistory=s.rejected===0&&s.failed===0
    if(current!=='auto'&&s.lowRiskSuccess>=5&&cleanHistory&&s.highRiskSuccess===0){
      suggestions.push([cap,s])
      continue
    }
    const totalExecuted=s.lowRiskSuccess+s.mediumRiskSuccess+s.highRiskSuccess
    if(totalExecuted>=3&&cleanHistory)patterns.push([cap,s])
  }
  suggestions.sort((a,b)=>b[1].lowRiskSuccess-a[1].lowRiskSuccess)
  patterns.sort((a,b)=>(b[1].lowRiskSuccess+b[1].mediumRiskSuccess+b[1].highRiskSuccess)-(a[1].lowRiskSuccess+a[1].mediumRiskSuccess+a[1].highRiskSuccess))

  return {suggestions,patterns,permissions,stats}
}

export async function tryRunAdaptiveTrustCommand(params:{actor:AgentActor;text:string}){
  if(!isAdaptiveTrustQuery(params.text))return null
  const {suggestions,patterns}=await buildAdaptiveTrustSuggestions(params.actor)
  if(!suggestions.length&&!patterns.length){
    return {
      runId:'adaptive-trust-none',status:'completed' as const,capability:'orchestrator' as const,risk:'low' as const,
      text:'🧠 *Adaptive Trust*\n\nI don’t have enough clean repeated approval history yet to recommend changing anything. I’ll keep learning from successful executions, rejections and failures, but I won’t change permissions on my own.',
      handledBy:'adaptive-trust',
    }
  }

  const blocks:string[]=[]
  if(suggestions.length){
    const lines=suggestions.slice(0,5).map(([cap,s],i)=>{
      return `${i+1}. *${cap}* — ${s.lowRiskSuccess} successfully executed low-risk approvals in the last 90 days, with no rejects/failures.\n   Suggested command: *set ${cap} autonomy to auto*`
    })
    blocks.push(`*Eligible for safer auto handling*\n${lines.join('\n\n')}`)
  }
  if(patterns.length){
    const lines=patterns.slice(0,5).map(([cap,s])=>{
      const total=s.lowRiskSuccess+s.mediumRiskSuccess+s.highRiskSuccess
      return `• *${cap}* — ${total} repeated executed approvals (${s.mediumRiskSuccess} medium-risk, ${s.highRiskSuccess} high-risk). I can recognize this pattern, but current hard safety still requires approval for consequential actions.`
    })
    blocks.push(`*Patterns I’m learning*\n${lines.join('\n')}`)
  }
  return {
    runId:'adaptive-trust-suggestions',status:'completed' as const,capability:'orchestrator' as const,risk:'low' as const,
    text:`🧠 *Adaptive Trust*\n\n${blocks.join('\n\n')}\n\nI will never change these automatically. You choose whether to promote a capability. Hard safety still overrides auto for irreversible or medium/high-risk consequential actions.`,
    handledBy:'adaptive-trust',
  }
}
