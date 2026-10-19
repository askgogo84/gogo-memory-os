// 19 Oct 23:27–23:31 IST live incident (owner, WhatsApp), Toit Indiranagar live-slot approval:
//  A) "Approve" right after "Ready to book … Reply APPROVE" got "That approval expired (requested 27 hours
//     ago)" plus a one-item list: an old expired card stole the reply.
//  B) "1" after "Reply approve 1 or reject 1" reached general chat, which answered "Booking confirmed for 2
//     at Toit Indiranagar …" — nothing had been booked.
//  C) "Approve 1" picked the right card, but arming refused "needs verified dining-date context" for the
//     incomplete-but-disclosed Calendar context the ask had already told the user about (#677).
// Behavioural checks against the real modules with in-memory stores and inert transports. No network,
// no real DB, no sends, no bookings.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import {createHash} from 'node:crypto'
import ts from 'typescript'
import * as ttl from '../lib/agent/approval-ttl'
import {buildApprovalBinding,assertApprovalBinding} from '../lib/agent/approval-binding'
import * as binding from '../lib/agent/approval-binding'
import * as timezone from '../lib/timezone'
import * as dining from '../lib/agent/reservation-dining-context'
import * as locality from '../lib/agent/india-locality'
import * as providerBooking from '../lib/agent/provider-booking'
import * as guestNameModule from '../lib/agent/reservation-guest-name'

const transpile=(file:string)=>ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const failures:string[]=[]
async function check(label:string,fn:()=>unknown){try{await fn();console.log('PASS '+label)}catch(e:any){failures.push(label+': '+(e?.stack||e?.message))}}
const noop=new Proxy({}, {get:(_t,key)=>/^(?:record|observe|capture)/.test(String(key))?async()=>null:()=>null})

// ───────────────────────── A + B1: WhatsApp approval bridge ─────────────────────────
const H=3_600_000
const NOW=Date.now()
const ago=(hours:number)=>new Date(NOW-hours*H).toISOString()
type Row=Record<string,any>
let tables:Record<string,Row[]>={}
let turns:Array<{role:string;content:string;created_at:string}>=[]
let insertSeq=0
function query(table:string){
  const filters:Array<[string,unknown]>=[]
  let patch:Row|null=null, insert:Row|null=null, order:{key:string;asc:boolean}|null=null, limit=Infinity
  const rows=()=>(tables[table]||=[]).filter(r=>filters.every(([k,v])=>String(r[k])===String(v)))
  const run=()=>{
    if(insert){const row={created_at:new Date(NOW+(++insertSeq)).toISOString(),...insert};(tables[table]||=[]).push(row);return {data:row,error:null}}
    let matched=rows()
    if(patch){for(const r of matched)Object.assign(r,patch);return {data:matched.map(r=>({...r})),error:null}}
    if(order)matched=[...matched].sort((a,b)=>(String(a[order!.key]).localeCompare(String(b[order!.key])))*(order!.asc?1:-1))
    return {data:matched.slice(0,limit).map(r=>({...r})),error:null}
  }
  const q:any={
    select:()=>q,eq:(k:string,v:unknown)=>{filters.push([k,v]);return q},
    order:(key:string,opts:any)=>{order={key,asc:!!opts?.ascending};return q},limit:(n:number)=>{limit=n;return q},
    update:(p:Row)=>{patch=p;return q},insert:(r:Row)=>{insert=r;return q},
    maybeSingle:()=>{const r=run();return Promise.resolve({data:Array.isArray(r.data)?(r.data[0]??null):r.data,error:null})},
    then:(resolve:any,reject:any)=>Promise.resolve(run()).then(resolve,reject),
  }
  return q
}
const db={from:(table:string)=>query(table)}
function load(path:string,deps:Record<string,unknown>){
  const exports:any={}
  runInNewContext(transpile(path),{exports,require:(name:string)=>(deps as any)[name]||noop,Date,Intl,console,URL,Request,Response,Buffer,process,setTimeout,clearTimeout})
  return exports
}
const executed:string[]=[]
const bindingInput=(runId:string,title:string)=>({missionId:runId,stepId:'step-1',capability:'calendar',actionType:'calendar_change',target:'calendar:primary',payload:{title}})
async function executeApprovedCalendarUpdate({runId}:{runId:string}){
  const approval=tables.agent_approvals.find(a=>a.run_id===runId)
  assert.equal(approval?.status,'approved')
  assertApprovalBinding(bindingInput(runId,approval!.title),approval)
  executed.push(runId)
  return {text:`Updated: ${approval!.title}`,status:'completed'}
}
const guard=load('lib/agent/approval-guard.ts',{'@/lib/supabase-admin':{supabaseAdmin:db},'./approval-ttl':ttl})
const bridge=load('lib/agent/whatsapp-bridge.ts',{
  '@/lib/supabase-admin':{supabaseAdmin:db},'./approval-ttl':ttl,'./approval-guard':guard,
  './calendar-update':{executeApprovedCalendarUpdate},
  '@/lib/bot/pending-questions':{readRecentTurns:async(tg:number)=>{assert.equal(tg,123,'turns are read for the owner only');return [...turns].sort((a,b)=>b.created_at.localeCompare(a.created_at))}},
  './orchestrator':{...noop,executeApprovedAgentRun:()=>{throw new Error('executeApprovedAgentRun must not run')}},
})
const user={id:'fixture',telegramId:123,whatsappId:'fixture-owner',name:'Example'}
const say=(text:string)=>bridge.tryRunWhatsAppAgent({user,text})
const number=(text:string)=>bridge.tryRunWhatsAppApprovalNumber({user,text})
function seed(items:Array<{id:string;title:string;hoursAgo:number;payload?:Row;owner?:string}>){
  tables={agent_approvals:[],agent_runs:[],agent_activity:[]};turns=[];executed.length=0
  for(const it of items){
    const runId=`run-${it.id}`
    tables.agent_runs.push({id:runId,telegram_id:it.owner||'123',status:'waiting_approval',metadata_json:{plan_type:'calendar_update'}})
    tables.agent_approvals.push({id:it.id,telegram_id:it.owner||'123',run_id:runId,title:it.title,action_type:'calendar_change',risk_level:'high',status:'pending',requested_at:ago(it.hoursAgo),execution_payload:it.payload||{},...buildApprovalBinding(bindingInput(runId,it.title))})
  }
}
const approval=(id:string)=>tables.agent_approvals.find(a=>a.id===id)!
const TOIT='Approve timed reservation attempt · Toit Indiranagar'
const ASK="Ready to book 7pm tomorrow for 2 at Toit Indiranagar under Goverdhan, with your WhatsApp number ending 1501. I couldn't fully check your calendar for that evening, so make sure you're free.\nReply APPROVE to book it, or REJECT to stop. I'll stop before any fee, CAPTCHA or OTP."
const said=(role:string,content:string,minutesAgo:number)=>turns.push({role,content,created_at:new Date(NOW-minutesAgo*60_000).toISOString()})

await check('A: live incident — 27h-old expired card + fresh Toit card: bare "Approve" binds Toit; old card closed silently',async()=>{
  seed([{id:'old',title:'Block calendar for this booking',hoursAgo:27},{id:'toit',title:TOIT,hoursAgo:0.01}])
  said('assistant',ASK,0.5)
  const r=await say('Approve')
  assert.equal(r.text,`Updated: ${TOIT}`)
  assert.doesNotMatch(r.text,/expired|pending approval/)
  assert.deepEqual(executed,['run-toit'])
  assert.equal(approval('toit').status,'approved')
  assert.equal(approval('old').status,'expired','the expired card is closed, never executed')
  assert.ok(tables.agent_activity.some(a=>a.event_type==='approval_expired'&&a.metadata_json?.approval_id==='old'))
})

await check('A: same incident without any conversation history still binds the single live card',async()=>{
  seed([{id:'old',title:'Block calendar for this booking',hoursAgo:27},{id:'toit',title:TOIT,hoursAgo:0.01}])
  const r=await say('approve')
  assert.deepEqual(executed,['run-toit']);assert.equal(approval('old').status,'expired');assert.match(r.text,/^Updated:/)
})

await check('A: two live cards — the latest specific "Reply APPROVE" ask decides',async()=>{
  seed([{id:'cal',title:'Block calendar for this booking',hoursAgo:3},{id:'toit',title:TOIT,hoursAgo:0.01}])
  said('assistant',ASK,0.5)
  const r=await say('Approve')
  assert.equal(r.text,`Updated: ${TOIT}`);assert.deepEqual(executed,['run-toit']);assert.equal(approval('cal').status,'pending')
})

await check('A: the ask binds only while it is the latest turn (user said something since -> list)',async()=>{
  seed([{id:'cal',title:'Block calendar for this booking',hoursAgo:3},{id:'toit',title:TOIT,hoursAgo:0.01}])
  said('assistant',ASK,2);said('user','what time is it',1)
  const r=await say('Approve')
  assert.equal(r.handledBy,'whatsapp-agent-approval-choice');assert.equal(executed.length,0)
})

await check('A: a numbered list is not a specific ask; stale ask (>30 min) does not bind',async()=>{
  seed([{id:'cal',title:'Block calendar for this booking',hoursAgo:3},{id:'toit',title:TOIT,hoursAgo:0.01}])
  said('assistant','1. Block calendar\n2. Toit\n\nReply approve 1 or reject 2.',0.5)
  assert.equal((await say('Approve')).handledBy,'whatsapp-agent-approval-choice')
  seed([{id:'cal',title:'Block calendar for this booking',hoursAgo:3},{id:'toit',title:TOIT,hoursAgo:1}])
  said('assistant',ASK,60)
  assert.equal((await say('Approve')).handledBy,'whatsapp-agent-approval-choice');assert.equal(executed.length,0)
})

await check('A: a NEWER expired card next to one older live card still does not guess',async()=>{
  seed([{id:'live',title:'Email Ravi the deck',hoursAgo:2},{id:'gone',title:'Book table',hoursAgo:1,payload:{expires_at:ago(0.5)}}])
  const r=await say('Approve')
  assert.match(r.text,/That approval expired/);assert.match(r.text,/Reply approve 1 or reject 1\./);assert.equal(executed.length,0)
})

await check('A: another owner\'s card is never a candidate',async()=>{
  seed([{id:'mine',title:TOIT,hoursAgo:0.01},{id:'theirs',title:'Pay invoice',hoursAgo:0.005,owner:'999'}])
  said('assistant',ASK,0.5)
  await say('Approve')
  assert.deepEqual(executed,['run-mine']);assert.equal(approval('theirs').status,'pending')
})

await check('B1: "1" after "Reply approve 1 or reject 1" asks approve-or-reject; nothing runs',async()=>{
  seed([{id:'cal',title:'Block calendar for this booking',hoursAgo:3},{id:'toit',title:TOIT,hoursAgo:0.01}])
  const listed=await say('Approve')
  assert.match(listed.text,/Reply approve 1 or reject 2\./)
  said('assistant',listed.text,0.2)
  const r=await number('1')
  assert.equal(r.text,'Approve or reject #1 (Block calendar for this booking)? Reply approve 1 or reject 1. Nothing has been done yet.')
  assert.equal(r.handledBy,'whatsapp-agent-approval-number')
  const r2=await number('2')
  assert.equal(r2.text,`Approve or reject #2 (${TOIT})? Reply approve 2 or reject 2. Nothing has been done yet.`)
  assert.equal(executed.length,0);assert.equal(approval('cal').status,'pending');assert.equal(approval('toit').status,'pending')
  assert.match((await number('3')).text,/^There's no #3 on that list\. Reply approve 1–2 or reject 1–2\. Nothing was done\./)
  const ok=await say('approve 2');assert.equal(ok.text,`Updated: ${TOIT}`);assert.deepEqual(executed,['run-toit'])
  said('assistant',ok.text,0.1)
  assert.equal(await number('2'),null,'list no longer the latest turn')
})

await check('B1: a bare number with no approval list on the table is left to normal routing',async()=>{
  seed([{id:'toit',title:TOIT,hoursAgo:0.01}])
  said('assistant','Here are 3 options:\n1. Toit\n2. Arbor\n3. Byg',0.2)
  assert.equal(await number('1'),null,'no persisted approval list')
  assert.equal(await number('hello'),null)
})

// ───────────────────────── B2: completion-claim guard ─────────────────────────
const g=await import('../lib/bot/completion-claim-guard')
const LIVE_FALSE="Booking confirmed for 2 at Toit Indiranagar tomorrow (20 Oct) at 7pm under Goverdhan. Check your email/SMS for the confirmation. Want me to block your calendar for this?"
const PENDING=[{title:TOIT,subject:'Toit Indiranagar',actionType:'booking'}]

await check('B2: the exact live false claim is replaced with an honest line naming the pending approval',()=>{
  const r=g.guardCompletionClaimsWith(LIVE_FALSE,[],PENDING)
  assert.equal(r.blocked,true)
  assert.equal(r.text,"I haven't booked anything — the Toit Indiranagar reservation is still waiting for your approval. Reply approve to go ahead, or reject to stop.")
  assert.equal(g.guardCompletionClaimsWith(LIVE_FALSE,[],[]).text,'Nothing has been booked yet.')
})

await check('B2: consequential completion claims of every kind are blocked without a record',()=>{
  const claims:Array<[string,string]>=[
    ['Your table at Toit is booked!','Nothing has been booked yet.'],
    ['I have booked the table for 4 at 8 pm.','Nothing has been booked yet.'],
    ['Reserved! See you at 7.','Nothing has been booked yet.'],
    ["You're all booked for Saturday.",'Nothing has been booked yet.'],
    ["I've sent the email to Ravi.",'Nothing has been sent.'],
    ['Done! Added to your calendar.','Nothing has been added to your calendar.'],
    ["I've placed your order on Swiggy.",'Nothing has been ordered yet.'],
    ['Payment successful.','Nothing has been paid.'],
    ["I've cancelled your Toit booking.",'Nothing has been cancelled.'],
    ["I've scheduled the call for 5pm.",'Nothing has been scheduled.'],
  ]
  for(const [t,expected] of claims){const r=g.guardCompletionClaimsWith(t,[],[]);assert.equal(r.blocked,true,t);assert.equal(r.text,expected,t)}
})

await check('B2: questions, offers, plans, negations and second-hand reports pass through',()=>{
  for(const t of ['Want me to book Toit for 7pm?',"I'll book it once you approve.","I haven't booked anything yet.",'You can book a table on Dineout.','The restaurant is fully booked on Saturdays.','Your Amazon order was placed yesterday according to your email.','Movie tickets are usually booked on BookMyShow.','Jailer 2 — PVR Orion Mall, 19 Oct at 9:45 pm.','Bengaluru will be 24°C today.'])
    assert.equal(g.guardCompletionClaimsWith(t,[],PENDING).blocked,false,t)
})

await check('B2: a matching verified record supports the claim; a different record does not',()=>{
  const jailer=[{kind:'booking' as const,label:'Jailer 2 BookMyShow PVR Orion Mall',at:null}]
  assert.equal(g.guardCompletionClaimsWith('Your Jailer 2 booking is confirmed for 19 Oct at PVR Orion Mall.',jailer,[]).blocked,false)
  assert.equal(g.guardCompletionClaimsWith(LIVE_FALSE,jailer,PENDING).blocked,true,'a Jailer ticket never supports a Toit claim')
  const toit=[{kind:'booking' as const,label:'Reserve Toit Indiranagar Toit Indiranagar',at:new Date().toISOString()}]
  assert.equal(g.guardCompletionClaimsWith('Booking confirmed for 2 at Toit Indiranagar tomorrow at 7pm.',toit,[]).blocked,false)
  assert.equal(g.guardCompletionClaimsWith('Booked! See you there.',toit,[]).blocked,false,'unnamed claim right after a verified completion')
  assert.equal(g.guardCompletionClaimsWith("I've sent the email to Ravi.",toit,[]).blocked,true,'a booking record never supports a send claim')
})

// Evidence loader: strict allowlist, owner-bound, read only when a claim exists.
function evidenceDb(seedRows:Record<string,Row[]>){
  const reads:Array<{table:string;filters:Array<[string,unknown]>}>=[]
  return {reads,from:(table:string)=>{
    const filters:Array<[string,unknown]>=[]
    const q:any={select:()=>q,eq:(k:string,v:unknown)=>{filters.push([k,v]);return q},gte:()=>q,order:()=>q,limit:()=>q,
      then:(res:any,rej:any)=>{reads.push({table,filters});return Promise.resolve({data:(seedRows[table]||[]).filter(r=>filters.every(([k,v])=>String(r[k])===String(v))),error:null}).then(res,rej)}}
    return q
  }}
}
await check('B2: evidence loader — pending approvals, research/slot runs and unconfirmed reservations are never evidence',async()=>{
  const now=new Date()
  const edb=evidenceDb({
    agent_runs:[
      {telegram_id:'123',status:'completed',title:'Reserve Toit',metadata_json:{plan_type:'restaurant_reservation_slot',restaurant:'Toit Indiranagar'},updated_at:now.toISOString()},
      {telegram_id:'123',status:'completed',title:'Toit research',metadata_json:{plan_type:'restaurant_reservation_research',restaurant:'Toit Indiranagar'},updated_at:now.toISOString()},
      {telegram_id:'999',status:'completed',title:'Reserve Toit',metadata_json:{plan_type:'restaurant_reservation_release',providerConfirmationVerified:true,restaurant:'Toit Indiranagar'},updated_at:now.toISOString()},
    ],
    life_events:[
      {telegram_id:'123',event_type:'reservation',title:'Reserve Toit Indiranagar',metadata_json:{reservationConfirmed:false},updated_at:now.toISOString()},
      {telegram_id:'123',event_type:'event',title:'Jailer 2',provider:'BookMyShow',location:'PVR Orion Mall',metadata_json:{},updated_at:now.toISOString()},
    ],
    agent_approvals:[{telegram_id:'123',status:'pending',title:TOIT,action_type:'booking',requested_at:now.toISOString(),execution_payload:{}}],
  })
  const mod=load('lib/bot/completion-claim-guard.ts',{'@/lib/supabase-admin':{supabaseAdmin:edb},'@/lib/agent/approval-ttl':ttl})
  const ev=await mod.loadCompletionEvidence(123,now)
  assert.ok(edb.reads.every(r=>r.filters.some(([k,v])=>k==='telegram_id'&&String(v)==='123')),'every read is owner-bound')
  assert.equal(ev.records.filter((r:any)=>/toit/i.test(r.label)).length,0,'no Toit record from slot/research runs, another owner, or an unconfirmed reservation')
  assert.ok(ev.records.some((r:any)=>r.kind==='booking'&&/Jailer 2/.test(r.label)),'a saved ticket booking is a record')
  assert.equal(ev.pending[0].subject,'Toit Indiranagar')
  const r=await mod.guardCompletionClaims(LIVE_FALSE,123,now)
  assert.equal(r.text,"I haven't booked anything — the Toit Indiranagar reservation is still waiting for your approval. Reply approve to go ahead, or reject to stop.")
  const before=edb.reads.length
  const plain=await mod.guardCompletionClaims('Bengaluru will be 24°C today.',123,now)
  assert.equal(plain.blocked,false);assert.equal(edb.reads.length,before,'no DB read without a claim')
})

await check('B2: unreadable records fail closed',async()=>{
  const mod=load('lib/bot/completion-claim-guard.ts',{'@/lib/supabase-admin':{supabaseAdmin:{from:()=>{throw new Error('db down')}}},'@/lib/agent/approval-ttl':ttl})
  const r=await mod.guardCompletionClaims(LIVE_FALSE,123)
  assert.equal(r.blocked,true);assert.equal(r.text,'Nothing has been booked yet.')
})

await check('B wiring: guard on chat + web replies, prompt rule, number handler before the pending-question resolver',()=>{
  const pm=readFileSync('lib/bot/process-message.ts','utf8')
  assert.match(pm,/if \(finalReply === rawClaude \|\| parsed\.type === 'search'\) \{\s*const completion = await guardCompletionClaims\(finalReply, resolvedUser\.telegramId\)/)
  const claude=readFileSync('lib/services/claude.ts','utf8')
  assert.match(claude,/NEVER CLAIM AN ACTION WAS COMPLETED/)
  assert.match(claude,/Only report actions that appear in the provided records\./)
  const route=readFileSync('app/api/webhooks/whatsapp/route.ts','utf8')
  const n=route.indexOf('tryRunWhatsAppApprovalNumber({ user: resolvedUser, text })')
  assert.ok(n>0&&n>route.indexOf('if (approvalIntent(text)) {')&&n<route.indexOf('const pendingAnswer = await tryResolvePendingQuestion('))
})

// ───────────────────────── C: arming a disclosed-gap live-slot approval ─────────────────────────
const CNOW=Date.parse('2026-10-19T17:58:00Z') // Mon 19 Oct, 23:28 IST
class Clock extends Date{constructor(...a:any[]){super(...(a.length?a:[CNOW]) as [])}static now(){return CNOW}}
const actor={legacyTelegramId:123,userId:'fixture-owner',whatsappId:'919800001501',name:'Fixture'}
const WIDGET='https://widget.reservego.com/toit-indiranagar'
const RESERVEGO={title:'Toit Indiranagar - Reserve a table | ReserveGo',url:WIDGET,snippet:'Reserve a table at Toit Brewpub, 100 Feet Road, Indiranagar, Bengaluru.'}
function makeDb(seedRows:Record<string,any[]>={}){
  const t:Record<string,any[]>=JSON.parse(JSON.stringify(seedRows));let ids=0
  const get=(r:any,k:string)=>{if(k.includes('->>')){const[a,b]=k.split('->>');const v=r[a]?.[b];return v==null?undefined:String(v)}return r[k]}
  function from(table:string){
    const rows=()=>t[table]||(t[table]=[])
    let op='select',payload:any=null,limitN=Infinity,orderKey='',asc=true
    const filters:Array<(r:any)=>boolean>=[]
    const exec=(single:boolean)=>{
      if(op==='insert'||op==='upsert'){const row={id:`${table}-${++ids}`,...payload};rows().push(row);return{data:single?row:[row],error:null}}
      let matched=rows().filter(r=>filters.every(f=>f(r)))
      if(op==='update'){matched.forEach(r=>Object.assign(r,payload));return{data:single?(matched[0]||null):matched,error:null}}
      if(orderKey)matched=[...matched].sort((x,y)=>String(get(x,orderKey)||'').localeCompare(String(get(y,orderKey)||''))*(asc?1:-1))
      matched=matched.slice(0,limitN)
      return{data:single?(matched[0]||null):matched,error:null}
    }
    const q:any={select:()=>q,eq:(k:string,v:any)=>{filters.push(r=>String(get(r,k))===String(v));return q},in:(k:string,vs:any[])=>{filters.push(r=>vs.map(String).includes(String(get(r,k))));return q},
      is:(k:string,v:any)=>{filters.push(r=>(get(r,k)??null)===v);return q},not:()=>q,lte:()=>q,gte:()=>q,lt:()=>q,gt:()=>q,
      order:(k:string,o?:any)=>{orderKey=k;asc=o?.ascending!==false;return q},limit:(n:number)=>{limitN=n;return q},
      update:(v:any)=>{op='update';payload=v;return q},insert:(v:any)=>{op='insert';payload=v;return q},upsert:(v:any)=>{op='upsert';payload=v;return q},
      maybeSingle:async()=>exec(true),single:async()=>exec(true),then:(res:any,rej:any)=>Promise.resolve().then(()=>exec(false)).then(res,rej)}
    return q
  }
  return{from,tables:t}
}
function loadReservation(opts:{calendarIncomplete?:boolean}){
  const rdb=makeDb({users:[{id:'fixture-owner',telegram_id:123,whatsapp_id:'919800001501',timezone:'Asia/Kolkata',email:null}]})
  const mod:any={}
  const contextPack=async(p:any)=>{const c={ownerId:'123',incomplete:false,coveredFrom:p.options.reservationCalendarCoverage?.from||new Date(CNOW).toISOString(),coveredUntil:p.options.reservationCalendarCoverage?.until||'2026-12-17T10:00:00Z'};return{facts:[],reservationTravel:{...c,facts:[]},reservationCalendar:{...c,connected:true,windows:[],incomplete:opts.calendarIncomplete===true},reservationPreferences:{ownerId:'123',incomplete:false,rules:[]}}}
  runInNewContext(transpile('lib/agent/restaurant-reservation.ts'),{exports:mod,require:(name:string)=>
    name==='node:crypto'?{createHash}:name==='@/lib/supabase-admin'?{supabaseAdmin:rdb}:name==='@/lib/timezone'?timezone:
    name==='./reservation-dining-context'?dining:name==='./approval-binding'?binding:name==='./india-locality'?locality:name==='./provider-booking'?providerBooking:
    name==='./reservation-guest-name'?guestNameModule:name==='@/lib/bot/pending-questions'?{openPendingQuestion:async()=>'q'}:
    name==='@/lib/web-search'?{searchWebResults:async()=>[RESERVEGO]}:
    name==='./secure-computer'?{runSecureBrowser:async()=>({status:'completed',url:WIDGET,title:'Toit Indiranagar | ReserveGo',summary:'Available times on Tue, 20 Oct for 2 guests: 7:00 PM',pageText:'Toit Brewpub Indiranagar. Select date: Tue, 20 Oct. Guests: 2. Available slots: 7:00 PM.'})}:
    name==='./context-brain'?{buildContextPack:contextPack}:{},
  Date:Clock,Intl,console,URL,Set,Map,Promise})
  return{mod,db:rdb}
}
async function preparedToit(calendarIncomplete:boolean){
  const h=loadReservation({calendarIncomplete})
  await h.mod.tryRunRestaurantReservation({actor,surface:'whatsapp',text:'Book a table for 2 at Toit Indiranagar tomorrow at 7pm'})
  const asked=await h.mod.continueRestaurantReservationGuestReply({actor,surface:'whatsapp',text:'Goverdhan'})
  const approvalRow=h.db.tables.agent_approvals[0]
  approvalRow.status='approved';approvalRow.resolved_at=new Date(CNOW).toISOString()
  return {h,asked,approvalRow,action:h.db.tables.life_event_actions[0],run:h.db.tables.agent_runs.find((r:any)=>r.metadata_json?.plan_type==='restaurant_reservation_release')}
}

await check('C: live incident — disclosed Calendar gap is bound into the approval and arming succeeds',async()=>{
  const {h,asked,action,run}=await preparedToit(true)
  assert.match(asked.text,/couldn't fully check your calendar for that evening/)
  assert.equal(action.payload_json.contextGapDisclosed,true)
  assert.deepEqual(action.payload_json.diningContext.reasons,['calendar_retrieval_incomplete'])
  const r=await h.mod.armApprovedRestaurantReservation({actor,runId:run.id})
  assert.equal(r.status,'queued',r.text)
  assert.equal(r.text,"Approved. Booking 7pm tomorrow for 2 at Toit Indiranagar under Goverdhan now — I'll message you the result. If a CAPTCHA, OTP or fee appears I'll stop and send you the link.")
  assert.equal(action.status,'ready');assert.equal(run.status,'queued')
})

await check('C: the disclosure flag cannot be added after approval (binding refuses)',async()=>{
  const {h,action,run}=await preparedToit(true)
  delete action.payload_json.contextGapDisclosed
  await assert.rejects(()=>h.mod.armApprovedRestaurantReservation({actor,runId:run.id}),/approval_action_changed|approval/)
  const p=h.mod.restaurantReservationApprovalInput({runId:'r',lifeEventId:'e',actionId:'a',restaurant:'Toit',providerUrl:WIDGET,partySize:2,preferredStart:'19:00',preferredEnd:'19:00',requestedDate:'2026-10-20',releaseAt:null,guestName:'G'})
  assert.equal('contextGapDisclosed' in p.payload,false,'existing approvals keep their hash')
  const q=h.mod.restaurantReservationApprovalInput({runId:'r',lifeEventId:'e',actionId:'a',restaurant:'Toit',providerUrl:WIDGET,partySize:2,preferredStart:'19:00',preferredEnd:'19:00',requestedDate:'2026-10-20',releaseAt:null,guestName:'G',contextGapDisclosed:true})
  assert.notEqual(buildApprovalBinding(p).action_hash,buildApprovalBinding(q).action_hash)
})

await check('C: complete context still arms; non-disclosable gaps, past dates, release missions stay refused',async()=>{
  const ok=await preparedToit(false)
  assert.equal(ok.action.payload_json.contextGapDisclosed,undefined)
  assert.equal((await ok.h.mod.armApprovedRestaurantReservation({actor,runId:ok.run.id})).status,'queued')
  const {h}=await preparedToit(true)
  const base={slotMission:true,guestName:'Goverdhan',contextGapDisclosed:true,preferredStart:'19:00',preferredEnd:'19:00',requestedDate:'2026-10-20'}
  const ctx=(await preparedToit(true)).action.payload_json.diningContext
  assert.equal(h.mod.disclosedLiveSlotContext({...base,diningContext:ctx}),true)
  assert.equal(h.mod.disclosedLiveSlotContext({...base,contextGapDisclosed:undefined,diningContext:ctx}),false,'no disclosure, no authority')
  assert.equal(h.mod.disclosedLiveSlotContext({...base,slotMission:undefined,diningContext:ctx}),false,'release-rule missions unchanged')
  assert.equal(h.mod.disclosedLiveSlotContext({...base,guestName:'',diningContext:ctx}),false)
  assert.equal(h.mod.disclosedLiveSlotContext({...base,preferredEnd:'21:00',diningContext:ctx}),false,'exact time only')
  assert.equal(h.mod.disclosedLiveSlotContext({...base,requestedDate:'2026-10-18',diningContext:ctx}),false,'past date refused')
  assert.equal(h.mod.disclosedLiveSlotContext({...base,diningContext:{...ctx,reasons:['calendar_retrieval_incomplete','dining_date_unverified']}}),false,'date gap never qualifies')
  assert.equal(h.mod.disclosedLiveSlotContext({...base,diningContext:{...ctx,reasons:['owner_preferences_unverified']}}),false,'preference gap never qualifies')
  assert.equal(h.mod.disclosedLiveSlotContext({...base,diningContext:{...ctx,ownerId:'not-a-number'}}),false,'structural checks still apply')
})

await check('C: worker re-check — a fresh read may not add a restriction or a new kind of gap',async()=>{
  const ctx=(await preparedToit(true)).action.payload_json.diningContext
  const now=new Date(CNOW)
  assert.equal(dining.sameDisclosedGapRestrictions(ctx,ctx,now),true)
  assert.equal(dining.sameDisclosedGapRestrictions(ctx,{...ctx,incomplete:false,reasons:[]},now),true,'the gap closing is fine')
  assert.equal(dining.sameDisclosedGapRestrictions(ctx,{...ctx,reasons:['calendar_retrieval_incomplete','travel_retrieval_incomplete']},now),false,'a new gap kind needs a new approval')
  assert.equal(dining.sameDisclosedGapRestrictions(ctx,{...ctx,calendar:{connected:true,windows:[{startAt:ctx.from,endAt:ctx.until,sourceRefs:[{type:'calendar_event',id:'x'}]}]}},now),false,'a new busy window needs a new approval')
  const worker=readFileSync('lib/agent/restaurant-reservation-worker.ts','utf8')
  assert.match(worker,/disclosedGap\?sameDisclosedGapRestrictions\(snapshot,fresh,new Date\(\)\):sameReservationRestrictions/)
  assert.match(worker,/contextGapDisclosed:payload\.contextGapDisclosed===true\}\)\n  assertApprovalBinding\(input,approval\)/)
  assert.match(worker,/If any fee, deposit, payment[^`]*CAPTCHA[^`]*stop before it/,'fee/CAPTCHA/OTP stop unchanged')
  assert.match(worker,/Never submit a second time if the result is uncertain\./,'no blind retry')
})

if(failures.length){console.error(failures.join('\n\n'));process.exit(1)}
console.log('Approve flow (19 Oct incident A–C): verified')
