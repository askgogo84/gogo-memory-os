import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'
const noop=new Proxy({}, {get:()=>()=>null})
function load(file:string,deps:any,extra:any={}){const exports:any={};runInNewContext(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:(name:string)=>deps[name]||noop,Date,Intl,console,URL,URLSearchParams,process,Buffer,Response,setTimeout,clearTimeout,...extra});return exports}
const loops=load('lib/agent/open-loops.ts',{})
const rows=[
 {id:'19abc00000000001',threadId:'19abc00000000002',from:'Vercel <noreply@example.invalid>',subject:'Payment failed and shutdown coming soon',snippet:'Action required: service suspension follows failed payment.'},
 {id:'19abc00000000003',threadId:'19abc00000000004',from:'Offers <offers@example.invalid>',subject:'Urgent offer: payment failed and shutdown',snippet:'Coupon sale',labelIds:['CATEGORY_PROMOTIONS'],listUnsubscribe:'<https://example.invalid/unsubscribe>'},
 {id:'19abc00000000005',threadId:'19abc00000000006',from:'Example Person <person@example.invalid>',subject:'Review needed',snippet:'Could you review the proposal by tomorrow?'},
]
let requested=0,noticeWrites=0,failNotices=false,failLoops=false,loopReads=0
const db={from:(table:string)=>{const q:any={select:()=>q,eq:(key:string,value:unknown)=>{if(key==='telegram_id')assert.equal(String(value),'123');if(key==='status')assert.equal(value,'active');return q},gte:()=>q,lte:()=>q,in:()=>q,order:()=>q,limit:()=>q,single:()=>q,maybeSingle:()=>q,then:(resolve:any)=>{
 if(table==='agent_open_loops'){loopReads++;return resolve(failLoops?{data:null,error:{message:'fixture-down'}}:{data:[{id:'loop1',kind:'commitment',title:'Review service billing notice',source_type:'gmail_service_notice',status:'active'}],error:null})}
 return resolve({data:table==='users'?{gmail_connected:true,gmail_email:'owner@example.invalid',gmail_access_token:'fixture-access',google_calendar_connected:false,briefing_content:'calendar'}:table==='user_consent_settings'?{gmail_enabled:true}:[],error:null})
}};return q}}
const security={redactEmailAuthSecrets:(text:string)=>text,formatEmailSnippet:(text:string,max:number)=>String(text).slice(0,max)}
const gmail=load('lib/bot/handlers/gmail-read.ts',{
 '@/lib/supabase-admin':{supabaseAdmin:db},'@/lib/google-gmail':{fetchLatestEmails:async(_access:string,limit:number)=>{requested=limit;return rows},fetchUnreadEmails:async()=>rows},
 '@/lib/security/google-token-crypto':{decryptGoogleToken:(value:string)=>value},'@/lib/agent/google-workspace-read':security,
 '@/lib/email/attention-store':{},
 '@/lib/agent/open-loops':{...loops,captureGmailServiceNotices:async(tg:number,messages:any[])=>{assert.equal(tg,123);assert.ok(messages.some(m=>m.id===rows[0].id));noticeWrites++;if(failNotices)throw Error('fixture-notice-write-failed')}},
})
const failures:string[]=[]
async function check(label:string,fn:()=>unknown){try{await fn();console.log('PASS '+label)}catch(e:any){failures.push(label+': '+e.message)}}
await check('attention read examines bounded broader inbox and links actionable source messages',async()=>{
 const text=await gmail.buildGmailReadReply(123,'latest',5,undefined,false,true)
 assert.equal(requested,25);assert.match(text,/Payment failed and shutdown coming soon/);assert.match(text,/Review needed/);assert.doesNotMatch(text,/Urgent offer/);assert.match(text,/https:\/\/mail.google.com\/mail\/u\/\?authuser=owner%40example.invalid#all\/19abc00000000002/);assert.match(text,/latest 25|up to 25/i);assert.equal(noticeWrites,1)
})
await check('failed urgent-item persistence stays explicit rather than claiming a saved loop',async()=>{
 failNotices=true;try{assert.match(await gmail.buildGmailReadReply(123,'latest',5,undefined,false,true),/could not save.*urgent action items/i)}finally{failNotices=false}
})
const briefing=load('lib/bot/handlers/morning-briefing.ts',{
 '@/lib/supabase-admin':{supabaseAdmin:db},'@/lib/services/weather':{fetchWeatherForecast:async()=>null},
 '@/lib/services/google-calendar-accounts':{getTodayEventsAllAccounts:async()=>({connected:false,events:[],multi:false,incomplete:false})},
 '@/lib/agent/task-lifecycle':{isRelevantOpenLoop:(row:any)=>row.status==='active'},'@/lib/agent/google-workspace-read':security,
})
await check('actual briefing includes requested owner-bound saved open loops despite narrower saved flags',async()=>{
 const text=await briefing.buildMorningBriefing(123,'Example',{includeOpenLoops:true});assert.match(text,/Review service billing notice/);assert.match(text,/saved.*status|saved.*open loops/i);assert.ok(loopReads>0)
})
await check('failed briefing loop read is unavailable rather than an empty queue claim',async()=>{
 failLoops=true;try{const text=await briefing.buildMorningBriefing(123,'Example',{includeOpenLoops:true});assert.match(text,/open loops.*unavailable|unavailable.*open loops/i);assert.doesNotMatch(text,/no active open loops/i)}finally{failLoops=false}
})
let transportFailure=''
const provider=load('lib/services/google-gmail.ts',{}, {fetch:async(url:string,init:any)=>{
 assert.equal(init.headers.Authorization,'Bearer fixture-access');assert.equal(new URL(url).origin,'https://gmail.googleapis.com')
 if(new URL(url).pathname.endsWith('/messages'))return new Response(JSON.stringify(transportFailure==='list'?{}:{messages:[{id:rows[1].id}]}),{status:transportFailure==='list'?503:200})
 assert.ok(url.includes('metadataHeaders=List-Unsubscribe'))
 return new Response(JSON.stringify({id:rows[1].id,threadId:rows[1].threadId,labelIds:['INBOX','CATEGORY_PROMOTIONS'],payload:{headers:[{name:'List-Unsubscribe',value:'<https://example.invalid/unsubscribe>'}]}}),{status:transportFailure==='metadata'?503:200})
}})
await check('actual provider adapter preserves promotion provenance for attention exclusion',async()=>{
 const fetched=await provider.fetchLatestEmails('fixture-access',25);assert.deepEqual(Array.from(fetched[0].labelIds),['INBOX','CATEGORY_PROMOTIONS']);assert.ok(fetched[0].listUnsubscribe);assert.equal(loops.isActionableGmailMessage(fetched[0]),false)
})
await check('actual provider outage cannot become a successful empty inbox',async()=>{
 transportFailure='list';try{await assert.rejects(()=>provider.fetchLatestEmails('fixture-access',25),/unavailable|list|Gmail/i)}finally{transportFailure=''}
})
await check('failed message detail read cannot become an authoritative empty inbox',async()=>{
 transportFailure='metadata';try{await assert.rejects(()=>provider.fetchLatestEmails('fixture-access',25),/incomplete|unavailable/i)}finally{transportFailure=''}
})
if(failures.length){console.error(failures.join('\n'));process.exitCode=1}
