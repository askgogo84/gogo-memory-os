import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import crypto from 'node:crypto'
import ts from 'typescript'
import * as timezone from '../lib/timezone'

// The actual 3 Oct WhatsApp invitation. Fixture clock/data only: no real reminders.
const invitation=`Food Working Session
Saturday, 3 Oct · 4:20–5 PM
Google Meet joining info
Video call link: https://meet.google.com/ghm-npbd-uar`
const actor={userId:'fixture-user',legacyTelegramId:101,whatsappId:'fixture-phone',name:'Fixture'}
let clock=Date.parse('2026-10-03T09:28:00Z'),seq=0,permission='auto',failInsert=false,writeAttempts=0
const store:Record<string,any[]>={users:[{telegram_id:101,whatsapp_id:'fixture-phone',timezone:'Asia/Kolkata'}],memories:[],conversations:[],reminders:[],links:[]}
const db={from(table:string){
  store[table]||=[]
  const filters:Array<(r:any)=>boolean>=[]
  let changes:any,insert:any,single=false,limit=Infinity,sort=false
  const b:any={select(){return b},eq(k:string,v:any){filters.push(r=>String(r[k])===String(v));return b},order(){sort=true;return b},limit(n:number){limit=n;return b},update(v:any){changes=v;return b},insert(v:any){insert=v;return b},maybeSingle(){single=true;return b},single(){single=true;return b},then(resolve:any,reject:any){return Promise.resolve().then(()=>{
    let rows=store[table].filter(r=>filters.every(f=>f(r)))
    if(sort)rows=rows.slice().sort((a,b)=>b._seq-a._seq)
    rows=rows.slice(0,limit)
    if(insert){
      if(table==='reminders'){
        writeAttempts++
        if(failInsert)return {data:null,error:{message:'injected write failure'}}
        if(store[table].some(r=>r.id===insert.id))return {data:null,error:{code:'23505'}}
      }
      const values=(Array.isArray(insert)?insert:[insert]).map(value=>({_seq:++seq,id:`fixture-${seq}`,created_at:new Date(clock).toISOString(),...structuredClone(value)}))
      store[table].push(...values);return {data:single?values[0]:values,error:null}
    }
    if(changes)rows.forEach(r=>Object.assign(r,structuredClone(changes)))
    return {data:single?structuredClone(rows[0]||null):structuredClone(rows),error:null}
  }).then(resolve,reject)}};return b
}}
function worker(){
  const output=ts.transpileModule(fs.readFileSync('lib/agent/meeting-share-followup.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
  const exports:any={}
  class Clock extends Date {constructor(value?:any){super(value===undefined?clock:value)}static now(){return clock}}
  const mocks:any={
    'node:crypto':crypto,'@/lib/supabase-admin':{supabaseAdmin:db},'@/lib/timezone':timezone,
    './adaptive-autonomy':{capabilityPermissionLevel:async()=>permission},
    '@/lib/services/link-vault':{saveLinkVaultItem:async(params:any)=>{const row={id:`link-${seq}`, ...params};store.links.push(row);return {row}}},
  }
  vm.runInNewContext(output,{exports,module:{exports},require:(name:string)=>mocks[name]||{},Date:Clock,Intl,URL,console})
  return exports
}
async function history(text:string,tg=101){await db.from('conversations').insert({telegram_id:tg,role:'assistant',content:text})}
async function offer(text=invitation){const r=await worker().tryMeetingShareFollowup({actor,text,surface:'whatsapp'});assert.ok(r);await history(r.text);return r}
const parsed=worker().parseSharedMeeting(invitation,'Asia/Kolkata')
assert.equal(parsed.startAt,'2026-10-03T10:50:00.000Z')
assert.equal(parsed.endAt,'2026-10-03T11:30:00.000Z')
assert.equal(parsed.remindAt,'2026-10-03T10:40:00.000Z')
const proposed=await offer()
assert.match(proposed.text,/4:10/i)
assert.equal(store.reminders.length,0,'sharing a meeting only offers; it does not create a reminder')
assert.ok(store.links[0].text.includes('Saturday, 3 Oct'),'meeting details remain in durable link memory')
const accepted=await worker().tryMeetingShareFollowup({actor,text:'Yes',surface:'web'})
assert.match(accepted.text,/Reminder set/)
assert.match(accepted.text,/4:10/)
assert.equal(store.reminders.length,1)
assert.equal(store.reminders[0].remind_at,parsed.remindAt)
assert.ok(accepted.text.includes(parsed.url))
await history(accepted.text)
await worker().tryMeetingShareFollowup({actor,text:'Yes',surface:'whatsapp'})
assert.equal(store.reminders.length,1,'repeat acknowledgement does not duplicate the reminder')
assert.equal(writeAttempts,1)

const foreign=await worker().tryMeetingShareFollowup({actor:{...actor,legacyTelegramId:202},text:'Yes',surface:'web'})
assert.equal(foreign,null,'another owner cannot consume this offer')
await offer(invitation.replace('Food Working','Another Working'))
await history('Would you like me to show your shopping list?')
assert.equal(await worker().tryMeetingShareFollowup({actor,text:'Yes',surface:'web'}),null,'newer conversational question owns Yes')
assert.equal(store.reminders.length,1)
await offer(invitation.replace('Food Working','Declined Working'))
await worker().tryMeetingShareFollowup({actor,text:'No thanks',surface:'web'})
assert.equal(store.reminders.length,1)
await offer(invitation.replace('Food Working','Permission Working'))
permission='off'
const denied=await worker().tryMeetingShareFollowup({actor,text:'Yes',surface:'web'})
assert.match(denied.text,/does not allow/)
assert.equal(store.reminders.length,1)
permission='auto'
await offer(invitation.replace('Food Working','Failure Working'))
failInsert=true
const failed=await worker().tryMeetingShareFollowup({actor,text:'Yes',surface:'web'})
assert.match(failed.text,/could not verify/)
assert.doesNotMatch(failed.text,/Reminder set/)
const attempts=writeAttempts
await worker().tryMeetingShareFollowup({actor,text:'Yes',surface:'web'})
assert.equal(writeAttempts,attempts,'uncertain write is read back, never blindly replayed')
failInsert=false
await offer(invitation.replace('Food Working','Concurrent Working'))
await Promise.all([worker(),worker()].map(w=>w.tryMeetingShareFollowup({actor,text:'Yes',surface:'web'})))
assert.equal(store.reminders.length,2,'concurrent approvals write one reminder')
await offer(invitation.replace('Food Working','Expired Working'))
clock=Date.parse('2026-10-03T10:45:00Z')
const expired=await worker().tryMeetingShareFollowup({actor,text:'Yes',surface:'whatsapp'})
assert.match(expired.text,/expired/)
assert.equal(store.reminders.length,2)
assert.equal(worker().parseSharedMeeting('Save this https://meet.google.com/ghm-npbd-uar','Asia/Kolkata'),null)
clock=Date.parse('2026-10-03T09:28:00Z')

// Execute actual route hooks with the real handler, not a second parser.
const dashboard=ts.transpileModule(fs.readFileSync('app/api/dashboard/chat/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const exports:any={},noop=new Proxy({},{get:()=>async()=>null})
const mocks:any={crypto,'next/server':{NextResponse:{json:(body:any)=>({body})}},'@/lib/supabase-admin':{supabaseAdmin:db},'@/lib/dashboard/session':{getSession:async()=>({telegramId:'101'})},'@/lib/agent/actor':{resolveAgentActor:async()=>actor},'@/lib/agent/meeting-share-followup':worker()}
vm.runInNewContext(dashboard,{exports,module:{exports},require:(n:string)=>mocks[n]||noop,URL,console})
const response=await exports.POST({headers:{get:()=> 'https://app.askgogo.in'},nextUrl:{host:'app.askgogo.in'},json:async()=>({text:invitation.replace('Food Working','Dashboard Working')})})
assert.equal(response.body.handledBy,'meeting-share-followup')
const wa=fs.readFileSync('app/api/webhooks/whatsapp/route.ts','utf8')
const hook=wa.slice(wa.indexOf('    // Meeting invitations and their bounded replies'),wa.indexOf('    const isKnownSocialPreview ='))
assert.ok(hook.includes('tryMeetingShareFollowup'))
let whatsappReply=''
await vm.runInNewContext(`(async()=>{${hook}})()`,{tryMeetingShareFollowup:worker().tryMeetingShareFollowup,resolvedUser:{id:actor.userId,telegramId:101,whatsappId:actor.whatsappId,name:actor.name},bodyText:invitation.replace('Food Working','WhatsApp Working'),from:actor.whatsappId,saveConversation:async(tg:number,role:string,content:string)=>{await db.from('conversations').insert({telegram_id:tg,role,content})},sendWhatsAppMessage:async(_phone:string,text:string)=>{whatsappReply=text},NextResponse:class {},emptyTwiml:()=>''})
assert.match(whatsappReply,/4:10/)
assert.ok(wa.indexOf('    // Meeting invitations and their bounded replies')<wa.indexOf('    const isKnownSocialPreview ='),'meeting flow precedes generic media saving')
console.log('PASS: shared meeting -> durable offer -> cross-channel Yes -> exact reminder readback; link retained, owner isolated, stale/unrelated replies ignored, duplicates and failed writes protected, actual WA/dashboard hooks')
