import Anthropic from '@anthropic-ai/sdk'
import { Sandbox } from '@vercel/sandbox'
import { redactBrowserSensitiveText } from './secure-browser-redaction'
import { detectHumanAuthGate } from './browser-auth-gate'
import { recordVaultBrowserOutcome, resolveVaultCredentialForBrowser } from '@/lib/vault/credential-store'
import { upsertVaultSession } from '@/lib/vault/session-store'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { BROWSER_PORTS, BROWSER_PROFILE_DIR, BROWSER_SETUP_NETWORK, SANDBOX_GENERATION, SANDBOX_IMAGE, SANDBOX_WORKDIR, browserSandboxNameFor, ensureBrowserRuntime } from './secure-browser-bootstrap'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
const MAX_ACTIONS = 12
const MAX_RESEARCH_WAVES = 4
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
  blockReason?: 'human_auth_required'|'provider_access_limited'
  authReason?: 'password'|'otp'|'passkey'|'captcha'|'payment_auth'
  credentialSelectionRequired?: boolean
}

function safeText(value:unknown,max=1200){
  const normalized=String(value??'').replace(/\s+/g,' ').trim()
  return redactBrowserSensitiveText(normalized).slice(0,max)
}

const userSandboxName=browserSandboxNameFor

async function canonicalBrowserOwnerId(value:string){
  const raw=String(value||'').trim()
  if(!raw)throw new Error('browser_owner_missing')
  if(!/^-?\d+$/.test(raw))return raw
  const {data,error}=await supabaseAdmin.from('users').select('id').eq('telegram_id',Number(raw)).maybeSingle()
  if(error)throw new Error(`browser_owner_lookup_failed:${error.message}`)
  return data?.id?String(data.id):raw
}

function allowedHosts(url:string){
  const u=new URL(url)
  if(u.protocol!=='https:'&&u.protocol!=='http:')throw new Error('browser_url_not_http')
  const hostname=u.hostname.toLowerCase()
  if(!hostname||hostname==='localhost'||hostname.endsWith('.local'))throw new Error('browser_private_host_blocked')
  return {hostname,allow:{[hostname]:[],[`*.${hostname}`]:[]}}
}

const VAULT_LOGIN_SCRIPT=String.raw`
const { chromium } = require('playwright');
const profile = '${BROWSER_PROFILE_DIR}';
const url = process.env.GOGO_LOGIN_URL || '';
const username = process.env.GOGO_VAULT_USERNAME || '';
const secret = process.env.GOGO_VAULT_SECRET || '';
if (!url || !username || !secret) throw new Error('missing_vault_login_inputs');

const clean = s => String(s||'').replace(/\s+/g,' ').trim();
const visible = async loc => { try { return await loc.isVisible(); } catch { return false; } };
async function firstVisible(page, selectors){
  for (const selector of selectors){
    const loc=page.locator(selector).first();
    if(await visible(loc)) return loc;
  }
  return null;
}
async function model(page){
  return await page.evaluate(() => {
    const clean = s => String(s||'').replace(/\s+/g,' ').trim();
    const visible = el => { try { const r=el.getBoundingClientRect(); const s=getComputedStyle(el); return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'; } catch { return true; } };
    const inputs = el => {
      const id=el.id||''; const name=el.getAttribute('name')||''; const type=(el.getAttribute('type')||el.tagName||'').toLowerCase();
      const label=id ? clean(document.querySelector('label[for="'+CSS.escape(id)+'"]')?.textContent||'') : '';
      let selector='';
      if(id) selector='#'+CSS.escape(id); else if(name) selector=el.tagName.toLowerCase()+'[name="'+CSS.escape(name)+'"]'; else selector=el.tagName.toLowerCase();
      return {selector,name,type,label:label||clean(el.getAttribute('aria-label')||el.getAttribute('placeholder')||'')};
    };
    return {
      url:location.href,title:document.title,text:clean(document.body?.innerText||'').slice(0,18000),
      forms:Array.from(document.forms).filter(visible).slice(0,16).map(f=>({
        action:f.action||location.href,method:(f.method||'get').toLowerCase(),
        inputs:Array.from(f.querySelectorAll('input,textarea,select')).filter(visible).slice(0,60).map(inputs)
      }))
    };
  });
}

(async()=>{
  const context=await chromium.launchPersistentContext(profile,{headless:true,viewport:{width:1280,height:900},args:['--disable-http2']});
  const page=context.pages()[0]||await context.newPage();
  let usernameFilled=false,passwordFilled=false,submitted=false;
  try{
    await page.goto(url,{waitUntil:'domcontentloaded',timeout:45000});
    await page.waitForTimeout(800);
    const user=await firstVisible(page,[
      'input[autocomplete="username"]','input[type="email"]','input[name*="user" i]',
      'input[name*="email" i]','input[name*="login" i]','input[type="tel"]'
    ]);
    if(user){ await user.fill(username,{timeout:10000}); usernameFilled=true; }
    let pass=await firstVisible(page,['input[autocomplete="current-password"]','input[type="password"]']);
    if(!pass && usernameFilled){
      const next=await firstVisible(page,[
        'button:has-text("Continue")','button:has-text("Next")','button:has-text("Sign in")',
        'button:has-text("Log in")','button[type="submit"]','input[type="submit"]'
      ]);
      if(next){ await next.click({timeout:10000}); submitted=true; await page.waitForTimeout(1200); }
      pass=await firstVisible(page,['input[autocomplete="current-password"]','input[type="password"]']);
    }
    if(pass){
      await pass.fill(secret,{timeout:10000}); passwordFilled=true;
      const submit=await firstVisible(page,[
        'button:has-text("Log in")','button:has-text("Sign in")','button:has-text("Login")',
        'button[type="submit"]','input[type="submit"]'
      ]);
      if(submit){ await submit.click({timeout:10000}); submitted=true; await page.waitForTimeout(1800); }
    }
    const out=await model(page);
    out.vaultLogin={usernameFilled,passwordFilled,submitted};
    console.log(JSON.stringify(out));
  } finally { await context.close(); }
})().catch(e=>{console.error(String(e&&e.stack||e));process.exit(1)});
`
const BROWSER_SCRIPT=String.raw`
const { chromium } = require('playwright');
const encoded = process.argv[2];
if (!encoded) throw new Error('missing_secure_browser_payload');
const payload = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
const profile = '${BROWSER_PROFILE_DIR}';
const navTimeout = 45000; // read mode ran with 18s and timed out on IRCTC; the worker has a 300s budget, no reason to be stingier than execute
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
      links:Array.from(document.querySelectorAll('a[href]')).filter(visible).slice(0,100).map(a=>({text:clean(a.textContent).slice(0,180),href:a.href})),
      forms:Array.from(document.forms).filter(visible).slice(0,16).map(f=>({
        action:f.action||location.href,method:(f.method||'get').toLowerCase(),
        inputs:Array.from(f.querySelectorAll('input,textarea,select')).filter(visible).slice(0,60).map(inputs)
      }))
    };
  });
}
async function isConsequentialControl(page,selector){
  try{return await page.locator(selector).first().evaluate(el=>{
    const t=(el.getAttribute('type')||'').toLowerCase();
    const text=[el.textContent,el.getAttribute('aria-label'),el.getAttribute('title'),el.getAttribute('value'),el.getAttribute('name'),el.id].filter(Boolean).join(' ').replace(/\s+/g,' ').trim().toLowerCase();
    const safeResearch=/\b(search|find|show|filter|apply filters|see results|view results|check availability|update results|go)\b/i.test(text);
    const consequential=/\b(book|buy|purchase|checkout|pay|payment|reserve|reservation|place order|order now|apply|send application|check\s*-?\s*in|confirm(?:ation)?|complete purchase|finish purchase|finali[sz]e|submit)\b/i.test(text);
    if(safeResearch && !consequential)return false;
    if(consequential)return true;
    if(t==='submit'||(el.tagName==='BUTTON'&&t!=='button')||el.getAttribute('formaction')!==null)return true;
    return false;
  });}catch{return true;}
}
(async()=>{
  const context=await chromium.launchPersistentContext(profile,{headless:true,viewport:{width:1280,height:900},args:['--disable-http2']});
  const page=context.pages()[0]||await context.newPage();
  const log=[];
  try{
    await page.goto(payload.url,{waitUntil:'domcontentloaded',timeout:navTimeout});
    await page.waitForTimeout(900);
    for(const a of (payload.actions||[])){
      try{
        if(a.kind==='goto') await page.goto(a.url,{waitUntil:'domcontentloaded',timeout:navTimeout});
        else if(a.kind==='fill') await page.locator(a.selector).first().fill(a.value,{timeout:10000});
        else if(a.kind==='select') await page.locator(a.selector).first().selectOption(a.value,{timeout:10000});
        else if(a.kind==='check') await page.locator(a.selector).first().check({timeout:10000});
        else if(a.kind==='wait') await page.waitForTimeout(Math.min(5000,Math.max(100,Number(a.ms)||500)));
        else if(a.kind==='click'){
          if(payload.mode!=='execute' && await isConsequentialControl(page,a.selector)){log.push({kind:a.kind,detail:a.selector,status:'skipped'});continue;}
          await page.locator(a.selector).first().click({timeout:10000});
        } else if(a.kind==='submit'){
          if(payload.mode!=='execute'){log.push({kind:a.kind,detail:a.selector,status:'skipped'});continue;}
          await page.locator(a.selector).first().click({timeout:10000});
        }
        log.push({kind:a.kind,detail:a.selector||a.url||String(a.ms||''),status:'done'});
        await page.waitForTimeout(650);
      }catch(e){log.push({kind:a.kind,detail:a.selector||a.url||'',status:'failed'});}
    }
    const out=await model(page); out.actions=log; console.log(JSON.stringify(out));
  } finally { await context.close(); }
})().catch(e=>{console.error(String(e&&e.stack||e));process.exit(1)});
`

async function getComputer(userId:string,targetUrl:string){
  const canonicalUserId=await canonicalBrowserOwnerId(userId)
  const name=userSandboxName(canonicalUserId)
  const sandbox=await Sandbox.getOrCreate({
    name, image:SANDBOX_IMAGE, region:SANDBOX_REGION, timeout:20*60*1000, persistent:true,
    ports:BROWSER_PORTS, resources:{vcpus:1}, networkPolicy:BROWSER_SETUP_NETWORK,
  } as any)
  await ensureBrowserRuntime(sandbox)
  await sandbox.writeFiles([
    {path:`${SANDBOX_WORKDIR}/gogo-browser.js`,content:Buffer.from(BROWSER_SCRIPT)},
    {path:`${SANDBOX_WORKDIR}/gogo-vault-login.js`,content:Buffer.from(VAULT_LOGIN_SCRIPT)},
  ])
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

function pageLooksLikeLogin(page:any){
  const text=`${page?.title||''} ${page?.text||''}`.toLowerCase()
  const inputs=(page?.forms||[]).flatMap((form:any)=>Array.isArray(form?.inputs)?form.inputs:[])
  const descriptors=inputs.map((input:any)=>`${input?.name||''} ${input?.type||''} ${input?.label||''}`.toLowerCase())
  const loginInput=descriptors.some((value:string)=>/\b(password|username|email|phone|mobile|login)\b/.test(value))
  const loginCopy=/\b(sign in|log in|login|account login)\b/.test(text)
  return loginInput&&loginCopy
}

async function attemptVaultLogin(params:{sandbox:any;url:string;username:string;secret:string}){
  const result=await params.sandbox.runCommand({
    cmd:'bash',
    args:['-lc',`cd ${SANDBOX_WORKDIR} && node gogo-vault-login.js`],
    env:{
      GOGO_LOGIN_URL:params.url,
      GOGO_VAULT_USERNAME:params.username,
      GOGO_VAULT_SECRET:params.secret,
    },
  } as any)
  if(result.exitCode!==0)throw new Error('vault_browser_login_failed')
  const stdout=await result.stdout()
  const lines=String(stdout||'').trim().split('\n').filter(Boolean)
  if(!lines.length)throw new Error('vault_browser_login_empty')
  return JSON.parse(lines[lines.length-1])
}
async function inspect(userId:string,url:string){
  const {sandbox,name}=await getComputer(userId,url)
  const payload=Buffer.from(JSON.stringify({url,mode:'read',actions:[]})).toString('base64')
  const result=await sandbox.runCommand({cmd:'bash',args:['-lc',`cd ${SANDBOX_WORKDIR} && node gogo-browser.js "$1"`,'--',payload]})
  if(result.exitCode!==0)throw new Error(`secure_browser_read_failed:${safeText(await result.stderr(),700)}`)
  const stdout=await result.stdout();const lines=String(stdout||'').trim().split('\n').filter(Boolean)
  if(!lines.length)throw new Error('secure_browser_empty_output')
  const parsed=JSON.parse(lines[lines.length-1])
  return {sandbox,name,page:parsed}
}

function detectProviderAccessBlock(page:any){
  const text=`${page?.title || ''} ${page?.text || ''}`.replace(/\s+/g,' ').toLowerCase()
  const blocked=/\b(your access to this site has been limited|access denied|access has been denied|request blocked|security policy prevents access|temporarily blocked|unusual traffic|automated requests|bot protection)\b/i.test(text)
  return blocked ? 'The provider site is limiting automated access, so Gogo cannot verify live availability from this page.' : null
}

async function planActions(objective:string,page:any,mode:BrowserMode):Promise<BrowserAction[]>{
  const pageModel={
    url:safeText(page.url,1200),
    title:safeText(page.title,500),
    text:safeText(page.text,10000),
    links:(page.links||[]).slice(0,70).map((link:any)=>({
      text:safeText(link?.text,180),
      href:safeText(link?.href,1200),
    })),
    forms:(page.forms||[]).slice(0,12).map((form:any)=>({
      action:safeText(form?.action,1200),
      method:String(form?.method||'get'),
      inputs:Array.isArray(form?.inputs)?form.inputs.slice(0,60):[],
    })),
  }
  const modeRule = mode==='read'
    ? 'Research mode: actively navigate, fill search/filter fields, click safe search/filter/result controls, and wait for results until the objective is satisfied. Never book, buy, reserve, apply, submit personal data, authenticate, or trigger a consequential action. Return [] only when the current page already contains enough evidence to answer the objective.'
    : mode==='draft'
      ? 'Draft mode: navigate and fill reversible fields, but do not trigger the final submit/book/buy/confirm control.'
      : 'Execute mode: perform only the explicitly approved objective. Do not invent credentials, OTPs, card data, or other secrets.'
  const prompt=`You are Gogo's browser action planner. Produce JSON array only. Goal: ${JSON.stringify(objective.slice(0,1600))}\nMode: ${mode}. ${modeRule}\nCurrent page model: ${JSON.stringify(pageModel)}\nAllowed action kinds: goto, click, fill, select, check, wait, submit. Use selectors already present for form fields. Prefer safe navigation/click/fill/select/wait. Never invent passwords, OTPs, card numbers or secret values. Never use submit unless mode is execute and the approved goal explicitly requires the final consequential action. Maximum ${MAX_ACTIONS} actions.`
  try{
    const res=await anthropic.messages.create({model:'claude-haiku-4-5',max_tokens:1600,temperature:0,messages:[{role:'user',content:prompt}]})
    const text=res.content[0]?.type==='text'?res.content[0].text:''
    return normalizeActions(parseJsonLoose(text),page.url)
  }catch(err:any){console.error('SECURE_BROWSER_PLAN_FAILED:',safeText(err?.message||err,700));return []}
}

function normalizeActionLog(values:any[]){
  return values.map((a:any)=>({kind:String(a.kind||''),detail:safeText(a.detail,300),status:['done','skipped','failed'].includes(a.status)?a.status:'failed' as const}))
}

export async function runSecureBrowser(params:{userId:string;url:string;objective:string;mode:BrowserMode;vaultCredentialId?:string|null}):Promise<SecureBrowserResult>{
  try {
    const target=new URL(params.url)
    if(!['http:','https:'].includes(target.protocol))throw new Error('browser_url_not_http')
    const first=await inspect(params.userId,target.toString())
    let page=first.page
    let actionLog:any[]=[]
    let anyPlannedSubmit=false
    let vaultAttempted=false
    let credentialSelectionRequired=false

    for(let wave=0;wave<(params.mode==='read'?MAX_RESEARCH_WAVES:1);wave++){
      const providerBlock=detectProviderAccessBlock(page)
      if(providerBlock){
        // Do NOT stop the sandbox on a block. A blocked result is precisely the
        // outcome that hands off to the user: startProviderBrowserHandoff resumes
        // this same sandbox and starts the takeover server on BROWSER_PORTS.
        // Stopping here killed the port binding, so the takeover URL returned
        // 502 SANDBOX_NOT_LISTENING. The sandbox expires on its own timeout.
        return {status:'blocked',url:safeText(page.url||target,1200),title:safeText(page.title,300),summary:providerBlock,pageText:safeText(page.text,1200),forms:[],actions:normalizeActionLog(actionLog),sandboxName:first.name,blockReason:'provider_access_limited'}
      }

      let authGate=detectHumanAuthGate(page)
      const loginish=pageLooksLikeLogin(page)

      // Vault is tried only for ordinary username/password login. Secrets are
      // resolved in the trusted backend, passed to the sandbox as command-scoped
      // environment variables, and injected directly by Playwright. They are
      // never exposed to the model planner, task objective, Activity, or logs.
      if(!vaultAttempted && (authGate.reason==='password'||loginish)){
        const currentUrl=String(page.url||target.toString())
        let host=''
        try{host=new URL(currentUrl).hostname}catch{}
        const credential=host
          ? await resolveVaultCredentialForBrowser(params.userId,host,params.vaultCredentialId||null).catch((err:any)=>{
              const reason=String(err?.message||'')
              if(reason==='vault_credential_ambiguous'){
                credentialSelectionRequired=true
                return null
              }
              console.error('VAULT_BROWSER_MATCH_FAILED:',reason||err)
              return null
            })
          : null

        if(credential){
          vaultAttempted=true
          try{
            page=await attemptVaultLogin({
              sandbox:first.sandbox,
              url:currentUrl,
              username:credential.username,
              secret:credential.secret,
            })
            actionLog.push({kind:'vault_login',detail:`Saved ${credential.provider} login`,status:'done'})
            authGate=detectHumanAuthGate(page)
            const stillLogin=pageLooksLikeLogin(page)
            const loginText=`${page?.title||''} ${page?.text||''}`.toLowerCase()
            const explicitFailure=/\b(?:incorrect|wrong|invalid)\s+(?:username|email|phone|password|credentials?)\b|\b(?:username|email|phone|password|credentials?)\s+(?:is\s+|are\s+)?(?:incorrect|wrong|invalid)\b|\bcredentials?\s+(?:do\s+not\s+match|not\s+recognized)\b/.test(loginText)

            if(!authGate.required&&!stillLogin){
              await recordVaultBrowserOutcome({
                telegramId:credential.telegramId,credentialId:credential.credentialId,
                provider:credential.provider,domain:credential.domain,outcome:'login_success',
              }).catch(()=>{})
              await upsertVaultSession({
                telegramId:credential.telegramId,
                provider:credential.provider,
                domain:credential.domain,
                credentialId:credential.credentialId,
                sandboxName:first.name,
                profileGeneration:SANDBOX_GENERATION,
                status:'active',
                authMethod:'vault_credential',
                metadata:{source:'secure_browser'},
              }).catch((err:any)=>console.error('VAULT_SESSION_UPSERT_FAILED:',String(err?.message||err).slice(0,180)))
            }else if(explicitFailure){
              await recordVaultBrowserOutcome({
                telegramId:credential.telegramId,credentialId:credential.credentialId,
                provider:credential.provider,domain:credential.domain,outcome:'login_failed',
                reason:'provider_rejected_credentials',
              }).catch(()=>{})
            }else{
              await recordVaultBrowserOutcome({
                telegramId:credential.telegramId,credentialId:credential.credentialId,
                provider:credential.provider,domain:credential.domain,outcome:'human_challenge',
                reason:authGate.reason||'login_not_completed',
              }).catch(()=>{})
              await upsertVaultSession({
                telegramId:credential.telegramId,
                provider:credential.provider,
                domain:credential.domain,
                credentialId:credential.credentialId,
                sandboxName:first.name,
                profileGeneration:SANDBOX_GENERATION,
                status:'human_challenge',
                authMethod:'vault_credential',
                metadata:{source:'secure_browser',challenge:authGate.reason||'login_not_completed'},
              }).catch(()=>{})
            }
          }catch(err:any){
            console.error('VAULT_BROWSER_LOGIN_FAILED:',err?.message||err)
          }
        }
      }

      authGate=detectHumanAuthGate(page)
      if(authGate.required||pageLooksLikeLogin(page)){
        // Human-only challenges stay in the provider browser. If multiple Vault
        // accounts match, pause safely and let the user choose which opaque
        // credential reference to use before retrying.
        const reason=authGate.reason||'password'
        const summary=credentialSelectionRequired
          ? 'Multiple saved logins match this site. Choose which account Gogo should use.'
          : authGate.message||'This site needs a secure sign-in before Gogo can continue.'
        return {status:'blocked',url:safeText(page.url||target,1200),title:safeText(page.title,300),summary,pageText:'Gogo paused before authentication. No password, OTP, passkey or payment-auth value was requested, inferred or stored.',forms:[],actions:normalizeActionLog(actionLog),sandboxName:first.name,blockReason:'human_auth_required',authReason:reason,credentialSelectionRequired}
      }

      const actions=await planActions(params.objective,page,params.mode)
      if(!actions.length)break
      if(actions.some(a=>a.kind==='submit'))anyPlannedSubmit=true
      const currentUrl=String(page.url||target.toString())
      const {allow}=allowedHosts(currentUrl);await first.sandbox.updateNetworkPolicy({allow} as any)
      const payload=Buffer.from(JSON.stringify({url:currentUrl,mode:params.mode,actions})).toString('base64')
      const result=await first.sandbox.runCommand({cmd:'bash',args:['-lc',`cd ${SANDBOX_WORKDIR} && node gogo-browser.js "$1"`,'--',payload]})
      if(result.exitCode!==0)throw new Error(`secure_browser_action_failed:${safeText(await result.stderr(),700)}`)
      const stdout=await result.stdout();const lines=String(stdout||'').trim().split('\n').filter(Boolean)
      if(!lines.length)throw new Error('secure_browser_action_empty_output')
      page=JSON.parse(lines[lines.length-1]);actionLog.push(...(page.actions||[]))
      const doneCount=(page.actions||[]).filter((a:any)=>a.status==='done').length
      if(doneCount===0)break
    }

    await first.sandbox.stop().catch(()=>{})
    const prepared=params.mode==='draft' && anyPlannedSubmit
    return {
      status:prepared?'prepared':'completed',url:safeText(page.url||target,1200),title:safeText(page.title,300),
      summary:params.mode==='read'?'Gogo completed the browser research task.':prepared?'Gogo prepared the browser flow and stopped before submit.':'Gogo completed the approved browser flow.',
      pageText:safeText(page.text,9000),forms:Array.isArray(page.forms)?page.forms.slice(0,12).map((form:any)=>({...form,action:safeText(form?.action,1200)})):[],actions:normalizeActionLog(actionLog),sandboxName:first.name,
    }
  } catch (error:any) {
    const safeError=safeText(error?.message||error,1000)
    console.error('SECURE_BROWSER_FAILED:',safeError)
    throw new Error(safeError||'secure_browser_failed')
  }
}
