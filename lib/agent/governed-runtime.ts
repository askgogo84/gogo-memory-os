// Server-side wiring for the governed canary. No caller/model sets its own budget.
import { randomUUID } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { exactSessionOwnerId } from '@/lib/dashboard/owner-identity'
import type { AgentActor } from './actor'
import { runGovernedAttempt, type GovernedScope, type BudgetOutcome, type Usage } from './governed-budget-ledger'

type Env=Record<string,string|undefined>
export function governedEnabled(kind:'personal'|'workspace',id:string,env:Env=(globalThis as any).process?.env||{}):boolean {
  if(env.GOGO_HACHI_ENFORCEMENT!=='1')return false
  const key=kind==='personal'?'GOGO_HACHI_PERSONAL_OWNERS':'GOGO_HACHI_WORKSPACES'
  return String(env[key]||'').split(',').map(x=>x.trim()).filter(Boolean).includes(id)
}
type ModelTariff={model:string;max_total_tokens:unknown;micros_per_token:unknown;valid_until:string;verified_source:string}
type Rpc=(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>
type ProviderResponse={model?:unknown;usage?:{input_tokens?:unknown;output_tokens?:unknown;cache_read_input_tokens?:unknown;cache_creation_input_tokens?:unknown}}
type Deps={rpc:Rpc;authorize:()=>Promise<boolean>;currentRun:()=>Promise<boolean>;tariff:(model:string)=>Promise<ModelTariff|null>;now:()=>number;nextAttempt:()=>string}
const denied=(reason:string):BudgetOutcome<never>=>({state:'blocked',reason})
function count(v:unknown):number|null {
  if(typeof v==='string'&&/^(0|[1-9][0-9]*)$/.test(v)&&String(Number(v))===v)v=Number(v)
  return typeof v==='number'&&Number.isSafeInteger(v)&&v>=0?v:null
}
export function verifiedCeiling(t:ModelTariff|null,model:string,now:number):Usage|null {
  if(!t||t.model!==model||typeof t.verified_source!=='string'||!t.verified_source.trim()||!Number.isFinite(now)||!(Date.parse(t.valid_until)>now))return null
  const tokens=count(t.max_total_tokens),rate=count(t.micros_per_token)
  if(tokens===null||rate===null||tokens<1||rate<1||!Number.isSafeInteger(tokens*rate))return null
  return {tokens,costMicrosInr:tokens*rate}
}
export function meteredUsage(res:ProviderResponse,t:ModelTariff):Usage|null {
  // Count cache input in addition to uncached input. Charge the operator's
  // verified conservative all-token rate, not an unverified invoice estimate.
  if(!res||res.model!==t.model||!res.usage)return null
  const u=res.usage
  const values=[u.input_tokens,u.output_tokens,u.cache_read_input_tokens===undefined?0:u.cache_read_input_tokens,u.cache_creation_input_tokens===undefined?0:u.cache_creation_input_tokens].map(v=>typeof v==='number'?count(v):null)
  if(values.some(v=>v===null))return null
  const tokens=(values as number[]).reduce((a,b)=>a+b,0),rate=count(t.micros_per_token)
  if(rate===null||rate<1||!Number.isSafeInteger(tokens)||!Number.isSafeInteger(tokens*rate))return null
  return {tokens,costMicrosInr:tokens*rate}
}
export type GovernedRuntime={
  model:<T extends ProviderResponse>(model:string,execute:()=>Promise<T>,inTime:()=>boolean)=>Promise<BudgetOutcome<T>>
  local:<T>(operation:string,execute:()=>Promise<T>,inTime:()=>boolean)=>Promise<BudgetOutcome<T>>
}
export function makeGovernedRuntime(scope:GovernedScope,d:Deps):GovernedRuntime {
  const s={...scope}
  const current=async(inTime:()=>boolean)=>inTime()&&await d.authorize()&&await d.currentRun()&&inTime()
  return {
    async model(model,execute,inTime){
      if(!inTime())return denied('deadline')
      let tariff:ModelTariff|null
      try{tariff=await d.tariff(model)}catch{return denied('price_unavailable')}
      const ceiling=verifiedCeiling(tariff,model,d.now())
      if(!ceiling||!tariff)return denied('price_unavailable')
      const pinned={...tariff}
      return runGovernedAttempt({scope:s,attempt:{id:d.nextAttempt(),kind:'model',ceiling},rpc:d.rpc,
        authorize:async()=>{
          if(!await current(inTime))return false
          const live=await d.tariff(model),c=verifiedCeiling(live,model,d.now())
          return !!c&&c.tokens===ceiling.tokens&&c.costMicrosInr===ceiling.costMicrosInr&&live?.verified_source===pinned.verified_source&&live?.valid_until===pinned.valid_until&&inTime()
        },
        execute:async()=>{const value=await execute();return {value,usage:meteredUsage(value,pinned)}}})
    },
    async local(operation,execute,inTime){
      // Only verified DB-only paths. A provider/tool without a bounded billing
      // adapter is blocked; it must never be treated as a zero-cost operation.
      const allowed=s.kind==='personal'?(operation==='events_list'||operation==='personal_skill_catalog'):(operation==='workspace_recorded_ask'||operation==='workspace_skill_catalog')
      if(!allowed)return denied('unpriced_tool')
      return runGovernedAttempt({scope:s,attempt:{id:d.nextAttempt(),kind:'tool',ceiling:{tokens:0,costMicrosInr:0}},rpc:d.rpc,
        authorize:()=>current(inTime),
        execute:async()=>({value:await execute(),usage:{tokens:0,costMicrosInr:0}})})
    },
  }
}
async function open(kind:'personal'|'workspace',scopeId:string,actorId:string,authorize:()=>Promise<boolean>):Promise<GovernedRuntime|null>{
  try{
    if(!governedEnabled(kind,scopeId)||exactSessionOwnerId(actorId)!==actorId||await authorize()!==true)return null
    const scope:GovernedScope={kind,id:scopeId,actorId,runId:randomUUID()}
    const rpc:Rpc=(name,args)=>supabaseAdmin.rpc(name,args)
    const a={p_scope_kind:kind,p_scope_id:scopeId,p_run_id:scope.runId,p_actor_id:actorId}
    const opened=await rpc('gogo_open_governed_run',a)
    if(opened.error||opened.data!=='opened')return null
    return makeGovernedRuntime(scope,{
      rpc,authorize,now:Date.now,nextAttempt:randomUUID,
      currentRun:async()=>{
        if(!governedEnabled(kind,scopeId))return false
        const [policy,run]=await Promise.all([
          supabaseAdmin.from('gogo_governed_policies').select('enabled,valid_until').eq('scope_kind',kind).eq('scope_id',scopeId).maybeSingle(),
          supabaseAdmin.from('gogo_governed_runs').select('deadline_at,breached').eq('scope_kind',kind).eq('scope_id',scopeId).eq('run_id',scope.runId).eq('actor_id',actorId).maybeSingle()
        ])
        return !policy.error&&!run.error&&policy.data?.enabled===true&&run.data?.breached===false&&Date.parse(policy.data.valid_until)>Date.now()&&Date.parse(run.data.deadline_at)>Date.now()
      },
      tariff:async(model)=>{
        const r=await supabaseAdmin.from('gogo_governed_model_prices').select('model,max_total_tokens,micros_per_token,valid_until,verified_source').eq('model',model).maybeSingle()
        return r.error?null:r.data as ModelTariff|null
      }
    })
  }catch{return null}
}
export async function openPersonalGovernedRuntime(actor:AgentActor):Promise<GovernedRuntime|null>{
  const owner=exactSessionOwnerId(actor.legacyTelegramId)
  if(!owner||!actor.userId)return null
  return open('personal',owner,owner,async()=>{
    const r=await supabaseAdmin.from('users').select('id,telegram_id').eq('id',actor.userId).eq('telegram_id',owner).maybeSingle()
    return !r.error&&String(r.data?.id??'')===actor.userId&&exactSessionOwnerId(r.data?.telegram_id)===owner
  })
}
export function openWorkspaceGovernedRuntime(owner:string,id:string,authorize:()=>Promise<boolean>):Promise<GovernedRuntime|null>{
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id))return Promise.resolve(null)
  return open('workspace',id,owner,authorize)
}
