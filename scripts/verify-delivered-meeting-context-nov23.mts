import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import {createHash} from 'node:crypto'
import ts from 'typescript'
import * as timezone from '../lib/timezone'
import {isMetaMessageId} from '../lib/channels/whatsapp-provider/provider'

const command = 'Move this tmrw 4.30pm'
const phone = '+918884501501'
let now = Date.parse('2026-11-23T10:55:00Z')
class FixtureDate extends Date {constructor(value?:any){super(value === undefined ? now : value)}static now(){return now}}
const original = {id:'delivered',telegram_id:-42,chat_id:-42,whatsapp_to:phone,message:'Askgogo<>Fund Raise — starts 23 Nov 2026, 4:30 pm\nhttps://calendar.app.google/8KVz8n3xPM13FnJh9\nhttps://meet.google.com/ycz-gire-akz',remind_at:'2026-11-23T10:50:00.000Z',sent:true,sent_at:'2026-11-23T10:50:37.000Z',twilio_sid:'verified-sid',timezone:'Asia/Kolkata',delivery_state:'read',is_recurring:false,recurring_pattern:null,claim_token:null,send_started_at:null}
const event = {id:'event',iCalUID:'same-event',_account:'owner@example.test',summary:'Askgogo<>Fund Raise',hangoutLink:'https://meet.google.com/ycz-gire-akz',start:{dateTime:'2026-11-24T16:30:00+05:30'},end:{dateTime:'2026-11-24T17:45:00+05:30'},status:'confirmed'}
let rows:any[], turns:any[], receipt:any, calendar:any, levels:any, failure:string, writes:any[], reads:any[], calendars:number, legacy:number
function reset(){
  now=Date.parse('2026-11-23T10:55:00Z'); rows=[{...original}]; turns=[]; receipt={provider_sid:'verified-sid',receipt_verified:true,status:'read',chunk:1,chunks:1}
  calendar={events:[structuredClone(event)],hasMore:false,accountsRead:2,accountsTotal:2};levels={reminders:'auto',calendar:'ask'};failure='';writes=[];reads=[];calendars=0;legacy=0
}
const db={from(table:string){
  assert.ok(['reminders','delivery_receipts','conversations','users'].includes(table),'no model, provider write, other private or send tables')
  let filters:((r:any)=>boolean)[]=[],op='',payload:any,single=false,max=Infinity,orderKey='',ascending=true
  const q:any={select:()=>q,eq(k:string,v:any){filters.push(r=>r[k]===v);return q},is(k:string,v:any){filters.push(r=>r[k]===v);return q},
    in(k:string,v:any[]){filters.push(r=>v.includes(r[k]));return q},gte(k:string,v:any){filters.push(r=>r[k]>=v);return q},
    order(k:string,o:any){orderKey=k;ascending=o.ascending;return q},limit(n:number){max=n;return q},maybeSingle(){single=true;return q},
    insert(p:any){assert.equal(table,'reminders');op='insert';payload=p;return q},update(p:any){assert.equal(table,'reminders');op='update';payload=p;return q},
    then(resolve:any,reject:any){
      reads.push({table,op});let error:any=null
      if(op==='update' && failure==='race') rows.find(r=>!r.sent).claim_token='other-worker'
      if(op==='update' && failure==='race-recipient') rows.find(r=>!r.sent).whatsapp_to='+919999999999'
      if(!op&&table==='reminders'&&single&&failure==='readback-recipient') rows.find(r=>!r.sent).whatsapp_to='+919999999999'
      let data=(table==='reminders'?rows:table==='conversations'?turns:table==='users'?[{telegram_id:-42,google_calendar_connected:true,google_refresh_token:failure==='missing-primary'?null:'inert-fixture'}]:[receipt]).filter(r=>filters.every(f=>f(r)))
      if(orderKey)data.sort((a,b)=>String(a[orderKey]).localeCompare(String(b[orderKey]))*(ascending?1:-1))
      data=data.slice(0,max)
      if(op){
        writes.push({op,payload})
        if(op==='insert'){
          if(rows.some(r=>r.id===payload.id))error={code:'23505'}
          else if(failure!=='write-lost')rows.push({...payload,delivery_state:'pending',claim_token:null,send_started_at:null})
          if(failure.startsWith('write-'))error={code:'uncertain'}
        }else for(const r of data)Object.assign(r,payload)
      }
      if(!op&&table==='reminders'&&single&&failure==='readback')error={code:'readback-failed'}
      return Promise.resolve({data:single?data[0]||null:data,error}).then(resolve,reject)
    },
  };return q
}}
const actual:any={}
runInNewContext(ts.transpileModule(readFileSync('lib/agent/contextual-meeting-reschedule.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
  exports:actual,Date:FixtureDate,Intl,URL,Set,console,
  require(name:string){
    if(name==='node:crypto')return {createHash}
    if(name==='@/lib/supabase-admin')return {supabaseAdmin:db}
    if(name==='@/lib/channels/whatsapp-provider/provider')return {isMetaMessageId}
    if(name==='@/lib/timezone')return timezone
    if(name==='./adaptive-autonomy')return {capabilityPermissionLevel:async(owner:number,cap:string)=>{assert.equal(owner,-42);if(failure==='policy')throw Error('policy');if(failure==='permission-change'&&calendars&&cap==='reminders')return 'off';return levels[cap]}}
    if(name==='@/lib/services/google-calendar-accounts')return {
      getCalendarAccountAccess:async(owner:number,_token:unknown,onUnavailable:()=>void)=>{assert.equal(owner,-42);calendars++;if(failure==='provider')throw Error('provider');if(failure==='discovery')onUnavailable();return [{primary:true}]},
      fetchMergedCalendarEventsPage:async()=>calendar,describeEventRange:()=> 'Tue, 24 Nov, 4:30–5:45 pm IST',
    }
    throw Error('forbidden effectful import: '+name)
  },
})
const invoke=(text=command,owner=-42)=>actual.tryContextualMeetingReschedule({telegramId:owner,phone,text,surface:'whatsapp'})
const quotedSid = 'MM' + 'a'.repeat(32)
function laterDelivery() {
  reset()
  now = Date.parse('2026-11-23T14:26:58Z')
  rows[0].twilio_sid = quotedSid
  receipt.provider_sid = quotedSid
  rows.push({...original,id:'newer-ordinary',message:'Call Divya',sent_at:'2026-11-23T12:30:39Z',twilio_sid:'MM'+'b'.repeat(32)})
  turns.push({telegram_id:-42,role:'user',created_at:'2026-11-23T13:00:00Z',content:'An unrelated message'})
}
const quoted = (sid=quotedSid) => actual.tryContextualMeetingReschedule({telegramId:-42,phone,text:command,surface:'whatsapp',replyToSid:sid})
laterDelivery()
assert.match(await quoted(),/24 Nov 2026, 4:20 pm/,'an exact quoted delivery wins over newer unrelated context')
assert.equal(rows.filter(r=>!r.sent).length,1)
assert.equal(rows[1].message,'Call Divya')
assert.equal(await invoke(),null,'unquoted stale context cannot authorize a change')
laterDelivery()
now = Date.parse('2026-11-24T03:45:00Z')
const todayCommand = 'Move this today 4.30pm'
function quotedToday() {
  return actual.tryContextualMeetingReschedule({telegramId:-42,phone,text:todayCommand,surface:'whatsapp',replyToSid:quotedSid})
}
assert.match(await quotedToday(),/24 Nov 2026, 4:20 pm/,'verified quoted today command uses current date and original lead time')
assert.equal(rows.filter(r=>!r.sent).length,1)
assert.match(await quotedToday(),/24 Nov 2026, 4:20 pm/)
assert.equal(writes.length,1)
assert.equal(await invoke(todayCommand),null,'today requires an exact quote')
laterDelivery()
now = Date.parse('2026-11-24T03:45:00Z')
calendar.events[0].start.dateTime = '2026-11-24T17:00:00+05:30'
assert.match(await quotedToday(),/not at the requested time/)
assert.equal(writes.length,0)
laterDelivery()
const metaReplyId = 'wamid.fixture_b7bn-eg='
rows[0].twilio_sid = receipt.provider_sid = metaReplyId
assert.match(await quoted(metaReplyId),/24 Nov 2026, 4:20 pm/,'a signed Meta quote uses the same exact delivered reminder')
for (const invalidate of [
  ()=>{rows[0].telegram_id=-43},
  ()=>{rows[0].whatsapp_to='+919999999999'},
  ()=>{receipt.receipt_verified=false},
  ()=>{rows[0].sent_at='2026-11-22T10:50:37Z'},
  ()=>{rows.push({...rows[0],id:'duplicated-sid'})},
]) {
  laterDelivery()
  invalidate()
  assert.doesNotMatch(String(await quoted()),/reminder is set/)
  assert.equal(writes.length,0)
}
reset();assert.match(await invoke(),/already on your Calendar/);assert.match(await invoke(),/24 Nov 2026, 4:20 pm/)
assert.equal(rows.length,2);assert.equal(writes.length,1);assert.deepEqual(rows[0],original,'delivered occurrence immutable')
assert.equal(rows[1].remind_at,'2026-11-24T10:50:00.000Z');assert.match(rows[1].message,/starts 24 Nov 2026, 4:30 pm/);assert.match(rows[1].message,/calendar.app.google/)
reset();await Promise.all([invoke(),invoke()]);assert.equal(rows.filter(r=>!r.sent).length,1,'concurrent turns share one durable successor')
for(const text of ['Move this tmw 4.30pm','Move this to tomorrow at 4:30 pm','Reschedule that meeting tomorrow 4:30pm IST']){reset();assert.match(await invoke(text),/reminder is set/)}
for(const text of ['Move the other meeting tomorrow 4:30pm','Move this reminder tomorrow 4:30pm','Create a reminder tomorrow at 4:30pm']){reset();assert.equal(await invoke(text),null);assert.equal(reads.length,0)}
for(const owner of [0,NaN,9007199254740992]){reset();assert.match(await invoke(command,owner),/verify the reminder owner/);assert.equal(reads.length,0);assert.equal(calendars,0)}
for(const cap of ['reminders','calendar']){reset();levels[cap]='off';assert.match(await invoke(),/permission/);assert.equal(reads.length,0);assert.equal(writes.length,0)}
for(const scenario of ['policy','provider','readback','write-lost']){reset();failure=scenario;assert.match(await invoke(),/couldn’t verify/);assert.ok(writes.length<=1);assert.doesNotMatch(await invoke('Move this tomorrow 25pm'),/reminder is set/)}
reset();failure='write-committed';assert.match(await invoke(),/reminder is set/);assert.equal(writes.length,1,'unknown insert only succeeds after exact readback')
reset();failure='permission-change';assert.match(await invoke(),/permission changed/);assert.equal(writes.length,0)
for(const scenario of ['discovery','missing-primary']){reset();failure=scenario;assert.match(await invoke(),/every connected Calendar/);assert.equal(writes.length,0)}
reset();failure='readback-recipient';assert.match(await invoke(),/couldn’t verify/);assert.equal(writes.length,1)
for(const change of [()=>receipt.receipt_verified=false,()=>calendar.hasMore=true,()=>calendar.accountsRead=1,()=>calendar.events.push(structuredClone(event)),()=>calendar.events[0].hangoutLink='https://meet.google.com/aaa-bbbb-ccc']){
  reset();change();assert.doesNotMatch(String(await invoke()),/reminder is set/);assert.equal(writes.length,0)
}
reset();calendar.events[0].hangoutLink='https://meet.google.com/ycz-gire-akz.evil.test';assert.match(await invoke(),/couldn’t identify/);assert.equal(writes.length,0)
reset();calendar.events[0].start.dateTime='2026-11-24T17:00:00+05:30';assert.match(await invoke(),/not at the requested time/);assert.equal(writes.length,0)
reset();turns=[{telegram_id:-42,role:'user',created_at:'2026-11-23T10:51:00Z',content:'Move this tmrw 4.30pm'},{telegram_id:-42,role:'user',created_at:'2026-11-23T10:52:00Z',content:'Yes'}];assert.match(await invoke(),/reminder is set/)
reset();turns=[{telegram_id:-42,role:'user',created_at:'2026-11-23T10:52:00Z',content:'Find another unrelated appointment'}];assert.equal(await invoke(),null);assert.equal(writes.length,0)
for(const change of [()=>rows[0].whatsapp_to='+919999999999',()=>rows[0].sent_at='2026-11-23T08:00:00Z',()=>rows[0].telegram_id=-43]){reset();change();assert.equal(await invoke(),null);assert.equal(writes.length,0)}
function future(){return {...original,id:'future',sent:false,sent_at:null,delivery_state:'pending',remind_at:'2026-11-24T11:00:00.000Z',message:original.message.replace('23 Nov','24 Nov')}}
reset();rows.push(future());assert.match(await invoke(),/reminder is set/);assert.equal(rows.length,2);assert.equal(writes[0].op,'update');assert.equal(rows[1].remind_at,'2026-11-24T10:50:00.000Z')
reset();rows.push(future());failure='race';assert.match(await invoke(),/couldn’t verify/);assert.equal(rows[1].remind_at,'2026-11-24T11:00:00.000Z')
reset();rows.push({...future(),whatsapp_to:'+919999999999'});assert.match(await invoke(),/different recipient/);assert.equal(writes.length,0)
reset();rows.push(future());failure='race-recipient';assert.match(await invoke(),/couldn’t verify/);assert.equal(rows[1].remind_at,'2026-11-24T11:00:00.000Z')
reset();rows.push(future(),{...future(),id:'second'});assert.match(await invoke(),/More than one/);assert.equal(writes.length,0)
function utcFixture(){
  reset();now=Date.parse('2026-11-23T16:25:00Z');rows[0].timezone='UTC';rows[0].remind_at='2026-11-23T16:20:00Z';rows[0].sent_at='2026-11-23T16:20:37Z'
  calendar.events[0].start.dateTime='2026-11-24T16:30:00Z';calendar.events[0].end.dateTime='2026-11-24T17:45:00Z'
}
utcFixture();const utcReply=await invoke();assert.match(utcReply,/4:30/);assert.match(utcReply,/5:45/);assert.match(utcReply,/UTC/);assert.doesNotMatch(utcReply,/10:00/);assert.equal(rows[1].remind_at,'2026-11-24T16:20:00.000Z')
utcFixture();calendar.events[0].start.dateTime='2026-11-24T17:00:00Z';const utcMismatch=await invoke();assert.match(utcMismatch,/5:00/);assert.match(utcMismatch,/UTC/);assert.equal(writes.length,0)

// Exercise the actual router before Calendar/legacy/LLM dispatch.
const routed:any={},none=new Proxy({}, {get:()=>()=>null})
runInNewContext(ts.transpileModule(readFileSync('lib/feature-intents.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
  exports:routed,Date:FixtureDate,Intl,URL,console,process:{env:{}},
  require(name:string){
    if(name==='@/lib/agent/contextual-meeting-reschedule')return actual
    if(name==='@/lib/bot/input-normalizer')return {normalizeUserInputForRouting:(text:string)=>({text,changed:false,reasons:[]})}
    if(name==='@/lib/agent/adaptive-autonomy')return {parseAutonomyCommand:()=>null}
    if(name==='@/lib/feature-intents-legacy')return {routeFeatureIntent:async()=>{legacy++;return 'legacy'}}
    if(name==='@/lib/supabase-admin')return {supabaseAdmin:db}
    return none
  },
})
for(const surface of ['web','whatsapp']){reset();assert.match(await routed.routeFeatureIntent(phone,command,{telegramId:-42,surface}),/reminder is set/);assert.equal(legacy,0);assert.equal(rows.length,2)}
reset();failure='readback';assert.match(await routed.routeFeatureIntent(phone,command,{telegramId:-42,surface:'web'}),/couldn’t verify/);assert.equal(legacy,0)
// Execute the literal authenticated entry-point blocks before their model/goal
// paths, using the actual handler. The existing full route auth suites remain.
for (const surface of ['web','whatsapp']) {
  const path = surface === 'web' ? 'app/api/dashboard/chat/route.ts' : 'app/api/webhooks/whatsapp/route.ts'
  const source = readFileSync(path,'utf8'), marker = '// Delivered meeting context precedes model/goal clarification on this surface.'
  const start = source.indexOf(marker)
  const end = source.indexOf(surface === 'web' ? '// Round 6 (#34' : '// 11 Nov: "forget my travel details"', start)
  assert.ok(start > source.indexOf(surface === 'web' ? 'if (!session)' : 'if (signatureAudit.reject)'))
  assert.ok(start < source.indexOf(surface === 'web' ? 'const understoodReply' : 'const understoodReply'))
  assert.ok(end > start)
  const block = source.slice(start,end)
  let saved:any[]=[],sent:any[]=[],preserve=false,importFailure=false,replyToSid='',signatureOutcome='valid'
  const api:any={}
  class ResponseFixture {constructor(public body:any,public options:any){}static json(data:any){return data}}
  runInNewContext(ts.transpileModule(`export async function run(text:string){${block};return 'fallback'}`,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
    exports:api,NextResponse:ResponseFixture,user:{telegram_id:-42,whatsapp_id:phone},actor:{legacyTelegramId:-42},resolvedUser:{telegramId:-42},from:phone,
    formData:{get:(key:string)=>key==='OriginalRepliedMessageSid'?replyToSid:null},
    signatureAudit:{verdict:{get outcome(){return signatureOutcome}}},
    get preserveFriendFlow(){return preserve},detectFriendReminder:()=>false,isFriendReminderFollowupCandidate:()=>preserve,getPendingFriend:async()=>preserve,
    saveConversation:async(...args:any[])=>saved.push(args),sendWhatsAppMessage:async(...args:any[])=>sent.push(args),emptyTwiml:()=>'<Response/>',
    require(name:string){assert.equal(name,'@/lib/agent/contextual-meeting-reschedule');if(importFailure)throw Error('import failed');return actual},
  })
  reset();const result=await api.run(command);assert.notEqual(result,'fallback');assert.equal(rows.filter(r=>!r.sent).length,1)
  assert.equal(saved.length,surface==='web'?1:2);assert.equal(sent.length,surface==='web'?0:1)
  if(surface==='web')assert.match(result.text,/reminder is set/);else assert.match(sent[0][1],/reminder is set/)
  reset();saved=[];sent=[];failure='readback';assert.notEqual(await api.run(command),'fallback');assert.equal(writes.length,1)
  reset();saved=[];sent=[];preserve=true;assert.equal(await api.run(command),'fallback');assert.equal(reads.length,0)
  reset();preserve=false;importFailure=true;const failed=await api.run(command);assert.notEqual(failed,'fallback');assert.equal(writes.length,0)
  reset();assert.equal(await api.run('Move it to 5 pm'),'fallback','unrelated clock-only commands never import this handler');assert.equal(reads.length,0)
  if (surface === 'whatsapp') {
    importFailure=false;laterDelivery();saved=[];sent=[]
    assert.notEqual(await api.run(command),'fallback','an ungrounded move cannot fall through to a model rewrite')
    assert.match(sent[0][1],/Which meeting or reminder/);assert.equal(writes.length,0)
    replyToSid=quotedSid;laterDelivery();saved=[];sent=[]
    await api.run(command)
    assert.match(sent[0][1],/24 Nov 2026, 4:20 pm/);assert.equal(writes.length,1);assert.equal(sent.length,1)
    laterDelivery();now=Date.parse('2026-11-24T03:45:00Z');rows.push(future());saved=[];sent=[]
    await api.run(todayCommand)
    assert.match(sent[0][1],/24 Nov 2026, 4:20 pm/)
    assert.equal(writes[0].op,'update');assert.equal(rows.filter(r=>!r.sent).length,1)
    assert.equal(rows[2].remind_at,'2026-11-24T10:50:00.000Z')
    signatureOutcome='invalid';laterDelivery();saved=[];sent=[]
    await api.run(command)
    assert.match(sent[0][1],/couldn’t match/);assert.equal(writes.length,0);assert.equal(reads.length,0)
  }
}
console.log('verify-delivered-meeting-context-nov23: actual handler/router context, Calendar truth, stable successor, CAS and fail-closed controls PASS (offline)')
