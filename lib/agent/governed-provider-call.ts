// Narrow existing provider operations, not an arbitrary URL executor.
// A trusted owner-bound caller supplies current task authority.
import {currentGovernedRun,currentGovernedForeground,foregroundRuntime,foregroundInTime} from './governed-run-context'
import {selectedModelOwner,GovernedModelError} from './governed-model-call'
import {openPersonalGovernedRuntimeForOwner,type GovernedRuntime} from './governed-runtime'
import type {VoiceOperation} from './governed-connector-shapes'
const id=/^[A-Za-z0-9_-]{1,200}$/
export function validVoiceRequest(op:VoiceOperation,url:string,init:RequestInit,expectedBody?:string):boolean{
  if(op==='bolna.execution.read.v1')return /^https:\/\/api\.bolna\.ai\/executions\/[A-Za-z0-9_-]{1,200}$/.test(url)&&String(init.method||'GET').toUpperCase()==='GET'&&init.body==null
  if(op!=='bolna.call.v1'||url!=='https://api.bolna.ai/call'||init.method!=='POST'||typeof init.body!=='string'||init.body!==expectedBody||init.body.length>16000)return false
  try{
    const b=JSON.parse(init.body)
    return !!b&&typeof b==='object'&&!Array.isArray(b)&&Object.keys(b).length===4&&Object.keys(b).every(k=>['agent_id','recipient_phone_number','from_phone_number','user_data'].includes(k))&&
      typeof b.agent_id==='string'&&id.test(b.agent_id)&&/^\+91\d{10}$/.test(b.recipient_phone_number)&&/^\+91\d{10}$/.test(b.from_phone_number)&&
      !!b.user_data&&typeof b.user_data==='object'&&!Array.isArray(b.user_data)&&Object.values(b.user_data).every(v=>typeof v==='string'&&v.length<=3000)
  }catch{return false}
}
type Deps={selection:()=>ReturnType<typeof selectedModelOwner>;open:()=>Promise<GovernedRuntime|null>;now:()=>number;fetcher:typeof fetch}
export async function governedVoiceFetch(p:{operation:VoiceOperation;owner:string;url:string;init:RequestInit;authorize:()=>Promise<boolean>;expectedBody?:string},deps?:Deps):Promise<Response>{
  const selection=deps?deps.selection():selectedModelOwner(p.owner)
  const active=currentGovernedRun(),foreground=currentGovernedForeground()
  if(selection.kind!=='governed'||selection.owner!==p.owner||active&&active.owner!==p.owner)throw new GovernedModelError('connector_identity_mismatch')
  const init={...p.init,headers:new Headers(p.init.headers),redirect:'error' as const}
  if(!validVoiceRequest(p.operation,p.url,init,p.expectedBody))throw new GovernedModelError('unreviewed_connector_shape')
  const runtime=active?active.runtime:foreground?await foregroundRuntime(p.owner,()=>deps?deps.open():openPersonalGovernedRuntimeForOwner(p.owner)):deps?await deps.open():null
  if(!runtime)throw new GovernedModelError('policy_unavailable')
  const now=deps?.now||Date.now,deadline=now()+25_000
  const inTime=()=>now()<deadline&&!init.signal?.aborted&&(active?active.inTime():foreground?foregroundInTime(p.owner):!!deps)
  const r=await runtime.boundedConnector(p.operation,p.url,p.operation==='bolna.call.v1'?'POST':'GET',p.authorize,async()=>{
    const timeout=AbortSignal.timeout(20_000)
    const response=await (deps?.fetcher||fetch)(p.url,{...init,signal:init.signal?AbortSignal.any([init.signal,timeout]):timeout})
    if(!response.ok&&![400,401,403,404,422,429].includes(response.status))throw Error('voice_provider_outcome_unverified')
    if(response.ok){
      const data=await response.clone().json().catch(()=>null)
      if(!data||typeof data!=='object'||(p.operation==='bolna.call.v1'&&(typeof data.execution_id!=='string'||!id.test(data.execution_id)))||(p.operation==='bolna.execution.read.v1'&&(typeof data.status!=='string'||!data.status)))throw Error('voice_provider_receipt_unverified')
    }
    return response
  },inTime)
  if(r.state!=='completed')throw new GovernedModelError(r.reason)
  return r.value
}
