// Defence-in-depth for global-fetch traffic inside a governed execution
// scope. Not a network sandbox: custom SDK transports must still be audited.
import {AsyncLocalStorage} from 'node:async_hooks'
import {currentGovernedRun} from './governed-run-context'
type Permit={kind:'model'|'search';name:string;used:boolean;closed:boolean}
const store:AsyncLocalStorage<Permit>=(globalThis as any).__gogoGovernedPermitStore||new AsyncLocalStorage<Permit>()
;(globalThis as any).__gogoGovernedPermitStore=store
const searchUrls:Record<string,string>={'tavily.basic.v1':'https://api.tavily.com/search','serper.search.v1':'https://google.serper.dev/search','parallel.fast.v1':'https://api.parallel.ai/v1/search'}
function modelUrl(model:string):string|null{
  if(/^claude-/.test(model))return 'https://api.anthropic.com/v1/messages'
  if(/^(?:gpt-|o[134](?:-|$))/.test(model))return 'https://api.openai.com/v1/chat/completions'
  if(/^sarvam-/.test(model))return 'https://api.sarvam.ai/v1/chat/completions'
  if(/^mercury-/.test(model))return 'https://api.inceptionlabs.ai/v1/chat/completions'
  return null
}
export async function withReservedOutbound<T>(kind:Permit['kind'],name:string,work:()=>Promise<T>):Promise<T>{
  const p:Permit={kind,name,used:false,closed:false}
  try{return await store.run(p,work)}finally{p.closed=true}
}
export function governedFenceInstalled(){return (globalThis as any).__gogoGovernedFetchFence===true}
function urlOf(input:RequestInfo|URL):string{
  return typeof input==='string'?input:input instanceof URL?input.href:input.url
}
async function bodyOf(input:RequestInfo|URL,init?:RequestInit):Promise<unknown>{
  try{
    const raw=typeof init?.body==='string'?init.body:!init?.body&&typeof input==='object'&&'clone' in input?await input.clone().text():null
    if(!raw||raw.length>5_000_000)return null
    return JSON.parse(raw)
  }catch{return null}
}
export function exactReservedModelBody(body:unknown,model:string):boolean{
  if(!body||typeof body!=='object'||Array.isArray(body))return false
  const b=body as Record<string,unknown>
  if(b.model!==model||b.stream===true)return false
  // Hosted tools have their own billing and network side effects. Only custom
  // function tool definitions are supported at this token-priced boundary.
  if(b.tools!==undefined&&(!Array.isArray(b.tools)||b.tools.some(t=>!t||typeof t!=='object'||!([undefined,'custom','function'].includes(t.type)))))return false
  return true
}
function internalDatabase(url:string,env:Record<string,string|undefined>):boolean{
  try{
    const u=new URL(url),db=new URL(env.NEXT_PUBLIC_SUPABASE_URL||'')
    return u.protocol==='https:'&&u.origin===db.origin&&!u.username&&!u.password&&u.pathname.startsWith('/rest/v1/')
  }catch{return false}
}
export async function authorizeGovernedFetch(input:RequestInfo|URL,init?:RequestInit,env:Record<string,string|undefined>=process.env):Promise<'legacy'|'database'|'provider'>{
  const active=currentGovernedRun(),p=store.getStore()
  if(!active&&!p)return 'legacy'
  if(active&&!active.inTime()||p?.closed)throw Error('governed_egress_deadline')
  const url=urlOf(input)
  if(internalDatabase(url,env))return 'database'
  if(!p||p.used)throw Error('governed_egress_unreserved')
  const method=String(init?.method||(typeof input==='object'&&'method' in input?input.method:'GET')).toUpperCase()
  if(method!=='POST'||url!==(p.kind==='model'?modelUrl(p.name):searchUrls[p.name]))throw Error('governed_egress_shape')
  if(p.kind==='model'&&!exactReservedModelBody(await bodyOf(input,init),p.name))throw Error('governed_egress_model_shape')
  // Recheck after asynchronous body inspection. One reservation authorizes
  // one physical fetch, never a provider SDK retry or another destination.
  if(p.used||p.closed||active&&!active.inTime())throw Error('governed_egress_revoked')
  p.used=true
  return 'provider'
}
export function installGovernedFetchFence(){
  const g=globalThis as any
  if(g.__gogoGovernedFetchFence||typeof g.fetch!=='function')return
  const original:typeof fetch=g.fetch.bind(globalThis)
  g.fetch=async(input:RequestInfo|URL,init?:RequestInit)=>{
    const mode=await authorizeGovernedFetch(input,init)
    return mode==='legacy'?original(input,init):original(input,{...init,redirect:'error'})
  }
  g.__gogoGovernedFetchFence=true
}
