import { randomBytes } from 'crypto'
import { BROWSER_HANDOFF_PORT, HANDOFF_SERVER, getPersistentBrowserSandbox, releaseBrowserHandoff } from './browser-handoff'
import { ensureBrowserRuntime, SANDBOX_WORKDIR } from './secure-browser-bootstrap'
import { resolveBrowserProxy, proxyAllowlistHost } from './browser-proxy'
import { browserPageAllowlist } from './browser-page-network'
import {ensurePersistentCommerceBrowser} from './persistent-commerce-browser'

export async function cancelBrowserHandoffReservation(userId:string,token:string){
  const {sandbox}=await getPersistentBrowserSandbox(userId,{bootstrap:false})
  await sandbox.writeFiles([{path:`gogo-handoff-abort-${token}`,content:Buffer.from(token)}])
  await sandbox.runCommand({cmd:'node',args:['-e',"const fs=require('fs');try{if(fs.readFileSync('gogo-handoff-transfer','utf8')===process.argv[1])fs.unlinkSync('gogo-handoff-transfer')}catch{}",token]})
}

export async function cancelProviderBrowserHandoff(userId:string,handoff:{token:string;releaseUrl:string}){
  try{await releaseBrowserHandoff(handoff.releaseUrl,{allowExpired:true})}finally{
    // Also stop a server still starting up, using only this reservation's token.
    const {sandbox}=await getPersistentBrowserSandbox(userId,{bootstrap:false})
    await sandbox.writeFiles([{path:`gogo-handoff-abort-${handoff.token}`,content:Buffer.from(handoff.token)}])
  }
}

export async function startProviderBrowserHandoff(params:{userId:string;url:string;originalUrl?:string;reservationToken?:string;keepAlive?:boolean;sessionTaskId?:string}){
  const target=new URL(params.url)
  const hosts=[target,...(params.originalUrl?[new URL(params.originalUrl)]:[])]
  if(hosts.some(url=>!['https:','http:'].includes(url.protocol)))throw new Error('browser_url_not_http')
  const allow=Object.assign({},...hosts.map(url=>browserPageAllowlist(url.toString())))
  // If this provider egresses through the residential proxy, the takeover browser needs
  // the same egress — allow the proxy host and pass its credentials to the handoff server
  // so the human takeover isn't 403'd by the provider's datacenter block.
  const proxy=resolveBrowserProxy(params.url)
  const proxyEnv:Record<string,string>={}
  if(proxy){
    const proxyHost=proxyAllowlistHost()
    if(proxyHost){allow[proxyHost]=[];allow[`*.${proxyHost}`]=[]}
    proxyEnv.GOGO_BROWSER_PROXY_URL=proxy.server
    if(proxy.username)proxyEnv.GOGO_BROWSER_PROXY_USERNAME=proxy.username
    if(proxy.password)proxyEnv.GOGO_BROWSER_PROXY_PASSWORD=proxy.password
  }
  const {sandbox,name}=await getPersistentBrowserSandbox(params.userId,{bootstrap:false})
  const token=params.reservationToken||randomBytes(24).toString('base64url')
  try{
  // Production's command cwd is /vercel, but Playwright is installed in the
  // shared runtime directory. Resolve the server (and its imports) there.
  const serverPath=`${SANDBOX_WORKDIR}/gogo-handoff.js`
  await sandbox.writeFiles([{path:serverPath,content:Buffer.from(HANDOFF_SERVER)}])
  const encoded=Buffer.from(params.url).toString('base64')
  const runtimeOptions=Buffer.from(JSON.stringify({keepAlive:params.keepAlive===true,taskId:params.sessionTaskId||''})).toString('base64')
  // Hold one OS lock for the server lifetime. A second run must never kill or
  // rotate the token of an active owner-scoped takeover. Reserve before changing
  // network policy, then let the lock holder launch Chromium after setup.
  const launch=String.raw`const fs=require('fs');const token=process.argv[1],url=process.argv[2],options=process.argv[4]||'';
let transfer='';try{transfer=fs.readFileSync('gogo-handoff-transfer','utf8')}catch{}
if(process.argv[3]==='required'?transfer!==token:Boolean(transfer))process.exit(1);
if(transfer===token)fs.unlinkSync('gogo-handoff-transfer');
fs.writeFileSync('gogo-handoff-reserved',token);
const deadline=Date.now()+300000;let launched=false;
const timer=setInterval(()=>{let abort='';try{abort=fs.readFileSync('gogo-handoff-abort-'+token,'utf8')}catch{}
if(abort===token||(!launched&&Date.now()>deadline))process.exit(1);
let ready='';try{ready=fs.readFileSync('gogo-handoff-go','utf8')}catch{}
if(!launched&&ready===token){launched=true;process.argv=['node','${serverPath}',token,url,options];require('${serverPath}')}},100);`
  await sandbox.runCommand({cmd:'flock',args:['-n','--close','gogo-handoff.lock','node','-e',launch,token,encoded,params.reservationToken?'required':'new',runtimeOptions],detached:true,...(Object.keys(proxyEnv).length?{env:proxyEnv}:{})} as any)
  await new Promise(r=>setTimeout(r,500))
  const reservation=await sandbox.runCommand({cmd:'node',args:['-e',"const fs=require('fs');let value='';try{value=fs.readFileSync('gogo-handoff-reserved','utf8')}catch{};process.exit(value===process.argv[1]?0:1)",token]})
  if(reservation.exitCode!==0)throw new Error('browser_handoff_in_use')
  await ensureBrowserRuntime(sandbox)
  if(params.keepAlive)await ensurePersistentCommerceBrowser(sandbox,params.originalUrl||params.url)
  await sandbox.updateNetworkPolicy({allow} as any)
  await sandbox.writeFiles([{path:'gogo-handoff-go',content:Buffer.from(token)}])
  // The 2 Oct live takeover returned 502 after a successful-looking setup.
  // Probe only readiness, never page contents or authentication data.
  const readiness=await sandbox.runCommand({cmd:'node',args:['-e',String.raw`(async()=>{
const deadline=Date.now()+55000;
while(Date.now()<deadline){try{const r=await fetch('http://127.0.0.1:${BROWSER_HANDOFF_PORT}/health',{headers:{'x-gogo-handoff-token':process.argv[1]},signal:AbortSignal.timeout(1000)});if(r.ok&&(await r.json()).ready===true)process.exit(0)}catch{};await new Promise(r=>setTimeout(r,250))}process.exit(1)
})()`,token]})
  if(readiness.exitCode!==0)throw new Error('browser_handoff_not_ready')
  const domain=typeof (sandbox as any).domain==='function' ? await (sandbox as any).domain(BROWSER_HANDOFF_PORT) : ''
  if(!domain)throw new Error('browser_handoff_domain_unavailable')
  const base=String(domain).startsWith('http')?String(domain):`https://${domain}`
  const q=encodeURIComponent(token)
  return {sandboxName:name,token,takeoverUrl:`${base}/?token=${q}`,stateUrl:`${base}/state?token=${q}`,agentActionUrl:`${base}/agent-action?token=${q}`,releaseUrl:`${base}/release?token=${q}`}
  }catch(error){
    await sandbox.writeFiles([{path:`gogo-handoff-abort-${token}`,content:Buffer.from(token)}]).catch(()=>{})
    await sandbox.runCommand({cmd:'node',args:['-e',"const fs=require('fs');try{if(fs.readFileSync('gogo-handoff-transfer','utf8')===process.argv[1])fs.unlinkSync('gogo-handoff-transfer')}catch{}",token]}).catch(()=>{})
    throw error
  }
}
