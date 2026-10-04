import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import crypto from 'node:crypto'
import ts from 'typescript'
import * as quality from '../lib/agent/watcher-quality'
import * as cadence from '../lib/agent/watch-cost-policy'

// User-requested lifecycle: empty now -> match on a later worker -> source link
// in WhatsApp and app -> no duplicate. Fixture records, no real sends or DB writes.
let clock=Date.parse('2026-10-03T08:00:00Z')
let results:any[]=[]
let inboxMessages:any[]=[], inboxReadingEnabled=true
let watcherReadError=false
let rejectDelivery=false
let unknownDelivery=false
let duringSearch=null as null|(()=>Promise<void>)
const accepted=new Map<string,string>()
const sent:string[]=[]
const queries:string[]=[]
const store:Record<string,any[]>={agent_watchers:[],agent_ideas:[],agent_activity:[],users:[{telegram_id:101,whatsapp_id:'fixture-phone'}]}
const db={from(table:string){
  store[table] ||= []
  const filters:Array<(r:any)=>boolean>=[]
  let changes:any,insert:any,single=false
  const b:any={
    select(){return b},eq(k:string,v:any){filters.push(r=>k==='condition_json'?JSON.stringify(r[k])===v:String(r[k])===String(v));return b},
    in(k:string,v:any[]){filters.push(r=>v.includes(r[k]));return b},
    lte(k:string,v:any){filters.push(r=>r[k]!=null&&r[k]<=v);return b},
    order(){return b},limit(){return b},or(){return b},is(){return b},update(v:any){changes=v;return b},insert(v:any){insert=v;return b},upsert(v:any){if(!store[table].some(r=>r.id===v.id))insert=v;return b},
    maybeSingle(){single=true;return b},single(){single=true;return b},
    then(resolve:any,reject:any){return Promise.resolve().then(()=>{
      if(table==='agent_watchers'&&watcherReadError)return {data:null,error:{message:'fixture read unavailable'}}
      const rows=(store[table]||[]).filter(r=>filters.every(f=>f(r)))
      if(insert){const row={id:`${table}-${store[table].length}`, ...structuredClone(insert)};store[table].push(row);return {data:single?row:[row],error:null}}
      if(changes)rows.forEach(r=>Object.assign(r,structuredClone(changes)))
      return {data:single?rows[0]||null:structuredClone(rows),count:rows.length,error:null}
    }).then(resolve,reject)},
  };return b
}}
const budget={activeWebWatchersMax:10,baseWatcherCadenceMinutes:60,maxWatcherCadenceMinutes:1440,burstHours:0}
function freshWorker(){
  const output=ts.transpileModule(fs.readFileSync('lib/agent/watchers.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
  const exports:any={}
  class Clock extends Date {constructor(value?:any){super(value===undefined?clock:value)}static now(){return clock}}
  const mocks:any={
    'node:crypto':crypto,'@/lib/supabase-admin':{supabaseAdmin:db},
    './watch-alert-delivery':{deliverWatchAlert:async(p:any)=>{
      if(unknownDelivery)return {accepted:false,state:'outcome_unknown',providerId:null}
      if(rejectDelivery)return {accepted:false,state:'pending',providerId:null}
      if(!accepted.has(p.key)){sent.push(p.message);accepted.set(p.key,'SM-fixture-'+accepted.size)}
      return {accepted:true,state:'provider_accepted',providerId:accepted.get(p.key)}
    }},
    '@/lib/channels/whatsapp':{sendWhatsAppMessage:async(_phone:string,text:string)=>{if(rejectDelivery)throw Object.assign(new Error('fixture provider rejection'),{status:429});sent.push(text)}},
    '@/lib/web-search':{searchWebResults:async(query:string)=>{queries.push(query);await duringSearch?.();return structuredClone(results)}},
    '@/lib/services/cost-guard':{getCostBudget:async()=>budget,checkCostAllowance:async()=>({allowed:true,state:{usageRatio:0}}),recordCostEvent:async()=>{},COST_ESTIMATES_PAISE:{web_search_basic:1}},
    './google-workspace-read':{listRecentWorkspaceInbox:async(actor:any)=>{assert.equal(actor.legacyTelegramId,101);if(!inboxReadingEnabled)throw new Error('workspace_email_reading_disabled');return {messages:structuredClone(inboxMessages)}}},
    './watch-cost-policy':cadence,'./watcher-quality':quality,
  }
  vm.runInNewContext(output,{exports,module:{exports},require:(name:string)=>mocks[name]||{},Date:Clock,URL,console,Buffer})
  return exports
}
const request='Keep searching for Christopher Ward C63 Sealander in India and alert me with the link.'
const condition={title:'Watch: Christopher Ward C63 Sealander India',query:'Christopher Ward C63 Sealander India',triggerKeywords:[],delivery:'both',cadenceMinutes:60,notifyOnFirstMatch:true,originalRequest:request}
const row:any={id:'watch-one',telegram_id:'101',type:'web_search',active:true,condition_json:condition,last_state_json:{},next_check_at:new Date(clock).toISOString()}
store.agent_watchers.push(row)
await freshWorker().processDueAgentWatchers()
assert.equal(sent.length,0,'empty search does not invent a result')
assert.equal(row.active,true,'empty search retains the watch')
assert.equal(row.condition_json.originalRequest,request,'original request survives normalization and rescheduling')
assert.equal(row.condition_json.notifyOnFirstMatch,true)
clock=Date.parse(row.next_check_at)
const url='https://shop.example.com/Products/C63?variant=BLUE#details'
results=[{title:'Christopher Ward C63 Sealander India',snippet:'Christopher Ward C63 Sealander India catalogue listing.',url}]
await freshWorker().processDueAgentWatchers()
assert.equal(sent.length,1,'first later match must not vanish into a silent baseline')
assert.ok(sent[0].includes(url),'alert carries the original provider URL, including case, variant and fragment')
assert.match(sent[0],/search result|not.*verified/i,'search evidence must not claim verified stock or price')
assert.equal(row.last_state_json.lastResult.url,url,'canonical state retains the shared source')
assert.equal(row.last_state_json.lastResult.evidenceLevel,'search_result')
assert.equal(store.agent_ideas[0].source_refs.find((x:any)=>x.type==='url').url,url,'app and WhatsApp use the same link')
assert.equal(row.active,true,'manual watch remains active until stopped')
clock=Date.parse(row.next_check_at)
await freshWorker().processDueAgentWatchers()
assert.equal(sent.length,1,'fresh worker must not alert the same result again')
assert.ok(queries.every(q=>q===condition.query),'request constraints survive worker restart')

// A seen but irrelevant page must not suppress its later relevant content.
row.last_state_json={};row.next_check_at=new Date(clock).toISOString()
results=[{title:'Unrelated catalogue',snippet:'Nothing relevant here.',url}]
await freshWorker().processDueAgentWatchers()
clock=Date.parse(row.next_check_at)
results=[{title:condition.query,snippet:'Updated C63 catalogue for India.',url}]
await freshWorker().processDueAgentWatchers()
assert.equal(sent.length,2,'later match on a previously nonmatching URL is not lost')

// Existing change-only watches keep their silent baseline semantics.
row.condition_json={...condition,notifyOnFirstMatch:false};row.last_state_json={};row.next_check_at=new Date(clock).toISOString()
await freshWorker().processDueAgentWatchers()
assert.equal(sent.length,2,'legacy baseline remains quiet')
row.active=false;clock+=86400000
await freshWorker().processDueAgentWatchers()
assert.equal(sent.length,2,'stopped watches never resume themselves')
console.log('PASS: persistent watch survives fresh workers, alerts first match with identical source link, deduplicates and respects stop')

// A definite rejection must survive fresh workers and a disappearing search result.
row.active=true;row.condition_json=condition;row.last_state_json={};row.next_check_at=new Date(clock).toISOString()
results=[{title:condition.query,snippet:'New source for this watch.',url:'https://shop.example.com/another'}]
rejectDelivery=true
const beforeSent=sent.length,beforeIdeas=store.agent_ideas.length
await freshWorker().processDueAgentWatchers()
assert.equal(sent.length,beforeSent)
assert.equal(row.last_state_json.lastAlertAt,undefined,'failed attempt is not a successful alert')
assert.ok(row.last_state_json.pendingAlert?.key,'result is persisted before send')
const pendingKey=row.last_state_json.pendingAlert.key
assert.equal(store.agent_ideas.length,beforeIdeas,'pending send is not published as completed')
results=[];clock=Date.parse(row.next_check_at);rejectDelivery=false
await freshWorker().processDueAgentWatchers()
assert.equal(sent.length,beforeSent+1,'saved result is retried even after disappearing from search')
assert.equal(row.last_state_json.alertDelivery.key,pendingKey)
assert.equal(row.last_state_json.alertDelivery.state,'provider_accepted','acceptance is not delivery')
assert.equal(row.last_state_json.pendingAlert,null)
assert.ok(sent.at(-1)?.includes('/another'))
clock=Date.parse(row.next_check_at)
await freshWorker().processDueAgentWatchers()
assert.equal(sent.length,beforeSent+1,'next worker does not duplicate accepted alert')
row.active=false
console.log('PASS: failed alert survives restart and empty later search, reuses delivery identity, and records acceptance honestly')

// Unknown sends surface in the app and do not halt future monitoring or resend blindly.
row.active=true;row.last_state_json={};row.next_check_at=new Date(clock).toISOString()
results=[{title:condition.query,snippet:'Unknown transport outcome fixture',url:'https://shop.example.com/unknown'}]
unknownDelivery=true
await freshWorker().processDueAgentWatchers()
assert.equal(row.last_state_json.alertDelivery.state,'outcome_unknown')
assert.equal(row.last_state_json.lastAlertAt,null)
assert.equal(row.last_state_json.pendingAlert,null)
assert.ok(store.agent_ideas.some(i=>i.source_refs.some((r:any)=>r.url==='https://shop.example.com/unknown')))
unknownDelivery=false;results=[];clock+=30*86400000
const queryCount=queries.length
await freshWorker().processDueAgentWatchers()
assert.equal(queries.length,queryCount+1,'watch keeps searching a month later after uncertain delivery')
assert.equal(row.condition_json.originalRequest,request)
assert.equal(row.active,true)
row.active=false
console.log('PASS: uncertain transport never masquerades as delivery or prevents later monitoring; month-later criteria remain intact')

// The shared prompt reads current stored criteria, not a stale conversation summary.
store.agent_watchers.push({...structuredClone(row),id:'foreign',telegram_id:'202',condition_json:{...condition,title:'PRIVATE OTHER OWNER',query:'Christopher Ward C63 Sealander India SECRET'}})
row.condition_json={...condition,query:'Christopher Ward C63 Sealander India blue dial, exclude card offers'}
store.user_consent_settings=[{telegram_id:101,memory_enabled:false}]
const contextOutput=ts.transpileModule(fs.readFileSync('lib/agent/context-brain.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const contextExports:any={}
const contextMocks:any={
  'node:crypto':crypto,'@/lib/supabase-admin':{supabaseAdmin:db},
  './typed-object-context':{latestTypedContext:async()=>null},
  '@/lib/bot/memory-redaction':{redactSecretShapedText:(v:string)=>v,isSecretShapedMemory:()=>false},
  './task-lifecycle':{isRelevantOpenLoop:()=>true},
}
vm.runInNewContext(contextOutput,{exports:contextExports,module:{exports:contextExports},require:(name:string)=>contextMocks[name]||{},Date,URL,console,Buffer})
const pack=await contextExports.buildContextPack({actor:{legacyTelegramId:101},text:'What is saved for my Christopher Ward C63 Sealander watch?',options:{includeSemantic:false}})
const block=contextExports.renderContextBlock(pack)
assert.match(block,/blue dial, exclude card offers/,'latest stored correction reaches the shared prompt')
assert.match(block,/inactive/,'stopped watch remains recalled as stopped')
assert.doesNotMatch(block,/PRIVATE OTHER OWNER|SECRET/,'other user watcher data never enters memory')
assert.ok(pack.facts.some((f:any)=>f.source==='watcher'))
assert.equal(pack.memoryEnabled,false,'operational task state does not enable learned-memory consent')
const other=await contextExports.buildContextPack({actor:{legacyTelegramId:101},text:'Explain how photosynthesis works',options:{includeSemantic:false}})
assert.equal(other.facts.some((f:any)=>f.source==='watcher'),false,'unrelated turns do not drag in watches')

const commandsOutput=ts.transpileModule(fs.readFileSync('lib/agent/watch-command.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const commandExports:any={}
let recalledWatchContext:any=null
const commandMocks:any={
  './typed-object-context':{rememberTypedObjects:async(_owner:any,domain:string,items:any[])=>{recalledWatchContext={domain,items}},latestTypedContext:async()=>recalledWatchContext},
  './watchers':freshWorker(), '@/lib/supabase-admin':{supabaseAdmin:db},
  '@/lib/services/cost-guard':{getCostBudget:async()=>budget}, './google-workspace-read':{listRecentWorkspaceInbox:async(actor:any)=>{assert.equal(actor.legacyTelegramId,101);if(!inboxReadingEnabled)throw new Error('workspace_email_reading_disabled');return {messages:structuredClone(inboxMessages)}}},
    './watch-cost-policy':cadence,
}
vm.runInNewContext(commandsOutput,{exports:commandExports,module:{exports:commandExports},require:(name:string)=>commandMocks[name]||{},Date,URL,console,Buffer})
const parsed=commandExports.parseWebWatchCommand('Keep searching for Christopher Ward C63 Sealander in India and alert me when you find a new listing')
assert.equal(parsed.notifyOnFirstMatch,true)
assert.match(parsed.originalRequest,/Keep searching/)
assert.equal(commandExports.parseWebWatchCommand('Find my email from yesterday'),null,'ordinary unrelated finds must not become web watchers')
console.log('PASS: corrected watch intent is recalled across surfaces, owner isolated, stop preserved, explicit keep-searching parsed')

// Execute the actual webhook first-refusal predicate, so supported watch language
// cannot silently fall back to a one-shot model answer before reaching the bridge.
const route=fs.readFileSync('app/api/webhooks/whatsapp/route.ts','utf8')
const predicate=route.match(/const isDeterministicWatcherCommand =([\s\S]*?)\n    if\(isDeterministicWatcherCommand\)/)?.[1]
assert.ok(predicate,'webhook watch first-refusal predicate exists')
const routesToWatch=(text:string)=>vm.runInNewContext(predicate!,{text,parseWebWatchCommand:commandExports.parseWebWatchCommand,isWatcherStatusQuery:commandExports.isWatcherStatusQuery})
assert.equal(routesToWatch('Keep searching for Christopher Ward C63 Sealander in India'),true)
assert.equal(routesToWatch('Please keep looking for Sony WH-1000XM5 below 22000'),true)
assert.equal(routesToWatch('Show my watches'),true)
assert.equal(routesToWatch('Find my email from yesterday'),false)
console.log('PASS: WhatsApp routes keep-searching requests to the persistent watch handler')

// Drive the real authenticated dashboard POST through actual watch creation.
const dashboardOutput=ts.transpileModule(fs.readFileSync('app/api/dashboard/chat/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const dashboardExports:any={}
const noop=new Proxy({}, {get:()=>async()=>null})
const dashboardMocks:any={
  crypto, 'next/server':{NextResponse:{json:(body:any,init:any)=>({body,status:init?.status||200})}},
  '@/lib/dashboard/session':{getSession:async()=>({telegramId:'101'})},
  '@/lib/supabase-admin':{supabaseAdmin:db},
  '@/lib/agent/actor':{resolveAgentActor:async()=>({legacyTelegramId:101})},
  '@/lib/agent/watch-command':commandExports,
}
vm.runInNewContext(dashboardOutput,{exports:dashboardExports,module:{exports:dashboardExports},require:(name:string)=>dashboardMocks[name]||noop,URL,console,Buffer})
const dashboardRequest='Keep searching for Sony WH-1000XM5 headphones in India'
const response=await dashboardExports.POST({headers:{get:()=> 'https://app.askgogo.in'},nextUrl:{host:'app.askgogo.in'},json:async()=>({text:dashboardRequest})})
assert.equal(response.status,200)
assert.equal(response.body.handledBy,'background-web-watch','dashboard must create a watch, not a one-shot answer')
const created=store.agent_watchers.find((w:any)=>w.condition_json?.originalRequest===dashboardRequest)
assert.ok(created?.active)
assert.equal(created.telegram_id,'101')
assert.equal(created.condition_json.notifyOnFirstMatch,true)
assert.equal(store.agent_runs.at(-1).source,'web','creation retains the originating dashboard surface')
assert.match(response.body.text,/source link/)
console.log('PASS: authenticated dashboard POST creates the same durable search with correct owner and surface')
// Exercise the actual delivery adapter, including owner/correction checks and receipt token.
const deliveryOutput=ts.transpileModule(fs.readFileSync('lib/agent/watch-alert-delivery.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const deliveryExports:any={}
let providerCalls=0,readyMutation:(()=>void)|null=null
const deliveryMocks:any={
  '@/lib/supabase-admin':{supabaseAdmin:db},
  '@/lib/whatsapp':{sendWhatsApp:async(phone:string,message:string,media:any,token:string)=>{
    assert.equal(phone,'fixture-phone');assert.equal(token,'fixture-receipt-token');assert.equal(media,null)
    providerCalls++;return {sid:'SM-verified-adapter-fixture'}
  }},
  '@/lib/services/notification-delivery':{deliverNotification:async(p:any)=>{
    assert.equal(p.source,'followup');assert.equal(p.owner,101)
    await p.prepare();readyMutation?.()
    if(!await p.ready())return 'suppressed'
    const id=await p.send('fixture-receipt-token')
    store.notification_deliveries=[{delivery_key:p.key,owner_id:101,state:'provider_accepted',provider_id:id}]
    return 'provider_accepted'
  }},
}
vm.runInNewContext(deliveryOutput,{exports:deliveryExports,module:{exports:deliveryExports},require:(n:string)=>deliveryMocks[n]||{},Date,console})
row.active=true;row.condition_json=condition
const adapterParams={watcherId:row.id,owner:'101',key:'watch/adapter-fixture',due:new Date(clock).toISOString(),message:'Fixture source link',condition}
let outcome=await deliveryExports.deliverWatchAlert(adapterParams)
assert.equal(outcome.accepted,true);assert.equal(outcome.providerId,'SM-verified-adapter-fixture')
store.notification_deliveries=[]
readyMutation=()=>{row.active=false}
outcome=await deliveryExports.deliverWatchAlert({...adapterParams,key:'watch/stopped'})
assert.equal(outcome.accepted,false);assert.equal(providerCalls,1,'intervening stop prevents send')
row.active=true
readyMutation=()=>{row.condition_json={...condition,query:'Corrected different request'}}
outcome=await deliveryExports.deliverWatchAlert({...adapterParams,key:'watch/corrected'})
assert.equal(outcome.accepted,false);assert.equal(providerCalls,1,'intervening correction prevents stale alert')
readyMutation=null
outcome=await deliveryExports.deliverWatchAlert({...adapterParams,owner:'202',key:'watch/foreign'}).catch(()=>({accepted:false}))
assert.equal(outcome.accepted,false);assert.equal(providerCalls,1)
console.log('PASS: receipt adapter passes delivery token, verifies owner, and honors intervening stop/correction')
// Real conversational correction, persisted under the same task identity.
row.active=true;row.condition_json={...condition};row.last_state_json={pendingAlert:{key:'old-request'}}
store.agent_watchers=store.agent_watchers.filter(w=>w.id===row.id||w.id==='foreign')
const correction='Update my Christopher Ward C63 watch to: Christopher Ward C63 Sealander blue dial in India below 90000 excluding card offers'
const correctionReply=await commandExports.tryUpdateWebWatchFromCommand({actor:{legacyTelegramId:101},text:correction})
assert.equal(correctionReply.handledBy,'watcher-update')
assert.equal(row.id,'watch-one');assert.equal(store.agent_watchers.length,2,'correction does not create another watch')
assert.match(row.condition_json.query,/blue dial.*below 90000 excluding card offers/)
assert.equal(row.condition_json.originalRequest,request)
assert.equal(row.last_state_json.pendingAlert,undefined,'old pending result is revoked')
results=[];clock+=31*86400000
await freshWorker().processDueAgentWatchers()
assert.match(queries.at(-1)!,/blue dial.*below 90000 excluding card offers/,'month-later worker uses actual conversational correction')
const correctedPack=await contextExports.buildContextPack({actor:{legacyTelegramId:101},text:'What is saved for my Christopher Ward C63 Sealander watch?',options:{includeSemantic:false}})
assert.match(contextExports.renderContextBlock(correctedPack),/blue dial.*below 90000 excluding card offers/)
const dashboardCorrection=await dashboardExports.POST({headers:{get:()=> 'https://app.askgogo.in'},nextUrl:{host:'app.askgogo.in'},json:async()=>({text:'Update my Christopher Ward C63 watch to: Christopher Ward C63 Sealander black dial in India below 80000 excluding card offers'})})
assert.equal(dashboardCorrection.body.handledBy,'watcher-update')
assert.match(row.condition_json.query,/black dial.*below 80000/)
assert.equal(routesToWatch(correction),true,'WhatsApp first-refusal routes explicit corrections')
console.log('PASS: conversational correction retains task identity and original request; fresh month-later worker and dashboard recall use corrected criteria')

// A correction/stop can arrive while an earlier provider search is still pending.
results=[];row.active=true;row.next_check_at=new Date(clock).toISOString()
let correctedWhileRunning:any
const sentBeforeCorrection=sent.length
duringSearch=async()=>{
  await commandExports.tryUpdateWebWatchFromCommand({actor:{legacyTelegramId:101},text:'Update my Christopher Ward C63 watch to: Christopher Ward C63 Sealander white dial in India below 70000 excluding card offers'})
  correctedWhileRunning=structuredClone(row)
}
await freshWorker().processDueAgentWatchers()
assert.deepEqual(row.condition_json,correctedWhileRunning.condition_json,'empty old search cannot overwrite a newer conversational correction')
assert.deepEqual(row.last_state_json,correctedWhileRunning.last_state_json,'old quiet-check state cannot erase corrected memory')
assert.equal(row.next_check_at,correctedWhileRunning.next_check_at,'new criteria retain their queued check')
assert.equal(sent.length,sentBeforeCorrection)
duringSearch=async()=>{row.active=false;row.next_check_at=null;row.last_state_json={stoppedByUser:true}}
row.next_check_at=new Date(clock).toISOString()
await freshWorker().processDueAgentWatchers()
assert.equal(row.active,false);assert.equal(row.next_check_at,null,'in-flight empty search cannot reschedule a stopped watch')
assert.deepEqual(row.last_state_json,{stoppedByUser:true})
duringSearch=null
console.log('PASS: a correction or stop arriving during search survives the stale worker result')

// Screenshot regression: visible saved watches must be recalled by the actual
// dashboard POST even when the request is conversational or has multiple sentences.
row.active=true
row.condition_json={...condition,title:'Watch: Sony WH-1000XM5',query:'Sony WH-1000XM5 on amazon.in below 22000 excluding bank/card offers'}
row.last_checked_at='2026-10-04T10:30:42.474Z'
row.next_check_at='2026-10-04T13:00:42.474Z'
row.cadence_minutes=150
store.agent_watchers.push({...structuredClone(row),id:'sony-broad',condition_json:{title:'Sony WH-1000XM5',query:'Sony WH-1000XM5 price amazon.in'}})
store.agent_watchers.push({...structuredClone(row),id:'unrelated-flight',condition_json:{title:'Unrelated flight watch',query:'AT9 flight New York'}})
store.life_event_actions=[{telegram_id:'101',title:'Unrelated itinerary task',action_key:'prepare-web-checkin',status:'blocked'}]
const recallQuestions=[
  'Show my watches. What are my Sony headphone criteria, when did you last check, and when will you check again?',
  'Which headphones am I watching, and what offers did I ask you to exclude?',
  'What are you monitoring for me?',
]
const beforeRecall=JSON.stringify(store.agent_watchers)
for(const text of recallQuestions){
  const reply=await dashboardExports.POST({headers:{get:()=> 'https://app.askgogo.in'},nextUrl:{host:'app.askgogo.in'},json:async()=>({text})})
  assert.equal(reply.body.handledBy,'watcher-status',text)
  assert.match(reply.body.text,/Sony WH-1000XM5 on amazon.in below 22000 excluding bank\/card offers/)
  assert.match(reply.body.text,/Last checked:.*4 Oct.*4:00 pm/)
  assert.match(reply.body.text,/Next check:.*4 Oct.*6:30 pm/)
  assert.match(reply.body.text,/150 min/)
  assert.doesNotMatch(reply.body.text,/PRIVATE OTHER OWNER|SECRET/)
  if(text!==recallQuestions[2]){
    assert.doesNotMatch(reply.body.text,/AT9|Unrelated|Itinerary|Expires:|Source:/,'focused recall excludes unrelated tasks and repeated metadata')
    assert.ok(reply.body.text.length<800,'focused response stays concise')
    assert.match(reply.body.text,/2 matching watches/,'broader second Sony watch remains visible, not silently merged or stopped')
    assert.equal((reply.body.text.match(/excluding bank\/card offers/g)||[]).length,1,'criteria are not repeated')
    assert.deepEqual(Array.from(recalledWatchContext.items,(item:any)=>item.id),['watch-one','sony-broad'],'follow-up selection contains only shown watches')
  }
  assert.equal(routesToWatch(text),true,'same recall intent must enter WhatsApp bridge')
}
assert.equal(JSON.stringify(store.agent_watchers),beforeRecall,'recall never creates, changes or stops a watch')
// Missing product identity is not empty memory.
const unmatchedWatch=await commandExports.tryGetWatcherStatusFromCommand({actor:{legacyTelegramId:101},text:'Which Samsung products am I watching?'})
assert.equal(unmatchedWatch.status,'paused')
assert.match(unmatchedWatch.text,/I have saved watches/)
assert.doesNotMatch(unmatchedWatch.text,/Sony|AT9/)
for(const text of ['Watch Sony headphones below 22000','Stop my Sony watch','Update my Sony watch to below 21000','Which headphones should I buy?','What should I watch tonight?']){
  assert.equal(commandExports.isWatcherStatusQuery(text),false,text)
}
console.log('PASS: both screenshot questions read canonical owner watches through dashboard POST and WhatsApp routing, with criteria and check times')

watcherReadError=true
await assert.rejects(()=>commandExports.tryGetWatcherStatusFromCommand({actor:{legacyTelegramId:101},text:recallQuestions[0]}),/watcher_status_read_failed/,'failed retrieval must never claim there are no watches')
watcherReadError=false
row.active=false
store.agent_watchers.filter(w=>w.telegram_id==='101').forEach(w=>{w.active=false})
const emptyRecall=await commandExports.tryGetWatcherStatusFromCommand({actor:{legacyTelegramId:101},text:'Show my watches'})
assert.equal(emptyRecall.runId,'watcher-status-none','foreign active watch cannot appear as this owner watch')
console.log('PASS: failed reads do not fabricate empty memory; genuine empty owner state is distinguished')


// Inbox alerts must use the same durable ledger as web watches. A five-item
// digest cannot consume the remaining actionable messages as already seen.
watcherReadError=false;rejectDelivery=false;unknownDelivery=false
store.agent_watchers=[];store.agent_ideas=[];store.users=[{id:'fixture-owner',telegram_id:101,whatsapp_id:'fixture-phone'}]
const inbox:any={id:'inbox-one',telegram_id:'101',type:'email_triage',active:true,
 condition_json:{title:'Inbox action watch',delivery:'whatsapp',cadenceMinutes:60},last_state_json:{},next_check_at:new Date(clock).toISOString()}
store.agent_watchers.push(inbox)
inboxMessages=Array.from({length:7},(_,i)=>({id:'mail-'+i,threadId:'thread-'+i,subject:'Action required: fixture '+i,from:'Fixture <sender@example.test>',snippet:'Please review',date:'2026-10-05'}))
rejectDelivery=true
const inboxBefore=sent.length
await freshWorker().processDueAgentWatchers()
assert.ok(inbox.last_state_json.pendingInboxAlert?.key,'rejected inbox digest must persist before sending')
assert.equal(sent.length,inboxBefore)
assert.equal(inbox.last_state_json.seenMessageIds?.length||0,0,'rejected messages are not consumed')
const inboxKey=inbox.last_state_json.pendingInboxAlert.key
inboxMessages=[];clock=Date.parse(inbox.next_check_at);rejectDelivery=false
await freshWorker().processDueAgentWatchers()
assert.equal(sent.length,inboxBefore+1,'retained digest retries after worker restart and inbox changes')
assert.equal(inbox.last_state_json.inboxAlertDelivery.key,inboxKey)
assert.equal(inbox.last_state_json.inboxAlertDelivery.state,'provider_accepted')
assert.equal(inbox.last_state_json.pendingInboxAlert,null)
assert.equal(inbox.last_state_json.seenMessageIds.length,5)
assert.equal(store.agent_ideas.length,1)
assert.ok(store.agent_ideas[0].source_refs.some((r:any)=>r.type==='gmail_message'&&r.id==='mail-0'&&r.threadId==='thread-0'),'app keeps the originating message/thread')
assert.ok(store.agent_ideas[0].source_refs.some((r:any)=>r.type==='notification_delivery'&&r.key===inboxKey),'app keeps receipt lookup identity')
clock=Date.parse(inbox.next_check_at)
inboxMessages=Array.from({length:7},(_,i)=>({id:'mail-'+i,threadId:'thread-'+i,subject:'Action required: fixture '+i,from:'Fixture',snippet:'Please review'}))
await freshWorker().processDueAgentWatchers()
assert.equal(sent.length,inboxBefore+2,'sixth and seventh action are not silently discarded')
assert.equal(inbox.last_state_json.lastActionCount,2)
clock=Date.parse(inbox.next_check_at)
await freshWorker().processDueAgentWatchers()
assert.equal(sent.length,inboxBefore+2,'accepted digests are deduplicated across fresh workers')
// Ambiguous transport results become visible app items without a blind resend.
inboxMessages=[{id:'unknown-mail',threadId:'unknown-thread',subject:'Please review fixture',from:'Fixture'}]
unknownDelivery=true;clock=Date.parse(inbox.next_check_at)
await freshWorker().processDueAgentWatchers()
assert.equal(inbox.last_state_json.inboxAlertDelivery.state,'outcome_unknown')
assert.equal(inbox.last_state_json.pendingInboxAlert,null)
assert.match(store.agent_ideas.at(-1).reason,/not confirmed/i)
unknownDelivery=false;clock=Date.parse(inbox.next_check_at)
await freshWorker().processDueAgentWatchers()
assert.equal(sent.length,inboxBefore+2)
// A retained alert cannot bypass newly disabled mail reading.
inboxMessages=[{id:'consent-mail',subject:'Action required fixture',from:'Fixture'}]
rejectDelivery=true;clock=Date.parse(inbox.next_check_at)
await freshWorker().processDueAgentWatchers()
const retainedConsent=inbox.last_state_json.pendingInboxAlert.key
inboxReadingEnabled=false;rejectDelivery=false;clock=Date.parse(inbox.next_check_at)
await freshWorker().processDueAgentWatchers()
assert.equal(inbox.last_state_json.pendingInboxAlert.key,retainedConsent)
assert.equal(inbox.last_state_json.lastError,'workspace_email_reading_disabled')
assert.ok(!sent.slice(inboxBefore+2).some(x=>x.includes('Action required fixture')),'disabled reading does not send saved email content')
console.log('PASS: inbox rejection/restart, durable receipt identity, source refs, overflow, dedup, uncertainty and revoked consent')

// A saved digest is revoked by corrected criteria, even after a failed attempt.
inboxReadingEnabled=true
inbox.condition_json={...inbox.condition_json,matchTerms:['different project']}
inboxMessages=[{id:'consent-mail',subject:'Action required fixture',from:'Fixture'}]
clock=Date.parse(inbox.next_check_at)
const beforeCorrection=sent.length
await freshWorker().processDueAgentWatchers()
assert.equal(sent.length,beforeCorrection)
assert.equal(inbox.last_state_json.pendingInboxAlert,null)
assert.equal(inbox.last_state_json.lastActionCount,0)
inbox.active=false;clock+=86400000
await freshWorker().processDueAgentWatchers()
assert.equal(sent.length,beforeCorrection,'stopped inbox watch never resumes itself')
console.log('PASS: corrected inbox criteria revoke retained alerts; stopped watches remain stopped')
