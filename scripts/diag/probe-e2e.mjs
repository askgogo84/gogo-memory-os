import { readFileSync } from 'node:fs'
import { Sandbox } from '@vercel/sandbox'
function loadEnv(){const files=['.env.local','.env.vercel.scratch'];const out={};for(const f of files){let raw='';try{raw=readFileSync(f,'utf8')}catch{continue}for(const line of raw.split(/\r?\n/)){const m=line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);if(!m)continue;let v=m[2];if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);out[m[1]]=v}}return out}
const env=loadEnv();const token=env.VERCEL_OIDC_TOKEN;process.env.VERCEL_OIDC_TOKEN=token
const rj=JSON.parse(readFileSync('.vercel/repo.json','utf8'));const p=rj.projects[0]
const creds={token,projectId:p.id,teamId:p.orgId}
const PW='1.63.0'
const launchScript=`const { chromium } = require('playwright');
(async()=>{const ctx=await chromium.launchPersistentContext('/vercel/browser-profile',{headless:true,viewport:{width:1280,height:900}});const pg=ctx.pages()[0]||await ctx.newPage();await pg.goto('https://example.com',{waitUntil:'domcontentloaded',timeout:30000});console.log('TITLE:'+(await pg.title()));await ctx.close();console.log('LAUNCH_OK')})().catch(e=>{console.error('LAUNCH_FAIL:'+(e&&e.message||e));process.exit(1)});`
async function run(sb,label,cmd,args,opts={}){const t0=Date.now();const r=await sb.runCommand({cmd,args,...opts});const o=(await r.stdout()).trim();const e=(await r.stderr()).trim();console.log(`--- ${label} (exit ${r.exitCode}, ${Date.now()-t0}ms) ---`);if(o)console.log(o.slice(0,1000));if(e)console.log('ERR:',e.slice(0,1000));return r.exitCode}
const setupPolicy={allow:{
  'registry.npmjs.org':[],'*.npmjs.org':[],'cdn.playwright.dev':[],'*.playwright.dev':[],
  'storage.googleapis.com':[],'*.googleapis.com':[],
  'archive.ubuntu.com':[],'security.ubuntu.com':[],
}}
const APT_HTTPS='sed -i "s#http://archive.ubuntu.com#https://archive.ubuntu.com#g; s#http://security.ubuntu.com#https://security.ubuntu.com#g" /etc/apt/sources.list.d/ubuntu.sources'
let sb, ok=false
try{
  console.log('== create node:24 (image form) w/ locked setup policy ==')
  sb=await Sandbox.create({image:'vercel/sandbox/node:24',region:'bom1',timeout:10*60*1000,resources:{vcpus:2},networkPolicy:setupPolicy,...creds})
  console.log('created',sb.name,'image=',sb.image)
  await run(sb,'1. install module+chromium (ubuntu)','bash',['-lc',`cd "$HOME" && npm init -y >/dev/null 2>&1; npm i --no-audit --no-fund playwright@${PW} >/tmp/npm.log 2>&1 && npx playwright install chromium >/tmp/i.log 2>&1 && echo INSTALL_OK || (echo INSTALL_FAIL; tail -8 /tmp/npm.log /tmp/i.log)`])
  await run(sb,'2. apt https + install-deps (sudo, cd /vercel)','bash',['-lc',`cd /vercel && ${APT_HTTPS} && apt-get update >/tmp/apt.log 2>&1 && npx playwright install-deps chromium >/tmp/deps.log 2>&1 && echo DEPS_OK || (echo DEPS_FAIL; tail -8 /tmp/apt.log /tmp/deps.log)`],{sudo:true})
  await run(sb,'3. verify binary (ubuntu)','bash',['-lc','cd "$HOME" && node -e "const{chromium}=require(\'playwright\');const fs=require(\'fs\');const pth=chromium.executablePath();console.log(pth, fs.existsSync(pth)?\'EXISTS\':\'MISSING\')"'])
  console.log('== lock to target-host-only policy ==')
  await sb.updateNetworkPolicy({allow:{'example.com':[],'*.example.com':[]}})
  await sb.writeFiles([{path:'launch.js',content:Buffer.from(launchScript)}])
  const code=await run(sb,'4. LAUNCH chromium -> example.com','bash',['-lc','cd "$HOME" && node launch.js'])
  ok=code===0
}catch(e){console.log('ERR',String(e&&e.stack||e))}
finally{if(sb){await sb.stop().catch(()=>{});console.log('stopped')}}
console.log(ok?'\n>>>>> PROVEN: full bootstrap + real browser launch works under LOCKED policy <<<<<':'\n>>>>> FAILED <<<<<')
process.exit(ok?0:1)
