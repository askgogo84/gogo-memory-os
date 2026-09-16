import { randomBytes } from 'crypto'
import { Sandbox } from '@vercel/sandbox'
import { BROWSER_PROFILE_DIR, BROWSER_SETUP_NETWORK, SANDBOX_IMAGE, ensureBrowserRuntime } from './secure-browser-bootstrap'

export const BROWSER_HANDOFF_PORT = 3001
const SANDBOX_REGION = process.env.GOGO_SANDBOX_REGION || 'bom1'

export function browserSandboxName(userId:string){
  const { createHash } = require('crypto') as typeof import('crypto')
  const digest=createHash('sha256').update(String(userId)).digest('hex').slice(0,24)
  return `gogo-browser-v2-${digest}`
}

export const HANDOFF_SERVER=String.raw`
const http=require('http');
const {URL}=require('url');
const {chromium}=require('playwright');
const profile='${BROWSER_PROFILE_DIR}';
const port=${BROWSER_HANDOFF_PORT};
const token=process.argv[2];
const initialUrl=Buffer.from(process.argv[3]||'', 'base64').toString('utf8');
const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
let context,page;
function ok(res,code=200,type='application/json'){res.writeHead(code,{'content-type':type,'cache-control':'no-store'});return res}
function auth(req){try{const u=new URL(req.url,'http://x');return u.searchParams.get('token')===token||req.headers['x-gogo-handoff-token']===token}catch{return false}}
async function state(){return {url:page.url(),title:await page.title(),text:clean(await page.locator('body').innerText().catch(()=>'' )).slice(0,18000)}}
(async()=>{
 context=await chromium.launchPersistentContext(profile,{headless:true,viewport:{width:1280,height:900}});
 page=context.pages()[0]||await context.newPage();
 if(initialUrl&&!page.url().startsWith('http'))await page.goto(initialUrl,{waitUntil:'domcontentloaded',timeout:45000}).catch(()=>{});
 const server=http.createServer(async(req,res)=>{
  if(!auth(req))return ok(res,403).end(JSON.stringify({error:'forbidden'}));
  const u=new URL(req.url,'http://x');
  if(req.method==='GET'&&u.pathname==='/shot'){const png=await page.screenshot({type:'png'});ok(res,200,'image/png').end(png);return}
  if(req.method==='GET'&&u.pathname==='/state'){ok(res).end(JSON.stringify(await state()));return}
  if(req.method==='POST'&&u.pathname==='/action'){
   let body='';for await(const c of req)body+=c;let a={};try{a=JSON.parse(body)}catch{}
   if(a.kind==='click')await page.mouse.click(Number(a.x)||0,Number(a.y)||0);
   else if(a.kind==='type')await page.keyboard.type(String(a.text||'').slice(0,500));
   else if(a.kind==='press')await page.keyboard.press(String(a.key||'Enter').slice(0,40));
   else if(a.kind==='scroll')await page.mouse.wheel(0,Number(a.dy)||500);
   await page.waitForTimeout(350);ok(res).end(JSON.stringify(await state()));return
  }
  if(req.method==='POST'&&u.pathname==='/return'){require('fs').writeFileSync('/home/vercel-sandbox/handoff-returned.json',JSON.stringify({at:new Date().toISOString(),url:page.url()}));ok(res).end(JSON.stringify({ok:true,url:page.url()}));return}
  if(req.method==='POST'&&u.pathname==='/release'){const s=await state();await context.close();ok(res).end(JSON.stringify({ok:true,state:s}));setTimeout(()=>process.exit(0),100);return}
  if(req.method==='GET'&&u.pathname==='/'){
   const html=`<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><title>AskGogo · Take control</title><style>body{font-family:system-ui;margin:0;background:#f7f4ee;color:#222}.bar{padding:12px 14px;background:white;position:sticky;top:0;z-index:2;box-shadow:0 1px 8px #0002}.stage{max-width:1100px;margin:auto;padding:10px}.browser{width:100%;border-radius:14px;box-shadow:0 2px 14px #0002;touch-action:manipulation}.controls{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}.controls input{flex:1;min-width:180px;padding:12px;border:1px solid #ccc;border-radius:10px}.controls button{padding:11px 14px;border:0;border-radius:10px;background:#222;color:white}.return{background:#16855b!important}</style><div class=bar><b>AskGogo · Take control</b><div id=s>Same secure browser session. Complete the human-only step, then return control.</div></div><div class=stage><img id=screen class=browser><div class=controls><input id=t placeholder="Type into the focused field"><button onclick="typeText()">Type</button><button onclick="press('Enter')">Enter</button><button onclick="scrollByY(600)">Scroll ↓</button><button onclick="scrollByY(-600)">Scroll ↑</button><button class=return onclick="giveBack()">Return control to Gogo</button></div></div><script>const tok=${JSON.stringify(token)};const sc=document.getElementById('screen');function refresh(){sc.src='/shot?token='+encodeURIComponent(tok)+'&t='+Date.now()}setInterval(refresh,1200);refresh();sc.onclick=async e=>{const r=sc.getBoundingClientRect();const x=(e.clientX-r.left)*1280/r.width,y=(e.clientY-r.top)*900/r.height;await act({kind:'click',x,y});refresh()};async function act(a){await fetch('/action?token='+encodeURIComponent(tok),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(a)})}async function typeText(){const el=document.getElementById('t');await act({kind:'type',text:el.value});el.value='';refresh()}async function press(key){await act({kind:'press',key});refresh()}async function scrollByY(dy){await act({kind:'scroll',dy});refresh()}async function giveBack(){await fetch('/return?token='+encodeURIComponent(tok),{method:'POST'});document.getElementById('s').textContent='Control returned. Go back to WhatsApp and send CONTINUE.'}</script>`;
   ok(res,200,'text/html; charset=utf-8').end(html);return
  }
  ok(res,404).end(JSON.stringify({error:'not_found'}));
 });
 server.listen(port,'0.0.0.0');
})().catch(e=>{console.error(e&&e.stack||e);process.exit(1)});
`

export async function getPersistentBrowserSandbox(userId:string){
  const name=browserSandboxName(userId)
  const sandbox=await Sandbox.getOrCreate({name,image:SANDBOX_IMAGE,region:SANDBOX_REGION,timeout:20*60*1000,persistent:true,ports:[BROWSER_HANDOFF_PORT],resources:{vcpus:1},networkPolicy:BROWSER_SETUP_NETWORK} as any)
  await ensureBrowserRuntime(sandbox)
  return {sandbox,name}
}

export async function startBrowserHandoff(params:{userId:string;url:string}){
  const {sandbox,name}=await getPersistentBrowserSandbox(params.userId)
  await sandbox.writeFiles([{path:'gogo-handoff.js',content:Buffer.from(HANDOFF_SERVER)}])
  const token=randomBytes(24).toString('base64url')
  const encoded=Buffer.from(params.url).toString('base64')
  await sandbox.runCommand({cmd:'bash',args:['-lc',`pkill -f 'gogo-handoff.js' >/dev/null 2>&1 || true; nohup node gogo-handoff.js ${token} ${encoded} >/home/vercel-sandbox/gogo-handoff.log 2>&1 & echo started`]})
  await new Promise(r=>setTimeout(r,1200))
  const domain=typeof (sandbox as any).domain==='function' ? await (sandbox as any).domain(BROWSER_HANDOFF_PORT) : ''
  if(!domain)throw new Error('browser_handoff_domain_unavailable')
  const base=String(domain).startsWith('http')?String(domain):`https://${domain}`
  return {sandboxName:name,token,takeoverUrl:`${base}/?token=${encodeURIComponent(token)}`,stateUrl:`${base}/state?token=${encodeURIComponent(token)}`,releaseUrl:`${base}/release?token=${encodeURIComponent(token)}`}
}

export async function readBrowserHandoffState(stateUrl:string){
  const res=await fetch(stateUrl,{cache:'no-store'});if(!res.ok)throw new Error(`browser_handoff_state_failed:${res.status}`);return await res.json() as {url:string;title:string;text:string}
}

export async function releaseBrowserHandoff(releaseUrl:string){
  const res=await fetch(releaseUrl,{method:'POST',cache:'no-store'});if(!res.ok)throw new Error(`browser_handoff_release_failed:${res.status}`);return await res.json()
}
