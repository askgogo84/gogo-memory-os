import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {createRequire} from 'node:module'
import {runInNewContext} from 'node:vm'
const repo=process.cwd()
const require=createRequire(import.meta.url)
const ts=require(path.join(repo,'node_modules/typescript'))
process.env.NEXT_PUBLIC_SUPABASE_URL='https://c1-context.invalid'
process.env.SUPABASE_SERVICE_ROLE_KEY='fixture-only'
process.env.OPENAI_API_KEY='fixture-only'
process.env.ANTHROPIC_API_KEY='fixture-only'
const RealDate=Date,epoch=RealDate.parse('2026-10-18T13:11:00Z')
class FixedDate extends RealDate{constructor(value?:string|number){super(value===undefined?epoch:value)}static now(){return epoch}}
globalThis.Date=FixedDate as DateConstructor
const beforeFetch=globalThis.fetch
let externalCalls=0
globalThis.fetch=async()=>{externalCalls++;throw Error('Real provider/model transport forbidden')}
const failures:string[]=[]
async function check(label:string,fn:()=>unknown){try{await fn();console.log('PASS '+label)}catch(error){failures.push(label+': '+(error instanceof Error?error.message:String(error)))}}
const noop=new Proxy({}, {get:(_target,key)=>/^(?:record|observe|capture)/.test(String(key))?async()=>null:()=>null})
function load(file:string,deps:Record<string,unknown>){const exports:any={};runInNewContext(ts.transpileModule(readFileSync(path.join(repo,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{exports,require:(name:string)=>deps[name]||noop,process:{env:{ANTHROPIC_API_KEY:'fixture-only'}},Date:FixedDate,Intl,console:{log(){},error(){},warn(){}},URL,URLSearchParams,Request,Response,Buffer,AbortSignal,setTimeout,clearTimeout});return exports}
try{
 const {detectIntent}=await import(pathToFileURL(path.join(repo,'lib/bot/detect-intent.ts')).href)
 const context=await import(pathToFileURL(path.join(repo,'lib/agent/context-brain.ts')).href)
 const redaction=await import(pathToFileURL(path.join(repo,'lib/bot/memory-redaction.ts')).href)
 const calendarActions=await import(pathToFileURL(path.join(repo,'lib/bot/handlers/calendar-actions.ts')).href)
 const recall=await import(pathToFileURL(path.join(repo,'lib/agent/recall-query.ts')).href)
 const workflows=await import(pathToFileURL(path.join(repo,'lib/agent/content-workflows.ts')).href)
 let captured:any,modelCalls=0,calendarCalls=0,contextFailure=false,historical=false,lastContextQuery=''
 class InertAnthropic{messages={create:async(params:unknown)=>{modelCalls++;captured=params;return{content:[{type:'text',text:'Bounded synthetic response'}]}}}}
 const services=load('lib/services/claude.ts',{'@anthropic-ai/sdk':InertAnthropic,openai:class{},'@/lib/bot/memory-redaction':redaction,'@/lib/agent/content-workflows':workflows})
 const old='Synthetic Guest arrives on flight ZX123 on 13 October 2026.'
 const move='Owner is moving house on 25 October 2026.'
 const unrelated='Synthetic Noodle Bar was an unrelated earlier assistant suggestion.'
 const previousUser='Tell me about Synthetic Guest and the recorded flight.'
 const preference='Standing owner preference: quiet seating.'
 const queries:string[]=[]
 const writes:Array<{role:string;content:string}>=[]
 const db={from:(table:string)=>{assert.ok(['conversations','memories'].includes(table),'Unexpected table '+table);queries.push(table);const q:any={select:()=>q,eq:(key:string,value:unknown)=>{assert.equal(key,'telegram_id');assert.equal(value,123);return q},order:()=>q,limit:()=>q,insert:(row:any)=>{assert.equal(row.telegram_id,123);assert.ok(['user','assistant'].includes(row.role));writes.push(row);return{error:null}},then:(resolve:any)=>resolve({data:table==='memories'?[{content:old},{content:unrelated},{content:move}]:[{role:'assistant',content:unrelated},{role:'user',content:previousUser}],error:null})};return q}}
 const pack=(query:string)=>({query,generatedAt:new FixedDate().toISOString(),memoryEnabled:true,facts:historical?[
  {id:'recorded-old-flight',source:'travel_ticket',summary:old,score:.95,confidence:.95,inferred:false,startAt:'2026-10-13T04:00:00Z',endAt:'2026-10-13T12:00:00Z'},
 ]:[
  {id:'recorded-move',source:'life_event',summary:move,score:.95,confidence:.95,inferred:false,startAt:'2026-10-25T00:00:00Z',endAt:'2026-10-25T23:00:00Z'},
  {id:'recorded-old-flight',source:'travel_ticket',summary:old,score:.95,confidence:.95,inferred:false,startAt:'2026-10-13T04:00:00Z',endAt:'2026-10-13T12:00:00Z'},
 ],provenance:{lifeEvents:1,travelTickets:1,openLoops:0,semanticMemories:0,insights:0,typedContext:0}})
 const pm=load('lib/bot/process-message.ts',{
  './resolve-user':{resolveUser:async()=>({id:'synthetic-owner',telegramId:123,whatsappId:'fixture-owner',name:'Synthetic Owner'})},'./detect-intent':{detectIntent},'@/lib/agent/semantic-gate':{gateDetectedIntent:(intent:unknown)=>intent},
  './format-response':{formatOutgoingText:(_channel:string,text:string)=>text},'@/lib/supabase-admin':{supabaseAdmin:db},'@/lib/limits':{checkAndIncrementLimit:async()=>({allowed:true})},
  '@/lib/services/memory-index':{isIndexable:()=>true},'@/lib/bot/memory-redaction':redaction,
  '@/lib/bot/handlers/preferences':new Proxy({getPreferenceBlock:async()=>preference},{get:(target:any,key:string)=>target[key]||noop[key as keyof typeof noop]}),
  '@/lib/agent/recall-query':recall,
  '@/lib/agent/content-workflows':workflows,
  '@/lib/agent/context-brain':{buildContextPack:async(params:any)=>{assert.equal(params.actor.legacyTelegramId,123);assert.equal(params.actor.userId,'synthetic-owner');lastContextQuery=params.text;if(contextFailure)throw Error('fixture_context_unavailable');return pack(params.text)},renderContextBlock:context.renderContextBlock},
  './handlers/calendar-actions':{isCalendarAction:()=>false,parseAbsoluteDate:calendarActions.parseAbsoluteDate},
  '@/lib/agent/calendar-read':{executeReadOnlyCalendarStep:async(params:any)=>{calendarCalls++;assert.equal(params.actor.legacyTelegramId,123);assert.match(params.instruction,/^Show my calendar on 2026-10-(?:25|13)$/);return{text:'Calendar coverage incomplete. No events returned on this partial calendar page.'}}},
  '@/lib/claude':services,'./parse-claude-response':{parseClaudeResponse:()=>({type:'none'})},'./action-claim-guard':{guardChatActionClaims:(text:string)=>({blocked:false,text})},
 })
 const run=async(text:string)=>{const callsBefore=modelCalls;assert.equal(detectIntent(text).type,'general_chat','fixture must reach actual context assembly');const result=await pm.processIncomingMessage({channel:'whatsapp',externalUserId:'fixture-owner',text,messageType:'text'});assert.equal(result.text,'Bounded synthetic response');assert.equal(modelCalls,callsBefore+1);return captured}
 const canonical='Based on everything you already know about me, would 25 October around 8:30 PM be a good time for dinner in Bengaluru? Tell me what existing context matters.'
 await check('future context synthesis uses selected owner evidence without legacy memory bypass',async()=>{
  const result=await run(canonical)
  assert.equal(result.messages.length,1)
  assert.ok(result.system.includes(move),'recorded moving-day fact must survive')
  assert.ok(result.system.includes(preference),'standing preference must survive')
  assert.match(result.system,/Calendar coverage incomplete/)
  assert.ok(!result.system.includes(old),'expired raw arrival must not bypass the actual filtered renderer')
  assert.ok(!result.system.includes(unrelated),'unrelated assistant or legacy-memory branch must not re-enter')
  assert.equal(calendarCalls,1)
 })
 await check('failed selected-context lookup stays unavailable without stale raw-memory fallback',async()=>{
  contextFailure=true
  try{const result=await run(canonical);assert.match(result.system,/retrieval is unavailable/);assert.ok(!result.system.includes(old));assert.ok(!result.system.includes(unrelated));assert.match(result.system,/Calendar coverage incomplete/)}finally{contextFailure=false}
 })
 await check('historical context synthesis retains recorded history from the selected pack',async()=>{
  historical=true
  try{const result=await run('Based on everything you already know, what context matters about Synthetic Guest and the past flight on 13 October 2026?');assert.equal(result.messages.length,1);assert.ok(result.system.includes(old),'recorded historical arrival remains available');assert.ok(!result.system.includes(unrelated))}finally{historical=false}
 })
 await check('trusted previous user resolves a synthesis pronoun without reintroducing assistant history',async()=>{
  historical=true
  try{const result=await run('Use my saved context: what was her scheduled arrival on 13 October 2026?');assert.ok(lastContextQuery.includes('Previous user request: '+previousUser),'selected retrieval must retain trusted user referent binding');assert.ok(!lastContextQuery.includes(unrelated));assert.equal(result.messages.length,1);assert.ok(result.system.includes(old));assert.ok(!result.system.includes(unrelated))}finally{historical=false}
 })
 await check('ordinary conversation retains its existing history and memory inputs',async()=>{
  const result=await run('Tell me about the move I mentioned')
  assert.equal(result.messages.length,3,'ordinary history includes both existing user and assistant turns')
  assert.ok(result.messages.some((message:any)=>message.content===unrelated))
  assert.ok(result.system.includes(old));assert.ok(result.system.includes(move))
 })
 const workflowPrompt='Write a LinkedIn post using everything you already know about me about my upcoming move'
 await check('content workflow synthesis also uses selected evidence without raw-memory bypass',async()=>{
  const result=await run(workflowPrompt)
  assert.match(result.system,/CURRENT CONTENT WORKFLOW: linkedin-post/)
  assert.equal(result.messages.length,1);assert.ok(result.system.includes(move));assert.ok(result.system.includes(preference))
  assert.ok(!result.system.includes(old),'workflow must not bypass the selected future context')
  assert.ok(!result.system.includes(unrelated),'workflow must exclude unrelated raw memories')
 })
 await check('content workflow selected-context failure stays explicitly unavailable',async()=>{
  contextFailure=true
  try{const result=await run(workflowPrompt);assert.match(result.system,/retrieval is unavailable/);assert.ok(!result.system.includes(old));assert.ok(!result.system.includes(unrelated))}finally{contextFailure=false}
 })
 await check('content workflow synthesis preserves trusted historical pronoun retrieval',async()=>{
  historical=true
  try{const result=await run('Write a LinkedIn post using my saved context about her scheduled arrival on 13 October 2026');assert.ok(lastContextQuery.includes('Previous user request: '+previousUser));assert.equal(result.messages.length,1);assert.ok(result.system.includes(old));assert.ok(!result.system.includes(unrelated))}finally{historical=false}
 })
 await check('ordinary content workflow preserves existing history and memory behavior',async()=>{
  const result=await run('Write a LinkedIn post about the move I mentioned')
  assert.match(result.system,/CURRENT CONTENT WORKFLOW: linkedin-post/)
  assert.equal(result.messages.length,3);assert.ok(result.system.includes(old));assert.ok(result.system.includes(move))
 })
 await check('context regressions stay owner-scoped with no provider, secret-store or action I/O',()=>{
  assert.equal(externalCalls,0);assert.ok(queries.includes('memories'),'ordinary conversation exercises real legacy-memory getter')
  assert.ok(writes.every(row=>['user','assistant'].includes(row.role)))
 })
}finally{globalThis.fetch=beforeFetch;globalThis.Date=RealDate}
if(failures.length){console.error(failures.join('\n'));process.exitCode=1}else console.log('Actual context assembly/model-input authority controls passed; inert synthetic fixtures only, no live acceptance implied.')
