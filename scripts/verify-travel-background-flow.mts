import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'
import {PGlite} from '@electric-sql/pglite'
import {NextRequest,NextResponse} from 'next/server'
import {createHmac} from 'node:crypto'

const fixedNow = new Date('2026-10-07T11:00:00Z')
class Clock extends Date {constructor(value?: any){super(value ?? fixedNow.getTime())}static now(){return fixedNow.getTime()}}
function load(file: string, mocks: Record<string,any>, globals: Record<string,any> = {}) {
  const module = {exports:{} as any}
  runInNewContext(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {module,exports:module.exports,Date:Clock,Intl,URL,Request,Response,Headers,Buffer,AbortSignal,console,process:{env:{CRON_SECRET:'fixture'}},
      require(name: string){if(name in mocks)return mocks[name];throw new Error(`Unmocked: ${name}`)},...globals})
  return module.exports
}
let seq = 0, searches = 0, browserAttempts = 0, sent = 0, rejectSend = false
const tables: Record<string,any[]> = {agent_runs:[],agent_steps:[],agent_activity:[],conversations:[],users:[{telegram_id:42,whatsapp_id:'+15555550101',name:'Fixture'}]}
const notifications = new Map<string,string>()
let failPublish = false
const db = {
  from(table: string) {
    const filters: Array<(row:any)=>boolean> = []
    let mode = 'read', payload:any, maximum = Infinity, cached:any
    const field = (row:any,key:string)=>key.includes('->>') ? String(row[key.split('->>')[0]]?.[key.split('->>')[1]]) : row[key]
    const execute = () => {
      if(cached)return cached
      const rows = tables[table].filter(row=>filters.every(f=>f(row))).slice(0,maximum)
      let data = rows
      if(mode==='insert'){data=(Array.isArray(payload)?payload:[payload]).map(row=>({...row,id:row.id||`fixture-${++seq}`}));tables[table].push(...data)}
      if(mode==='update')rows.forEach(row=>{
        if(table==='agent_runs' && row.metadata_json?.background_travel && payload.status==='completed')
          assert.ok(payload.metadata_json?.result_text,'completion and the full result must be saved together before publication is eligible')
        Object.assign(row,payload)
      })
      cached = {data,error:null};return cached
    }
    const q:any = {select(){return q},eq(key:string,value:any){filters.push(row=>field(row,key)===value);return q},
      in(key:string,values:any[]){filters.push(row=>values.includes(field(row,key)));return q},
      is(key:string,value:any){filters.push(row=>value===null ? field(row,key)==null||field(row,key)==='undefined' : field(row,key)===value);return q},
      lte(key:string,value:any){filters.push(row=>field(row,key)<=value);return q},order(){return q},limit(n:number){maximum=n;return q},
      insert(row:any){mode='insert';payload=row;return q},update(row:any){mode='update';payload=row;return q},
      async maybeSingle(){const r=execute();return {...r,data:r.data[0]||null}},async single(){return q.maybeSingle()},
      then(resolve:any,reject:any){return Promise.resolve(execute()).then(resolve,reject)}}
    return q
  },
  async rpc(name:string,args:any) {
    if(name==='due_travel_research_deliveries')return {data:tables.agent_runs.filter(r=>['completed','failed'].includes(r.status)&&!r.metadata_json?.notified&&!notifications.has(`travel_research/${r.id}`)),error:null}
    if(name==='publish_web_travel_result'){
      if(failPublish)return {error:{message:'fixture write failure'}}
      const run=tables.agent_runs.find(r=>r.id===args.p_run_id&&r.telegram_id===args.p_owner)
      if(!run||run.source!=='web'||run.metadata_json.notified)return {data:false,error:null}
      tables.conversations.push({role:'assistant',content:args.p_content});run.metadata_json.notified=true;return {data:true,error:null}
    }
    throw new Error(name)
  },
}
const actor = {userId:'fixture-owner',legacyTelegramId:42,whatsappId:'+15555550101',name:'Fixture',timezone:'Asia/Kolkata'}
const browser = load('lib/agent/travel-browser-task.ts',{
  '@anthropic-ai/sdk':{default:class {messages={create:async()=>({content:[]})}}},
  './secure-computer':{runSecureBrowser:async()=>{browserAttempts++;throw new Error('browser_objective_unverified')}},
})
let queue:any
const travel = load('lib/agent/travel-research.ts',{
  '@/lib/supabase-admin':{supabaseAdmin:db},'./typed-object-context':{rememberTypedObjects:async()=>{}},
  '@/lib/web-search':{searchWebResults:async()=>{searches++;return [{title:'BLR to BOM fare ₹4,999',snippet:'Generic route page without a departure date',url:'https://example.com/flights'}]}},
  '@/lib/integrations/creditiq-travel':{searchCreditIQLiveFlights:async()=>null},
  '@/lib/bot/memory-redaction':{redactSecretShapedText:(text:string)=>text},'./travel-browser-task':browser,
  './travel-research-queue':{enqueueTravelResearch:(params:any)=>queue.enqueueTravelResearch(params)},
})
const sanitizer = load('lib/agent/travel-research-sanitize.ts',{'@/lib/supabase-admin':{supabaseAdmin:db},'./travel-research':travel})
const fallback=sanitizer.sanitizeTravelResearchText('Task could not obtain verified live rows\n\n1. Airline\nPublic snippet mentions ₹4,159\nOpen source: https://example.com/flights\n\nThese are fallback sources only, not completed live inventory.',
  'Compare flights from BLR to BOM on 20 October 2026')
assert.match(fallback,/\nOpen source: https:\/\/example.com\/flights/,'stripping an unverified fare must preserve its provider link')
assert.match(fallback,/fallback sources only/,'fallback disclaimer survives sanitation')
const titleFare=sanitizer.sanitizeTravelResearchText('Task could not obtain verified live rows\n\n1. MakeMyTrip — Fares @ ₹ 4269 on 20 October 2026\nPublic snippet mentions INR 4,269\nOpen source: https://example.com/flights\n\nThese are fallback sources only, not completed live inventory.',
 'Compare flights from Bengaluru to Mumbai on 20 October 2026 for 1 adult in economy.',new Date('2026-10-07T12:00:00Z'))
assert.doesNotMatch(titleFare,/4269|4,269|₹/,'a matching date in a search title does not verify its fare')
assert.match(titleFare,/https:\/\/example.com\/flights/)
queue = load('lib/agent/travel-research-queue.ts',{
  '@/lib/supabase-admin':{supabaseAdmin:db},'./travel-research':travel,'./travel-research-sanitize':sanitizer,
  './brain-runtime-guard':{acquireBrainUserLease:async()=>({ownerToken:'fixture'}),releaseBrainUserLease:async()=>{}},
})
const worker = load('lib/agent/travel-research-worker.ts',{
  '@/lib/supabase-admin':{supabaseAdmin:db},'./actor':{resolveAgentActor:async()=>actor},'./travel-research-queue':queue,
  '@/lib/whatsapp':{sendWhatsApp:async()=>{sent++;return {sid:'SMfixture'}}},
  '@/lib/services/notification-delivery':{deliverNotification:async(job:any)=>{
    if(notifications.has(job.key))return 'skipped'
    if(rejectSend)return 'failed'
    await job.prepare();if(!await job.ready())return 'suppressed'
    await job.send('fixture-token');notifications.set(job.key,'provider_accepted');await job.accepted();return 'provider_accepted'
  }},
})

const text='Compare flights from Bengaluru to Mumbai on 20 October 2026 for 1 adult in economy. Show verified non-stop options with INR fares and provider links. Do not book or pay.'
const preferences=travel.flightSearchPreferences('Search flights from BLR to BOM on 20 October 2026 for two adults in premium economy, non-stop')
assert.equal(preferences.cabin,'premium_economy');assert.equal(preferences.adults,2);assert.equal(preferences.nonStop,true)
const late=new Date('2026-10-07T20:00:00Z')
assert.equal(travel.buildTravelResearchContext('Search flights from BLR to BOM tomorrow',late,'Asia/Kolkata').startDate,'2026-10-09')
assert.equal(travel.buildTravelResearchContext('Search flights from BLR to BOM today',late,'America/New_York').startDate,'2026-10-07')
for(const input of ['Search flights from BLR to BOM on 2027-02-30','Search flights from BLR to BOM on 30/02/2027',
  'Compare flights from Bengaluru to Mumbai on 30 February 2027 for 1 adult in economy.',
  'Compare flights from BLR to BOM on February 30, 2027']){
  assert.equal(travel.buildTravelResearchContext(input,fixedNow).startDate,undefined,'invalid dates must not roll into March')
  assert.match((await queue.enqueueTravelResearch({actor,surface:'web',text:input})).text,/not a valid/)
}
assert.match((await queue.enqueueTravelResearch({actor,surface:'web',text:'Compare flights from BLR to BOM on 1 October 2026'})).text,/past/)
assert.match((await queue.enqueueTravelResearch({actor,surface:'web',text:'Compare flights to Mumbai'})).text,/departure city.*travel date/)
assert.match((await queue.enqueueTravelResearch({actor,surface:'web',text:text.replace('1 adult','2 adults and 1 child')})).text,/child\/infant/)
assert.equal(tables.agent_runs.length,0,'invalid/incomplete requests create no provider work')

const context={...travel.buildTravelResearchContext(text,fixedNow),...travel.flightSearchPreferences(text)}
const searchHeader='Bengaluru BLR to Mumbai BOM 20 October 2026 1 adult Economy'
assert.equal(browser.browserFlightContextVisible(searchHeader,context),true)
for(const header of [searchHeader.replace('20 October','21 October'),searchHeader.replace('Economy','Business'),searchHeader.replace('Economy','Premium economy'),searchHeader.replace('1 adult','2 adults'),searchHeader.replace('Mumbai BOM','Delhi DEL'),searchHeader.replace('Bengaluru BLR to Mumbai BOM','Mumbai BOM to Bengaluru BLR')])
  assert.equal(browser.browserFlightContextVisible(header,context),false,'the selected search context must be visible, not inferred from the requested URL')
const base={id:'live',live:true,from:'BLR',to:'BOM',departure:'2026-10-20T10:00:00+05:30',arrival:'2026-10-20T11:45:00+05:30',airline:'Fixture Air',cabin:'economy',stops:0,price:4999,currency:'INR',cashFareVerifiedForCabin:true,bookingLink:'https://example.com/flight'}
assert.equal(travel.verifiedProviderFlights([base],context).length,1)
for(const mutation of [{from:'BOM',to:'BLR'},{departure:'2026-10-21T10:00:00+05:30'},{stops:null},{stops:1},{live:false},{cabin:'business'}])
  assert.equal(travel.verifiedProviderFlights([{...base,...mutation}],context).length,0,'wrong requested inventory is excluded')
for(const mutation of [{price:null},{currency:'USD'},{cashFareVerifiedForCabin:false}])
  assert.equal(travel.verifiedProviderFlights([{...base,...mutation}],context)[0].price,null,'unknown/foreign/unverified fare stays unknown')
const quote='Fixture Air 10:00 11:45 Non-stop ₹4,999'
const row={airline:'Fixture Air',departure:'10:00',arrival:'11:45',stops:0,fareInr:4999,evidence:quote}
assert.equal(browser.normalizeBrowserFlightOption(row,quote).fareInr,4999)
assert.equal(browser.normalizeBrowserFlightOption({...row,evidence:quote+' invented'},quote),null)
assert.equal(browser.normalizeBrowserFlightOption({...row,airline:'Other Air'},quote),null)
assert.equal(browser.normalizeBrowserFlightOption({...row,evidence:quote.replace('₹4,999','$4999')},quote.replace('₹4,999','$4999')).fareInr,null)
assert.equal(browser.normalizeBrowserFlightOption({...row,stops:null},quote).stops,null,'null is not zero stops')

// The actual public Google results label preserves the complete row. Its
// selected controls, not the query URL or page recommendations, ground context.
const googleLabel='From 4423 Indian rupees. Nonstop flight with IndiGo. Leaves Kempegowda International Airport Bengaluru at 3:45 AM on Tuesday, October 20 and arrives at Chhatrapati Shivaji Maharaj International Airport Mumbai at 5:30 AM on Tuesday, October 20. Total duration 1 hr 45 min. Select flight'
const selected=['Where from? Bengaluru BLR','Where to? Mumbai BOM','Change ticket type. One way','Change seating class. Economy','1 passenger, change number of passengers.','Track prices from Bengaluru to Mumbai departing 2026-10-20']
const observedGoogle={url:'https://www.google.com/travel/flights/search',flightEvidence:{searchControls:selected,resultLabels:[googleLabel]}}
const exactRows=browser.googleFlightOptionsFromEvidence(observedGoogle,context)
assert.equal(exactRows.length,1);assert.equal(exactRows[0].fareInr,4423);assert.equal(exactRows[0].stops,0)
assert.equal(exactRows[0].departure,'3:45 AM');assert.equal(exactRows[0].evidence,googleLabel)
for(const replacement of [['2026-10-20','2026-10-21'],['Economy','Business'],['1 passenger','2 passengers'],['One way','Round trip'],['Where from? Bengaluru BLR','Where from? Mumbai BOM']]){
  assert.equal(browser.googleFlightOptionsFromEvidence({...observedGoogle,flightEvidence:{...observedGoogle.flightEvidence,searchControls:selected.map(s=>s.replace(replacement[0],replacement[1]))}},context).length,0)
}
assert.equal(browser.googleFlightOptionsFromEvidence({...observedGoogle,url:'https://www.google.com.evil.example/travel/flights/search'},context).length,0)
assert.equal(browser.googleFlightOptionsFromEvidence({...observedGoogle,flightEvidence:{searchControls:selected,resultLabels:[googleLabel.replace('October 20 and arrives','October 19 and arrives')]}},context).length,0,'a wrong departure day cannot become a requested row')
const realObservedBrowser=load('lib/agent/travel-browser-task.ts',{
  '@anthropic-ai/sdk':{default:class {messages={create:async()=>{throw Error('observed rows must not require generated extraction')}}}},
  './secure-computer':{runSecureBrowser:async()=>({...observedGoogle,status:'completed',pageText:'ordinary page prose without control values'})},
})
assert.equal((await realObservedBrowser.runLiveFlightBrowserTask({actor,context,objective:text})).options[0].fareInr,4423,'the real task uses observed labels before a model-based prose extraction')

// Execute the real web POST export. Upstream generic-search/PIM fallthrough fails.
const nullModule=new Proxy({}, {get:()=>async()=>null})
const webSource=readFileSync('app/api/dashboard/chat/route.ts','utf8')
const names=[...webSource.matchAll(/from ['"]([^'"]+)['"]/g)].map(m=>m[1])
const webMocks=Object.fromEntries(names.map(name=>[name,nullModule]))
Object.assign(webMocks,{'next/server':{NextRequest,NextResponse},'crypto':{randomUUID:()=> 'fixture-web-turn'},
  '@/lib/dashboard/session':{getSession:async()=>({telegramId:'42'})},'@/lib/supabase-admin':{supabaseAdmin:db},
  '@/lib/agent/actor':{resolveAgentActor:async()=>actor},'@/lib/agent/travel-research':travel,'@/lib/agent/travel-research-sanitize':sanitizer,
  '@/lib/bot/memory-redaction':{redactSecretShapedText:(s:string)=>s},
  '@/lib/bot/handlers/friend-reminders':{detectFriendReminder:()=>null,isFriendReminderFollowupCandidate:()=>false},
  '@/lib/commerce/comparison-model':{namesRetailerPriceRead:()=>false},
  '@/lib/dashboard/day-chat':{detectDashboardDayIntent:()=>null},
  '@/lib/agent/read-only-schedule':{detectReadOnlyScheduleRequest:()=>false},
  '@/lib/bot/process-message':{processIncomingMessage:async()=>{throw new Error('Flight wrongly reached generic PIM')}},
})
const web=load('app/api/dashboard/chat/route.ts',webMocks)
const response=await web.POST(new NextRequest('https://fixture.invalid/api/dashboard/chat',{method:'POST',headers:{origin:'https://fixture.invalid','content-type':'application/json'},body:JSON.stringify({text})}))
assert.equal(response.status,200);const reply=await response.json()
assert.equal(reply.handledBy,'travel-research-queued');assert.match(reply.text,/background/)
assert.equal(browserAttempts,0,'the incoming request must not launch the slow browser')
assert.equal(searches,0,'the incoming request must not perform fallback network searches')
const duplicate=await queue.enqueueTravelResearch({actor,surface:'web',text})
assert.equal(duplicate.runId,reply.runId);assert.equal(tables.agent_runs.length,1,'an active duplicate reuses the saved task')
const unauthWeb=load('app/api/dashboard/chat/route.ts',{...webMocks,'@/lib/dashboard/session':{getSession:async()=>null}})
assert.equal((await unauthWeb.POST(new NextRequest('https://fixture.invalid/api/dashboard/chat',{method:'POST',headers:{origin:'https://fixture.invalid'},body:JSON.stringify({text})}))).status,401)

// Concurrent ticks claim once. Browser failure becomes labelled fallback, not HTTP 500.
failPublish=true
await Promise.all([worker.processTravelResearchQueue(Clock.now()+270000),worker.processTravelResearchQueue(Clock.now()+270000)])
assert.equal(browserAttempts,1);assert.ok(searches>0);assert.equal(tables.agent_runs[0].status,'completed')
assert.equal(tables.agent_runs[0].metadata_json.notified,undefined,'failed publication stays eligible')
assert.doesNotMatch(tables.agent_runs[0].metadata_json.result_text,/₹4,999/,'undated fallback fare is withheld')
assert.match(tables.agent_runs[0].metadata_json.result_text,/could not|not completed live|could not find/i)
failPublish=false
await worker.processTravelResearchQueue(Clock.now()+270000)
await worker.processTravelResearchQueue(Clock.now()+270000)
assert.equal(tables.conversations.filter(r=>r.role==='assistant'&&!/background/.test(r.content)).length,1,'web publishes once after recovery')
assert.equal(sent,0,'web completion never sends to WhatsApp')

// Final phone result uses the receipt outbox; a rejection cannot mark notified.
const phone=await queue.enqueueTravelResearch({actor,surface:'whatsapp',text:text.replace('20 October','21 October')})
rejectSend=true
await worker.processTravelResearchQueue(Clock.now()+270000)
const phoneRun=tables.agent_runs.find(r=>r.id===phone.runId)
assert.equal(phoneRun.metadata_json.notified,undefined)
rejectSend=false
await worker.processTravelResearchQueue(Clock.now()+270000)
await worker.processTravelResearchQueue(Clock.now()+270000)
assert.equal(sent,1);assert.equal(phoneRun.metadata_json.notified,true)

// A worker crash reuses the existing step once, then gives a terminal result.
const interrupted=await queue.enqueueTravelResearch({actor,surface:'web',text:text.replace('20 October','22 October')})
const interruptedRun=tables.agent_runs.find(r=>r.id===interrupted.runId)
interruptedRun.status='running';interruptedRun.updated_at='2026-10-07T10:00:00Z'
tables.agent_steps.push({id:'interrupted-step',run_id:interrupted.runId,telegram_id:'42',ordinal:1,tool_name:'travel',status:'running'})
await worker.processTravelResearchQueue(Clock.now()+270000)
assert.equal(interruptedRun.metadata_json.requeued,true)
assert.equal(interruptedRun.status,'completed')
assert.equal(tables.agent_steps.filter(r=>r.run_id===interrupted.runId).length,1,'recovery does not duplicate the research step')
interruptedRun.status='running';interruptedRun.updated_at='2026-10-07T10:00:00Z';delete interruptedRun.metadata_json.notified
const priorAttempts=browserAttempts
await worker.processTravelResearchQueue(Clock.now()+270000)
assert.equal(interruptedRun.status,'failed');assert.equal(browserAttempts,priorAttempts,'a second interruption is terminal')
assert.match(interruptedRun.metadata_json.result_text,/interrupted/)

// The actual cron export requires bearer authorization before invoking any worker.
let cronCalls=0
const cron=load('app/api/cron/travel-research/route.ts',{'next/server':{NextResponse},
  '@/lib/agent/travel-research-worker':{processTravelResearchQueue:async()=>{cronCalls++;return {claimed:0,published:0,deliveryFailures:0}}}})
for(const headers of [{},{authorization:'Bearer wrong'}])
  assert.equal((await cron.GET(new Request('https://fixture.invalid/api/cron/travel-research',{headers}))).status,401)
assert.equal(cronCalls,0)
assert.equal((await cron.GET(new Request('https://fixture.invalid/api/cron/travel-research',{headers:{authorization:'Bearer fixture'}}))).status,200)
assert.equal(cronCalls,1)

// Exercise the signed bridge contract: a departure window is not a return leg.
let bridgePayload:any
const bridge=load('lib/integrations/creditiq-travel.ts',{'node:crypto':{createHmac}}, {
  AbortController,setTimeout,clearTimeout,process:{env:{CREDITIQ_GOGO_SERVICE_SECRET:'fixture-secret'}},
  fetch:async(_url:string,init:any)=>{
    bridgePayload=JSON.parse(init.body)
    assert.equal(init.headers['X-Gogo-Signature'],createHmac('sha256','fixture-secret').update(`${init.headers['X-Gogo-Timestamp']}.${init.body}`).digest('hex'))
    return Response.json({contract:'gogo-creditiq-travel-v1',inventory:{live:true},flights:[{...base,price:null,stops:null,cabin:'business'}]})
  },
})
const bridgeResult=await bridge.searchCreditIQLiveFlights({from:'BLR',to:'BOM',date:'2026-10-20',dateTo:'2026-10-27',adults:2,cabin:'premium_economy'})
assert.equal(bridgePayload.returnDate,null);assert.equal(bridgePayload.adults,2);assert.equal(bridgePayload.cabin,'premium_economy')
assert.equal(bridgeResult.flights[0].price,null);assert.equal(bridgeResult.flights[0].stops,null);assert.equal(bridgeResult.flights[0].cabin,'business')

// Execute the actual migration in isolated Postgres, including privacy and transactionality.
const pg=new PGlite()
await pg.exec(`create role anon;create role authenticated;create role service_role;
create table agent_runs(id uuid primary key default gen_random_uuid(),telegram_id text,type text,source text,status text,updated_at timestamptz default now(),metadata_json jsonb default '{}');
create table conversations(telegram_id bigint,role text,content text check(content<>'fixture-failure'),created_at timestamptz);
create table notification_deliveries(delivery_key text,source text,channel text,owner_id bigint,send_started_at timestamptz,retry_at timestamptz,state text,lease_until timestamptz);`)
await pg.exec(readFileSync('supabase/migrations/20261007120157_travel_result_delivery.sql','utf8'))
const id=(await pg.query<any>(`insert into agent_runs(telegram_id,type,source,status,metadata_json) values('42','travel_research','web','completed','{"background_travel":true}') returning id`)).rows[0].id
assert.equal((await pg.query<any>('select publish_web_travel_result($1,$2,$3) ok',['43',id,'wrong owner'])).rows[0].ok,false)
await assert.rejects(()=>pg.query('select publish_web_travel_result($1,$2,$3)',['42',id,'fixture-failure']))
assert.equal((await pg.query<any>(`select metadata_json->>'notified' marker from agent_runs where id=$1`,[id])).rows[0].marker,null)
assert.equal((await pg.query<any>('select publish_web_travel_result($1,$2,$3) ok',['42',id,'verified result'])).rows[0].ok,true)
assert.equal((await pg.query<any>('select publish_web_travel_result($1,$2,$3) ok',['42',id,'duplicate'])).rows[0].ok,false)
assert.equal((await pg.query<any>('select count(*)::int total from conversations')).rows[0].total,1)
assert.equal((await pg.query<any>(`select has_function_privilege('anon','public.publish_web_travel_result(text,uuid,text)','execute') allowed`)).rows[0].allowed,false)
await pg.close()
console.log('✓ Real flight web routing, saved queue, duplicate claims, browser fallback, evidence checks, delivery retry and transactional publication passed')
