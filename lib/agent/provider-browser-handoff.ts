import { randomBytes } from 'crypto'
import { BROWSER_HANDOFF_PORT, HANDOFF_SERVER, getPersistentBrowserSandbox, releaseBrowserHandoff } from './browser-handoff'
import { ensureBrowserRuntime } from './secure-browser-bootstrap'

export async function cancelProviderBrowserHandoff(userId:string,handoff:{token:string;releaseUrl:string}){
  try{await releaseBrowserHandoff(handoff.releaseUrl,{allowExpired:true})}finally{
    // Also stop a server still starting up, using only this reservation's token.
    const {sandbox}=await getPersistentBrowserSandbox(userId,{bootstrap:false})
    await sandbox.writeFiles([{path:`gogo-handoff-abort-${handoff.token}`,content:Buffer.from(handoff.token)}])
  }
}

export async function startProviderBrowserHandoff(params:{userId:string;url:string}){
  const target=new URL(params.url)
  const {sandbox,name}=await getPersistentBrowserSandbox(params.userId,{bootstrap:false})
  await sandbox.writeFiles([{path:'gogo-handoff.js',content:Buffer.from(HANDOFF_SERVER)}])
  const token=randomBytes(24).toString('base64url')
  const encoded=Buffer.from(params.url).toString('base64')
  // Hold one OS lock for the server lifetime. A second run must never kill or
  // rotate the token of an active owner-scoped takeover. Reserve before changing
  // network policy, then let the lock holder launch Chromium after setup.
  const launch=String.raw`const fs=require('fs');const token=process.argv[1],url=process.argv[2];
fs.writeFileSync('gogo-handoff-reserved',token);
const deadline=Date.now()+300000;let launched=false;
const timer=setInterval(()=>{let abort='';try{abort=fs.readFileSync('gogo-handoff-abort-'+token,'utf8')}catch{}
if(abort===token||(!launched&&Date.now()>deadline))process.exit(1);
let ready='';try{ready=fs.readFileSync('gogo-handoff-go','utf8')}catch{}
if(!launched&&ready===token){launched=true;process.argv=['node','gogo-handoff.js',token,url];require('./gogo-handoff.js')}},100);`
  await sandbox.runCommand({cmd:'flock',args:['-n','--close','gogo-handoff.lock','node','-e',launch,token,encoded],detached:true} as any)
  await new Promise(r=>setTimeout(r,500))
  const reservation=await sandbox.runCommand({cmd:'node',args:['-e',"const fs=require('fs');let value='';try{value=fs.readFileSync('gogo-handoff-reserved','utf8')}catch{};process.exit(value===process.argv[1]?0:1)",token]})
  if(reservation.exitCode!==0)throw new Error('browser_handoff_in_use')
  try{
  await ensureBrowserRuntime(sandbox)
  await sandbox.updateNetworkPolicy({allow:{[target.hostname]:[],[`*.${target.hostname}`]:[]}} as any)
  await sandbox.writeFiles([{path:'gogo-handoff-go',content:Buffer.from(token)}])
  await new Promise(r=>setTimeout(r,1500))
  const domain=typeof (sandbox as any).domain==='function' ? await (sandbox as any).domain(BROWSER_HANDOFF_PORT) : ''
  if(!domain)throw new Error('browser_handoff_domain_unavailable')
  const base=String(domain).startsWith('http')?String(domain):`https://${domain}`
  const q=encodeURIComponent(token)
  return {sandboxName:name,token,takeoverUrl:`${base}/?token=${q}`,stateUrl:`${base}/state?token=${q}`,agentActionUrl:`${base}/agent-action?token=${q}`,releaseUrl:`${base}/release?token=${q}`}
  }catch(error){
    await sandbox.writeFiles([{path:`gogo-handoff-abort-${token}`,content:Buffer.from(token)}]).catch(()=>{})
    throw error
  }
}
