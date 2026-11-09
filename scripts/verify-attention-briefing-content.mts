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

await check('private dashboard briefing preview never aliases 64-bit tenant identities', async () => {
  // Run the actual transpiled HTTP entry point. All DB and briefing calls below
  // are inert sentinels: no credentials, real accounts, messages or live providers.
  let sessionOwner: string | null = null
  const lookedUp: string[] = []
  const synthesized: number[] = []
  const accounts = new Map([['123', {name: 'Synthetic Alpha'}], ['124', {name: 'Synthetic Beta'}]])
  const db = {from: (table: string) => {
    assert.equal(table, 'users')
    let selected = ''
    const q = {
      select: (fields: string) => { assert.equal(fields, 'name'); return q },
      eq: (col: string, owner: unknown) => {
        assert.equal(col, 'telegram_id')
        assert.equal(typeof owner, 'string', 'DB query must retain original owner TEXT, not rounded Number')
        selected = String(owner); lookedUp.push(selected); return q
      },
      maybeSingle: async () => ({data: accounts.get(selected) ?? null, error: null}),
    }
    return q
  }}
  class FakeNextResponse extends Response {
    static json(body: unknown, opts: {status?: number} = {}) {
      return new FakeNextResponse(JSON.stringify(body), {status: opts.status ?? 200})
    }
  }
  const route = load('app/api/dashboard/daily-brief-preview/route.ts', {
    'next/server': {NextResponse: FakeNextResponse},
    '@/lib/dashboard/session': {getSession: async () => sessionOwner === null ? null : {telegramId: sessionOwner}},
    '@/lib/supabase-admin': {supabaseAdmin: db},
    '@/lib/bot/handlers/morning-briefing': {
      buildMorningBriefing: async (owner: number) => { synthesized.push(owner); return 'PRIVATE_BRIEF_FOR_' + owner },
    },
    '@/lib/email/daily-brief': {
      renderDailyBriefEmail: ({firstName, briefing}: any) => ({html: '<p>' + firstName + ': ' + briefing + '</p>'}),
    },
  })
  // IEEE-754 aliases these two DISTINCT persisted signed-64-bit account IDs.
  assert.equal(Number('9007199254740992'), Number('9007199254740993'))
  for (const invalid of [
    '9007199254740992', '9007199254740993', '-9007199254740992',
    '9223372036854775808', '1e3', '+123', '000123', '0', '-0', '123junk', ' 123',
  ]) {
    sessionOwner = invalid
    const prevReads = lookedUp.length, prevBriefs = synthesized.length
    const denied: Response = await route.GET()
    assert.equal(denied.status, 403, 'deny invalid/unsafe owner before any private access: ' + invalid)
    assert.equal(lookedUp.length, prevReads, 'no DB owner lookup for ' + invalid)
    assert.equal(synthesized.length, prevBriefs, 'no private briefing generation for ' + invalid)
  }
  sessionOwner = null
  assert.equal((await route.GET()).status, 401, 'unauthenticated request remains denied')
  assert.deepEqual(lookedUp, [])
  assert.deepEqual(synthesized, [])

  sessionOwner = '123'
  const alpha: Response = await route.GET()
  assert.equal(alpha.status, 200)
  assert.match(await alpha.text(), /Synthetic: PRIVATE_BRIEF_FOR_123/)
  assert.deepEqual(lookedUp, ['123'])
  assert.deepEqual(synthesized, [123])
  sessionOwner = '124'
  const beta: Response = await route.GET()
  assert.equal(beta.status, 200)
  assert.match(await beta.text(), /Synthetic: PRIVATE_BRIEF_FOR_124/)
  assert.deepEqual(lookedUp, ['123', '124'], 'every privileged lookup must use exact session owner TEXT')
  assert.deepEqual(synthesized, [123, 124], 'each synthetic tenant gets only its own briefing')
})

if(failures.length){console.error(failures.join('\n'));process.exitCode=1}
