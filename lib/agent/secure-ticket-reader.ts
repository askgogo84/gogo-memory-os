import { createHash } from 'crypto'
import { Sandbox } from '@vercel/sandbox'
import { detectHumanAuthGate } from './browser-auth-gate'
import { runSecureBrowser } from './secure-computer'

const PLAYWRIGHT_VERSION = '1.63.0'
const SANDBOX_REGION = process.env.GOGO_SANDBOX_REGION || 'bom1'

export type TicketCredential = {
  mimeType: string
  dataBase64: string
  source: 'provider_page'
  label: string
}

export type SecureTicketReadResult = {
  status: 'completed' | 'blocked' | 'failed'
  url: string
  title: string
  pageText: string
  shareData?: { title?: string; text?: string; url?: string }
  usefulLinks: Array<{ text: string; href: string }>
  credential?: TicketCredential
  blockReason?: 'human_auth_required'
  authReason?: 'password'|'otp'|'passkey'|'captcha'|'payment_auth'
}

function sandboxName(userId: string) {
  const digest = createHash('sha256').update(String(userId)).digest('hex').slice(0, 24)
  return `gogo-browser-${digest}`
}

function allowedHosts(url: string) {
  const u = new URL(url)
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('ticket_url_not_http')
  const host = u.hostname.toLowerCase()
  if (!host || host === 'localhost' || host.endsWith('.local')) throw new Error('ticket_private_host_blocked')
  const allow: Record<string, string[]> = { [host]: [], [`*.${host}`]: [] }
  if (/bookmyshow|bmsurl/.test(host)) {
    allow['bookmyshow.com'] = []
    allow['*.bookmyshow.com'] = []
    allow['bmscdn.com'] = []
    allow['*.bmscdn.com'] = []
  }
  return allow
}

const SCRIPT = String.raw`
const { chromium } = require('playwright');
const encoded = process.argv[2];
if (!encoded) throw new Error('missing_ticket_reader_payload');
const payload = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
const profile='/vercel/sandbox/browser-profile';
const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
const visible=el=>{try{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'}catch{return false}};
const bad=/\b(pay|purchase|buy|confirm purchase|place order|book now|checkout|refund|cancel booking|delete)\b/i;
const useful=/\b(share|download|show ticket|view ticket|ticket|qr|barcode|pass|wallet)\b/i;
async function clickUseful(page){
  const loc=page.locator('button,a,[role="button"]');
  const n=Math.min(await loc.count(),120);
  const tried=[];
  for(let i=0;i<n;i++){
    const el=loc.nth(i); let label='';
    try{label=clean(await el.innerText().catch(()=>'' )||await el.getAttribute('aria-label')||await el.getAttribute('title')||'')}catch{}
    if(!label||!useful.test(label)||bad.test(label))continue;
    tried.push(label.slice(0,120));
    try{await el.click({timeout:3500});await page.waitForTimeout(900)}catch{}
    const share=await page.evaluate(()=>window.__gogoShareData||null).catch(()=>null);
    if(share)break;
  }
  return tried;
}
async function candidateScore(el){
  return await el.evaluate(node=>{
    const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
    const attrs=[node.getAttribute('alt'),node.getAttribute('title'),node.getAttribute('aria-label'),node.getAttribute('src'),node.id,node.className].filter(Boolean).join(' ').toLowerCase();
    const near=clean(node.parentElement?.innerText||node.closest('div')?.innerText||'').slice(0,500).toLowerCase();
    let s=0;
    if(/qr|qrcode|barcode/.test(attrs))s+=12;
    if(/ticket|pass|entry|scan/.test(attrs))s+=5;
    if(/qr|barcode|scan (?:this|at)|show this|entry/.test(near))s+=7;
    if(node.tagName==='CANVAS')s+=2;
    return s;
  }).catch(()=>0);
}
async function captureCredential(page){
  const selectors='img,canvas,svg,[class*="qr" i],[id*="qr" i],[class*="barcode" i],[id*="barcode" i]';
  const loc=page.locator(selectors); const n=Math.min(await loc.count(),100); let best=null,bestScore=0;
  for(let i=0;i<n;i++){
    const el=loc.nth(i);
    try{
      if(!await el.isVisible())continue;
      const box=await el.boundingBox(); if(!box||box.width<70||box.height<70)continue;
      const score=await candidateScore(el); if(score>bestScore){best=el;bestScore=score;}
    }catch{}
  }
  if(!best||bestScore<7)return null;
  try{
    const label=clean(await best.getAttribute('aria-label')||await best.getAttribute('alt')||await best.getAttribute('title')||'ticket QR/barcode');
    const buf=await best.screenshot({type:'png',animations:'disabled'});
    return {mimeType:'image/png',dataBase64:buf.toString('base64'),source:'provider_page',label:label.slice(0,180)||'ticket QR/barcode'};
  }catch{return null;}
}
(async()=>{
  const context=await chromium.launchPersistentContext(profile,{headless:true,viewport:{width:1280,height:1000}});
  await context.addInitScript(()=>{
    window.__gogoShareData=null;
    try{
      Object.defineProperty(navigator,'share',{configurable:true,value:async(data)=>{window.__gogoShareData={title:data?.title||'',text:data?.text||'',url:data?.url||''};}});
      Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>true});
    }catch{}
  });
  const page=context.pages()[0]||await context.newPage();
  try{
    await page.goto(payload.url,{waitUntil:'domcontentloaded',timeout:45000});
    await page.waitForTimeout(1800);
    const tried=await clickUseful(page);
    await page.waitForTimeout(800);
    const data=await page.evaluate(()=>({
      url:location.href,title:document.title,text:clean(document.body?.innerText||'').slice(0,22000),
      shareData:window.__gogoShareData||null,
      links:Array.from(document.querySelectorAll('a[href]')).filter(visible).map(a=>({text:clean(a.textContent).slice(0,180),href:a.href})).filter(x=>/ticket|pass|qr|barcode|download|share|wallet/i.test(x.text+' '+x.href)).slice(0,30)
    }));
    data.tried=tried; data.credential=await captureCredential(page);
    console.log(JSON.stringify(data));
  }finally{await context.close();}
})().catch(e=>{console.error(String(e&&e.stack||e));process.exit(1)});
`

async function computer(userId: string, url: string) {
  const sandbox = await Sandbox.getOrCreate({
    name: sandboxName(userId), runtime: 'node24', region: SANDBOX_REGION,
    timeout: 20 * 60 * 1000, persistent: true, resources: { vcpus: 1 },
    networkPolicy: { allow: {
      'registry.npmjs.org': [], '*.npmjs.org': [], 'cdn.playwright.dev': [], '*.playwright.dev': [],
      'playwright.azureedge.net': [], '*.azureedge.net': [],
    } },
  } as any)
  const check = await sandbox.runCommand({ cmd: 'bash', args: ['-lc', 'test -f node_modules/playwright/package.json && echo ready || echo missing'] })
  if ((await check.stdout()).trim() !== 'ready') {
    const install = await sandbox.runCommand({ cmd: 'bash', args: ['-lc', `npm init -y >/dev/null 2>&1 || true; npm install --no-audit --no-fund playwright@${PLAYWRIGHT_VERSION} && npx playwright install --with-deps chromium`] })
    if (install.exitCode !== 0) throw new Error(`ticket_browser_bootstrap_failed:${String(await install.stderr()).slice(0,500)}`)
  }
  await sandbox.writeFiles([{ path: 'gogo-ticket-reader.js', stream: Buffer.from(SCRIPT) }])
  await sandbox.updateNetworkPolicy({ allow: allowedHosts(url) } as any)
  return sandbox
}

async function fallbackSecureComputer(params: { userId: string; url: string }): Promise<SecureTicketReadResult> {
  try {
    const result = await runSecureBrowser({
      userId: params.userId,
      url: params.url,
      mode: 'read',
      objective: 'Read this confirmed booking/ticket page. Do not submit, purchase, cancel, authenticate, or change anything.',
    })
    if (result.status === 'blocked') {
      return {
        status: 'blocked', url: result.url || params.url, title: result.title || '', pageText: '', usefulLinks: [],
        blockReason: 'human_auth_required', authReason: result.authReason,
      }
    }
    if (result.status === 'completed' || result.status === 'prepared') {
      return { status: 'completed', url: result.url || params.url, title: result.title || '', pageText: result.pageText || '', usefulLinks: [] }
    }
  } catch (error: any) {
    console.error('SECURE_TICKET_READER_FALLBACK_FAILED:', error?.stack || error?.message || error)
  }
  return { status: 'failed', url: params.url, title: '', pageText: '', usefulLinks: [] }
}

export async function readProviderTicketPage(params: { userId: string; url: string }): Promise<SecureTicketReadResult> {
  let sandbox: any = null
  try {
    sandbox = await computer(params.userId, params.url)
    const payload = Buffer.from(JSON.stringify({ url: params.url })).toString('base64')
    const result = await sandbox.runCommand({ cmd: 'node', args: ['gogo-ticket-reader.js', payload] })
    if (result.exitCode !== 0) throw new Error(`ticket_browser_failed:${String(await result.stderr()).slice(0,700)}`)
    const stdout = await result.stdout()
    const lines = String(stdout || '').trim().split('\n').filter(Boolean)
    if (!lines.length) throw new Error('ticket_browser_empty_output')
    const page: any = JSON.parse(lines[lines.length - 1])
    const gate = detectHumanAuthGate({ title: page.title, text: page.text, forms: [] })
    if (gate.required) {
      return {
        status: 'blocked', url: String(page.url || params.url), title: String(page.title || '').slice(0, 300),
        pageText: '', usefulLinks: [], blockReason: 'human_auth_required', authReason: gate.reason,
      }
    }
    return {
      status: 'completed', url: String(page.url || params.url), title: String(page.title || '').slice(0, 300),
      pageText: String(page.text || '').slice(0, 16000), shareData: page.shareData || undefined,
      usefulLinks: Array.isArray(page.links) ? page.links.slice(0, 30) : [], credential: page.credential || undefined,
    }
  } catch (error: any) {
    console.error('SECURE_TICKET_READER_FAILED:', error?.stack || error?.message || error)
    return fallbackSecureComputer(params)
  } finally {
    if (sandbox) await sandbox.stop().catch(() => {})
  }
}
