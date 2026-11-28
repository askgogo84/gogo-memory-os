// Native Google read/refresh boundary. No model can supply credentials, grant
// permission or execute a mutation. Each token is checked against the current
// authenticated owner, including refreshed calendar tokens that are not stored.
import {createHash} from 'node:crypto'
import {supabaseAdmin} from '@/lib/supabase-admin'
import {decryptGoogleToken} from '@/lib/security/google-token-crypto'
import {exactSessionOwnerId} from '@/lib/dashboard/owner-identity'
import {capabilityPermissionLevel} from './adaptive-autonomy'
import type {AgentCapability} from './policy'
import {gmailConsentState} from './gmail-consent'
import {selectedModelOwner,GovernedModelError} from './governed-model-call'
import {currentGovernedRun,currentGovernedForeground,foregroundRuntime,foregroundInTime} from './governed-run-context'
import {openPersonalGovernedRuntimeForOwner,type GovernedRuntime} from './governed-runtime'
import {googleRequestShape,type GoogleOperation,type GoogleRequest} from './governed-connector-shapes'
type Family='calendar'|'workspace'
type TokenBinding={owner:string;family:Family;sourceHash:string;expiresAt:number}
type CredentialSnapshot={refreshHashes:ReadonlySet<string>;accessHashes:ReadonlySet<string>}
const hash=(value:string)=>createHash('sha256').update(value).digest('hex')
const family=(op:GoogleOperation):Family=>op.startsWith('google.calendar.')?'calendar':'workspace'
const minted=new WeakMap<GovernedRuntime,Map<string,TokenBinding>>()
const allowedLevel=(x:unknown)=>['read','draft','ask','auto'].includes(String(x))
function nonemptyHash(raw:unknown):string|null{
  try{const token=decryptGoogleToken(typeof raw==='string'?raw:'');return token?hash(token):null}catch{return null}
}
function addHash(set:Set<string>,value:unknown){const key=nonemptyHash(value);if(key)set.add(key)}
async function readCredentialSnapshot(owner:string,which:Family):Promise<CredentialSnapshot|null>{
  const r=await supabaseAdmin.from('users').select('telegram_id,access_status,google_calendar_connected,google_refresh_token,gmail_connected,gmail_refresh_token,gmail_access_token').eq('telegram_id',owner).maybeSingle()
  if(r.error||exactSessionOwnerId(r.data?.telegram_id)!==owner||r.data?.access_status!=='active')return null
  const refreshHashes=new Set<string>(),accessHashes=new Set<string>()
  if(which==='calendar'){
    if(r.data.google_calendar_connected===true)addHash(refreshHashes,r.data.google_refresh_token)
    const rows=await supabaseAdmin.from('google_calendar_accounts').select('refresh_token').eq('telegram_id',owner).limit(21)
    if(rows.error||!Array.isArray(rows.data)||rows.data.length>20)return null
    for(const row of rows.data)addHash(refreshHashes,row.refresh_token)
  }else{
    if(r.data.gmail_connected===true){addHash(refreshHashes,r.data.gmail_refresh_token);addHash(accessHashes,r.data.gmail_access_token)}
    const rows=await supabaseAdmin.from('gmail_accounts').select('refresh_token,access_token').eq('telegram_id',owner).is('disconnected_at',null).limit(21)
    if(rows.error||!Array.isArray(rows.data)||rows.data.length>20)return null
    for(const row of rows.data){addHash(refreshHashes,row.refresh_token);addHash(accessHashes,row.access_token)}
  }
  return {refreshHashes,accessHashes}
}
export function credentialAuthorized(request:GoogleRequest,owner:string,snapshot:CredentialSnapshot,binding:TokenBinding|undefined,now:number):boolean{
  if(!Number.isFinite(now)||exactSessionOwnerId(owner)!==owner)return false
  const key=hash(request.credential)
  if(request.operation.endsWith('.refresh'))return snapshot.refreshHashes.has(key)
  if(snapshot.accessHashes.has(key))return true
  return !!binding&&binding.owner===owner&&binding.family===family(request.operation)&&binding.expiresAt>now&&snapshot.refreshHashes.has(binding.sourceHash)
}
async function permission(owner:string,op:GoogleOperation):Promise<boolean>{
  const permitted=async(c:AgentCapability)=>allowedLevel(await capabilityPermissionLevel(owner,c))
  if(op.startsWith('google.calendar.'))return permitted('calendar')
  if(op==='google.gmail.read')return (await gmailConsentState(owner))==='on'&&await permitted('email')
  if(op==='google.gmail.send')return (await gmailConsentState(owner))==='on'&&['draft','ask','auto'].includes(String(await capabilityPermissionLevel(owner,'email')))
  if(op==='google.drive.read')return permitted('files')
  if(op==='google.contacts.read')return permitted('contacts')
  // Workspace's refresh credential may also authorize Drive/Contacts. Gmail
  // read consent is still required before any mailbox call.
  return await permitted('files')||await permitted('contacts')||(await gmailConsentState(owner))==='on'&&await permitted('email')
}
type SendAuthority={actorId:string;senderAccount:string;expectedBody:string;authorize:()=>Promise<boolean>}
async function primarySendSnapshot(owner:string,actorId:string,senderAccount:string):Promise<CredentialSnapshot|null>{
  const r=await supabaseAdmin.from('users').select('id,telegram_id,access_status,gmail_connected,gmail_send_connected,gmail_email,gmail_refresh_token,gmail_access_token').eq('id',actorId).eq('telegram_id',owner).maybeSingle()
  if(r.error||String(r.data?.id||'')!==actorId||exactSessionOwnerId(r.data?.telegram_id)!==owner||r.data?.access_status!=='active'||r.data.gmail_connected!==true||r.data.gmail_send_connected!==true||String(r.data.gmail_email||'').trim().toLowerCase()!==senderAccount)return null
  const refreshHashes=new Set<string>(),accessHashes=new Set<string>()
  addHash(refreshHashes,r.data.gmail_refresh_token);addHash(accessHashes,r.data.gmail_access_token)
  return {refreshHashes,accessHashes}
}
type Deps={
  selection:()=>ReturnType<typeof selectedModelOwner>
  open:()=>Promise<GovernedRuntime|null>
  now:()=>number
  permission:(owner:string,op:GoogleOperation)=>Promise<boolean>
  snapshot:(owner:string,family:Family)=>Promise<CredentialSnapshot|null>
  fetcher:typeof fetch
}
export async function governedGoogleFetch(operation:GoogleOperation,url:string,init:RequestInit={},explicit?:string|number,deps?:Deps):Promise<Response>{
  if(operation==='google.gmail.send')throw new GovernedModelError('exact_send_approval_required')
  return governedGoogleRequest(operation,url,init,explicit,deps)
}
// Only the existing claimed Gmail send executor may provide this trusted
// callback and exact wire body. Read connectors cannot invoke this lane.
export async function governedApprovedGmailFetch(url:string,init:RequestInit,owner:string,authority:SendAuthority,deps?:Deps):Promise<Response>{
  if(!authority?.actorId||typeof authority.senderAccount!=='string'||!authority.senderAccount.trim()||typeof authority.expectedBody!=='string'||typeof authority.authorize!=='function'||init.body!==authority.expectedBody)throw new GovernedModelError('exact_send_approval_required')
  return governedGoogleRequest('google.gmail.send',url,init,owner,deps,authority)
}
async function governedGoogleRequest(operation:GoogleOperation,url:string,init:RequestInit={},explicit?:string|number,deps?:Deps,send?:SendAuthority):Promise<Response>{
  const selected=deps?deps.selection():selectedModelOwner(explicit)
  const parent=currentGovernedRun(),foreground=currentGovernedForeground()
  if(parent&&(selected.kind!=='governed'||selected.owner!==parent.owner||!parent.inTime()))throw new GovernedModelError('connector_scope_mismatch')
  if(selected.kind==='legacy'){
    if(send)throw new GovernedModelError('connector_scope_mismatch')
    return (deps?.fetcher||fetch)(url,init)
  }
  if(selected.kind!=='governed')throw new GovernedModelError('connector_identity_mismatch')
  const owner=selected.owner,now=deps?.now||Date.now
  const pinned:RequestInit={...init,headers:new Headers(init.headers),body:init.body instanceof URLSearchParams?new URLSearchParams(init.body):init.body,redirect:'error'}
  const request=googleRequestShape(operation,url,pinned)
  if(!request)throw new GovernedModelError('unreviewed_connector_shape')
  const runtime=parent?parent.runtime:foreground?await foregroundRuntime(owner,()=>deps?deps.open():openPersonalGovernedRuntimeForOwner(owner)):deps?await deps.open():null
  if(!runtime)throw new GovernedModelError('policy_unavailable')
  const deadline=now()+15_000,which=family(operation)
  const check=async()=>{
    if(send&&(operation!=='google.gmail.send'||pinned.body!==send.expectedBody||await send.authorize()!==true))return false
    if(parent&&await parent.authorize()!==true)return false
    if(!(await (deps?.permission||permission)(owner,operation)))return false
    const current=deps?await deps.snapshot(owner,which):send?await primarySendSnapshot(owner,send.actorId,send.senderAccount):await readCredentialSnapshot(owner,which)
    return !!current&&credentialAuthorized(request,owner,current,minted.get(runtime)?.get(hash(request.credential)),now())&&(!parent||await parent.authorize()===true)&&(!send||await send.authorize()===true)
  }
  const inTime=()=>now()<deadline&&!pinned.signal?.aborted&&(parent?parent.inTime():foreground?foregroundInTime(owner):!!deps)
  const r=await runtime.boundedConnector(operation,request.url,request.method,check,async()=>{
    const signal=AbortSignal.timeout(12_000)
    const response=await (deps?.fetcher||fetch)(request.url,{...pinned,signal:pinned.signal?AbortSignal.any([pinned.signal,signal]):signal})
    // Definite provider rejection is a completed HTTP attempt, not successful
    // work. Transport errors and ambiguous server outcomes remain reserved.
    if(!response.ok&&![400,401,403,404,409,410,412,422,429].includes(response.status))throw Error('google_transport_outcome_unverified')
    if(response.ok&&operation==='google.gmail.send'){
      const value=await response.clone().json().catch(()=>null)
      if(typeof value?.id!=='string'||!value.id||value.id.length>200||typeof value?.threadId!=='string'||!value.threadId||value.threadId.length>200)throw Error('gmail_send_receipt_unverified')
    }
    if(response.ok&&operation.endsWith('.refresh')){
      const value=await response.clone().json().catch(()=>null) as {access_token?:unknown;expires_in?:unknown}|null
      if(typeof value?.access_token!=='string'||!value.access_token||value.access_token.length>8192||typeof value.expires_in!=='number'||!Number.isFinite(value.expires_in)||value.expires_in<=0)throw Error('google_refresh_receipt_invalid')
      const tokens=minted.get(runtime)||new Map<string,TokenBinding>()
      if(tokens.size>=50)throw Error('google_refresh_scope_limit')
      tokens.set(hash(value.access_token),{owner,family:which,sourceHash:hash(request.credential),expiresAt:now()+Math.min(value.expires_in,3600)*1000})
      minted.set(runtime,tokens)
    }
    return response
  },inTime)
  if(r.state!=='completed')throw new GovernedModelError(r.reason)
  return r.value
}
