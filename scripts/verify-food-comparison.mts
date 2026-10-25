import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'
import * as intent from '../lib/agent/food-comparison-intent'
import {detectIntent} from '../lib/bot/detect-intent'
import {retiredRunReason} from '../lib/agent/task-lifecycle'
import * as contentWorkflows from '../lib/agent/content-workflows'
import * as comparisonModel from '../lib/commerce/comparison-model'
import * as vaultProviders from '../lib/vault/providers'
import * as accountIntent from '../lib/agent/external-account-intent'

const incident='Find me a veg burger nearest my house.. best and the cheapest one compare with all good delivery apps'
assert.equal(detectIntent(incident).type,'food_comparison')
assert.equal(detectIntent('remind me to compare burger delivery tomorrow').type,'set_reminder')
assert.equal(intent.foodLocationReply('my OTP is 560086'),null)
assert.equal(intent.foodLocationReply('watch this for 560086 rupees'),null)
assert.equal(intent.foodLocationReply('WH-560086XM5'),null)

const rows:any[]=[]
let assistant=''
let failWrite=false
const searches:string[]=[]
const db={from(table:string){
  let predicates:Array<(r:any)=>boolean>=[],patch:any=null,insert:any=null,max=Infinity
  const resolve=()=>{
    if(table==='conversations'){
      if(insert)assistant=insert.find((r:any)=>r.role==='assistant')?.content||assistant
      return {data:[{content:assistant}],error:null}
    }
    assert.equal(table,'agent_runs')
    if((patch||insert)&&failWrite)return {data:null,error:{message:'injected write failure'}}
    if(insert){const r={id:`run-${rows.length+1}`,...insert};rows.unshift(r);return {data:[r],error:null}}
    const found=rows.filter(r=>predicates.every(p=>p(r))).slice(0,max)
    if(patch)for(const r of found)Object.assign(r,patch)
    return {data:found,error:null}
  }
  const q:any={select(){return q},eq(k:string,v:any){predicates.push(r=>r[k]===v);return q},order(){return q},limit(n:number){max=n;return q},
    insert(r:any){insert=r;return q},update(p:any){patch=p;return q},
    async maybeSingle(){const r=resolve();return {...r,data:r.data?.[0]||null}},async single(){return q.maybeSingle()},
    then(ok:any,bad:any){return Promise.resolve(resolve()).then(ok,bad)},
  };return q
}}
const source=readFileSync('lib/agent/food-comparison.ts','utf8')
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const exports:any={}
runInNewContext(compiled,{exports,Date,URL,console,require(name:string){
  if(name==='@/lib/supabase-admin')return {supabaseAdmin:db}
  if(name==='./food-comparison-intent')return intent
  if(name==='@/lib/commerce/task')return {commerceTaskLink:(id:string)=>'https://app.askgogo.in/dashboard/commerce?run='+id}
  if(name==='@/lib/web-search')return {searchWebResults:async(query:string)=>{
    searches.push(query)
    return [
      {title:'US burger 0.7 miles $5 off',snippet:'560086',url:'https://grubhub.com/food'},
      {title:'Burger menu in a different area',snippet:'110001',url:'https://www.swiggy.com/city/delhi/other'},
      {title:'Local burger restaurant',snippet:'Vegetarian burger delivery 560086',url:'https://www.swiggy.com/city/bangalore/local-menu'},
      {title:'Fake provider',snippet:'560086',url:'https://swiggy.com.evil.example/menu'},
    ]
  }}
  throw new Error(`Unexpected dependency ${name}`)
}})
const run=(text:string,telegramId=42,surface='whatsapp')=>exports.tryFoodComparison({telegramId,text,surface})
// Exact observed browser request must reach the later browser handler even
// when a food task is waiting for a PIN; a PIN inside the request is not a reply.
const browserRequest='Open https://www.zomato.com/ in the browser. Find vegetarian burgers in Bengaluru. Report only visible restaurant/menu evidence; do not infer delivery availability or total. Do not sign in, order or change a cart. Read only.'
assert.equal(intent.isFoodComparisonRequest(browserRequest),false)
assert.notEqual(detectIntent(browserRequest).type,'food_comparison')
assert.equal(await run(browserRequest),null)
assert.equal(rows.length,0)
const first=await run(incident)
assert.match(first.text,/delivery PIN code/)
assert.equal(searches.length,0,'unknown location must not search or guess')
assert.equal(rows[0].metadata_json.state,'waiting_location')
assistant=first.text
assert.equal(await run(browserRequest+' Area 560086.'),null,'explicit browser request must not resume a pending PIN question')
assert.equal(rows.length,1)
assert.equal(searches.length,0)
assert.equal(await run('560086',99),null,'another owner cannot resume this task')
assistant='Here is your email summary.'
assert.equal(await run('560086'),null,'a paused task cannot steal a number after a topic change')
assistant=first.text
const second=await run('Mahalakshmipuram, Bengaluru 560086',42,'web')
assert.equal(second.runId,first.runId,'location reply resumes the same owner task across surfaces')
assert.equal(searches.length,3)
assert(searches.every(q=>q.includes('vegetarian burger')&&q.includes('560086')&&q.includes('India')))
assert.match(second.text,/https:\/\/www.swiggy.com\/city\/bangalore\/local-menu/)
assert.doesNotMatch(second.text,/Grubhub|grubhub|\$5|0\.7 miles|different area|evil\.example/)
assert.match(second.text,/not verified delivery quotes/)
assert.match(second.text,/Nothing has been added to a cart or ordered/)
assert.equal(rows[0].metadata_json.discovery.cart_verified,false)
assert.match((await run('show my food comparison')).text,/live prices, delivery totals and cart connection remain unverified/,'status comes from stored task summary')
assert.equal(rows[0].status,'paused','unverified totals cannot be labelled completed')
const remembered=await run(incident)
assert.doesNotMatch(remembered.text,/what is your delivery PIN/,'recent confirmed area is reused')
assert.equal(retiredRunReason(rows[1]),'Replaced comparison','new explicit comparison retires the old one')
await run('cancel food comparison')
assert.equal(retiredRunReason(rows[0]),'Cancelled by you')
assert.equal(await run('560086'),null)
const newQuestion=await run(incident)
assistant=newQuestion.text
rows[0].updated_at='2026-01-01T00:00:00Z'
assert.equal(await run('560086'),null,'expired handoff cannot claim messages')
failWrite=true
await assert.rejects(()=>run(incident),/create_failed/)
assert.equal(exports.foodProviderLink({url:'javascript:alert(1)'},'swiggy.com'),null)
assert.equal(exports.foodProviderLink({url:'https://swiggy.com@evil.example/menu'},'swiggy.com'),null)

// Exercise the actual WhatsApp/dashboard shared feature router, not only helpers.
failWrite=false
const router:any={}
runInNewContext(ts.transpileModule(readFileSync('lib/feature-intents.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
  exports:router,console,process:{env:{}},require(name:string){
    if(name==='@/lib/agent/food-comparison')return exports
    if(name==='@/lib/agent/food-comparison-intent')return intent
    if(name==='@/lib/bot/input-normalizer')return {normalizeUserInputForRouting:(text:string)=>({text,changed:false})}
    return new Proxy({},{get(_t,key){return ()=>{throw new Error(`Unexpected generic route ${name}.${String(key)}`)}}})
  },
})
const routed=await router.routeFeatureIntent('test-owner',incident,{telegramId:42})
assert.match(routed,/delivery PIN code/,'exact production prompt is claimed before generic model routing')
// The agent API also persists the location question, allowing a cross-surface reply.
const contentEntry:any={}
runInNewContext(ts.transpileModule(readFileSync('lib/agent/content-workflow-entry.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
  exports:contentEntry,require(name:string){
    if(name==='./content-workflows')return contentWorkflows
    if(name==='@/lib/bot/process-message')return {processIncomingMessage:async()=>{throw new Error('A food request must not enter a draft workflow')}}
    throw new Error(`Unexpected content entry dependency ${name}`)
  },
})
const api:any={}
// The Agent API runs the objective-first account flow before every other route. Load the
// REAL module, not a stub, against an isolated store where reads return nothing and every
// write throws: a food request must pass straight through it without touching anything.
// Unknown dependencies throw instead of returning {}; a silent {} for this module is what
// once turned it into "tryRunExternalAccountFlow is not a function" and broke this test.
const accountWrites:string[]=[]
const accountDb={from(table:string){
  const refuse=()=>{accountWrites.push(table);throw new Error(`a food request must not write ${table} from the account flow`)}
  const q:any={select(){return q},eq(){return q},order(){return q},limit(){return q},insert:refuse,update:refuse,delete:refuse,
    then(ok:any,bad:any){return Promise.resolve({data:[],error:null}).then(ok,bad)}}
  return q
}}
const externalAccount:any={}
runInNewContext(ts.transpileModule(readFileSync('lib/agent/external-account.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
  exports:externalAccount,console,URL,Date,require(name:string){
    if(name==='@/lib/supabase-admin')return {supabaseAdmin:accountDb}
    if(name==='@/lib/bot/handlers/followup-state')return {
      clearFollowupState:async()=>{accountWrites.push('clear_followup')},
      saveFollowupState:async()=>{accountWrites.push('save_followup');throw new Error('a food request must not save an account follow-up')},
    }
    if(name==='@/lib/vault/providers')return vaultProviders
    if(name==='./external-account-intent')return accountIntent
    if(name==='./browser-command')return {runBrowserCommand:async()=>{throw new Error('a food request must not start an account browser run')}}
    // The model reader never turns a food request into an account request.
    if(name==='./account-intent-model')return {mayBeAccountRequest:()=>false,readAccountRequestWithModel:async()=>null}
    throw new Error('unexpected external-account dependency in test sandbox: '+name)
  },
})
assert.equal(typeof externalAccount.tryRunExternalAccountFlow,'function','the real account flow must load in the route sandbox')

runInNewContext(ts.transpileModule(readFileSync('app/api/agent/run/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
  exports:api,console,process:{env:{}},require(name:string){
    if(name==='@/lib/agent/external-account')return externalAccount
    if(name==='@/lib/commerce/price-comparison')return {tryPriceComparison:async()=>null}
    if(name==='@/lib/commerce/comparison-model')return comparisonModel
    if(name==='@/lib/agent/content-workflow-entry')return contentEntry
    if(name==='@/lib/agent/food-comparison')return exports
    if(name==='@/lib/supabase-admin')return {supabaseAdmin:db}
    if(name==='next/server')return {NextResponse:{json:(data:any)=>data}}
    if(name==='node:crypto')return {randomUUID:()=> 'test-request'}
    if(name==='@/lib/agent/session')return {requireAgentMutationOrigin:()=>null,requireAgentSession:async()=>({telegramId:42,surface:'web'}),isAgentSession:()=>true}
    if(name==='@/lib/agent/actor')return {resolveAgentActor:async()=>({legacyTelegramId:42})}
    if(name==='@/lib/agent/typed-time-routing')return {tryTypedTimeRouting:async()=>null}
    if(name==='@/lib/agent/brain-introspection')return {trySameBrainIntrospection:async()=>null}
    if(name==='@/lib/agent/thread-context')return {resolveThreadForUser:async()=>({id:'thread'}),attachRunToThread:async()=>{}}
    return {}
  },
})
const apiQuestion=await api.POST({json:async()=>({text:incident})})
// Assert on the API response itself. `assistant` can still hold an earlier reply, which
// is how a failed route call once passed this check while returning no task at all.
assert.ok(apiQuestion?.runId,'agent API food question must create a task; a failed route returns no runId')
assert.match(String(apiQuestion?.text||''),/delivery PIN code/,'agent API must itself ask for the delivery PIN')
assert.match(assistant,/delivery PIN code/)
const crossSurface=await run('560086',42,'whatsapp')
assert.equal(crossSurface.runId,apiQuestion.runId,'agent API question resumes on WhatsApp without a new task')
assert.equal(await externalAccount.tryRunExternalAccountFlow({actor:{legacyTelegramId:42},surface:'whatsapp',text:'560086'}),null,'a delivery PIN reply is never an account follow-up')
assert.deepEqual(accountWrites,[],'the account flow must not write anything for a food request or its PIN reply')
console.log('PASS: food location-first routing, same-task resume, owner isolation, expiry, provider links, honest incomplete state and write failure')
