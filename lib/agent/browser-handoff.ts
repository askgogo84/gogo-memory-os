import Anthropic from '@anthropic-ai/sdk'
import { randomBytes, createHash } from 'crypto'
import { Sandbox } from '@vercel/sandbox'
import { BROWSER_PROFILE_DIR, BROWSER_SETUP_NETWORK, SANDBOX_IMAGE, ensureBrowserRuntime } from './secure-browser-bootstrap'

export const BROWSER_HANDOFF_PORT = 3001
const SANDBOX_REGION = process.env.GOGO_SANDBOX_REGION || 'bom1'
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

export function browserSandboxName(userId:string){
  const digest=createHash('sha256').update(String(userId)).digest('hex').slice(0,24)
  return `gogo-browser-v2-${digest}`
}

export type HandoffState={url:string;title:string;text:string;links:Array<{text:string;href:string}>;forms:Array<{action:string;method:string;inputs:Array<{selector:string;name:string;type:string;label:string}>}>}
type AgentAction={kind:'goto'|'click'|'fill'|'select'|'check'|'wait';url?:string;selector?:string;value?:string;ms?:number}

export const HANDOFF_SERVER=String.raw`
const http=require('http');
const {URL}=require('url');
const {chromium}=require('playwright');
const fs=require('fs');
const profile='${BROWSER_PROFILE_DIR}';
const port=${BROWSER_HANDOFF_PORT};
const token=process.argv[2];
const initialUrl=Buffer.from(process.argv[3]||'', 'base64').toString('utf8');
let context,page;
function ok(res,code=200,type='application/json'){res.writeHead(code,{'content-type':type,'cache-control':'no-store'});return res}
function auth(req){try{const u=new URL(req.url,'http://x');return u.searchParams.get('token')===token||req.headers['x-gogo-handoff-token']===token}catch{return false}}
async function model(){return await page.evaluate(()=>{const clean=s=>String(s||'').replace(/\s+/g,' ').trim();const visible=el=>{try{const r=el.getBoundingClientRect();const s=getComputedStyle(el);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'}catch{return true}};const input=el=>{const id=el.id||'',name=el.getAttribute('name')||'',type=(el.getAttribute('type')||el.tagName||'').toLowerCase();const label=id?clean(document.querySelector('label[for="'+CSS.escape(id)+'"]')?.textContent||''):'';let selector='';if(id)selector='#'+CSS.escape(id);else if(name)selector=el.tagName.toLowerCase()+'[name="'+CSS.escape(name)+'"]';else selector=el.tagName.toLowerCase();return{selector,name,type,label:label||clean(el.getAttribute('aria-label')||el.getAttribute('placeholder')||'')}};return{url:location.href,title:document.title,text:clean(document.body?.innerText||'').slice(0,18000),links:Array.from(document.querySelectorAll('a[href]')).filter(visible).slice(0,100).map(a=>({text:clean(a.textContent).slice(0,180),href:a.href})),forms:Array.from(document.forms).filter(visible).slice(0,16).map(f=>({action:f.action||location.href,method:(f.method||'get').toLowerCase(),inputs:Array.from(f.querySelectorAll('input,textarea,select')).filter(visible).slice(0,60).map(input)}))}})}
async function isConsequential(selector){try{return await page.locator(selector).first().evaluate(el=>{const t=(el.getAttribute('type')||'').toLowerCase();const text=[el.textContent,el.getAttribute('aria-label'),el.getAttribute('title'),el.getAttribute('value'),el.getAttribute('name'),el.id].filter(Boolean).join(' ').replace(/\s+/g,' ').trim().toLowerCase();const safe=/\b(search|find|show|filter|apply filters|see results|view results|check availability|update results|go)\b/i.test(text);const bad=/\b(book|buy|purchase|checkout|pay|payment|reserve|reservation|place order|order now|apply|send application|check\s*-?\s*in|confirm(?:ation)?|complete purchase|finish purchase|finali[sz]e|submit)\b/i.test(text);if(safe&&!bad)return false;if(bad)return true;if(t==='submit'||(el.tagName==='BUTTON'&&t!=='button')||el.getAttribute('formaction')!==null)return true;return false})}catch{return true}}
(async()=>{
 context=await chromium.launchPersistentContext(profile,{headless:true,viewport:{width:1280,height:900}});
 page=context.pages()[0]||await context.newPage();
 if(initialUrl&&(!page.url().startsWith('http')||page.url()==='about:blank'))await page.goto(initialUrl,{waitUntil:'domcontentloaded',timeout:45000}).catch(()=>{});
 const server=http.createServer(async(req,res)=>{
  if(!auth(req))return ok(res,403).end(JSON.stringify({error:'forbidden'}));
  const u=new URL(req.url,'http://x');
  if(req.method==='GET'&&u.pathname==='/shot'){const png=await page.screenshot({type:'png'});ok(res,200,'image/png').end(png);return}
  if(req.method==='GET'&&u.pathname==='/state'){ok(res).end(JSON.stringify(await model()));return}
  if(req.method==='POST'&&u.pathname==='/action'){
   let body='';for await(const c of req)body+=c;let a={};try{a=JSON.parse(body)}catch{}
   if(a.kind==='click')await page.mouse.click(Number(a.x)||0,Number(a.y)||0);
   else if(a.kind==='type')await page.keyboard.type(String(a.text||'').slice(0,500));
   else if(a.kind==='press')await page.keyboard.press(String(a.key||'Enter').slice(0,40));
   else if(a.kind==='scroll')await page.mouse.wheel(0,Number(a.dy)||500);
   await page.waitForTimeout(350);ok(res).end(JSON.stringify(await model()));return
  }
  if(req.method==='POST'&&u.pathname==='/agent-action'){
   let body='';for await(const c of req)body+=c;let a={};try{a=JSON.parse(body)}catch{}
   try{
    if(a.kind==='goto'&&a.url)await page.goto(String(a.url),{waitUntil:'domcontentloaded',timeout:45000});
    else if(a.kind==='fill'&&a.selector)await page.locator(String(a.selector)).first().fill(String(a.value||''),{timeout:10000});
    else if(a.kind==='select'&&a.selector)await page.locator(String(a.selector)).first().selectOption(String(a.value||''),{timeout:10000});
    else if(a.kind==='check'&&a.selector)await page.locator(String(a.selector)).first().check({timeout:10000});
    else if(a.kind==='wait')await page.waitForTimeout(Math.min(5000,Math.max(100,Number(a.ms)||500)));
    else if(a.kind==='click'&&a.selector){if(await isConsequential(String(a.selector)))return ok(res,409).end(JSON.stringify({error:'consequential_control_blocked',state:await model()}));await page.locator(String(a.selector)).first().click({timeout:10000});}
    await page.waitForTimeout(500);ok(res).end(JSON.stringify({ok:true,state:await model()}));
   }catch(e){ok(res,422).end(JSON.stringify({error:String(e&&e.message||e),state:await model()}));}
   return
  }
  if(req.method==='POST'&&u.pathname==='/return'){fs.writeFileSync('/home/vercel-sandbox/handoff-returned.json',JSON.stringify({at:new Date().toISOString(),url:page.url()}));ok(res).end(JSON.stringify({ok:true,url:page.url()}));return}
  if(req.method==='POST'&&u.pathname==='/release'){const s=await model();await context.close();ok(res).end(JSON.stringify({ok:true,state:s}));setTimeout(()=>process.exit(0),100);return}
  if(req.method==='GET'&&u.pathname==='/'){
   const html='<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>AskGogo · Take control</title><style>body{font-family:system-ui;margin:0;background:#f7f4ee;color:#222}.bar{padding:12px 14px;background:white;position:sticky;top:0;z-index:2;box-shadow:0 1px 8px #0002}.stage{max-width:1100px;margin:auto;padding:10px}.browser{width:100%;border-radius:14px;box-shadow:0 2px 14px #0002;touch-action:manipulation}.controls{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}.controls input{flex:1;min-width:180px;padding:12px;border:1px solid #ccc;border-radius:10px}.controls button{padding:11px 14px;border:0;border-radius:10px;background:#222;color:white}.return{background:#16855b!important}</style><div class="bar"><b>AskGogo · Take control</b><div id="s">Same secure browser session. Complete only the human-required step, then return control.</div></div><div class="stage"><img id="screen" class="browser"><div class="controls"><input id="t" placeholder="Type into the focused field"><button onclick="typeText()">Type</button><button onclick="press(\"Enter\")">Enter</button><button onclick="scrollByY(600)">Scroll ↓</button><button onclick="scrollByY(-600)">Scroll ↑</button><button class="return" onclick="giveBack()">Return control to Gogo</button></div></div><script>const tok=new URLSearchParams(location.search).get("token");const sc=document.getElementById("screen");function refresh(){sc.src="/shot?token="+encodeURIComponent(tok)+"&t="+Date.now()}setInterval(refresh,1200);refresh();sc.onclick=async e=>{const r=sc.getBoundingClientRect();const x=(e.clientX-r.left)*1280/r.width,y=(e.clientY-r.top)*900/r.height;await act({kind:"click",x,y});refresh()};async function act(a){await fetch("/action?token="+encodeURIComponent(tok),{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(a)})}async function typeText(){const el=document.getElementById("t");await act({kind:"type",text:el.value});el.value="";refresh()}async function press(key){await act({kind:"press",key});refresh()}async function scrollByY(dy){await act({kind:"scroll",dy});refresh()}async function giveBack(){await fetch("/return?token="+encodeURIComponent(tok),{method:"POST"});document.getElementById("s").textContent="Control returned. Go back to WhatsApp and send CONTINUE."}</script>';
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
  await new Promise(r=>setTimeout(r,1500))
  const domain=typeof (sandbox as any).domain==='function' ? await (sandbox as any).domain(BROWSER_HANDOFF_PORT) : ''
  if(!domain)throw new Error('browser_handoff_domain_unavailable')
  const base=String(domain).startsWith('http')?String(domain):`https://${domain}`
  const q=encodeURIComponent(token)
  return {sandboxName:name,token,takeoverUrl:`${base}/?token=${q}`,stateUrl:`${base}/state?token=${q}`,agentActionUrl:`${base}/agent-action?token=${q}`,releaseUrl:`${base}/release?token=${q}`}
}

export async function readBrowserHandoffState(stateUrl:string){
  const res=await fetch(stateUrl,{cache:'no-store'});if(!res.ok)throw new Error(`browser_handoff_state_failed:${res.status}`);return await res.json() as HandoffState
}

function parseJsonArray(text:string){const clean=String(text||'').replace(/```json|```/g,'').trim();try{const v=JSON.parse(clean);return Array.isArray(v)?v:[]}catch{}const m=clean.match(/\[[\s\S]*\]/);if(!m)return[];try{const v=JSON.parse(m[0]);return Array.isArray(v)?v:[]}catch{return[]}}

async function planSafeActions(objective:string,state:HandoffState):Promise<AgentAction[]>{
  const prompt=`You are Gogo's browser research planner resuming after a human handoff. Produce JSON array only. Goal: ${JSON.stringify(objective.slice(0,1600))}. Current page: ${JSON.stringify({url:state.url,title:state.title,text:state.text.slice(0,10000),links:state.links.slice(0,60),forms:state.forms.slice(0,12)})}. Allowed actions: goto, click, fill, select, check, wait. Continue safe research only. Never book, buy, reserve, submit passenger/payment data, authenticate, solve CAPTCHA, or trigger a consequential action. Use selectors already present for form fields. Maximum 10 actions.`
  try{const res=await anthropic.messages.create({model:'claude-haiku-4-5',max_tokens:1400,temperature:0,messages:[{role:'user',content:prompt}]});const raw=res.content[0]?.type==='text'?res.content[0].text:'';return parseJsonArray(raw).slice(0,10).map((a:any)=>({kind:String(a.kind||'') as AgentAction['kind'],url:a.url?String(a.url).slice(0,1000):undefined,selector:a.selector?String(a.selector).slice(0,300):undefined,value:a.value?String(a.value).slice(0,1000):undefined,ms:Number(a.ms)||undefined})).filter((a:any)=>['goto','click','fill','select','check','wait'].includes(a.kind))}catch{return[]}
}

export async function continueBrowserHandoffResearch(params:{stateUrl:string;agentActionUrl:string;objective:string;waves?:number}){
  let state=await readBrowserHandoffState(params.stateUrl)
  for(let wave=0;wave<Math.max(1,Math.min(4,params.waves||3));wave++){
    const actions=await planSafeActions(params.objective,state);if(!actions.length)break
    let progressed=false
    for(const action of actions){const res=await fetch(params.agentActionUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(action),cache:'no-store'});const body=await res.json().catch(()=>null);if(res.status===409)return{state:(body?.state||state) as HandoffState,blocked:'consequential_control' as const};if(res.ok&&body?.state){state=body.state as HandoffState;progressed=true}}
    if(!progressed)break
  }
  return{state,blocked:null as null}
}

export async function releaseBrowserHandoff(releaseUrl:string){
  const res=await fetch(releaseUrl,{method:'POST',cache:'no-store'});if(!res.ok)throw new Error(`browser_handoff_release_failed:${res.status}`);return await res.json()
}
