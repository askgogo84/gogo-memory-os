/**
 * Keenable public-web shadow adapter. NOT wired to customer or enterprise
 * research, search-provider order, or any private-memory workflows.
 *
 * The provider's default data policy retains queries and results. Only
 * manually classified PUBLIC_WEB queries may leave AskGogo. No auto-buy,
 * keyless prod, agent-driven provider switching, retries or logging query text.
 */
export type PublicSearchHit = {
  title:string; snippet:string;url:string;publishedDate?:string;acquiredDate?:string
}
export type PublicWebSearchRequest = {
  query:string
  classification:'public_web_only'
  approval:'server_verified_public'
  mode?:'pro'|'realtime'
  site?:string
  maxResults?:number
  timeoutMs?:number
  publishedAfter?:string
}
export type KeenableEnv = {
  KEENABLE_SHADOW_ENABLED?:string
  KEENABLE_API_KEY?:string
  NODE_ENV?:string
  KEENABLE_ALLOW_KEYLESS_DEV?:string
}
export class KeenablePublicSearchError extends Error {
  constructor(public reason:string){super(reason)}
}
const block=(reason:string):never=>{throw new KeenablePublicSearchError(reason)}
const validSite=(v:string)=>/^(?!-)[a-z0-9][a-z0-9.-]{1,150}[a-z0-9]$/.test(v)&&!v.includes('..')
const safeDate=(v:unknown)=>{
  if(typeof v!=='string'||v.length>70)return undefined
  const d=Date.parse(v)
  return Number.isFinite(d)?new Date(d).toISOString():undefined
}
export function publicSearchPayload(input:PublicWebSearchRequest){
  if(!input||input.classification!=='public_web_only'||input.approval!=='server_verified_public')
    return block('public_classification_required')
  if(typeof input.query!=='string')return block('invalid_public_query')
  const query=input.query.replace(/\s+/g,' ').trim()
  // Heuristic defense in depth; a server-side PUBLIC classification is required.
  // Do not rely on these patterns to declassify confidential user content.
  if(query.length<4||query.length>400||
    /[\u0000-\u001f]/.test(query)||
    /(?:[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i.test(query)||
    /(?:sk[-_]|token|password|secret|api[_ -]?key|otp|cvv|pan number|aadhaar|aadhar|account number|my inbox|my email|my calendar|private repo|confidential|our employees|our customers)/i.test(query)||
    /(?:\+?\d[\d ()-]{10,}\d)/.test(query))return block('sensitive_query_blocked')
  const mode=input.mode??'realtime'
  if(mode!=='pro'&&mode!=='realtime')return block('invalid_mode')
  const max=input.maxResults??5
  if(!Number.isInteger(max)||max<1||max>8)return block('result_budget_exceeded')
  if(input.site!==undefined&&!validSite(input.site))return block('invalid_site')
  if(input.publishedAfter!==undefined&&!/^20\d\d-\d\d-\d\d$/.test(input.publishedAfter))
    return block('invalid_date_filter')
  return {
    query,mode,max_results:max,snippet_max_length:600,
    disable_cards:true,
    ...(input.site?{site:input.site}:{}),
    ...(input.publishedAfter?{published_after:input.publishedAfter}:{}),
  }
}
export function verifiedKeenableResults(raw:unknown, input:ReturnType<typeof publicSearchPayload>):PublicSearchHit[]{
  if(!raw||typeof raw!=='object')return block('bad_provider_response')
  const body=raw as Record<string,unknown>
  if(body.query!==input.query||body.mode!==input.mode||
    !Array.isArray(body.results)||body.results.length>50)
    return block('bad_provider_response')
  const out:PublicSearchHit[]=[]
  for(const r of body.results){
    if(!r||typeof r!=='object')continue
    const row=r as Record<string,unknown>
    if(typeof row.url!=='string'||typeof row.title!=='string'||row.title.length>1000)continue
    let uri:URL
    try{uri=new URL(row.url)}catch{continue}
    if(uri.protocol!=='https:'||uri.username||uri.password||
      uri.hostname==='localhost'||uri.hostname.endsWith('.localhost')||
      uri.hostname==='cards.keenable.ai'||
      /^(?:127\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2[0-9]|3[01])\.)/.test(uri.hostname))continue
    if(out.some(x=>x.url===uri.href))continue
    const snippet=typeof row.snippet==='string'?row.snippet.replace(/\s+/g,' ').trim().slice(0,600):''
    if(!snippet)continue
    const publishedDate=safeDate(row.published_at)
    if(input.published_after&&(!publishedDate||publishedDate.slice(0,10)<input.published_after))continue
    out.push({
      title:row.title.replace(/\s+/g,' ').trim().slice(0,250),
      snippet,url:uri.href,
      ...(publishedDate?{publishedDate}:{}),
      ...(safeDate(row.acquired_at)?{acquiredDate:safeDate(row.acquired_at)}:{}),
    })
    if(out.length>=input.max_results)break
  }
  return out
}
export async function searchKeenablePublicShadow(
  input:PublicWebSearchRequest,
  deps:{env?:KeenableEnv;request?:typeof fetch}={},
):Promise<PublicSearchHit[]>{
  const env=deps.env??process.env
  if(env.KEENABLE_SHADOW_ENABLED!=='true')return block('shadow_disabled')
  const body=publicSearchPayload(input)
  const key=(env.KEENABLE_API_KEY||'').trim()
  if(!key&&(env.NODE_ENV==='production'||env.KEENABLE_ALLOW_KEYLESS_DEV!=='true'))
    return block('production_key_required')
  const url=key?'https://api.keenable.ai/v1/search':
    'https://api.keenable.ai/v1/search/public'
  const headers:Record<string,string>={'Content-Type':'application/json','Accept':'application/json'}
  if(key)headers['X-API-Key']=key
  else headers['X-Keenable-Title']='AskGogo-Public-Search-Shadow'
  const timeout=Math.max(1000,Math.min(input.timeoutMs??8000,10000))
  const response=await (deps.request??fetch)(url,{
    method:'POST',headers,body:JSON.stringify(body),
    signal:AbortSignal.timeout(timeout),cache:'no-store',redirect:'error',
  })
  if(!response.ok){
    // Never echo error bodies: they may contain query or account information.
    return block(response.status===402?'provider_credits_exhausted':
      response.status===429?'provider_rate_limited':
      response.status===401||response.status===403?'provider_auth_failed':
      'provider_unavailable')
  }
  const text=await response.text()
  if(text.length>250000)return block('provider_response_too_large')
  let parsed:unknown
  try{parsed=JSON.parse(text)}catch{return block('bad_provider_response')}
  return verifiedKeenableResults(parsed,body)
}
