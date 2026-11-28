// Server-side wiring for the governed canary. No caller/model sets its own budget.
import { randomUUID } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { exactSessionOwnerId } from '@/lib/dashboard/owner-identity'
import type { AgentActor } from './actor'
import { runGovernedAttempt, type GovernedScope, type BudgetOutcome, type Usage } from './governed-budget-ledger'
import {withGovernedPersonalRun,currentGovernedRun} from './governed-run-context'
import {withReservedOutbound,governedFenceInstalled} from './governed-outbound-fence'
import {CONNECTOR_OPERATIONS,type ConnectorOperation} from './governed-connector-shapes'

type Env=Record<string,string|undefined>
export function governedEnabled(kind:'personal'|'workspace',id:string,env:Env=(globalThis as any).process?.env||{}):boolean {
  if(env.GOGO_HACHI_ENFORCEMENT!=='1')return false
  const key=kind==='personal'?'GOGO_HACHI_PERSONAL_OWNERS':'GOGO_HACHI_WORKSPACES'
  return String(env[key]||'').split(',').map(x=>x.trim()).filter(Boolean).includes(id)
}
type ModelTariff={model:string;max_total_tokens:unknown;micros_per_token:unknown;valid_until:string;verified_source:string}
type Rpc=(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>
type ProviderResponse={model?:unknown;usage?:{input_tokens?:unknown;output_tokens?:unknown;cache_read_input_tokens?:unknown;cache_creation_input_tokens?:unknown}}
export type SearchOperation='tavily.basic.v1'|'serper.search.v1'|'parallel.fast.v1'
const SEARCH_OPERATIONS=new Set<string>(['tavily.basic.v1','serper.search.v1','parallel.fast.v1'])
type OperationTariff={operation:string;max_cost_micros:unknown;valid_until:string;verified_source:string}
type Deps={rpc:Rpc;authorize:()=>Promise<boolean>;currentRun:()=>Promise<boolean>;tariff:(model:string)=>Promise<ModelTariff|null>;operationTariff?:(operation:SearchOperation)=>Promise<OperationTariff|null>;connectorTariff?:(operation:ConnectorOperation)=>Promise<OperationTariff|null>;now:()=>number;nextAttempt:()=>string}
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
export function verifiedOperationCeiling(t:OperationTariff|null,operation:SearchOperation,now:number):Usage|null{
  if(!SEARCH_OPERATIONS.has(operation)||!t||t.operation!==operation||typeof t.verified_source!=='string'||!t.verified_source.trim()||!Number.isFinite(now)||!(Date.parse(t.valid_until)>now))return null
  const cost=count(t.max_cost_micros)
  return cost!==null&&cost>0?{tokens:0,costMicrosInr:cost}:null
}
export function verifiedConnectorCeiling(t:OperationTariff|null,operation:ConnectorOperation,now:number):Usage|null{
  if(!(CONNECTOR_OPERATIONS as readonly string[]).includes(operation)||!t||t.operation!==operation||typeof t.verified_source!=='string'||!t.verified_source.trim()||!Number.isFinite(now)||!(Date.parse(t.valid_until)>now))return null
  const cost=count(t.max_cost_micros)
  return cost===null||operation==='bolna.call.v1'&&cost===0?null:{tokens:0,costMicrosInr:cost}
}
export type GovernedRuntime={
  model:<T extends ProviderResponse>(model:string,execute:()=>Promise<T>,inTime:()=>boolean)=>Promise<BudgetOutcome<T>>
  boundedSearch:<T>(operation:SearchOperation,execute:()=>Promise<T>,inTime:()=>boolean)=>Promise<BudgetOutcome<T>>
  boundedConnector:<T>(operation:ConnectorOperation,url:string,method:'GET'|'POST'|'PATCH',authorize:()=>Promise<boolean>,execute:()=>Promise<T>,inTime:()=>boolean)=>Promise<BudgetOutcome<T>>
  nestedSearch:<T>(operation:'web_search'|'venue_contact'|'calendar_read'|'recovery_read',execute:()=>Promise<T>,inTime:()=>boolean,authorize?:()=>Promise<boolean>)=>Promise<BudgetOutcome<T>>
  workerStep:<T>(operation:string,attemptId:string,execute:()=>Promise<T>,inTime:()=>boolean)=>Promise<BudgetOutcome<T>>
  local:<T>(operation:string,execute:()=>Promise<T>,inTime:()=>boolean)=>Promise<BudgetOutcome<T>>
}
export function makeGovernedRuntime(scope:GovernedScope,d:Deps):GovernedRuntime {
  const s={...scope}
  const nestedAuthority=async()=>{
    const parent=currentGovernedRun()
    return !parent||parent.owner===s.actorId&&parent.runtime===runtime&&await parent.authorize()===true
  }
  const current=async(inTime:()=>boolean)=>inTime()&&await d.authorize()&&await d.currentRun()&&await nestedAuthority()&&inTime()
  const runtime:GovernedRuntime={
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
          return !!c&&c.tokens===ceiling.tokens&&c.costMicrosInr===ceiling.costMicrosInr&&live?.verified_source===pinned.verified_source&&live?.valid_until===pinned.valid_until&&await nestedAuthority()&&inTime()
        },
        execute:async()=>{const value=await withReservedOutbound('model',model,execute);return {value,usage:meteredUsage(value,pinned)}}})
    },
    async boundedSearch(operation,execute,inTime){
      // Fixed-cost, bounded search requests only; never classify arbitrary
      // connector methods or model-chosen endpoints as known-price work.
      if(s.kind!=='personal'||!SEARCH_OPERATIONS.has(operation)||!inTime()||!d.operationTariff)return denied('unpriced_tool')
      let tariff:OperationTariff|null
      try{tariff=await d.operationTariff(operation)}catch{return denied('price_unavailable')}
      const ceiling=verifiedOperationCeiling(tariff,operation,d.now())
      if(!ceiling||!tariff)return denied('price_unavailable')
      const pinned={...tariff}
      return runGovernedAttempt({scope:s,attempt:{id:d.nextAttempt(),kind:'tool',ceiling},rpc:d.rpc,
        authorize:async()=>{
          if(!await current(inTime))return false
          const live=await d.operationTariff!(operation),c=verifiedOperationCeiling(live,operation,d.now())
          return !!c&&c.costMicrosInr===ceiling.costMicrosInr&&live?.valid_until===pinned.valid_until&&live?.verified_source===pinned.verified_source&&await nestedAuthority()&&inTime()
        },
        // Charge the verified maximum, not a guessed actual provider invoice.
        // Transport/invalid response throws and retains the reservation.
        execute:async()=>({value:await withReservedOutbound('search',operation,execute),usage:ceiling})})
    },
    async boundedConnector(operation,url,method,authorize,execute,inTime){
      if(s.kind!=='personal'||!inTime()||!d.connectorTariff||!(CONNECTOR_OPERATIONS as readonly string[]).includes(operation))return denied('unreviewed_connector')
      let tariff:OperationTariff|null
      try{tariff=await d.connectorTariff(operation)}catch{return denied('price_unavailable')}
      const ceiling=verifiedConnectorCeiling(tariff,operation,d.now())
      if(!ceiling||!tariff)return denied('price_unavailable')
      const pinned={...tariff}
      return runGovernedAttempt({scope:s,attempt:{id:d.nextAttempt(),kind:'tool',ceiling},rpc:d.rpc,
        authorize:async()=>{
          if(!await current(inTime)||await authorize()!==true)return false
          const live=await d.connectorTariff!(operation),c=verifiedConnectorCeiling(live,operation,d.now())
          return !!c&&c.costMicrosInr===ceiling.costMicrosInr&&live?.verified_source===pinned.verified_source&&live?.valid_until===pinned.valid_until&&await nestedAuthority()&&await authorize()===true&&inTime()
        },execute:async()=>({value:await withReservedOutbound('connector',url,execute,method,async()=>inTime()&&await nestedAuthority()&&await authorize()===true&&inTime()),usage:ceiling})})
    },
    async nestedSearch(operation,execute,inTime,authorize){
      // The inspected first-slice search tools call only the bounded web
      // adapters (venue lookup does not read pages or dispatch an action).
      // The orchestration step is zero provider cost; each nested provider
      // call must independently reserve against THIS same run.
      if(s.kind!=='personal'||!['web_search','venue_contact','calendar_read','recovery_read'].includes(operation)||operation==='recovery_read'&&(!authorize||!governedFenceInstalled()))return denied('unpriced_tool')
      return runGovernedAttempt({scope:s,attempt:{id:d.nextAttempt(),kind:'tool',ceiling:{tokens:0,costMicrosInr:0}},rpc:d.rpc,
        authorize:async()=>await current(inTime)&&(!authorize||await authorize())&&inTime(),
        execute:async()=>({value:await withGovernedPersonalRun(s.actorId,runtime,inTime,execute,authorize),usage:{tokens:0,costMicrosInr:0}})})
    },
    async workerStep(operation,attemptId,execute,inTime){
      // Only the existing statically bound persistent general-plan handlers.
      // No arbitrary procedure, browser, voice, payment or mutation adapter
      // gains authority here. Existing deterministic safety/approval rules
      // still apply; the fetch fence denies unreserved connector egress.
      if(s.kind!=='personal'||!governedFenceInstalled()||!['tasks.safe','lists.verified','reminders.verified','memory.verified','web_search.verified','files.read','travel.read'].includes(operation)||!/^worker:[A-Za-z0-9_-]{1,100}:[0-9]{1,8}$/.test(attemptId))return denied('unreviewed_worker_tool')
      return runGovernedAttempt({scope:s,attempt:{id:attemptId,kind:'tool',ceiling:{tokens:0,costMicrosInr:0}},rpc:d.rpc,
        authorize:()=>current(inTime),
        execute:async()=>({value:await withGovernedPersonalRun(s.actorId,runtime,inTime,execute),usage:{tokens:0,costMicrosInr:0}})})
    },
    async local(operation,execute,inTime){
      // Only verified DB-only paths. A provider/tool without a bounded billing
      // adapter is blocked; it must never be treated as a zero-cost operation.
      const allowed=s.kind==='personal'?(operation==='events_list'||operation==='personal_skill_catalog'):(operation==='workspace_recorded_ask'||operation==='workspace_skill_catalog'||operation==='workspace_shared_reports'||operation==='workspace_incident_review')
      if(!allowed)return denied('unpriced_tool')
      return runGovernedAttempt({scope:s,attempt:{id:d.nextAttempt(),kind:'tool',ceiling:{tokens:0,costMicrosInr:0}},rpc:d.rpc,
        authorize:()=>current(inTime),
        execute:async()=>({value:await execute(),usage:{tokens:0,costMicrosInr:0}})})
    },
  }
  return runtime
}
async function open(kind:'personal'|'workspace',scopeId:string,actorId:string,authorize:()=>Promise<boolean>,missionId?:string):Promise<GovernedRuntime|null>{
  try{
    if(!governedEnabled(kind,scopeId)||exactSessionOwnerId(actorId)!==actorId||await authorize()!==true)return null
    if(missionId!==undefined&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(missionId))return null
    const scope:GovernedScope={kind,id:scopeId,actorId,runId:missionId?'auto-'+missionId:randomUUID()}
    const rpc:Rpc=(name,args)=>supabaseAdmin.rpc(name,args)
    const a={p_scope_kind:kind,p_scope_id:scopeId,p_run_id:scope.runId,p_actor_id:actorId}
    const opened=await rpc('gogo_open_governed_run',a)
    if(opened.error)return null
    if(opened.data!=='opened'){
      if(!missionId||opened.data!=='duplicate')return null
      const previous=await supabaseAdmin.from('gogo_governed_runs').select('deadline_at,breached').eq('scope_kind',kind).eq('scope_id',scopeId).eq('run_id',scope.runId).eq('actor_id',actorId).maybeSingle()
      if(previous.error||previous.data?.breached!==false||!(Date.parse(previous.data.deadline_at)>Date.now()))return null
    }
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
      },
      operationTariff:async(operation)=>{
        const r=await supabaseAdmin.from('gogo_governed_search_prices').select('operation,max_cost_micros,valid_until,verified_source').eq('operation',operation).maybeSingle()
        return r.error?null:r.data as OperationTariff|null
      },
      connectorTariff:async(operation)=>{
        const r=await supabaseAdmin.from('gogo_governed_connector_prices').select('operation,max_cost_micros,valid_until,verified_source').eq('operation',operation).maybeSingle()
        return r.error?null:r.data as OperationTariff|null
      }
    })
  }catch{return null}
}
export async function openPersonalGovernedRuntime(actor:AgentActor,worker?:{missionId:string;authorize:()=>Promise<boolean>}):Promise<GovernedRuntime|null>{
  const owner=exactSessionOwnerId(actor.legacyTelegramId)
  if(!owner||!actor.userId)return null
  const actorId=actor.userId
  return open('personal',owner,owner,async()=>{
    const r=await supabaseAdmin.from('users').select('id,telegram_id,access_status').eq('id',actorId).eq('telegram_id',owner).maybeSingle()
    return !r.error&&String(r.data?.id??'')===actorId&&exactSessionOwnerId(r.data?.telegram_id)===owner&&r.data?.access_status==='active'&&(!worker||await worker.authorize()===true)
  },worker?.missionId)
}
// Only callers that already resolved the authenticated or metering owner may
// use this helper. Pin the database user identity; recheck active access on
// every reservation and immediately before the provider invocation.
export async function openPersonalGovernedRuntimeForOwner(owner:string):Promise<GovernedRuntime|null>{
  if(exactSessionOwnerId(owner)!==owner||!governedEnabled('personal',owner))return null
  try{
    const r=await supabaseAdmin.from('users').select('id,telegram_id,access_status').eq('telegram_id',owner).maybeSingle()
    if(r.error||!r.data?.id||r.data.access_status!=='active'||exactSessionOwnerId(r.data.telegram_id)!==owner)return null
    const actorId=String(r.data.id)
    return open('personal',owner,owner,async()=>{
      const current=await supabaseAdmin.from('users').select('id,telegram_id,access_status').eq('id',actorId).eq('telegram_id',owner).maybeSingle()
      return !current.error&&String(current.data?.id??'')===actorId&&exactSessionOwnerId(current.data?.telegram_id)===owner&&current.data?.access_status==='active'
    })
  }catch{return null}
}
export function openWorkspaceGovernedRuntime(owner:string,id:string,authorize:()=>Promise<boolean>):Promise<GovernedRuntime|null>{
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id))return Promise.resolve(null)
  return open('workspace',id,owner,authorize)
}
