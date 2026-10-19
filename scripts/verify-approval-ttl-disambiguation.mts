// Approval-card TTL + disambiguation — BEHAVIOURAL CHECKS against the real WhatsApp bridge, the
// typed calendar/reminder approval turn, and the dashboard approvals route. Each is transpiled and
// run with an in-memory agent_approvals/agent_runs/agent_activity store and the REAL shared
// approval guard; executors are recording stubs that re-check the exact approval binding of the run
// they were handed. No network, no real DB.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'
import * as ttl from '../lib/agent/approval-ttl'
import {buildApprovalBinding,assertApprovalBinding} from '../lib/agent/approval-binding'

const H=3_600_000
const NOW=Date.now()
const ago=(hours:number)=>new Date(NOW-hours*H).toISOString()

// ---- Pure helpers ----
assert.equal(ttl.APPROVAL_TTL_HOURS,24)
assert.equal(ttl.isApprovalExpired({requested_at:ago(1)},NOW),false,'1h-old approval is live')
assert.equal(ttl.isApprovalExpired({requested_at:ago(25)},NOW),true,'25h-old approval is expired at default TTL')
assert.equal(ttl.isApprovalExpired({requested_at:ago(25)},NOW,48),false,'ttl override is honoured')
assert.equal(ttl.isApprovalExpired({requested_at:ago(1),execution_payload:{expires_at:ago(0.5)}},NOW),true,'explicit payload expires_at wins over TTL')
assert.equal(ttl.isApprovalExpired({requested_at:ago(30),execution_payload:{expiresAt:new Date(NOW+H).toISOString()}},NOW),false,'explicit future expiresAt keeps an old card live')
assert.equal(ttl.isApprovalExpired({requested_at:ago(1),expires_at:ago(0.1)},NOW),true,'row-level expires_at is honoured')
assert.equal(ttl.isApprovalExpired({requested_at:null},NOW),true,'unprovable age fails closed')
assert.equal(ttl.isApprovalExpired({requested_at:ago(1),execution_payload:{expires_at:'not-a-date'}},NOW),false,'invalid explicit expiry falls back to TTL')
assert.equal(ttl.approvalRelativeAge(ago(26),NOW),'26 hours ago')
assert.equal(ttl.approvalRelativeAge(ago(72),NOW),'3 days ago')
assert.equal(ttl.approvalRelativeAge(new Date(NOW-5*60_000).toISOString(),NOW),'5 minutes ago')
console.log('PASS pure TTL helpers')

// ---- Bridge fixture ----
type Row=Record<string,any>
let tables:Record<string,Row[]>={}
let insertSeq=0
function query(table:string){
  const filters:Array<[string,unknown]>=[]
  let patch:Row|null=null, insert:Row|null=null, order:{key:string;asc:boolean}|null=null, limit=Infinity
  const rows=()=>(tables[table]||=[]).filter(r=>filters.every(([k,v])=>String(r[k])===String(v)))
  const run=()=>{
    // created_at mirrors the DB default and is strictly increasing, so "latest" reads are deterministic.
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

const executed:string[]=[]
const bindingInput=(runId:string,title:string)=>({missionId:runId,stepId:'step-1',capability:'calendar',actionType:'calendar_change',target:'calendar:primary',payload:{title}})
const tamperedRuns=new Set<string>()
async function executeApprovedCalendarUpdate({runId}:{runId:string}){
  const approval=tables.agent_approvals.find(a=>a.run_id===runId)
  assert.equal(approval?.status,'approved','executor only ever sees an approved card')
  // Exact binding is still enforced on the chosen item, never weakened by disambiguation.
  assertApprovalBinding(bindingInput(runId,tamperedRuns.has(runId)?'CHANGED':approval!.title),approval)
  executed.push(runId)
  return {text:`Updated: ${approval!.title}`,status:'completed'}
}
const fail=(name:string)=>()=>{throw new Error(`${name} must not run in approval tests`)}
const noop=new Proxy({}, {get:(_t,key)=>/^(?:record|observe|capture)/.test(String(key))?async()=>null:()=>null})
function load(path:string,deps:Record<string,unknown>){
  const exports:any={}
  runInNewContext(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
    exports,require:(name:string)=>(deps as any)[name]||noop,
    Date,Intl,console,URL,Request,Response,Buffer,process,setTimeout,clearTimeout,
  })
  return exports
}
// The real shared guard, bound to the in-memory store. Every surface below uses this same module.
const guard=load('lib/agent/approval-guard.ts',{'@/lib/supabase-admin':{supabaseAdmin:db},'./approval-ttl':ttl})
const {tryRunWhatsAppAgent,approvalIntent,parseApprovalIntent}=load('lib/agent/whatsapp-bridge.ts',{
  '@/lib/supabase-admin':{supabaseAdmin:db},
  './approval-ttl':ttl,
  './approval-guard':guard,
  './calendar-update':{executeApprovedCalendarUpdate},
  './orchestrator':{...noop,executeApprovedAgentRun:fail('executeApprovedAgentRun')},
})
const {tryTypedTimeRouting}=load('lib/agent/typed-time-routing.ts',{
  '@/lib/supabase-admin':{supabaseAdmin:db},
  './approval-guard':guard,
  './calendar-update':{executeApprovedCalendarUpdate},
  './reminder-update':{executeApprovedReminderUpdate:fail('executeApprovedReminderUpdate')},
})
const sessionOwner={telegramId:'123',surface:'dashboard'}
const {POST:approveRoute}=load('app/api/agent/approvals/[id]/route.ts',{
  'next/server':{NextResponse:{json:(body:unknown,init?:{status?:number})=>({body,status:init?.status??200})}},
  '@/lib/supabase-admin':{supabaseAdmin:db},
  '@/lib/agent/session':{requireAgentMutationOrigin:()=>null,requireAgentSession:async()=>sessionOwner,isAgentSession:()=>true},
  '@/lib/agent/approval-guard':guard,
})
const dashboard=(id:string,decision='approve')=>approveRoute({json:async()=>({decision})},{params:Promise.resolve({id})})
const typedActor={userId:'fixture',legacyTelegramId:123,whatsappId:'fixture-owner',name:'Example'}
const typed=(text:string)=>tryTypedTimeRouting({actor:typedActor,text,surface:'whatsapp'})
const user={id:'fixture',telegramId:123,whatsappId:'fixture-owner',name:'Example'}
const say=(text:string)=>tryRunWhatsAppAgent({user,text})

function approvalRow(it:{id:string;title:string;hoursAgo:number;payload?:Row}){
  const runId=`run-${it.id}`
  return {id:it.id,telegram_id:'123',run_id:runId,title:it.title,action_type:'calendar_change',risk_level:'medium',status:'pending',requested_at:ago(it.hoursAgo),execution_payload:it.payload||{},...buildApprovalBinding(bindingInput(runId,it.title))}
}
function addApproval(it:{id:string;title:string;hoursAgo:number;payload?:Row}){
  tables.agent_runs.push({id:`run-${it.id}`,telegram_id:'123',status:'waiting_approval',metadata_json:{plan_type:'calendar_update'}})
  tables.agent_approvals.push(approvalRow(it))
}
function seed(items:Array<{id:string;title:string;hoursAgo:number;payload?:Row}>){
  tables={agent_approvals:[],agent_runs:[],agent_activity:[]}
  for(const it of items){
    const runId=`run-${it.id}`
    tables.agent_runs.push({id:runId,telegram_id:'123',status:'waiting_approval',metadata_json:{plan_type:'calendar_update'}})
    tables.agent_approvals.push(approvalRow(it))
  }
  executed.length=0
  tamperedRuns.clear()
}
const approval=(id:string)=>tables.agent_approvals.find(a=>a.id===id)!
const run=(id:string)=>tables.agent_runs.find(r=>r.id===`run-${id}`)!

const failures:string[]=[]
async function check(label:string,fn:()=>unknown){try{await fn();console.log('PASS '+label)}catch(e:any){failures.push(label+': '+(e?.stack||e?.message))}}

await check('parser keeps the boolean/decision wrapper and adds the index',()=>{
  for(const t of ['Approve','“Approve”','approve.','yes approve']){assert.equal(approvalIntent(t),'approve');assert.deepEqual({...parseApprovalIntent(t)},{decision:'approve'})}
  for(const t of ['approve 2','Approve #2','approve#2','yes approve 2','“approve 2”']){assert.equal(approvalIntent(t),'approve',t);assert.deepEqual({...parseApprovalIntent(t)},{decision:'approve',index:2},t)}
  for(const t of ['reject 1','Reject #1','decline 1']){assert.equal(approvalIntent(t),'reject',t);assert.deepEqual({...parseApprovalIntent(t)},{decision:'reject',index:1},t)}
  for(const t of ['approve the Hugging Face account for me please','approve 2 things','approve it 2','reject 123','']){assert.equal(approvalIntent(t),null,t);assert.equal(parseApprovalIntent(t),null,t)}
})

await check('expired single approval: not executed, marked expired, honest copy',async()=>{
  seed([{id:'a1',title:'Move dentist to 5 PM',hoursAgo:26}])
  const r=await say('Approve')
  assert.equal(r.text,"That approval expired (requested 26 hours ago). Nothing was done. Ask me again and I'll prepare a fresh request.")
  assert.equal(r.status,'expired')
  assert.equal(executed.length,0)
  assert.equal(approval('a1').status,'expired')
  assert.match(String(approval('a1').resolution_note),/Expired before a decision.*nothing was executed/)
  assert.equal(run('a1').status,'paused','expired run cannot be picked up by a worker')
  assert.ok(tables.agent_activity.some(a=>a.event_type==='approval_expired'))
})

await check('explicit per-action expires_at expires a card younger than the TTL',async()=>{
  seed([{id:'p1',title:'Book table',hoursAgo:2,payload:{expires_at:ago(1)}}])
  const r=await say('approve')
  assert.equal(r.status,'expired');assert.equal(executed.length,0);assert.equal(approval('p1').status,'expired')
})

await check('fresh single approval behaves exactly as before',async()=>{
  seed([{id:'f1',title:'Move standup to 10 AM',hoursAgo:1}])
  const r=await say('Approve')
  assert.equal(r.text,'Updated: Move standup to 10 AM')
  assert.equal(r.handledBy,'whatsapp-agent-approval')
  assert.deepEqual(executed,['run-f1'])
  assert.equal(approval('f1').status,'approved')
  assert.equal(run('f1').status,'queued')
  seed([{id:'f2',title:'Send invoice',hoursAgo:1}])
  const rj=await say('Reject')
  assert.equal(rj.text,'Rejected: Send invoice. Gogo did not execute that action.')
  assert.equal(executed.length,0);assert.equal(approval('f2').status,'rejected');assert.equal(run('f2').status,'paused')
})

await check('no pending approvals: falls through unchanged',async()=>{
  seed([])
  assert.equal(await say('Approve'),null)
  assert.equal(await say('approve 2'),null)
})

await check('two pending + bare approve: numbered list, nothing executed',async()=>{
  seed([{id:'old',title:'Email Ravi the deck',hoursAgo:3},{id:'new',title:'Move gym to 7 AM',hoursAgo:1}])
  const r=await say('Approve')
  assert.equal(r.handledBy,'whatsapp-agent-approval-choice')
  assert.match(r.text,/You have 2 pending approvals/)
  assert.match(r.text,/1\. Email Ravi the deck \(requested 3 hours ago\)\n2\. Move gym to 7 AM \(requested 1 hour ago\)/,'oldest first, with age')
  assert.match(r.text,/Reply approve 1 or reject 2\./)
  assert.equal(executed.length,0)
  assert.equal(approval('old').status,'pending');assert.equal(approval('new').status,'pending')
  const rj=await say('yes approve');assert.equal(executed.length,0);assert.match(rj.text,/Reply approve 1 or reject 2/)
  const rr=await say('reject');assert.equal(approval('old').status,'pending');assert.equal(approval('new').status,'pending');assert.match(rr.text,/1\. Email Ravi/)
})

await check('"approve 2" resolves exactly item 2 from the same list; item 1 untouched',async()=>{
  seed([{id:'old',title:'Email Ravi the deck',hoursAgo:3},{id:'new',title:'Move gym to 7 AM',hoursAgo:1}])
  await say('approve')
  const r=await say('approve #2')
  assert.equal(r.text,'Updated: Move gym to 7 AM')
  assert.deepEqual(executed,['run-new'])
  assert.equal(approval('new').status,'approved')
  assert.equal(approval('old').status,'pending');assert.equal(run('old').status,'waiting_approval')
})

await check('exact binding still applies to the chosen item',async()=>{
  seed([{id:'old',title:'Email Ravi the deck',hoursAgo:3},{id:'new',title:'Move gym to 7 AM',hoursAgo:1}])
  await say('approve')
  tamperedRuns.add('run-new')
  await assert.rejects(()=>say('approve 2'),/approval_action_changed/)
  assert.equal(executed.length,0)
  assert.equal(approval('old').status,'pending')
})

await check('out-of-range index asks again, nothing executed',async()=>{
  seed([{id:'old',title:'Email Ravi the deck',hoursAgo:3},{id:'new',title:'Move gym to 7 AM',hoursAgo:1}])
  await say('approve')
  for(const t of ['approve 3','approve 0','reject 9']){
    const r=await say(t)
    assert.match(r.text,/There are 2 pending approvals, so there is no number \d\. Nothing was done\./,t)
    assert.match(r.text,/Reply approve 1 or reject 2\./)
  }
  assert.equal(executed.length,0)
  assert.equal(approval('old').status,'pending');assert.equal(approval('new').status,'pending')
  seed([{id:'only',title:'Send invoice',hoursAgo:1}])
  const listed=await say('approve 2')
  assert.match(listed.text,/I don't have a current numbered list for approve 2, so nothing was done\. You have 1 pending approval:\n1\. Send invoice/)
  assert.equal(executed.length,0);assert.equal(approval('only').status,'pending')
  const r=await say('approve 2')
  assert.match(r.text,/There is only 1 pending approval, so there is no number 2/)
  assert.equal(executed.length,0);assert.equal(approval('only').status,'pending')
  const ok=await say('approve 1');assert.equal(ok.text,'Updated: Send invoice');assert.deepEqual(executed,['run-only'])
})

await check('expired items are excluded from numbering and closed',async()=>{
  seed([{id:'stale',title:'Old flight check-in',hoursAgo:30},{id:'b',title:'Email Ravi the deck',hoursAgo:3},{id:'c',title:'Move gym to 7 AM',hoursAgo:1}])
  const r=await say('Approve')
  assert.match(r.text,/^That approval expired \(requested 30 hours ago\)\. Nothing was done\./)
  assert.match(r.text,/1\. Email Ravi the deck[^\n]*\n2\. Move gym to 7 AM/)
  assert.doesNotMatch(r.text,/\d\. Old flight check-in/)
  assert.equal(approval('stale').status,'expired');assert.equal(executed.length,0)
  const r2=await say('approve 1')
  assert.equal(r2.text,'Updated: Email Ravi the deck');assert.deepEqual(executed,['run-b']);assert.equal(approval('c').status,'pending')
})

await check('expired card plus one live card: bare approve does not guess',async()=>{
  seed([{id:'live',title:'Email Ravi the deck',hoursAgo:2},{id:'gone',title:'Book table',hoursAgo:1,payload:{expires_at:ago(0.5)}}])
  const r=await say('Approve')
  assert.match(r.text,/That approval expired \(requested 1 hour ago\)/)
  assert.match(r.text,/You still have 1 pending approval:\n1\. Email Ravi the deck/)
  assert.match(r.text,/Reply approve 1 or reject 1\./)
  assert.equal(executed.length,0);assert.equal(approval('gone').status,'expired');assert.equal(approval('live').status,'pending')
})

await check('reject N rejects exactly that item',async()=>{
  seed([{id:'old',title:'Email Ravi the deck',hoursAgo:3},{id:'new',title:'Move gym to 7 AM',hoursAgo:1}])
  await say('approve')
  const r=await say('reject 1')
  assert.equal(r.text,'Rejected: Email Ravi the deck. Gogo did not execute that action.')
  assert.equal(approval('old').status,'rejected');assert.equal(run('old').status,'paused')
  assert.equal(approval('new').status,'pending');assert.equal(run('new').status,'waiting_approval')
  assert.equal(executed.length,0)
})

await check('list is bounded to 5 and numbering matches resolution',async()=>{
  seed(Array.from({length:7},(_,i)=>({id:`n${i}`,title:`Action ${i}`,hoursAgo:10-i})))
  const r=await say('approve')
  assert.match(r.text,/You have 5 pending approvals/)
  assert.match(r.text,/showing the latest 5 of 7/)
  assert.match(r.text,/1\. Action 2 /);assert.match(r.text,/5\. Action 6 /);assert.doesNotMatch(r.text,/6\. /)
  const r3=await say('approve 3');assert.equal(r3.text,'Updated: Action 4');assert.deepEqual(executed,['run-n4'])
})


// ---- Shared expiry guard on every approval surface ----
function seedTyped(id:string,hoursAgo:number){
  seed([{id,title:'Move standup to 10 AM',hoursAgo,payload:{plan_type:'calendar_update'}}])
}

await check('typed-time "approve" on an expired calendar_update: not executed, closed as expired',async()=>{
  seedTyped('t1',72)
  const r=await typed('approve')
  assert.equal(r.status,'expired')
  assert.equal(r.text,"That approval expired (requested 3 days ago). Nothing was done. Ask me again and I'll prepare a fresh request.")
  assert.equal(executed.length,0)
  assert.equal(approval('t1').status,'expired')
  assert.equal(run('t1').status,'paused')
  assert.ok(tables.agent_activity.some(a=>a.event_type==='approval_expired'&&a.metadata_json?.surface==='typed'))
  seedTyped('t2',72)
  const rj=await typed('reject')
  assert.equal(rj.status,'expired');assert.equal(approval('t2').status,'expired')
})

await check('typed-time "approve" on a fresh calendar_update executes as before',async()=>{
  seedTyped('t3',1)
  const r=await typed('approve')
  assert.equal(r.text,'Updated: Move standup to 10 AM')
  assert.deepEqual(executed,['run-t3'])
  assert.equal(approval('t3').status,'approved')
})

const UA='00000000-0000-4000-8000-00000000000a',UB='00000000-0000-4000-8000-00000000000b'
await check('dashboard approve on an expired card: 409, closed as expired, run never queued',async()=>{
  seed([{id:UA,title:'Send invoice',hoursAgo:30}])
  const r=await dashboard(UA)
  assert.equal(r.status,409)
  assert.equal(r.body.error,'approval_expired')
  assert.match(r.body.message,/^That approval expired \(requested 30 hours ago\)\. Nothing was done\./)
  assert.equal(approval(UA).status,'expired')
  assert.equal(run(UA).status,'paused')
  assert.equal(executed.length,0)
  assert.ok(!tables.agent_activity.some(a=>a.event_type==='approval_granted'))
  assert.ok(tables.agent_activity.some(a=>a.event_type==='approval_expired'&&a.metadata_json?.surface==='dashboard'))
  const again=await dashboard(UA)
  assert.equal(again.status,409);assert.equal(again.body.error,'not_found_or_already_resolved')
})

await check('dashboard approve/reject on a fresh card is unchanged; other owners untouched',async()=>{
  seed([{id:UA,title:'Send invoice',hoursAgo:1},{id:UB,title:'Book table',hoursAgo:1}])
  approval(UB).telegram_id='999'
  const r=await dashboard(UA)
  assert.equal(r.status,200)
  assert.equal(r.body.approval.status,'approved')
  assert.equal(approval(UA).status,'approved')
  assert.equal(run(UA).status,'queued')
  assert.ok(tables.agent_activity.some(a=>a.event_type==='approval_granted'))
  const foreign=await dashboard(UB)
  assert.equal(foreign.status,409);assert.equal(approval(UB).status,'pending')
  seed([{id:UB,title:'Book table',hoursAgo:1}])
  const rj=await dashboard(UB,'reject')
  assert.equal(rj.status,200);assert.equal(approval(UB).status,'rejected');assert.equal(run(UB).status,'paused')
})

// ---- "approve N" binds to the exact list shown ----
await check('list [A,B,C], A expires, "approve 1": A refused as expired, B NOT executed',async()=>{
  seed([{id:'A',title:'Email Ravi the deck',hoursAgo:5},{id:'B',title:'Move gym to 7 AM',hoursAgo:3},{id:'C',title:'Send invoice',hoursAgo:1}])
  const list=await say('approve')
  assert.match(list.text,/1\. Email Ravi the deck[^\n]*\n2\. Move gym to 7 AM[^\n]*\n3\. Send invoice/)
  approval('A').requested_at=ago(25)
  const r=await say('approve 1')
  assert.match(r.text,/^That approval expired \(requested 25 hours ago\)\. Nothing was done\./)
  assert.match(r.text,/You still have 2 pending approvals:\n1\. Move gym to 7 AM[^\n]*\n2\. Send invoice/)
  assert.equal(executed.length,0,'B must not execute in place of A')
  assert.equal(approval('A').status,'expired')
  assert.equal(approval('B').status,'pending');assert.equal(approval('C').status,'pending')
  const next=await say('approve 1')
  assert.equal(next.text,'Updated: Move gym to 7 AM','the refreshed list is the new binding')
  assert.deepEqual(executed,['run-B'])
})

await check('6th approval arriving after the list does not shift "approve 1"',async()=>{
  seed(Array.from({length:5},(_,i)=>({id:`s${i}`,title:`Action ${i}`,hoursAgo:10-i})))
  const list=await say('approve')
  assert.match(list.text,/1\. Action 0 /)
  addApproval({id:'s5',title:'Action 5',hoursAgo:0.1})
  const r=await say('approve 1')
  assert.equal(r.text,'Updated: Action 0')
  assert.deepEqual(executed,['run-s0'])
  assert.equal(approval('s1').status,'pending');assert.equal(approval('s5').status,'pending')
})

await check('no snapshot + "approve 2": list shown, nothing executed',async()=>{
  seed([{id:'x',title:'Email Ravi the deck',hoursAgo:3},{id:'y',title:'Move gym to 7 AM',hoursAgo:1}])
  const r=await say('approve 2')
  assert.equal(r.handledBy,'whatsapp-agent-approval-choice')
  assert.match(r.text,/I don't have a current numbered list for approve 2, so nothing was done\. You have 2 pending approvals:\n1\. Email Ravi the deck[^\n]*\n2\. Move gym to 7 AM/)
  assert.equal(executed.length,0)
  assert.equal(approval('x').status,'pending');assert.equal(approval('y').status,'pending')
  const snap=tables.agent_activity.filter(a=>a.event_type==='approval_choice_list').at(-1)
  assert.deepEqual(snap?.metadata_json?.approval_ids,['x','y'],'the list just shown is persisted as exact ids')
})

await check('stale snapshot (>30 min) is never used; list shown again',async()=>{
  seed([{id:'x',title:'Email Ravi the deck',hoursAgo:3},{id:'y',title:'Move gym to 7 AM',hoursAgo:1}])
  await say('approve')
  for(const a of tables.agent_activity)if(a.event_type==='approval_choice_list')a.metadata_json.at=ago(0.6)
  const r=await say('reject 1')
  assert.match(r.text,/I don't have a current numbered list for reject 1/)
  assert.equal(approval('x').status,'pending');assert.equal(executed.length,0)
})

await check('snapshot item already handled: refused honestly, nothing else runs',async()=>{
  seed([{id:'x',title:'Email Ravi the deck',hoursAgo:3},{id:'y',title:'Move gym to 7 AM',hoursAgo:1}])
  await say('approve')
  await say('reject 1')
  assert.equal(approval('x').status,'rejected')
  const r=await say('approve 1')
  assert.match(r.text,/^Approval 1 from that list is no longer pending \(it was already rejected\)\. Nothing was done\./)
  assert.match(r.text,/You still have 1 pending approval:\n1\. Move gym to 7 AM/)
  assert.equal(executed.length,0);assert.equal(approval('y').status,'pending')
})

await check('snapshot belongs to its owner only',async()=>{
  seed([{id:'x',title:'Email Ravi the deck',hoursAgo:3},{id:'y',title:'Move gym to 7 AM',hoursAgo:1}])
  tables.agent_activity.push({telegram_id:'999',event_type:'approval_choice_list',created_at:new Date(NOW+1e9).toISOString(),metadata_json:{approval_ids:['y','x'],at:new Date().toISOString()}})
  const r=await say('approve 1')
  assert.match(r.text,/I don't have a current numbered list/)
  assert.equal(executed.length,0)
})

if(failures.length){console.error(failures.join('\n\n'));process.exit(1)}
console.log('approval TTL + disambiguation verification passed')
