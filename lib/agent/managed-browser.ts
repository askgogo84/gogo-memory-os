import {createHash} from 'node:crypto'
import {isIP} from 'node:net'
import {browserPageAllowlist} from './browser-page-network'
import {SANDBOX_WORKDIR} from './secure-browser-bootstrap'

// Browserbase is infrastructure, never an authority source. Existing action,
// owner-lock, authentication and outcome checks remain in the browser executor.
export const managedBrowserEnabled=()=>process.env.GOGO_BROWSER_RUNTIME==='browserbase'
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const metadataPath=`${SANDBOX_WORKDIR}/managed-browser.json`
type Session={id:string;scope:string;fingerprint:string}
export type ManagedState={owner:string;contexts:Record<string,string>;session?:Session;pending?:string}
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
export function managedSessionConfig(projectId:string,contextId:string,owner:string,scope:string,timeoutSeconds:number,keepAlive:boolean,envTag:string){
  // userMetadata (session-metadata.md) carries our ownership + deployment tags. The
  // orphan sweep releases ONLY sessions tagged app:'askgogo' AND env:'production', so a
  // Preview deploy sharing this project/key can never release a live production session.
  return {projectId,region:'ap-southeast-1',timeout:timeoutSeconds,keepAlive,
    proxies:[{type:'browserbase',geolocation:{country:'IN'}}],
    browserSettings:{context:{id:contextId,persist:true},allowedDomains:[scope],solveCaptchas:false,recordSession:false,logSession:false,ignoreCertificateErrors:false,viewport:{width:1280,height:900}},
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
  const keepAlive=opts.keepAlive===true
  const sessionTimeout=keepAlive?KEEPALIVE_SESSION_TIMEOUT_SECONDS:NORMAL_SESSION_TIMEOUT_SECONDS
  const digest=createHash('sha256').update(owner).digest('hex')
  let state=await store.load()||{owner:digest,contexts:{}}
  if(state.owner!==digest)throw Error('managed_browser_owner_mismatch')
  if(state.pending)throw Error('managed_browser_setup_outcome_unknown')
  const api=async(path:string,body?:unknown)=>{
    let response:Response
    try{response=await fetcher(`https://api.browserbase.com/v1/${path}`,{method:body?'POST':'GET',headers:{'X-BB-API-Key':key,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(30000)})}
    catch{throw Error('managed_browser_provider_unavailable')}
    if(!response.ok)throw Error(`managed_browser_provider_http_${response.status}`)
    try{return await response.json()}catch{throw Error('managed_browser_invalid_response')}
  }
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
  const fingerprint=createHash('sha256').update(JSON.stringify({project,scope,policy:browserPageAllowlist(url),version:1,keepAlive})).digest('hex')
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
  const created=await api('sessions',managedSessionConfig(project,state.contexts[scope],digest,scope,sessionTimeout,keepAlive,String(env.VERCEL_ENV||'')))
  if(!uuid.test(created.id)||created.projectId!==project||created.contextId!==state.contexts[scope])throw Error('managed_browser_session_invalid')
  state.session={id:created.id,scope,fingerprint};delete state.pending;await store.save(state)
  return {...await connect(created),id:created.id,newSession:true,scope,release:async()=>{await api(`sessions/${created.id}`,{status:'REQUEST_RELEASE'})}}
}

// Idempotent REQUEST_RELEASE by session id, usable by handoff teardown and the orphan
// sweep without the original release closure. Releasing an already-ended session is a
// no-op; configuration/transport failures are swallowed so teardown never throws.
export async function releaseManagedSessionById(sessionId:string,env:Env=process.env,fetcher:typeof fetch=fetch):Promise<boolean>{
  const key=env.BROWSERBASE_API_KEY,project=env.BROWSERBASE_PROJECT_ID
  if(!key||!project||!uuid.test(String(sessionId||'')))return false
  try{
    const response=await fetcher(`https://api.browserbase.com/v1/sessions/${sessionId}`,{method:'POST',headers:{'X-BB-API-Key':key,'Content-Type':'application/json'},body:JSON.stringify({status:'REQUEST_RELEASE'}),redirect:'error',signal:AbortSignal.timeout(15000)})
    return response.ok
  }catch{return false}
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
  const session=await resolveManagedSession(owner,url,store,process.env,fetch,{keepAlive})
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
