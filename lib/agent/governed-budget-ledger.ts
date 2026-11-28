// Shared server-only attempt boundary. No authorization, pricing or receipt may originate from model output.
export type GovernedScope = Readonly<{ kind:'personal'|'workspace'; id:string; actorId:string; runId:string }>
export type Usage = Readonly<{ costMicrosInr:number; tokens:number }>
export type Attempt = Readonly<{ id:string; kind:'model'|'tool'; ceiling:Usage }>
type Rpc = (name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>
const decimal=/^-?[1-9][0-9]{0,18}$/
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const run=/^[A-Za-z0-9_-]{1,128}$/
const attempt=/^[A-Za-z0-9_:-]{1,160}$/
const validNumber=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0
function usageValid(x:Usage|null|undefined):x is Usage{return !!x&&validNumber(x.costMicrosInr)&&validNumber(x.tokens)}
function scopeValid(s:GovernedScope):boolean{return !!s&&typeof s.actorId==='string'&&decimal.test(s.actorId)&&typeof s.runId==='string'&&run.test(s.runId)&&typeof s.id==='string'&&(s.kind==='personal'?s.id===s.actorId:s.kind==='workspace'&&uuid.test(s.id))}
export type BudgetOutcome<T> = {state:'completed';value:T}|{state:'blocked';reason:string}|{state:'unknown';reason:string}
// A reserve response other than the exact success token must not dispatch. Duplicate
// attempt IDs never authorize replay. Transport and settlement errors are not retryable proof.
export async function runGovernedAttempt<T>(p:{
  scope:GovernedScope; attempt:Attempt; rpc:Rpc;
  authorize:()=>Promise<boolean>; // trusted live actor/workspace/approval check; mandatory
  execute:()=>Promise<{value:T;usage:Usage|null}>; // actual provider usage, not inferred completion
}):Promise<BudgetOutcome<T>>{
  const s={...p.scope},a={...p.attempt,ceiling:{...p.attempt?.ceiling}}
  if(!scopeValid(s)||typeof a.id!=='string'||!attempt.test(a.id)||!['model','tool'].includes(a.kind)||!usageValid(a.ceiling))return{state:'blocked',reason:'invalid_attempt'}
  const args={p_scope_kind:s.kind,p_scope_id:s.id,p_run_id:s.runId,p_actor_id:s.actorId,p_attempt_id:a.id}
  const call=async(name:string,more:Record<string,unknown>)=>{const r=await p.rpc(name,{...args,...more});if(r.error)throw Error('ledger_unavailable');return r.data}
  const settle=async(u:Usage|null)=>call('gogo_settle_governed_attempt',{p_cost_micros:u?.costMicrosInr??null,p_tokens:u?.tokens??null})
  try{if(await p.authorize()!==true)return{state:'blocked',reason:'not_authorized'}}catch{return{state:'blocked',reason:'authorization_unavailable'}}
  let result:unknown
  try{result=await call('gogo_reserve_governed_attempt',{p_kind:a.kind,p_cost_micros:a.ceiling.costMicrosInr,p_tokens:a.ceiling.tokens})}catch{return{state:'blocked',reason:'reservation_unavailable'}}
  if(result!=='reserved')return{state:'blocked',reason:typeof result==='string'&&['invalid','unavailable','breach','deadline','duplicate','steps','cost','tokens'].includes(result)?result:'reservation_unavailable'}
  // Recheck immediately before dispatch. If revoked, do not execute. A failed
  // release is conservative: the reservation remains charged, and no replay is allowed.
  let permitted=false
  try{permitted=await p.authorize()===true}catch{/* deny */}
  if(!permitted){try{await settle({costMicrosInr:0,tokens:0})}catch{/* retained */}return{state:'blocked',reason:'authorization_revoked'}}
  try{
    const receipt=await p.execute()
    if(!usageValid(receipt?.usage)){try{await settle(null)}catch{/* retained */}return{state:'unknown',reason:'usage_unverified'}}
    const settled=await settle(receipt.usage)
    if(settled!=='settled')return{state:'unknown',reason:settled==='breach'?'budget_breached':'settlement_unverified'}
    return{state:'completed',value:receipt.value}
  }catch{
    try{await settle(null)}catch{/* retained; must reconcile */}
    return{state:'unknown',reason:'attempt_outcome_unverified'}
  }
}
