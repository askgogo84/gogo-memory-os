import Anthropic from '@anthropic-ai/sdk'
import { createHash } from 'crypto'
import { Sandbox } from '@vercel/sandbox'
import { redactSecretShapedText } from '@/lib/bot/memory-redaction'
import { detectHumanAuthGate } from './browser-auth-gate'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
const PLAYWRIGHT_VERSION = '1.63.0'
const MAX_ACTIONS = 12
const SANDBOX_REGION = process.env.GOGO_SANDBOX_REGION || 'bom1'

export type BrowserMode = 'read' | 'draft' | 'execute'

type BrowserAction =
  | { kind:'goto'; url:string }
  | { kind:'click'; selector:string }
  | { kind:'fill'; selector:string; value:string }
  | { kind:'select'; selector:string; value:string }
  | { kind:'check'; selector:string }
  | { kind:'wait'; ms:number }
  | { kind:'submit'; selector:string }

export type SecureBrowserResult = {
  status:'completed'|'prepared'|'blocked'|'failed'
  url:string
  title:string
  summary:string
  pageText:string
  forms:Array<{action:string;method:string;inputs:Array<{selector:string;name:string;type:string;label:string}>}>
  actions:Array<{kind:string;detail:string;status:'done'|'skipped'|'failed'}>
  sandboxName:string
  blockReason?: 'human_auth_required'
  authReason?: 'password'|'otp'|'passkey'|'captcha'|'payment_auth'
}

function safeText(value:unknown,max=1200){
  return redactSecretShapedText(String(value??'').replace(/\s+/g,' ').trim().slice(0,max))
}

function userSandboxName(userId:string){
  const digest=createHash('sha256').update(String(userId)).digest('hex').slice(0,24)
  return `gogo-browser-${digest}`
}

function allowedHosts(url:string){
  const u=new URL(url)
  if(u.protocol!=='https:'&&u.protocol!=='http:')throw new Error('browser_url_not_http')
  const hostname=u.hostname.toLowerCase()
  if(!hostname||hostname==='localhost'||hostname.endsWith('.local'))throw new Error('browser_private_host_blocked')
  return {hostname,allow:{[hostname]:[],[`*.${hostname}`]:[]}}
}

const BROWSER_SCRIPT=String.raw`
const { chromium } = require('playwright');
const payload = JSON.parse(Buffer.from(process.argv[2], 'base64').toString('utf8'));
const profile = '/vercel/sandbox/browser-profile';
const clean = s => String(s||'').replace(/\s+/g,' ').trim();
async function model(page){
  return await page.evaluate(() => {
    const clean = s => String(s||'').replace(/\s+/g,' ').trim();
    const visible = el => {
      try { const r=el.getBoundingClientRect(); const s=getComputedStyle(el); return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'; } catch { return true; }
    };
    const inputs = el => {
      const id=el.id||''; const name=el.getAttribute('name')||''; const type=(el.getAttribute('type')||el.tagName||'').toLowerCase();
      const label=id ? clean(document.querySelector('label[for="'+CSS.escape(id)+'"]')?.textContent||'') : '';
      let selector='';
      if(id) selector='#'+CSS.escape(id); else if(name) selector=el.tagName.toLowerCase()+'[name="'+CSS.escape(name)+'"]';
      else selector=el.tagName.toLowerCase();
      return {selector,name,type,label:label||clean(el.getAttribute('aria-label')||el.getAttribute('placeholder')||'')};
    };
    return {
      url:location.href,title:document.title,
      text:clean(document.body?.innerText||'').slice(0,18000),
      links:Array.from(document.querySelectorAll('a[href]')).filter(visible).slice(0,80).map(a=>({text:clean(a.textContent).slice(0,160),href:a.href})),
      forms:Array.from(document.forms).filter(visible).slice(0,12).map(f=>({
        action:f.action||location.href,method:(f.method||'get').toLowerCase(),
        inputs:Array.from(f.querySelectorAll('input,textarea,select')).filter(visible).slice(0,50).map(inputs)
      }))
    };
  });
}
async function isSubmit(page,selector){
  try{return await page.locator(selector).first().evaluate(el=>{
    const t=(el.getAttribute('type')||'').toLowerCase();
    return t==='submit'||(el.tagName==='BUTTON'&&t!=='button')||el.getAttribute('formaction')!==null;
  });}catch{return false;}
}
(async()=>{
  const context=await chromium.launchPersistentContext(profile,{headless:true,viewport:{width:1280,height:900}});
  const page=context.pages()[0]||await context.newPage();
  const log=[];
  try{
    await page.goto(payload.url,{waitUntil:'domcontentloaded',timeout:45000});
    await page.waitForTimeout(900);
    for(const a of (payload.actions||[])){
      try{
        if(a.kind==='goto') await page.goto(a.url,{waitUntil:'domcontentloaded',timeout:45000});
        else if(a.kind==='fill') await page.locator(a.selector).first().fill(a.value,{timeout:12000});
        else if(a.kind==='select') await page.locator(a.selector).first().selectOption(a.value,{timeout:12000});
        else if(a.kind==='check') await page.locator(a.selector).first().check({timeout:12000});
        else if(a.kind==='wait') await page.waitForTimeout(Math.min(5000,Math.max(100,Number(a.ms)||500));
        else if(a.kind==='click'){
          if(payload.mode!=='execute' && await isSubmit(page,a.selector)){log.push({kind:a.kind,detail:a.selector,status:'skipped'});continue;}
          await page.locator(a.selector).first().click({timeout:12000});
        } else if(a.kind==='submit'){
          if(payload.mode!=='execute'){log.push({kind:a.kind,detail:a.selector,status:'skipped'});continue;}
          await page.locator(a.selector).first().click({timeout:12000});
        }
        log.push({kind:a.kind,detail:a.selector||a.url||String(a.ms||''),status:'done'});
        await page.waitForTimeout(500);
      }catch(e){log.push({kind:a.kind,detail:a.selector||a.url||'',status:'failed'});}
    }
    const out=await model(page); out.actions=log; console.log(JSON.stringify(out));
  } finally { await context.close(); }
})().catch(e=>{console.error(String(e&&e.stack||e));process.exit(1)});
`

async function getComputer(userId:string,targetUrl:string){
  const name=userSandboxName(userId)
  const setupPolicy={allow:{
    'registry.npmjs.org':[], '*.npmjs.org':[], 'cdn.playwright.dev':[], '*.playwright.dev':[],
    'playwright.azureedge.net':[], '*.azureedge.net':[],
  }} as any
  const sandbox=await Sandbox.getOrCreate({
    name, runtime:'node24', region:SANDBOX_REGION, timeout:20*60*1000, persistent:true,
    resources:{vcpus:1}, networkPolicy:setupPolicy,
  } as any)
  const check=await sandbox.runCommand('bash',['-lc',`test -f node_modules/playwright/package.json && echo ready || echo missing`])
  const state=(await check.stdout()).trim()
  if(state!=='ready'){
    const install=await sandbox.runCommand('bash',['-lc',`npm init -y >/dev/null 2>&1 || true; npm install --no-audit --no-fund playwright@${PLAYWRIGHT_VERSION} && npx playwright install --with-deps chromium`])
    if(install.exitCode!==0)throw new Error(`secure_browser_bootstrap_failed:${safeText(await install.stderr(),500)}`)
  }
  await sandbox.writeFiles([{path:'gogo-browser.js',stream:Buffer.from(BROWSER_SCRIPT)}])
  const {allow}=allowedHosts(targetUrl)
  await sandbox.updateNetworkPolicy({allow} as any)
  return {sandbox,name}
}

function parseJsonLoose(text:string){
  const clean=String(text||'').replace(/```json|```/g,'').trim()
  try{return JSON.parse(clean)}catch{}
  const m=clean.match(/\[[\s\S]*\]/)
  if(!m)return []
  try{return JSON.parse(m[0])}catch{return []}
}

function normalizeActions(raw:any,initialUrl:string):BrowserAction[]{
  if(!Array.isArray(raw))return []
  const out:BrowserAction[]=[]
  for(const item of raw.slice(0,MAX_ACTIONS)){
    const kind=String(item?.kind||'')
    if(kind==='goto'){
      try{const u=new URL(String(item.url||''),initialUrl); if(['http:','https:'].includes(u.protocol))out.push({kind:'goto',url:u.toString()})}catch{}
    }else if(['click','check','submit'].includes(kind)){
      const selector=String(item.selector||'').trim().slice(0,300);if(selector)out.push({kind,selector} as BrowserAction)
    }else if(kind==='fill'||kind==='select'){
      const selector=String(item.selector||'').trim().slice(0,300);const value=String(item.value||'').slice(0,1200)
      if(selector)out.push({kind,selector,value} as BrowserAction)
    }else if(kind==='wait')out.push({kind:'wait',ms:Math.min(5000,Math.max(100,Number(item.ms)||500))})
  }
  return out
}

async function inspect(userId:string,url:string){
  const {sandbox,name}=await getComputer(userId,url)
  const payload=Buffer.from(JSON.stringify({url,mode:'read',actions:[]})).toString('base64')
  const result=await sandbox.runCommand('node',['gogo-browser.js',payload])
  if(result.exitCode!==0)throw new Error(`secure_browser_read_failed:${safeText(await result.stderr(),700)}`)
  const stdout=await result.stdout();const lines=stdout.trim().split('\n');const parsed=JSON.parse(lines[lines.length-1])
  return {sandbox,name,page:parsed}
}

async function planActions(objective:string,page:any,mode:BrowserMode):Promise<BrowserAction[]>{
  if(mode==='read')return []
  const pageModel={url:page.url,title:page.title,text:String(page.text||'').slice(0,9000),links:(page.links||[]).slice(0,50),forms:(page.forms||[]).slice(0,10)}
  const prompt=`You are Gogo's browser action planner. Produce JSON array only. Goal: ${JSON.stringify(objective.slice(0,1600))}\nMode: ${mode}.\nCurrent page model: ${JSON.stringify(pageModel)}\nAllowed action kinds: goto, click, fill, select, check, wait, submit. Use selectors already present for form fields. Never invent passwords, OTPs, card numbers or secret values. Never use submit unless the user's goal explicitly asks to submit/send/apply/book and mode is execute. In draft mode, fill fields and navigate but leave the final submit untouched. Maximum ${MAX_ACTIONS} actions.`
  try{
    const res=await anthropic.messages.create({model:'claude-haiku-4-5',max_tokens:1400,temperature:0,messages:[{role:'user',content:prompt}]})
    const text=res.content[0]?.type==='text'?res.content[0].text:''
    return normalizeActions(parseJsonLoose(text),page.url)
  }catch(err:any){console.error('SECURE_BROWSER_PLAN_FAILED:',err?.message||err);return []}
}

export async function runSecureBrowser(params:{userId:string;url:string;objective:string;mode:BrowserMode}):Promise<SecureBrowserResult>{
  const target=new URL(params.url)
  if(!['http:','https:'].includes(target.protocol))throw new Error('browser_url_not_http')
  const first=await inspect(params.userId,target.toString())

  // Passwords, OTPs, passkeys, CAPTCHAs and payment authentication are human
  // boundaries. Stop before the model plans any fill/click actions. The persistent
  // browser profile remains in the user's sandbox for future secure takeover.
  const authGate=detectHumanAuthGate(first.page)
  if(authGate.required){
    await first.sandbox.stop().catch(()=>{})
    return {
      status:'blocked',url:String(first.page.url||target),title:safeText(first.page.title,300),
      summary:authGate.message||'Human authentication is required before Gogo can continue.',
      pageText:'Gogo paused before authentication. No password, OTP, passkey or payment-auth value was requested, inferred or stored.',
      forms:[],actions:[],sandboxName:first.name,blockReason:'human_auth_required',authReason:authGate.reason,
    }
  }

  const actions=await planActions(params.objective,first.page,params.mode)
  let page=first.page
  let actionLog:any[]=[]
  if(actions.length){
    const {allow}=allowedHosts(target.toString());await first.sandbox.updateNetworkPolicy({allow} as any)
    const payload=Buffer.from(JSON.stringify({url:target.toString(),mode:params.mode,actions})).toString('base64')
    const result=await first.sandbox.runCommand('node',['gogo-browser.js',payload])
    if(result.exitCode!==0)throw new Error(`secure_browser_action_failed:${safeText(await result.stderr(),700)}`)
    const stdout=await result.stdout();const lines=stdout.trim().split('\n');page=JSON.parse(lines[lines.length-1]);actionLog=page.actions||[]
  }
  await first.sandbox.stop().catch(()=>{})
  const prepared=params.mode==='draft' && actions.some(a=>a.kind==='submit')
  return {
    status:prepared?'prepared':'completed',url:String(page.url||target),title:safeText(page.title,300),
    summary:params.mode==='read'?'Gogo read the page in an isolated browser.':prepared?'Gogo prepared the browser flow and stopped before submit.':'Gogo completed the approved browser flow.',
    pageText:safeText(page.text,6000),forms:Array.isArray(page.forms)?page.forms.slice(0,12):[],
    actions:actionLog.map((a:any)=>({kind:String(a.kind||''),detail:safeText(a.detail,300),status:['done','skipped','failed'].includes(a.status)?a.status:'failed'})),
    sandboxName:first.name,
  }
}
