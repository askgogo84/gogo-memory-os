import * as sentinel from '../lib/agent/sentinel'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import crypto from 'node:crypto'
import ts from 'typescript'
import * as model from '../lib/commerce/comparison-model'
import * as identity from '../lib/commerce/product-identity'
import * as quality from '../lib/agent/watcher-quality'
import * as travelTime from '../lib/services/travel-time'
import * as timezone from '../lib/timezone'
const failures:string[]=[]
async function check(name:string,run:()=>unknown){try{await run();console.log('PASS',name)}catch(error){failures.push(name);console.error('FAIL',name,error)}}
function fixtureComputer(){
  const computer:any={}
  const source=ts.transpileModule(fs.readFileSync('lib/agent/secure-computer.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
  vm.runInNewContext(source,{exports:computer,module:{exports:computer},require:(name:string)=>name==='./sentinel'?sentinel:name==='../commerce/product-identity'?identity:{},process:{env:{}},Buffer,URL,console})
  return computer
}
const clock=Date.parse('2026-10-18T18:45:00Z') // 19 October at destination, still 18 October UTC.
class Clock extends Date{constructor(value?:string|number){super(value===undefined?clock:value)}static now(){return clock}}
const rows=[{id:'00000000-0000-4000-8000-000000000001',telegram_id:123,from_city:'Amsterdam',to_city:'Bengaluru',depart_at:new Date(clock+3600000).toISOString(),arrive_at:new Date(clock+7200000).toISOString(),flight_no:'KL879'}]
let stored:any[]=[],home=false,rejectRetire=false
const ticketBounds:Array<{key:string;value:string}>=[]
const db={from(table:string){let update:any,insert:any,single=false;const filters:Array<(r:any)=>boolean>=[];const b:any={
  select(){return b},eq(k:string,v:any){filters.push(r=>String(k.includes('->>')?r[k.split('->>')[0]]?.[k.split('->>')[1]]:r[k])===String(v));return b},
  in(k:string,v:unknown[]){filters.push(r=>v.includes(r[k]));return b},gte(key:string,value:string){if(table==='travel_tickets')ticketBounds.push({key,value});return b},lt(){return b},or(value:string){if(table==='travel_tickets')for(const clause of value.split(',')){const match=clause.match(/^(depart_at|arrive_at)\.gte\.(.+)$/);if(match)ticketBounds.push({key:match[1],value:match[2]})}return b},order(){return b},limit(){return b},
  update(v:any){update=v;return b},insert(v:any){insert=v;return b},maybeSingle(){single=true;return b},single(){single=true;return b},
  then(resolve:any,reject:any){return Promise.resolve().then(()=>{
    if(table==='travel_tickets')return {data:rows,error:null}
    if(table==='memories')return {data:home?[{content:'My home city is Bengaluru'}]:[],error:null}
    if(table==='users')return {data:{gmail_connected:false},error:null}
    if(table!=='agent_watchers')return {data:[],error:null}
    const matches=stored.filter(r=>filters.every(f=>f(r)))
    if(update&&update.active===false&&rejectRetire)return {data:null,error:{message:'fixture retirement failed'}}
    if(update)matches.forEach(r=>Object.assign(r,structuredClone(update)))
    if(insert){const row={id:'watch-'+stored.length,...structuredClone(insert)};stored.push(row);return {data:single?row:[row],error:null}}
    return {data:single?matches[0]||null:structuredClone(matches),error:null}
  }).then(resolve,reject)},
};return b}}
const exports:any={}
const source=ts.transpileModule(fs.readFileSync('lib/agent/contextual-travel-watchers.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const mocks:any={'node:crypto':crypto,'@/lib/supabase-admin':{supabaseAdmin:db},'@/lib/services/cost-guard':{getCostBudget:async()=>({activeWebWatchersMax:20})},'@/lib/services/travel-time':travelTime,'@/lib/timezone':timezone,'./flight-leg-tracker':{normalizeFlightNo:(v:string)=>v}}
vm.runInNewContext(source,{exports,module:{exports},require:(name:string)=>name==='./sentinel'?sentinel:mocks[name]||{},Date:Clock,console,Intl})
await check('post-arrival weather retains destination-local explicit occurrence date',()=>{
  const conditions=exports.desiredWebConditions([{...rows[0],depart_at:new Date(clock-7200000).toISOString(),arrive_at:new Date(clock-3600000).toISOString()}],'root','2026-10-22T00:00:00Z')
  const weather=conditions.find((r:any)=>r.condition.contextClass==='destination_weather').condition
  assert.match(weather.query,/19 October 2026/)
  assert.equal(quality.verifyContextualDisruption({contextClass:'destination_weather',query:weather.query,title:weather.title,resultTitle:'Bengaluru heavy rain warning 12 October 2025'}).verified,false)
  const next=quality.effectiveWeatherQuery(weather,new Date('2026-10-19T20:00:00Z'))
  assert.match(next,/20 October 2026/,'saved query advances to the destination local date at each poll')
  assert.equal(quality.verifyContextualDisruption({contextClass:'destination_weather',query:next,title:weather.title,resultTitle:'Bengaluru heavy rain warning 19 October 2026'}).verified,false)
  assert.equal(quality.verifyContextualDisruption({contextClass:'destination_weather',query:next,title:weather.title,resultTitle:'Bengaluru heavy rain warning 20 October 2026'}).verified,true)
})
await check('existing home-city weather is retired with owner isolation and visible failures',async()=>{
  stored=[];home=false;await exports.compileTravelWatchersForUser(123)
  const weather=stored.find(r=>r.condition_json.contextClass==='destination_weather');assert.ok(weather?.active)
  stored.push({...structuredClone(weather),id:'other-owner',telegram_id:456},{id:'manual',telegram_id:123,type:'web_search',active:true,condition_json:{title:'My Bengaluru weather'}})
  home=true;rejectRetire=true
  await assert.rejects(()=>exports.compileTravelWatchersForUser(123),/retire|reconcile/)
  rejectRetire=false;await exports.compileTravelWatchersForUser(123)
  assert.equal(weather.active,false)
  assert.equal(stored.find(r=>r.id==='other-owner').active,true)
  assert.equal(stored.find(r=>r.id==='manual').active,true)
})
await check('accepted equivalent-unit product renders final price without weakening pack identity',()=>{
  const row=model.providerObservation('zepto',{id:'fixture',status:'completed'},{status:'completed',output_json:{sourceUrl:'https://www.zepto.com/pn/amul-butter/pvid/item',summary:'Amul butter 0.5kg\n₹250'}},'Amul butter 500g')
  assert.equal(row.status,'observed');assert.equal(model.comparisonQuote('Amul butter 500g',row)?.price,'₹250')
  assert.match(model.comparisonWhatsAppSummary({id:'fixture',status:'completed',title:'butter',source:'fixture',updated_at:'2026-10-18',metadata_json:{request:'fixture',subject:'Amul butter 500g',providers:[row]}}),/₹250/)
  assert.equal(model.comparisonEvidenceMatchesSubject('Amul butter 500g pack of 2','Amul butter 500g pack of 3 ₹500'),false)
  assert.equal(model.comparisonEvidenceMatchesSubject('Amul butter 500g','Amul butter 1500g ₹500'),false)
})
await check('quantity clause identity survives discovery direct observation and final summary',()=>{
  const subject='Logitech M185 wireless mouse, grey, quantity 1,'
  const title='Logitech M185 wireless mouse grey'
  const url='https://www.flipkart.com/logitech-m185/p/itm1?pid=FIXTURE'
  assert.equal(model.comparisonProductLead('flipkart',subject,[{url,title}]),url)
  const observed=model.providerObservation('flipkart',{id:'fixture',status:'completed'},{status:'completed',output_json:{sourceUrl:url,summary:title+'\n₹926'}},subject)
  assert.equal(observed.status,'observed');assert.equal(model.comparisonQuote(subject,observed)?.price,'₹926')
  assert.match(model.comparisonWhatsAppSummary({id:'fixture',status:'completed',title,source:'fixture',updated_at:'2026-10-18',metadata_json:{request:'fixture',subject,providers:[observed]}}),/₹926/)
  const computer=fixtureComputer()
  const objective=`Find the listed price of this product on Flipkart: ${JSON.stringify(subject)}.`
  assert.equal(computer.comparisonReadEvidenceMatches(objective,title+' ₹926'),true)
  assert.ok(computer.productPagePriceEvidence(objective,title,title+' ₹926 in stock'))
  assert.equal(computer.productPagePriceEvidence(objective,title.replace('grey','black'),title.replace('grey','black')+' ₹926 in stock'),null)
  for(const wrong of ['Apple iPhone 18 Pro 128GB','Apple iPhone 18 512GB','Apple iPhone 118 128GB'])assert.equal(identity.productIdentityMatches('iPhone 18',wrong),false)
  assert.equal(model.tokensEndWords('Apple iPhone 18 128GB',['iPhone','18','128GB']),true,'model digits must not be concatenated with capacity')
})
await check('unrequested multipacks are refused across discovery observation and price quote',()=>{
  const computer=fixtureComputer()
  const cases=[{subject:'Amul butter 500g',label:'Amul butter 500g pack of 2'},{subject:'Logitech M185 wireless mouse grey',label:'Logitech M185 wireless mouse grey pack of 3'}]
  for(const {subject,label} of cases){
    const url='https://www.flipkart.com/item/p/itm1?pid=FIXTURE'
    assert.equal(identity.productIdentityMatches(subject,label),false)
    assert.equal(model.comparisonProductLead('flipkart',subject,[{url,title:label}]),null)
    assert.equal(model.providerObservation('flipkart',{id:'fixture',status:'completed'},{status:'completed',output_json:{sourceUrl:url,summary:label+'\n₹500'}},subject).status,'failed')
    assert.equal(model.comparisonQuote(subject,{provider:'flipkart',status:'observed',sourceUrl:url,evidence:label+'\n₹500'}),null)
    const objective=`Find the listed price of this product on Flipkart: ${JSON.stringify(subject)}.`
    assert.equal(computer.productPagePriceEvidence(objective,label,label+' ₹500 in stock'),null)
    assert.equal(computer.comparisonReadEvidenceMatches(objective,label+' ₹500'),false)
  }
  assert.equal(identity.productIdentityMatches('Amul butter 500g pack of 2','Amul butter 2 x 500g'),true)
  assert.equal(identity.productIdentityMatches('Amul butter 500g x2','Amul butter 500g 2-pack'),true)
  assert.equal(identity.productIdentityMatches('Amul butter 500g pack of 2','Amul butter 500g pack of 20'),false)
  assert.equal(identity.productIdentityMatches('Amul butter 500g, quantity 2,','Amul butter 500g pack of 2'),false,'cart quantity is separate from one sellable item pack')
  const packSubject='Amul butter 500g pack of 2',packLabel='Amul butter 2 x 500g',packUrl='https://www.flipkart.com/amul/p/itm1?pid=FIXTURE'
  assert.equal(model.comparisonProductLead('flipkart',packSubject,[{url:packUrl,title:packLabel}]),packUrl)
  const packObserved=model.providerObservation('flipkart',{id:'fixture',status:'completed'},{status:'completed',output_json:{sourceUrl:packUrl,summary:packLabel+'\n₹500'}},packSubject)
  assert.equal(packObserved.status,'observed');assert.equal(model.comparisonQuote(packSubject,packObserved)?.price,'₹500')
  assert.ok(computer.productPagePriceEvidence(`Find the listed price of this product on Flipkart: "${packSubject}".`,packLabel,packLabel+' ₹500 in stock'))
})
await check('arrived home weather reconciles through both public scheduled and per-user entry points',async()=>{
  rows[0].depart_at=new Date(clock-8*3600000).toISOString();rows[0].arrive_at=new Date(clock-2*3600000).toISOString()
  const root='travel:'+crypto.createHash('sha256').update(rows[0].id).digest('hex').slice(0,24)
  const condition=exports.desiredWebConditions(rows,root,new Date(clock+70*3600000).toISOString()).find((r:any)=>r.condition.contextClass==='destination_weather').condition
  const fixture=()=>[{id:'arrived-home',telegram_id:123,type:'web_search',active:true,condition_json:condition},{id:'other-owner',telegram_id:456,type:'web_search',active:true,condition_json:condition},{id:'manual',telegram_id:123,type:'web_search',active:true,condition_json:{title:'Bengaluru weather'}}]
  home=true;rejectRetire=false
  for(const hours of [{depart:8,arrive:2},{depart:84,arrive:60}])for(const entry of ['compileTravelWatchersForUser','compileUpcomingTravelWatchers']){
    rows[0].depart_at=new Date(clock-hours.depart*3600000).toISOString();rows[0].arrive_at=new Date(clock-hours.arrive*3600000).toISOString()
    stored=fixture();ticketBounds.length=0
    if(entry==='compileTravelWatchersForUser')await exports[entry](123);else await exports[entry]()
    assert.equal(stored[0].active,false,entry+' must retire weather after long-haul arrival')
    assert.equal(stored[1].active,true);assert.equal(stored[2].active,true)
    assert.ok(ticketBounds.some(bound=>bound.key==='arrive_at'&&Date.parse(bound.value)<=Date.parse(rows[0].arrive_at)),'actual database window includes recently arrived sources even when departure is older than72h')
  }
  Object.assign(rows[0],{passengers:['A Different Traveller'],raw:{travellerAliases:{'A Different Traveller':'Colleague'}}})
  stored=fixture();await exports.compileTravelWatchersForUser(123)
  assert.equal(stored[0].active,true,'owner home must not be inferred as another named traveller home')
  Object.assign(rows[0],{passengers:undefined,raw:undefined})
})
assert.deepEqual(failures,[],'review regressions must all pass')
