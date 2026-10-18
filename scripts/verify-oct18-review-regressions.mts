import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import crypto from 'node:crypto'
import ts from 'typescript'
import * as model from '../lib/commerce/comparison-model'
import * as quality from '../lib/agent/watcher-quality'
import * as travelTime from '../lib/services/travel-time'
import * as timezone from '../lib/timezone'
const failures:string[]=[]
async function check(name:string,run:()=>unknown){try{await run();console.log('PASS',name)}catch(error){failures.push(name);console.error('FAIL',name,error)}}
const clock=Date.parse('2026-10-18T18:45:00Z') // 19 October at destination, still 18 October UTC.
class Clock extends Date{constructor(value?:string|number){super(value===undefined?clock:value)}static now(){return clock}}
const rows=[{id:'00000000-0000-4000-8000-000000000001',telegram_id:123,from_city:'Amsterdam',to_city:'Bengaluru',depart_at:new Date(clock+3600000).toISOString(),arrive_at:new Date(clock+7200000).toISOString(),flight_no:'KL879'}]
let stored:any[]=[],home=false,rejectRetire=false
const db={from(table:string){let update:any,insert:any,single=false;const filters:Array<(r:any)=>boolean>=[];const b:any={
  select(){return b},eq(k:string,v:any){filters.push(r=>String(k.includes('->>')?r[k.split('->>')[0]]?.[k.split('->>')[1]]:r[k])===String(v));return b},
  in(k:string,v:unknown[]){filters.push(r=>v.includes(r[k]));return b},gte(){return b},lt(){return b},or(){return b},order(){return b},limit(){return b},
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
vm.runInNewContext(source,{exports,module:{exports},require:(name:string)=>mocks[name]||{},Date:Clock,console,Intl})
await check('post-arrival weather retains destination-local explicit occurrence date',()=>{
  const conditions=exports.desiredWebConditions([{...rows[0],depart_at:new Date(clock-7200000).toISOString(),arrive_at:new Date(clock-3600000).toISOString()}],'root','2026-10-22T00:00:00Z')
  const weather=conditions.find((r:any)=>r.condition.contextClass==='destination_weather').condition
  assert.match(weather.query,/19 October 2026/)
  assert.equal(quality.verifyContextualDisruption({contextClass:'destination_weather',query:weather.query,title:weather.title,resultTitle:'Bengaluru heavy rain warning 12 October 2025'}).verified,false)
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
assert.deepEqual(failures,[],'review regressions must all pass')
