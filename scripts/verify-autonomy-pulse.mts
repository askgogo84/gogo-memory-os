import assert from 'node:assert/strict'
import { runInNewContext } from 'node:vm'
import { createHash } from 'node:crypto'
import ts from 'typescript'
import { readFileSync } from 'node:fs'
import { isAutonomyStatus, isConnectionStatus } from '../lib/agent/autonomy-status'

assert.equal(isAutonomyStatus('What are you working on for me?'),true)
assert.equal(isAutonomyStatus('Show me my agent status'),true)
assert.equal(isAutonomyStatus('What meetings do I have tomorrow?'),false)

assert.equal(isConnectionStatus('Which email am I connected to?'),true)
assert.equal(isConnectionStatus('What Google account am I connected to?'),true)
assert.equal(isConnectionStatus('Connect my calendar'),false)

const pulse=readFileSync('lib/agent/autonomy-pulse.ts','utf8')
const vercel=readFileSync('vercel.json','utf8')
const bridge=readFileSync('lib/agent/whatsapp-bridge.ts','utf8')

assert.match(pulse,/event_type:'autonomy_pulse_sent'/)
assert.match(pulse,/PULSE_COOLDOWN_MINUTES/)
assert.match(pulse,/quiet_hours/)
assert.match(pulse,/waiting_approval/)
assert.match(pulse,/life_events/)
assert.match(pulse,/agent_ideas/)
assert.match(vercel,/\/api\/cron\/autonomy-pulse/)
assert.match(bridge,/tryGetAutonomyStatus/)
assert.match(bridge,/tryGetConnectionStatus/)

console.log('Autonomy Pulse + live status verification passed')

assert.match(pulse,/stale_provider_access_limited/)
assert.match(pulse,/background_browser_resume_expired/)
assert.match(pulse,/fromMemoryTwin&&score<90/)
assert.match(pulse,/!fromMemoryTwin&&score<85/)
assert.match(pulse,/hasRecentWhatsAppSession/)
assert.match(pulse,/sendWhatsApp\(String\(user\.whatsapp_id\),message\)/)
assert.match(pulse,/sendWhatsAppReminderTemplate/)
assert.match(pulse,/delivery_mode:activeSession\?'freeform':'template'/)
console.log('Autonomy Pulse signal-quality and delivery-window verification passed')

assert.doesNotMatch(pulse,/Gogo is staying on top of things/,'normal proactive WhatsApp must not narrate backend state')
assert.doesNotMatch(pulse,/\*Open loop\*:/,'normal proactive WhatsApp must not expose open-loop jargon')
assert.doesNotMatch(pulse,/Gogo found a high-signal update/,'normal proactive WhatsApp must not expose signal-ranking jargon')
assert.match(pulse,/usefulOpenLoopTitle/,'generic unresolved-state labels must be suppressible')
assert.match(pulse,/If you want the full status/,'diagnostic detail remains opt-in')
console.log('Outcome-first proactive notification UX verification passed')

// 3 Oct WhatsApp: duplicate Zomato attempts crowded out useful digest items.
const now='2026-10-03T06:00:00.000Z',owner='101'
const browserRun=(id:string,host='www.zomato.com',objective='Find vegetarian burgers in Bengaluru')=>({
  id,telegram_id:owner,type:'secure_browser',status:'failed',title:`Browser ${host}`,
  summary:'Gogo could not complete the secure browser session.',error:'browser_objective_unverified',updated_at:now,
  metadata_json:{plan_type:'secure_browser',mode:'read',url:`https://${host}/`,objective},
})
let tables:Record<string,any[]>={},historyFails=false
const deliveries:string[]=[]
const db={from:(table:string)=>{
  let rows=[...(tables[table]||[])],single=false,history=false
  const q:any={select:()=>q,
    eq:(key:string,value:any)=>{rows=rows.filter(r=>String(r[key])===String(value));if(key==='event_type'&&value==='autonomy_pulse_sent')history=true;return q},
    in:(key:string,values:any[])=>{rows=rows.filter(r=>values.includes(r[key]));return q},
    gte:(key:string,value:any)=>{rows=rows.filter(r=>r[key]>=value);return q},lte:(key:string,value:any)=>{rows=rows.filter(r=>r[key]<=value);return q},
    order:(key:string,options:any)=>{rows.sort((a,b)=>String(a[key]).localeCompare(String(b[key]))*(options.ascending?1:-1));return q},
    limit:(n:number)=>{rows=rows.slice(0,n);return q},range:(a:number,b:number)=>{rows=rows.slice(a,b+1);return q},not:()=>q,or:()=>q,contains:()=>q,
    maybeSingle:()=>{single=true;return q},insert:(row:any)=>{(tables[table]??=[]).push({...row,created_at:now});return q},
    then:(resolve:any)=>Promise.resolve(historyFails&&history?{data:null,error:{message:'fixture history unavailable'}}:{data:single?rows[0]||null:rows,error:null}).then(resolve),
  };return q
}}
function loadPulseModule(file:string,extra=''):any{
  const source=readFileSync(`lib/agent/${file}.ts`,'utf8')+extra,exports:any={}
  class FixedDate extends Date{constructor(value:any=now){super(value)}static now(){return Date.parse(now)}}
  runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
    exports,Date:FixedDate,Intl,URL,console,process:{env:{}},require:(name:string)=>{
      if(name==='node:crypto')return {createHash}
      if(name==='@/lib/supabase-admin')return {supabaseAdmin:db}
      if(name==='@/lib/whatsapp')return {sendWhatsApp:async(_to:string,text:string)=>{deliveries.push(text);return {sid:'fixture'}},sendWhatsAppReminderTemplate:async()=>{throw new Error('unexpected template')}}
      if(name==='./task-lifecycle')return {retiredRunReason:()=>null,isRelevantOpenLoop:()=>true}
      if(name==='./browser-failure-notice')return loadPulseModule('browser-failure-notice')
      throw new Error(`Unexpected dependency ${name}`)
    },
  });return exports
}
const runtime=loadPulseModule('autonomy-pulse','\nexport {buildPulse,sendPulse}')
tables={agent_runs:[browserRun('z-new'),{...browserRun('z-old'),updated_at:'2026-10-03T05:00:00.000Z'},browserRun('flip','www.flipkart.com','Find Sony WH-1000XM5')],users:[{telegram_id:owner,whatsapp_id:'fixture',timezone:'Asia/Kolkata'}],agent_activity:[{telegram_id:owner,event_type:'shadow_brain_observation',created_at:now}]}
const first=await runtime.buildPulse(owner,'Asia/Kolkata')
assert.equal(first.items.length,2,'same Zomato request must occupy one digest slot')
assert(first.items.some((x:any)=>x.line.includes('/dashboard/activity/z-new')),'link latest attempt')
assert(first.items.every((x:any)=>!x.line.includes('could not complete the secure browser session')),'explain the recorded failure')
assert(first.items.every((x:any)=>/No input is requested from you/.test(x.line)),'do not imply user can repair an unverified browser read')
await runtime.sendPulse(owner)
assert.equal(deliveries.length,1)
// Same blocker stays quiet past the cooldown, including a new attempt ID.
tables.agent_activity.filter(r=>r.event_type==='autonomy_pulse_sent').forEach(r=>r.created_at='2026-10-03T02:00:00.000Z')
tables.agent_runs=[browserRun('z-retry'),browserRun('flip-retry','www.flipkart.com','Find Sony WH-1000XM5')]
assert.equal((await runtime.buildPulse(owner,'Asia/Kolkata')).items.length,0,'unchanged retries stay quiet')
assert.equal((await runtime.sendPulse(owner)).sent,false)
tables.agent_runs.push(browserRun('different','www.zomato.com','Find dosa in Bengaluru'))
assert.equal((await runtime.buildPulse(owner,'Asia/Kolkata')).items.length,1,'different request on same site stays visible')
tables.agent_activity.filter(r=>r.event_type==='autonomy_pulse_sent').forEach(r=>r.telegram_id='another-owner')
assert.equal((await runtime.buildPulse(owner,'Asia/Kolkata')).items.length,3,'history is owner-scoped')
tables.agent_runs=[{...browserRun('auth'),status:'paused',error:'human_auth_required',summary:'Open Take Control to sign in, then resume this task.'}]
assert.match((await runtime.buildPulse(owner,'Asia/Kolkata')).items[0].line,/Take Control/,'keep actionable sign-in handoff')
tables.agent_activity=[{telegram_id:owner,event_type:'autonomy_pulse_sent',created_at:now,metadata_json:{item_keys:['run:legacy:failed']}}]
tables.agent_runs=[browserRun('newer'),{...browserRun('legacy'),updated_at:'2026-10-03T05:00:00.000Z'}]
assert.equal((await runtime.buildPulse(owner,'Asia/Kolkata')).items.length,0,'recognize the old run-ID notification already sent in the screenshot')
tables.agent_runs=[{...browserRun('changed'),error:'browser_live_session_expired'}]
const changed=await runtime.buildPulse(owner,'Asia/Kolkata')
assert.equal(changed.items.length,1,'a changed blocker with a human next step remains visible')
assert.match(changed.items[0].line,/Take Control/)
tables.agent_runs=[browserRun('history-error')];historyFails=true
await assert.rejects(()=>runtime.buildPulse(owner,'Asia/Kolkata'),/history/i,'do not send duplicates when history lookup fails')
console.log('PASS: duplicate blockers, distinct requests, owner isolation, cooldown and human handoff')
