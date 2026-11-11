import {createHash,randomBytes} from 'node:crypto'
import {isIP} from 'node:net'
import {browserPageAllowlist,FLIGHT_BOOKING_HANDOFF_SITES} from './browser-page-network'
import {SANDBOX_WORKDIR,browserSandboxNameFor} from './secure-browser-bootstrap'

// Browserbase is infrastructure, never an authority source. Existing action,
// owner-lock, authentication and outcome checks remain in the browser executor.
export const managedBrowserEnabled=()=>process.env.GOGO_BROWSER_RUNTIME==='browserbase'
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const metadataPath=`${SANDBOX_WORKDIR}/managed-browser.json`
type Session={id:string;scope:string;fingerprint:string}
// Anchor Browser (Addendum 6 pilot): its own records beside Browserbase's, so switching a user between providers never
// mixes a Browserbase Context with an Anchor profile, and turning the pilot off leaves the Browserbase login untouched.
type AnchorState={profiles:Record<string,string>;session?:Session&{startedAt?:number;minutes?:number};pending?:string;pendingAt?:number}
export type ManagedState={owner:string;contexts:Record<string,string>;session?:Session;pending?:string;anchor?:AnchorState}
type Store={load:()=>Promise<ManagedState|null>;save:(state:ManagedState)=>Promise<void>}
type Env=Record<string,string|undefined>

export function managedScope(url:string){
  const u=new URL(url),host=u.hostname.toLowerCase().replace(/^www\./,'')
  if(!['https:','http:'].includes(u.protocol)||u.username||u.password||isIP(host)||host.includes(':')||!host.includes('.')||host.endsWith('.local')||host.endsWith('.localhost')||host.endsWith('.internal'))throw Error('browser_private_host_blocked')
  return host
}
// Normal one-shot runs end promptly so a missed release cannot leak browser
// minutes / proxy bandwidth. 300s = the 5-minute project default and sits above the
// 180s browser read budget (secure-computer READ_BUDGET_MS). Per timeouts.md the
// `timeout` field is in seconds.
export const NORMAL_SESSION_TIMEOUT_SECONDS=300
// Sessions that MUST survive the agent's CDP disconnect — persistent commerce across
// cron re-entry, and human OTP/live-view takeover — use keepAlive (per keep-alive.md
// the session stays available for reconnection instead of ending on disconnect) and are
// capped at the 20-minute owner-lock window (browser-owner-lock.ts). keepAlive sessions
// run until REQUEST_RELEASE or this timeout, so PR-0 also guarantees release and sweeps.
export const KEEPALIVE_SESSION_TIMEOUT_SECONDS=1200
// Advanced Stealth (Browserbase Scale plan) makes the browser look like a normal one to sites that refuse automated
// browsers (amazon.in answered 503 on 15 Oct). Off unless GOGO_BROWSER_ADVANCED_STEALTH=1; CAPTCHAs are still never solved.
// 26 Oct live booking 412f5a03: Google Flights' "Continue to book with Air India" was refused by Browserbase
// (browserbase.com/navigation-blocked) because the session only allowed google.com. A Google Flights run may
// hand off to the airlines and Indian agencies in FLIGHT_BOOKING_HANDOFF_SITES, so the session allows those too.
export function managedAllowedDomains(url:string):string[]{
  const scope=managedScope(url)
  let path='';try{path=new URL(url).pathname}catch{}
  if(scope==='google.com'&&/^\/travel\/flights(?:\/|$)/.test(path))return [scope,...FLIGHT_BOOKING_HANDOFF_SITES]
  return [scope]
}
export function managedSessionConfig(projectId:string,contextId:string,owner:string,scope:string,timeoutSeconds:number,keepAlive:boolean,envTag:string,recordSession:boolean,advancedStealth=false,allowedDomains:string[]=[scope]){
  // keepAlive is ALWAYS true for managed sessions: the broker and the per-wave executor
  // each open their own CDP connection (managed-browser.ts broker connectOverCDP +
  // secure-computer.ts executor connectOverCDP that closes after every runCommand), so a
  // non-keepAlive session would end on the first executor disconnect and kill the run
  // mid-way. Cost is still bounded by the explicit `timeout` tier (300s normal / 1200s
  // persistent), the guaranteed REQUEST_RELEASE at run end, and the orphan sweep.
  // userMetadata (session-metadata.md) carries our ownership + deployment tags; the sweep
  // releases ONLY app:'askgogo' AND env:'production'. recordSession/logSession are the
  // debug flag (off unless GOGO_BROWSER_RECORD_SESSIONS==='1').
  return {projectId,region:'ap-southeast-1',timeout:timeoutSeconds,keepAlive,
    proxies:[{type:'browserbase',geolocation:{country:'IN'}}],
    browserSettings:{context:{id:contextId,persist:true},allowedDomains,solveCaptchas:false,...(advancedStealth?{advancedStealth:true}:{}),recordSession,logSession:recordSession,ignoreCertificateErrors:false,viewport:{width:1280,height:900}},
    userMetadata:{owner,scope,application:'askgogo',app:'askgogo',env:envTag}}
}
function connection(data:any){
  let u:URL
  try{u=new URL(data.connectUrl)}catch{throw Error('managed_browser_connection_missing')}
  if(u.protocol!=='wss:'||u.username||u.password||u.port||!(u.hostname==='connect.browserbase.com'||/^connect\.(apse1|us-west-2|us-east-1|eu-central-1|ap-southeast-1)\.browserbase\.com$/.test(u.hostname)))throw Error('managed_browser_connection_invalid')
  return {endpoint:u.toString(),host:u.hostname}
}

export async function resolveManagedSession(owner:string,url:string,store:Store,env:Env=process.env,fetcher:typeof fetch=fetch,opts:{keepAlive?:boolean}={}){
  const key=env.BROWSERBASE_API_KEY,project=env.BROWSERBASE_PROJECT_ID
  if(!key||!project||!uuid.test(project))throw Error('managed_browser_configuration_missing')
  const scope=managedScope(url)
  // opts.keepAlive selects the TIMEOUT TIER only (persistent/takeout runs live longer).
  // The keepAlive flag sent to Browserbase is always true (see managedSessionConfig).
  const persistent=opts.keepAlive===true
  const sessionTimeout=persistent?KEEPALIVE_SESSION_TIMEOUT_SECONDS:NORMAL_SESSION_TIMEOUT_SECONDS
  const recordSessions=String(env.GOGO_BROWSER_RECORD_SESSIONS||'')==='1'
  const digest=createHash('sha256').update(owner).digest('hex')
  let state=await store.load()||{owner:digest,contexts:{}}
  if(state.owner!==digest)throw Error('managed_browser_owner_mismatch')
  const api=async(path:string,body?:unknown)=>{
    let response:Response
    try{response=await fetcher(`https://api.browserbase.com/v1/${path}`,{method:body?'POST':'GET',headers:{'X-BB-API-Key':key,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(30000)})}
    catch{throw Error('managed_browser_provider_unavailable')}
    if(!response.ok)throw Error(`managed_browser_provider_http_${response.status}`)
    try{return await response.json()}catch{throw Error('managed_browser_invalid_response')}
  }
  // A session request whose outcome is unknown blocks new sessions (two writers on one Context). It is cleared only when
  // Browserbase confirms no running session belongs to this owner (15 Oct: a 403 left a user stuck on this forever).
  if(state.pending==='session'){
    const running=await api(`sessions?status=RUNNING&q=${encodeURIComponent(`user_metadata['owner']:'${digest}'`)}`).catch(()=>null)
    if(!Array.isArray(running)||running.some((row:any)=>row?.userMetadata?.owner===digest))throw Error('managed_browser_setup_outcome_unknown')
    delete state.pending;await store.save(state)
  }
  if(state.pending)throw Error('managed_browser_setup_outcome_unknown')
  // Explicit server-side import, bound to this exact sandbox owner and site.
  // No shared default Context: a new user can never inherit the demo login.
  if(!state.contexts[scope]&&env.GOGO_BROWSER_CONTEXT_IMPORTS){
    const bindings=JSON.parse(env.GOGO_BROWSER_CONTEXT_IMPORTS)
    const imported=bindings?.[owner]?.[scope]
    if(imported){
      if(!uuid.test(imported))throw Error('managed_browser_context_invalid')
      const context=await api(`contexts/${imported}`)
      if(context.projectId!==project||context.id!==imported)throw Error('managed_browser_context_project_mismatch')
      state.contexts[scope]=imported;await store.save(state)
    }
  }
  const fingerprint=createHash('sha256').update(JSON.stringify({project,scope,policy:browserPageAllowlist(url),domains:managedAllowedDomains(url),version:2,persistent})).digest('hex')
  const connect=async(data:any)=>{try{return connection(data)}catch(error){await api(`sessions/${data.id}`,{status:'REQUEST_RELEASE'}).catch(()=>{});throw error}}
  if(state.session){
    if(!uuid.test(state.session.id))throw Error('managed_browser_session_invalid')
    const current=await api(`sessions/${state.session.id}`)
    if(current.projectId!==project||current.userMetadata?.owner!==digest||current.contextId!==state.contexts[state.session.scope])throw Error('managed_browser_session_owner_mismatch')
    if(current.status==='RUNNING'&&Date.parse(current.expiresAt)>Date.now()+30000&&state.session.scope===scope&&state.session.fingerprint===fingerprint){
      return {...await connect(current),id:current.id,newSession:false,scope,release:async()=>{await api(`sessions/${current.id}`,{status:'REQUEST_RELEASE'})}}
    }
    if(['RUNNING','PENDING'].includes(current.status)){
      await api(`sessions/${state.session.id}`,{status:'REQUEST_RELEASE'})
      const closed=await api(`sessions/${state.session.id}`)
      if(!['COMPLETED','TIMED_OUT','ERROR'].includes(closed.status))throw Error('managed_browser_previous_session_closing')
    }
    // Context is synchronized by the provider on close. Never overlap writers.
    await new Promise(resolve=>setTimeout(resolve,5000))
    delete state.session;await store.save(state)
  }
  if(!state.contexts[scope]){
    state.pending='context';await store.save(state)
    const context=await api('contexts',{projectId:project,name:`gogo-${digest.slice(0,24)}-${createHash('sha256').update(scope).digest('hex').slice(0,16)}`})
    if(!uuid.test(context.id))throw Error('managed_browser_context_invalid')
    state.contexts[scope]=context.id;delete state.pending;await store.save(state)
  }
  if(!uuid.test(state.contexts[scope]))throw Error('managed_browser_context_invalid')
  state.pending='session';await store.save(state)
  const stealth=String(env.GOGO_BROWSER_ADVANCED_STEALTH||'')==='1'
  const sessionConfig=(withStealth:boolean)=>managedSessionConfig(project,state.contexts[scope],digest,scope,sessionTimeout,true,String(env.VERCEL_ENV||''),recordSessions,withStealth,managedAllowedDomains(url))
  // A plan without Advanced Stealth answers 403 (15 Oct live); fall back to a normal session instead of failing every run.
  const created=await api('sessions',sessionConfig(stealth)).catch(async(error:any)=>{
    if(!stealth||String(error?.message||'')!=='managed_browser_provider_http_403')throw error
    console.warn('MANAGED_BROWSER_STEALTH_UNAVAILABLE: retrying without advanced stealth')
    return api('sessions',sessionConfig(false))
  }).catch(async(error:any)=>{
    // A 4xx answer means Browserbase created nothing, so the request is not "outcome unknown".
    if(/^managed_browser_provider_http_4\d\d$/.test(String(error?.message||''))){delete state.pending;await store.save(state)}
    throw error
  })
  if(!uuid.test(created.id)||created.projectId!==project||created.contextId!==state.contexts[scope])throw Error('managed_browser_session_invalid')
  state.session={id:created.id,scope,fingerprint};delete state.pending;await store.save(state)
  return {...await connect(created),id:created.id,newSession:true,scope,release:async()=>{await api(`sessions/${created.id}`,{status:'REQUEST_RELEASE'})}}
}

// ---- Anchor Browser pilot (Same Brain 3.0 Addendum 6) ----
// An optional second provider behind the same resolver. It is used only for users listed in GOGO_BROWSER_ANCHOR_USERS
// (their exact users.id; "on" is not accepted), only while managed mode is on, and only with ANCHOR_API_KEY set on the
// server. It is never chosen automatically after a failure: a site that refuses one provider is not retried on another.
// Everything the existing executor enforces (owner lock, action guards, allowlist broker, approvals) stays in force.
export const ANCHOR_API='https://api.anchorbrowser.io/v1'
export function anchorEnabledForSandbox(sandboxName:string,env:Env=process.env,nameFor:(userId:string)=>string=defaultSandboxName){
  if(!env.ANCHOR_API_KEY)return false
  const ids=String(env.GOGO_BROWSER_ANCHOR_USERS||'').split(',').map(x=>x.trim().toLowerCase()).filter(x=>uuid.test(x))
  // The general and commerce namespaces (userId, userId:commerce). Per-store comparison sandboxes
  // (userId:commerce:<store>) stay on Browserbase in this pilot.
  return ids.some(id=>nameFor(id)===sandboxName||nameFor(`${id}:commerce`)===sandboxName)
}
const defaultSandboxName=(userId:string)=>browserSandboxNameFor(userId)
export const ANCHOR_SESSION_PREFIX='anchor:'
/** Pure: the session request. Recording off, CAPTCHA solving off, no extra stealth, India egress, the same top-level
 *  domains Browserbase allows, a persistent profile per owner and site, and a hard duration cap. */
export function anchorSessionConfig(profile:string,ownerDigest:string,scope:string,persistent:boolean,envTag:string,allowedDomains:string[],webBotAuth:boolean){
  return {
    session:{
      tags:['askgogo',`env-${envTag||'unknown'}`,`owner-${ownerDigest.slice(0,24)}`],
      recording:{active:false},
      proxy:{active:true,type:'anchor_proxy',country_code:'in'},
      // Minutes. Normal runs 5 (as Browserbase's 300 s), takeover and persistent commerce 20 (the owner-lock window).
      timeout:{max_duration:persistent?20:5,idle_timeout:2},
      live_view:{read_only:false,one_time_url:true},
      domain_allowlist:allowedDomains.slice(0,100),
    },
    browser:{
      profile:{name:profile,persist:true},
      captcha_solver:{active:false},
      extra_stealth:{active:false},
      // Cloudflare Web Bot Auth signs requests as Anchor Browser. It identifies the agent honestly; it is not
      // permission to act. Off unless GOGO_ANCHOR_WEB_BOT_AUTH=1 (and the plan includes it).
      web_bot_auth:{active:webBotAuth},
      headless:{active:false},
      viewport:{width:1280,height:900},
      // Off: masking may blank fields the executor reads; AskGogo's own redaction (secure-browser-redaction) applies.
      sensitive_data_mask:{active:false},
    },
  }
}
function anchorConnection(data:any,apiKey:string){
  let u:URL
  try{u=new URL(String(data?.cdp_url||''))}catch{throw Error('anchor_connection_missing')}
  if(u.protocol!=='wss:'||u.username||u.password||u.port||!/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.anchorbrowser\.io$/.test(u.hostname))throw Error('anchor_connection_invalid')
  // The connection URL goes into the sandbox where web pages run. It must never carry the account API key.
  if(apiKey&&(u.toString().includes(apiKey)||u.toString().includes(encodeURIComponent(apiKey))))throw Error('anchor_connection_embeds_api_key')
  // The sandbox may reach any Anchor connect host (a redirect between them must not break the run); nothing else.
  return {endpoint:u.toString(),host:'*.anchorbrowser.io'}
}
export const ANCHOR_ENDED=['ended','completed','terminated','failed','closed','stopped','expired']
const ANCHOR_LIVE=['running','active','idle']
export async function resolveAnchorSession(owner:string,url:string,store:Store,env:Env=process.env,fetcher:typeof fetch=fetch,opts:{keepAlive?:boolean}={}){
  const key=String(env.ANCHOR_API_KEY||'')
  if(!key)throw Error('anchor_configuration_missing')
  const scope=managedScope(url)
  const persistent=opts.keepAlive===true
  const digest=createHash('sha256').update(owner).digest('hex')
  const state=await store.load()||{owner:digest,contexts:{}}
  if(state.owner!==digest)throw Error('managed_browser_owner_mismatch')
  const a:AnchorState=state.anchor||(state.anchor={profiles:{}})
  const save=()=>store.save(state)
  const api=async(path:string,method:'GET'|'POST'|'DELETE'='GET',body?:unknown)=>{
    let response:Response
    try{response=await fetcher(`${ANCHOR_API}/${path}`,{method,headers:{'anchor-api-key':key,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(60000)})}
    catch{throw Error('anchor_provider_unavailable')}
    if(!response.ok)throw Error(`anchor_provider_http_${response.status}`)
    try{return await response.json()}catch{throw Error('anchor_invalid_response')}
  }
  // A session request whose outcome is unknown blocks new ones (two writers on one profile). Any session it may have
  // created ends at its own cap (20 minutes), so the block lifts by itself after 25 minutes.
  if(a.pending){
    if(Number.isFinite(a.pendingAt)&&Date.now()-Number(a.pendingAt)>25*60_000){delete a.pending;delete a.pendingAt;await save()}
    else throw Error('anchor_setup_outcome_unknown')
  }
  // A random name, stored on first use: a lost state file or another deployment sharing the key can never attach to
  // this owner's signed-in profile by guessing its name (it starts a fresh profile instead).
  const profile=a.profiles[scope]||`gogo-${randomBytes(16).toString('hex')}`
  if(!/^gogo-[0-9a-f]{32}$/.test(profile))throw Error('anchor_profile_invalid')
  const fingerprint=createHash('sha256').update(JSON.stringify({provider:'anchor',scope,policy:browserPageAllowlist(url),domains:managedAllowedDomains(url),version:1,persistent})).digest('hex')
  if(a.session){
    const id=a.session.id
    if(!/^[A-Za-z0-9-]{8,80}$/.test(id))throw Error('anchor_session_invalid')
    const read=async()=>{
      const r:any=await api(`sessions/${id}`).catch((error:any)=>/_http_404$/.test(String(error?.message||''))?null:Promise.reject(error))
      const d=r?.data||r
      return d?{status:String(d.status||'').toLowerCase(),cdp:d.cdp_url}:null
    }
    const current=await read()
    const minutes=Number(a.session.minutes)||5, started=Number(a.session.startedAt)||0
    const timeLeft=started+minutes*60_000-Date.now()
    if(current&&ANCHOR_LIVE.includes(current.status)&&current.cdp&&a.session.scope===scope&&a.session.fingerprint===fingerprint&&timeLeft>60_000){
      return {...anchorConnection({cdp_url:current.cdp},key),id:`${ANCHOR_SESSION_PREFIX}${id}`,newSession:false,scope,provider:'anchor' as const,release:async()=>{await api(`sessions/${id}`,'DELETE')}}
    }
    // Never two writers on one profile: a new session starts only once the old one is confirmed gone.
    if(current&&!ANCHOR_ENDED.includes(current.status)){
      await api(`sessions/${id}`,'DELETE').catch((error:any)=>/_http_404$/.test(String(error?.message||''))?null:Promise.reject(Error('anchor_previous_session_closing')))
      const after=await read().catch(()=>({status:'unknown',cdp:null}))
      if(after&&!ANCHOR_ENDED.includes(after.status))throw Error('anchor_previous_session_closing')
    }
    const settle=Number(env.GOGO_ANCHOR_PROFILE_SETTLE_MS??5000)
    await new Promise(resolve=>setTimeout(resolve,Number.isInteger(settle)&&settle>=0&&settle<=30000?settle:5000))
    delete a.session;await save()
  }
  a.profiles[scope]=profile
  a.pending='session';a.pendingAt=Date.now();await save()
  const created:any=await api('sessions','POST',anchorSessionConfig(profile,digest,scope,persistent,String(env.VERCEL_ENV||''),managedAllowedDomains(url),String(env.GOGO_ANCHOR_WEB_BOT_AUTH||'')==='1')).catch(async(error:any)=>{
    // A 4xx answer means nothing was created, so the request is not "outcome unknown".
    if(/^anchor_provider_http_4\d\d$/.test(String(error?.message||''))){delete a.pending;delete a.pendingAt;await save()}
    throw error
  })
  const data=created?.data||{}
  const id=String(data.id||'')
  if(!/^[A-Za-z0-9-]{8,80}$/.test(id))throw Error('anchor_session_invalid')
  let conn:{endpoint:string;host:string}
  try{conn=anchorConnection(data,key)}catch(error){await api(`sessions/${id}`,'DELETE').catch(()=>{});delete a.pending;delete a.pendingAt;await save();throw error}
  a.session={id,scope,fingerprint,startedAt:Date.now(),minutes:persistent?20:5};delete a.pending;delete a.pendingAt;await save()
  return {...conn,id:`${ANCHOR_SESSION_PREFIX}${id}`,newSession:true,scope,provider:'anchor' as const,release:async()=>{await api(`sessions/${id}`,'DELETE')}}
}
async function releaseAnchorSession(id:string,env:Env,fetcher:typeof fetch){
  const key=String(env.ANCHOR_API_KEY||'')
  if(!key||!/^[A-Za-z0-9-]{8,80}$/.test(id))return false
  try{const r=await fetcher(`${ANCHOR_API}/sessions/${id}`,{method:'DELETE',headers:{'anchor-api-key':key},redirect:'error',signal:AbortSignal.timeout(15000)});return r.ok||r.status===404}catch{return false}
}

// Idempotent REQUEST_RELEASE by session id, usable by handoff teardown and the orphan
// sweep without the original release closure. Releasing an already-ended session is a
// no-op; configuration/transport failures are swallowed so teardown never throws.
export async function releaseManagedSessionById(sessionId:string,env:Env=process.env,fetcher:typeof fetch=fetch):Promise<boolean>{
  if(String(sessionId||'').startsWith(ANCHOR_SESSION_PREFIX))return releaseAnchorSession(String(sessionId).slice(ANCHOR_SESSION_PREFIX.length),env,fetcher)
  const key=env.BROWSERBASE_API_KEY,project=env.BROWSERBASE_PROJECT_ID
  if(!key||!project||!uuid.test(String(sessionId||'')))return false
  try{
    const response=await fetcher(`https://api.browserbase.com/v1/sessions/${sessionId}`,{method:'POST',headers:{'X-BB-API-Key':key,'Content-Type':'application/json'},body:JSON.stringify({status:'REQUEST_RELEASE'}),redirect:'error',signal:AbortSignal.timeout(15000)})
    return response.ok
  }catch{return false}
}

// Browserbase's own interactive live view of a session: the real browser, which the owner can
// click, type and scroll in. Used for the human step instead of our screenshot relay. Returns
// null when unavailable; the caller falls back to the relay. The URL is a bearer link to the
// session, so it is stored on the owner's run and only served through the authenticated
// dashboard route, never sent in chat.
export async function managedLiveViewUrl(sessionId:string,env:Env=process.env,fetcher:typeof fetch=fetch):Promise<string|null>{
  const key=env.BROWSERBASE_API_KEY
  if(!key||!/^[a-zA-Z0-9-]{8,80}$/.test(String(sessionId||'')))return null
  try{
    const response=await fetcher(`https://api.browserbase.com/v1/sessions/${sessionId}/debug`,{headers:{'X-BB-API-Key':key},redirect:'error',signal:AbortSignal.timeout(15000)})
    if(!response.ok)return null
    const data:any=await response.json()
    const url=new URL(String(data?.debuggerFullscreenUrl||''))
    if(url.protocol!=='https:'||!(url.hostname==='browserbase.com'||url.hostname.endsWith('.browserbase.com')))return null
    return url.toString()
  }catch{return null}
}

// List this project's RUNNING sessions with their start time, for the orphan sweep.
export async function listRunningManagedSessions(env:Env=process.env,fetcher:typeof fetch=fetch):Promise<Array<{id:string;startedAt:string|null;app:string;env:string}>>{
  const key=env.BROWSERBASE_API_KEY,project=env.BROWSERBASE_PROJECT_ID
  if(!key||!project)throw Error('managed_browser_configuration_missing')
  const response=await fetcher('https://api.browserbase.com/v1/sessions?status=RUNNING',{headers:{'X-BB-API-Key':key},redirect:'error',signal:AbortSignal.timeout(30000)})
  if(!response.ok)throw Error(`managed_browser_provider_http_${response.status}`)
  const data=await response.json()
  return (Array.isArray(data)?data:[])
    .filter((s:any)=>s&&s.projectId===project&&uuid.test(String(s.id||'')))
    .map((s:any)=>({id:String(s.id),startedAt:s.startedAt||s.createdAt||null,app:String(s.userMetadata?.app||s.userMetadata?.application||''),env:String(s.userMetadata?.env||'')}))
}

// Remains connected while agent/human clients come and go. The broker owns the
// resource allowlist; the provider also enforces top-level navigation domains.
// No website content or authentication value is printed by this process.
export const MANAGED_BROWSER_BROKER=String.raw`
const {chromium}=require('playwright'),fs=require('fs');
(async()=>{
 const browser=await chromium.connectOverCDP(process.env.GOGO_BROWSER_CDP_URL);
 const context=browser.contexts()[0];if(!context)throw Error();
 const hosts=JSON.parse(process.env.GOGO_BROWSER_ALLOWED_HOSTS);
 const allowed=value=>{try{const u=new URL(value);return ['https:','http:','wss:','ws:'].includes(u.protocol)&&!u.username&&!u.password&&hosts.some(h=>h.startsWith('*.')?u.hostname.endsWith(h.slice(1)):u.hostname===h)}catch{return false}};
 await context.route('**/*',route=>allowed(route.request().url())?route.continue():route.abort());
 await context.routeWebSocket('**/*',socket=>allowed(socket.url())?socket.connectToServer():socket.close());
 const protect=async page=>{const cdp=await context.newCDPSession(page);await cdp.send('Network.setBypassServiceWorker',{bypass:true})};
 for(const page of context.pages())await protect(page);
 context.on('page',page=>protect(page).catch(()=>process.exit(1)));
 const ready='${SANDBOX_WORKDIR}/managed-browser-ready';
 fs.writeFileSync(ready,JSON.stringify({id:process.env.GOGO_BROWSER_SESSION_ID,pid:process.pid}));
 browser.on('disconnected',()=>{try{if(JSON.parse(fs.readFileSync(ready,'utf8')).pid===process.pid)fs.unlinkSync(ready)}catch{};process.exit(0)});
 setInterval(()=>{},1000);
})().catch(()=>{console.error('managed_browser_broker_failed');process.exit(1)});
`

export async function ensureManagedBrowser(sandbox:any,owner:string,url:string,keepAlive=false){
  if(!managedBrowserEnabled())return null
  const store:Store={
    load:async()=>{
      const result=await sandbox.runCommand({cmd:'node',args:['-e',`const fs=require('fs');const p=process.argv[1];process.stdout.write(fs.existsSync(p)?fs.readFileSync(p,'utf8'):'null')`,metadataPath]})
      if(result.exitCode!==0)throw Error('managed_browser_state_read_failed')
      return JSON.parse(await result.stdout())
    },
    save:async state=>{await sandbox.writeFiles([{path:metadataPath,content:Buffer.from(JSON.stringify(state))}])},
  }
  // Anchor only for the users listed for the pilot; everyone else stays on Browserbase exactly as before.
  const session=anchorEnabledForSandbox(owner)?await resolveAnchorSession(owner,url,store,process.env,fetch,{keepAlive}):await resolveManagedSession(owner,url,store,process.env,fetch,{keepAlive})
  console.log('MANAGED_BROWSER_PROVIDER:',JSON.stringify({provider:(session as any).provider==='anchor'?'anchor':'browserbase',newSession:session.newSession}))
  // Guaranteed release: once the provider session exists, ANY failure wiring up the
  // sandbox (network policy, broker launch, readiness) must REQUEST_RELEASE it rather
  // than leave it running until timeout. REQUEST_RELEASE is idempotent.
  try{
    const allow={...browserPageAllowlist(url),[session.host]:[]}
    await sandbox.updateNetworkPolicy({allow})
    const env={GOGO_BROWSER_CDP_URL:session.endpoint,GOGO_BROWSER_SESSION_ID:session.id,GOGO_BROWSER_ALLOWED_HOSTS:JSON.stringify(Object.keys(browserPageAllowlist(url)))}
    const ready=()=>sandbox.runCommand({cmd:'node',args:['-e',`try{const r=JSON.parse(require('fs').readFileSync('${SANDBOX_WORKDIR}/managed-browser-ready','utf8'));process.kill(r.pid,0);process.exit(r.id===process.argv[1]?0:1)}catch{process.exit(1)}`,session.id]})
    if(session.newSession)await sandbox.writeFiles([{path:`${SANDBOX_WORKDIR}/commerce-active-task`,content:Buffer.from('')}])
    if((await ready()).exitCode!==0){
      await sandbox.writeFiles([{path:`${SANDBOX_WORKDIR}/managed-browser-broker.cjs`,content:Buffer.from(MANAGED_BROWSER_BROKER)}])
      await sandbox.runCommand({cmd:'node',args:[`${SANDBOX_WORKDIR}/managed-browser-broker.cjs`],detached:true,env})
      for(let attempt=0;attempt<40;attempt++){
        if((await ready()).exitCode===0)return {env,allow,release:session.release}
        await new Promise(resolve=>setTimeout(resolve,250))
      }
      throw Error('managed_browser_broker_not_ready')
    }
    return {env,allow,release:session.release}
  }catch(error){
    await session.release().catch(()=>{})
    throw error
  }
}
