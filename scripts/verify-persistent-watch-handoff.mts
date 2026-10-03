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
const sent:string[]=[]
const queries:string[]=[]
const store:Record<string,any[]>={agent_watchers:[],agent_ideas:[],agent_activity:[],users:[{telegram_id:101,whatsapp_id:'fixture-phone'}]}
const db={from(table:string){
  store[table] ||= []
  const filters:Array<(r:any)=>boolean>=[]
  let changes:any,insert:any,single=false
  const b:any={
    select(){return b},eq(k:string,v:any){filters.push(r=>String(r[k])===String(v));return b},
    in(k:string,v:any[]){filters.push(r=>v.includes(r[k]));return b},
    lte(k:string,v:any){filters.push(r=>r[k]!=null&&r[k]<=v);return b},
    order(){return b},limit(){return b},or(){return b},is(){return b},update(v:any){changes=v;return b},insert(v:any){insert=v;return b},
    maybeSingle(){single=true;return b},single(){single=true;return b},
    then(resolve:any,reject:any){return Promise.resolve().then(()=>{
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
    '@/lib/channels/whatsapp':{sendWhatsAppMessage:async(_phone:string,text:string)=>{sent.push(text)}},
    '@/lib/web-search':{searchWebResults:async(query:string)=>{queries.push(query);return structuredClone(results)}},
    '@/lib/services/cost-guard':{getCostBudget:async()=>budget,checkCostAllowance:async()=>({allowed:true,state:{usageRatio:0}}),recordCostEvent:async()=>{},COST_ESTIMATES_PAISE:{web_search_basic:1}},
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
const commandMocks:any={
  './watchers':freshWorker(), '@/lib/supabase-admin':{supabaseAdmin:db},
  '@/lib/services/cost-guard':{getCostBudget:async()=>budget}, './watch-cost-policy':cadence,
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
const routesToWatch=(text:string)=>vm.runInNewContext(predicate!,{text,parseWebWatchCommand:commandExports.parseWebWatchCommand})
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
