// Shared adapter for existing non-streaming model call sites. This is a
// server-only boundary, not an executor. Explicit owner is a trusted resolved
// identity; an authenticated metering context is the alternative. Neither
// model arguments nor public request JSON may choose this identity.
import { currentMeterContext } from '@/lib/metering/core'
import { exactSessionOwnerId } from '@/lib/dashboard/owner-identity'
import { governedEnabled,openPersonalGovernedRuntimeForOwner,type GovernedRuntime } from './governed-runtime'
import {currentGovernedRun,currentGovernedForeground,foregroundRuntime,foregroundInTime} from './governed-run-context'
type Env=Record<string,string|undefined>
type Owner=string|number|null|undefined
type Selection={kind:'legacy'}|{kind:'governed';owner:string}|{kind:'invalid'}
export type ModelReceipt={model?:unknown;usage?:{input_tokens?:unknown;output_tokens?:unknown;cache_read_input_tokens?:unknown;cache_creation_input_tokens?:unknown}}
export class GovernedModelError extends Error{
  constructor(readonly reason:string){super('governed_model_'+reason);this.name='GovernedModelError'}
}
export function selectGovernedOwner(explicit:Owner,context:Owner,env:Env):Selection{
  if(env.GOGO_HACHI_ENFORCEMENT!=='1')return {kind:'legacy'}
  const a=exactSessionOwnerId(explicit),b=exactSessionOwnerId(context)
  const chosen=a||b
  const selected=[a,b].some(x=>x!==null&&governedEnabled('personal',x,env))
  if(!selected)return {kind:'legacy'}
  // Empty context is not an identity. A conflicting or malformed supplied
  // identity must not cause an enabled owner to fall back to unmetered calls.
  if(!chosen||(explicit!=null&&explicit!==''&&!a)||(context!=null&&context!==''&&!b)||(a&&b&&a!==b))return {kind:'invalid'}
  return {kind:'governed',owner:chosen}
}
export function selectedModelOwner(explicit?:Owner):Selection{
  const active=currentGovernedRun(),context=currentMeterContext()?.telegramId
  if(!active){
    const request=currentGovernedForeground()
    if(!request)return selectGovernedOwner(explicit,context,process.env)
    const selected=selectGovernedOwner(explicit,request.owner||context,process.env)
    if(selected.kind==='legacy')return selected
    if(selected.kind!=='governed'||!foregroundInTime(selected.owner)||context!=null&&context!==''&&exactSessionOwnerId(context)!==selected.owner)return {kind:'invalid'}
    return selected
  }
  // A nested task cannot fall through to legacy on lost context, changed
  // flags, deadline, or mismatched owner. Parent scope remains authoritative.
  if(!active.inTime()||!governedEnabled('personal',active.owner)||
    (explicit!=null&&explicit!==''&&exactSessionOwnerId(explicit)!==active.owner)||
    (context!=null&&context!==''&&exactSessionOwnerId(context)!==active.owner))return {kind:'invalid'}
  return {kind:'governed',owner:active.owner}
}
export function modelGoverned(explicit?:Owner):boolean{return selectedModelOwner(explicit).kind!=='legacy'}
type Deps={
  selection:()=>Selection
  open:(owner:string)=>Promise<GovernedRuntime|null>
  now:()=>number
}
export async function governedModelCall<T>(model:string,invoke:(guarded:boolean)=>Promise<T>,receipt:(value:T)=>ModelReceipt,explicit?:Owner,deps?:Deps):Promise<T>{
  const d=deps||{selection:()=>selectedModelOwner(explicit),open:openPersonalGovernedRuntimeForOwner,now:Date.now}
  const selected=d.selection(),parent=currentGovernedRun()
  if(parent&&(selected.kind!=='governed'||selected.owner!==parent.owner||!parent.inTime()))throw new GovernedModelError('nested_scope_mismatch')
  if(selected.kind==='legacy')return invoke(false)
  if(selected.kind!=='governed')throw new GovernedModelError('identity_mismatch')
  const deadline=d.now()+30_000
  const request=currentGovernedForeground()
  // Selected production calls without a trusted request/worker scope fail
  // closed instead of creating an independent allowance for each fallback.
  const runtime=parent?parent.runtime:request?await foregroundRuntime(selected.owner,()=>d.open(selected.owner)):deps?await d.open(selected.owner).catch(()=>null):null
  if(!runtime)throw new GovernedModelError('policy_unavailable')
  const result=await runtime.model(model,async()=>{
    const value=await invoke(true)
    const proof=receipt(value)
    return {model:proof.model,usage:proof.usage,value}
  },()=>d.now()<deadline&&(parent?parent.inTime():request?foregroundInTime(selected.owner):!!deps))
  if(result.state!=='completed')throw new GovernedModelError(result.reason)
  return result.value.value
}
export function openAICompatibleReceipt(value:unknown):ModelReceipt{
  // Prompt/total input counters already include cached input tokens. Do not
  // count the cached subset a second time. Reasoning is included in output.
  const r=value as {model?:unknown;usage?:{prompt_tokens?:unknown;completion_tokens?:unknown}}|null
  return {model:r?.model,usage:{input_tokens:r?.usage?.prompt_tokens,output_tokens:r?.usage?.completion_tokens}}
}
