// Server-side adapter for three reviewed search request shapes. These are
// code-bound endpoints, not an arbitrary network tool. Never log request bodies.
import {currentMeterContext} from '@/lib/metering/core'
import {selectGovernedOwner,GovernedModelError} from './governed-model-call'
import {openPersonalGovernedRuntimeForOwner,type GovernedRuntime,type SearchOperation} from './governed-runtime'
const ENDPOINTS:Record<SearchOperation,string>={
  'tavily.basic.v1':'https://api.tavily.com/search',
  'serper.search.v1':'https://google.serper.dev/search',
  'parallel.fast.v1':'https://api.parallel.ai/v1/search'
}
const object=(x:unknown):x is Record<string,any>=>!!x&&typeof x==='object'&&!Array.isArray(x)
const only=(x:Record<string,any>,keys:string[])=>Object.keys(x).every(k=>keys.includes(k))
const query=(x:unknown,max:number)=>typeof x==='string'&&x.trim().length>0&&x.length<=max
const domains=(v:unknown)=>v===undefined||Array.isArray(v)&&v.length<=20&&v.every(d=>typeof d==='string'&&d.length<=253&&/^[a-z0-9.-]+$/i.test(d))
const day=(v:unknown)=>v===undefined||typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)
export function validBoundedSearch(op:SearchOperation,url:string,init:RequestInit):boolean{
  if(!Object.hasOwn(ENDPOINTS,op)||url!==ENDPOINTS[op]||init.method!=='POST'||typeof init.body!=='string'||init.body.length>20_000)return false
  let b:unknown
  try{b=JSON.parse(init.body)}catch{return false}
  if(!object(b))return false
  if(op==='tavily.basic.v1')return only(b,['api_key','query','topic','search_depth','max_results','include_answer','include_domains','start_date','end_date','include_published_date','filter_by_published_date'])&&
    query(b.query,500)&&b.topic==='general'&&b.search_depth==='basic'&&b.max_results===5&&b.include_answer===false&&domains(b.include_domains)&&day(b.start_date)&&day(b.end_date)&&
    [b.include_published_date,b.filter_by_published_date].every(v=>v===undefined||v===true)
  if(op==='serper.search.v1')return only(b,['q','gl','hl','num','tbs'])&&query(b.q,6000)&&b.gl==='in'&&b.hl==='en'&&b.num===8&&(b.tbs===undefined||typeof b.tbs==='string'&&/^cdr:1(?:,cd_(?:min|max):\d{1,2}\/\d{1,2}\/\d{4}){1,2}$/.test(b.tbs))
  if(!only(b,['objective','search_queries','mode','advanced_settings'])||b.mode!=='fast'||!query(b.objective,500)||!Array.isArray(b.search_queries)||b.search_queries.length!==1||b.search_queries[0]!==b.objective)return false
  const a=b.advanced_settings
  if(!object(a)||!only(a,['max_results','location','excerpt_settings','source_policy'])||a.max_results!==8||a.location!=='in'||!object(a.excerpt_settings)||!only(a.excerpt_settings,['max_chars_per_result'])||a.excerpt_settings.max_chars_per_result!==600)return false
  const p=a.source_policy
  return p===undefined||object(p)&&only(p,['include_domains','after_date'])&&domains(p.include_domains)&&day(p.after_date)
}
type Deps={selection:()=>ReturnType<typeof selectGovernedOwner>;open:(owner:string)=>Promise<GovernedRuntime|null>;fetcher:typeof fetch;now:()=>number}
export async function governedSearchFetch(op:SearchOperation,url:string,init:RequestInit,deps?:Deps):Promise<Response>{
  const d=deps||{selection:()=>selectGovernedOwner(undefined,currentMeterContext()?.telegramId,process.env),open:openPersonalGovernedRuntimeForOwner,fetcher:fetch,now:Date.now}
  const s=d.selection()
  if(s.kind==='legacy')return d.fetcher(url,init)
  if(s.kind!=='governed')throw new GovernedModelError('identity_mismatch')
  if(!validBoundedSearch(op,url,init))throw new GovernedModelError('unpriced_search_shape')
  // Snapshot the exact request body before async reservation; do not permit
  // a redirect or a changed payload after the price check.
  const request={...init,headers:new Headers(init.headers),body:String(init.body),redirect:'error' as const}
  const deadline=d.now()+30_000
  const rt=await d.open(s.owner).catch(()=>null)
  if(!rt)throw new GovernedModelError('policy_unavailable')
  const result=await rt.boundedSearch(op,async()=>{
    const timeout=AbortSignal.timeout(15_000)
    const response=await d.fetcher(url,{...request,signal:request.signal?AbortSignal.any([request.signal,timeout]):timeout})
    if(!response.ok)throw Error('search_response_not_verified')
    const data:unknown=await response.clone().json()
    if(!object(data))throw Error('search_response_not_verified')
    return response
  },()=>d.now()<deadline&&!request.signal?.aborted)
  if(result.state!=='completed')throw new GovernedModelError(result.reason)
  return result.value
}
