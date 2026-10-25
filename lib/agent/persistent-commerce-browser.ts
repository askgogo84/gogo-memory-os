import {createHash} from 'node:crypto'
import {BROWSER_PROFILE_DIR, SANDBOX_WORKDIR} from './secure-browser-bootstrap'
import {resolveBrowserProxy} from './browser-proxy'

// Private loopback only: CDP is NEVER a public sandbox port or a dashboard URL.
export const COMMERCE_CDP_URL='http://127.0.0.1:9222'
export const COMMERCE_BROWSER_DAEMON=String.raw`
const {chromium}=require('playwright');
const fs=require('fs');
(async()=>{
 const server=process.env.GOGO_BROWSER_PROXY_URL||'';
 const proxy=server?{server,username:process.env.GOGO_BROWSER_PROXY_USERNAME||undefined,password:process.env.GOGO_BROWSER_PROXY_PASSWORD||undefined}:undefined;
 const context=await chromium.launchPersistentContext('${BROWSER_PROFILE_DIR}',{headless:true,viewport:{width:1280,height:900},args:['--disable-http2','--remote-debugging-address=127.0.0.1','--remote-debugging-port=9222'],...(proxy?{proxy}:{})});
 // A fresh process cannot promise the previous live DOM survived an idle expiry.
 fs.writeFileSync('${SANDBOX_WORKDIR}/commerce-active-task','');
 fs.writeFileSync('${SANDBOX_WORKDIR}/commerce-browser-config',process.env.GOGO_BROWSER_CONFIG_ID||'');
 context.on('close',()=>process.exit(0));
 process.on('SIGTERM',async()=>{await context.close();process.exit(0)});
})().catch(()=>{console.error('commerce_browser_daemon_failed');process.exit(1)});
`

export async function ensurePersistentCommerceBrowser(sandbox:any,url:string){
  const proxy=resolveBrowserProxy(url)
  const fingerprint=createHash('sha256').update(JSON.stringify(proxy)).digest('hex')
  const probe=String.raw`(async()=>{try{const r=await fetch('${COMMERCE_CDP_URL}/json/version',{signal:AbortSignal.timeout(1500)});if(!r.ok)process.exit(1);const fs=require('fs');process.exit(fs.readFileSync('${SANDBOX_WORKDIR}/commerce-browser-config','utf8')===process.argv[1]?0:2)}catch{process.exit(1)}})()`
  const check=()=>sandbox.runCommand({cmd:'node',args:['-e',probe,fingerprint]})
  const current=await check()
  if(current.exitCode===0)return
  if(current.exitCode===2)throw new Error('commerce_browser_egress_changed')
  await sandbox.writeFiles([{path:`${SANDBOX_WORKDIR}/commerce-browser-daemon.cjs`,content:Buffer.from(COMMERCE_BROWSER_DAEMON)}])
  await sandbox.runCommand({cmd:'flock',args:['-n','--close',`${SANDBOX_WORKDIR}/commerce-browser-daemon.lock`,'node',`${SANDBOX_WORKDIR}/commerce-browser-daemon.cjs`],detached:true,
    env:{GOGO_BROWSER_CONFIG_ID:fingerprint,...(proxy?{GOGO_BROWSER_PROXY_URL:proxy.server,GOGO_BROWSER_PROXY_USERNAME:proxy.username||'',GOGO_BROWSER_PROXY_PASSWORD:proxy.password||''}:{})}})
  for(let attempt=0;attempt<30;attempt++){
    await new Promise(resolve=>setTimeout(resolve,250))
    if((await check()).exitCode===0)return
  }
  throw new Error('commerce_browser_not_ready')
}
