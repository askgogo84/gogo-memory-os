import { randomBytes } from 'crypto'
import { BROWSER_HANDOFF_PORT, HANDOFF_SERVER, getPersistentBrowserSandbox } from './browser-handoff'

export async function startProviderBrowserHandoff(params:{userId:string;url:string}){
  const target=new URL(params.url)
  const {sandbox,name}=await getPersistentBrowserSandbox(params.userId)
  await sandbox.updateNetworkPolicy({allow:{[target.hostname]:[],[`*.${target.hostname}`]:[]}} as any)
  await sandbox.writeFiles([{path:'gogo-handoff.js',content:Buffer.from(HANDOFF_SERVER)}])
  const token=randomBytes(24).toString('base64url')
  const encoded=Buffer.from(params.url).toString('base64')
    // The takeover server must OUTLIVE this call. A non-detached runCommand has its
  // whole process group reaped when it returns, so `nohup ... &` died with SIGTERM
  // (exit 143) before it could bind the port - the takeover URL then returned
  // 502 SANDBOX_NOT_LISTENING. detached:true is the SDK's supported long-running mode.
  await sandbox.runCommand({cmd:'bash',args:['-lc',`pkill -f 'gogo-handoff.js' >/dev/null 2>&1 || true`]}).catch(()=>{})
  await sandbox.runCommand({cmd:'node',args:['gogo-handoff.js',token,encoded],detached:true} as any)
  await new Promise(r=>setTimeout(r,1500))
  const domain=typeof (sandbox as any).domain==='function' ? await (sandbox as any).domain(BROWSER_HANDOFF_PORT) : ''
  if(!domain)throw new Error('browser_handoff_domain_unavailable')
  const base=String(domain).startsWith('http')?String(domain):`https://${domain}`
  const q=encodeURIComponent(token)
  return {sandboxName:name,token,takeoverUrl:`${base}/?token=${q}`,stateUrl:`${base}/state?token=${q}`,agentActionUrl:`${base}/agent-action?token=${q}`,releaseUrl:`${base}/release?token=${q}`}
}
