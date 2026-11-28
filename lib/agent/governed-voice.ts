// Exact plan and operator-reviewed agent profile; no implicit provisioning.
import {supabaseAdmin} from '@/lib/supabase-admin'
import {exactSessionOwnerId} from '@/lib/dashboard/owner-identity'
import {sarvamCallProfile} from './voice-call-language'
import {voicePlanHash,voiceAttemptId} from './voice-call-execution'
import {capabilityPermissionLevel} from './adaptive-autonomy'
import {capabilityPaused} from './policy'
import type {CallPlan} from './voice-call'
import {governedVoiceFetch} from './governed-provider-call'
import {withGovernedForeground,bindGovernedForegroundOwner,currentGovernedRun,currentGovernedForeground} from './governed-run-context'
export type VoiceBinding={version:'bolna-approved-v1';agentId:string;from:string;contact:string;maxSeconds:number}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const validNumber=(v:unknown)=>typeof v==='string'&&/^\+91\d{10}$/.test(v)
const int=(v:unknown)=>Number.isSafeInteger(Number(v))&&String(Number(v))===String(v)?Number(v):null
export function governedVoiceSelected(owner:string|number,env:Record<string,string|undefined>=(globalThis as any).process?.env||{}){
  return env.GOGO_HACHI_ENFORCEMENT==='1'&&String(env.GOGO_HACHI_PERSONAL_OWNERS||'').split(',').map(s=>s.trim()).includes(String(owner))
}
async function profile(owner:string,plan:CallPlan){
  if(exactSessionOwnerId(owner)!==owner)return null
  const kind=plan.kind==='general'?'general':'table',language=plan.callLanguage||'English'
  const id=plan.callLanguage?sarvamCallProfile(owner,plan.callLanguage,kind):String(kind==='general'?process.env.BOLNA_GENERAL_AGENT_ID||'':process.env.BOLNA_AGENT_ID||'').trim().toLowerCase()
  if(!id||!uuid.test(id)||plan.voiceAgentId&&plan.voiceAgentId!==id)return null
  const [r,t]=await Promise.all([
    supabaseAdmin.from('gogo_governed_voice_profiles').select('profile_id,kind,language,max_seconds,max_cost_micros,valid_until,verified_source').eq('profile_id',id).maybeSingle(),
    supabaseAdmin.from('gogo_governed_connector_prices').select('operation,max_cost_micros,valid_until,verified_source').eq('operation','bolna.call.v1').maybeSingle()
  ])
  const x=r.data,p=t.data,seconds=int(x?.max_seconds),cost=int(x?.max_cost_micros),cap=int(p?.max_cost_micros)
  if(r.error||t.error||x?.profile_id!==id||x?.kind!==kind||x?.language!==language||seconds===null||seconds<1||seconds>180||cost===null||cost<1||cap===null||cap<cost||
    !(Date.parse(x.valid_until)>Date.now())||!(Date.parse(p.valid_until)>Date.now())||!x.verified_source?.trim()||!p.verified_source?.trim())return null
  return {id,seconds}
}
export async function bindReviewedVoicePlan(owner:string,plan:CallPlan,whatsappId:string,from:string):Promise<CallPlan|null>{
  const p=await profile(owner,plan)
  if(!p||!validNumber(from))return null
  const phone='+'+String(whatsappId||'').replace(/\D/g,'')
  const contact=plan.kind==='general'||plan.callLanguage||plan.test?'':validNumber(phone)?phone:''
  return {...plan,governedCall:{version:'bolna-approved-v1',agentId:p.id,from,contact,maxSeconds:p.seconds}}
}
export async function voiceBindingStillValid(owner:string,plan:CallPlan,from:string,whatsappId:string):Promise<boolean>{
  const next=await bindReviewedVoicePlan(owner,plan,whatsappId,from)
  return !!next?.governedCall&&JSON.stringify(next.governedCall)===JSON.stringify(plan.governedCall)
}
export async function approvedVoiceRunAuthority(owner:string,actorId:string,plan:CallPlan,approvalHash:string,livePlan:()=>Promise<boolean>):Promise<boolean>{
  if(!governedVoiceSelected(owner)||capabilityPaused('voice_calls')||!plan.governedCall||voicePlanHash(owner,plan)!==approvalHash||Date.now()-Date.parse(plan.createdAt)>=900000||Date.parse(plan.createdAt)>Date.now())return false
  if(!['draft','ask','auto'].includes(await capabilityPermissionLevel(owner,'contacts')))return false
  const [user,run]=await Promise.all([
    supabaseAdmin.from('users').select('id,telegram_id,access_status,whatsapp_id').eq('id',actorId).eq('telegram_id',owner).maybeSingle(),
    supabaseAdmin.from('agent_runs').select('id,status,metadata_json,error').eq('id',voiceAttemptId(owner,plan)).eq('telegram_id',owner).maybeSingle()
  ])
  if(user.error||run.error||String(user.data?.id||'')!==actorId||exactSessionOwnerId(user.data?.telegram_id)!==owner||user.data?.access_status!=='active'||run.data?.status!=='running'||run.data.error==='user_cancelled'||run.data.metadata_json?.call_state!=='submitting'||run.data.metadata_json?.approval_hash!==approvalHash||voicePlanHash(owner,run.data.metadata_json?.plan||{})!==approvalHash||voiceAttemptId(owner,run.data.metadata_json?.plan||{})!==run.data.id)return false
  return await voiceBindingStillValid(owner,plan,String(process.env.BOLNA_FROM_NUMBER||'+918065539020'),String(user.data.whatsapp_id||''))&&await livePlan()
}
export async function governedVoiceStatus(owner:string,runId:string,executionId:string,fetcher:typeof fetch=fetch):Promise<any>{
  if(!uuid.test(runId)||!/^[A-Za-z0-9_-]{1,200}$/.test(executionId)||exactSessionOwnerId(owner)!==owner)throw Error('voice_read_identity_invalid')
  const authorize=async()=>{
    const [u,r]=await Promise.all([
      supabaseAdmin.from('users').select('telegram_id,access_status').eq('telegram_id',owner).maybeSingle(),
      supabaseAdmin.from('agent_runs').select('id,type,status,metadata_json,error,started_at').eq('id',runId).eq('telegram_id',owner).maybeSingle()
    ])
    return !u.error&&!r.error&&exactSessionOwnerId(u.data?.telegram_id)===owner&&u.data?.access_status==='active'&&r.data?.type==='voice_call'&&r.data.status==='running'&&r.data.error!=='user_cancelled'&&r.data.metadata_json?.execution_id===executionId&&r.data.metadata_json?.call_state==='provider_accepted'&&!r.data.metadata_json?.result_claim&&['read','draft','ask','auto'].includes(await capabilityPermissionLevel(owner,'contacts'))
  }
  const read=async()=>{
    const key=String(process.env.BOLNA_API_KEY||'').trim()
    if(!key)throw Error('bolna_not_configured')
    const res=await governedVoiceFetch({operation:'bolna.execution.read.v1',owner,url:'https://api.bolna.ai/executions/'+executionId,init:{method:'GET',headers:{authorization:'Bearer '+key}},authorize})
    if(!res.ok)throw Error('voice_status_unavailable')
    return res.json()
  }
  if(currentGovernedRun()||currentGovernedForeground())return read()
  return withGovernedForeground(async()=>{bindGovernedForegroundOwner(owner);return read()},45_000)
}
