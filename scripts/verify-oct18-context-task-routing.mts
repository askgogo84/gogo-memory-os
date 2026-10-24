import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'
process.env.NEXT_PUBLIC_SUPABASE_URL='https://context-fixture.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY='fixture-only'
process.env.OPENAI_API_KEY='fixture-only'
process.env.ANTHROPIC_API_KEY='fixture-only'
const {isDecisionRecallQuery}=await import('../lib/agent/recall-query')
const {parseRestaurantReservationIntent}=await import('../lib/agent/restaurant-reservation')
const {tryRunWhatsAppAgent}=await import('../lib/agent/whatsapp-bridge')
const {taskStepIntent,executeTaskStep}=await import('../lib/agent/general-planner')
const {prioritizeRecallEvidence,renderContextBlock}=await import('../lib/agent/context-brain')
const {planningCalendarInstruction,isPronounReminder}=await import('../lib/bot/process-message')
const originalFetch=globalThis.fetch
let writes=0
globalThis.fetch=async(input,init)=>{
  const url=new URL(String(input))
  assert.equal(url.origin,'https://context-fixture.supabase.co')
  assert.equal(url.pathname,'/rest/v1/todos')
  assert.equal(url.searchParams.get('whatsapp_id'),'eq.fixture-owner')
  if(init?.method==='POST'){writes++;return new Response(JSON.stringify({id:'created',text:'Pack bag'}),{status:201,headers:{'Content-Type':'application/json'}})}
  return new Response(JSON.stringify([{id:'travel',text:'Pack bag for trip'},{id:'other',text:'Fix kitchen tap'}]),{headers:{'Content-Type':'application/json'}})
}
try{
  for(const text of ['What did I decide about the Naru Noodle Bar booking?','What did we say about the restaurant reservation?','Remind me what I decided about Naru']){
    assert.ok(isDecisionRecallQuery(text))
    assert.equal(parseRestaurantReservationIntent(text),null)
    assert.equal(await tryRunWhatsAppAgent({user:{id:'fixture',telegramId:123,whatsappId:'fixture-owner'} as any,text}),null)
  }
  assert.ok(parseRestaurantReservationIntent('Book Naru Noodle Bar for 2 at the next available slot between 7 PM and 9 PM'))
  const actor={userId:'fixture',legacyTelegramId:123,whatsappId:'fixture-owner',name:'Example Owner'}
  const step={tool:'tasks' as const,title:'Review tasks',instruction:'List all open tasks related to travel'}
  assert.equal(taskStepIntent(step),'read')
  const read=await executeTaskStep(actor,step)
  assert.match(read.text,/Pack bag/)
  assert.doesNotMatch(read.text,/Fix kitchen/)
  assert.equal(writes,0,'a read step never creates a task')
  await assert.rejects(()=>executeTaskStep(actor,{...step,instruction:'List tasks and create a new task'}),/task_action_ambiguous/)
  assert.equal(writes,0,'mixed instructions cannot silently mutate')
  await assert.rejects(()=>executeTaskStep({...actor,whatsappId:''},step),/task_owner_missing/)
  // 24 Oct: planner-internal steps are never saved as tasks the person did not ask for.
  const internal=await executeTaskStep(actor,{tool:'tasks',title:'Prefs',instruction:'Create task: Pack sunscreen'},'Plan a weekend in Goa')
  assert.equal((internal.output as any).skipped,'task_not_requested')
  const odd=await executeTaskStep(actor,{tool:'tasks',title:'Prefs',instruction:'Create task: Retrieve saved preferences without revealing sensitive identifiers'},'Plan Goa and add a task to book cabs')
  assert.equal((odd.output as any).skipped,'task_text_not_user_facing')
  assert.equal(writes,0,'skipped tasks are never written')
}finally{globalThis.fetch=originalFetch}
// 24 Oct live: a reminder saved as just "This".
for(const m of ['This','this','about that','it','This one.'])assert.ok(isPronounReminder(m),m)
for(const m of ['This weekend trip','call Nithin','drink water'])assert.ok(!isPronounReminder(m),m)
const query='Based on everything you already know about me, would 25 October 2026 around 8:30 PM be a good time for dinner in Bengaluru? Tell me what existing context matters.'
assert.equal(planningCalendarInstruction(query),'Show my calendar on 2026-10-25')
const move={id:'move',source:'semantic_memory',summary:'I am moving house on 25 October 2026.',score:.6,confidence:.95,inferred:false}
const oldFlight={id:'divya',source:'travel_ticket',summary:"Divya's flight on 13 October 2026",score:.9,confidence:.95,startAt:'2026-10-13T04:00:00Z',endAt:'2026-10-13T12:00:00Z'}
const facts=prioritizeRecallEvidence(query,[oldFlight,move] as any)
assert.equal(facts[0].id,'move')
assert.ok(!facts.some(f=>f.id==='divya'),'past passenger travel cannot imply current owner presence')
const rendered=renderContextBlock({query,generatedAt:'2026-10-18T00:00:00Z',memoryEnabled:true,facts,provenance:{}} as any,3200)
assert.match(rendered,/moving house/,'the relevant saved commitment survives the actual prompt budget')
assert.doesNotMatch(rendered,/Divya/)
console.log('D6/D7/D10: date-specific calendar/context, recall bypass, owner-bound read-only tasks passed')

// Execute the dashboard POST with real private-intent parsers. Provider handlers
// fail immediately if a link save or decision recall reaches them.
const linkModule=await import('../lib/services/link-vault')
const webExports:any={}
const requests:string[]=[]
const noop=new Proxy({}, {get:(_target,key)=>/^(?:record|observe|capture)/.test(String(key))?async()=>null:()=>null})
const db={from:(table:string)=>{
  assert.equal(table,'users')
  const q:any={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:{telegram_id:123,whatsapp_id:'fixture-owner',name:'Example Owner'}})}
  return q
}}
const deps:any={
  'crypto':{randomUUID:()=> 'fixture-decision'},
  'next/server':{NextResponse:{json:(body:any,options:any={})=>new Response(JSON.stringify(body),{status:options.status||200})}},
  '@/lib/dashboard/session':{getSession:async()=>({telegramId:'123'})},
  '@/lib/agent/actor':{resolveAgentActor:async()=>({userId:'fixture',legacyTelegramId:123,whatsappId:'fixture-owner',name:'Example Owner'})},
  '@/lib/supabase-admin':{supabaseAdmin:db},
  '@/lib/agent/recall-query':{isDecisionRecallQuery},
  '@/lib/services/link-vault':linkModule,
  '@/lib/bot/process-message':{processIncomingMessage:async(params:any)=>{requests.push(params.text);return{text:'private context result',handledBy:'private-context'}}},
  '@/lib/agent/browser-command':{...noop,findLoginCodeRun:async()=>null,tryRunBrowserCommand:()=>{throw Error('private request reached browser')}},
  '@/lib/agent/restaurant-reservation':{tryRunRestaurantReservation:()=>{throw Error('recall reached booking')}},
}
runInNewContext(ts.transpileModule(readFileSync('app/api/dashboard/chat/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
  exports:webExports,URL,Request,Response,Buffer,process,console,require:(name:string)=>deps[name]||noop,
})
for(const text of ['What did I decide about the Naru Noodle Bar booking?','Save this link — open-source browser extension for saving links: https://github.com/example/repo','Retrieve the saved Google Meet link:']){
  const request=new Request('https://fixture.invalid/api/dashboard/chat',{method:'POST',headers:{origin:'https://fixture.invalid','content-type':'application/json'},body:JSON.stringify({text})})
  const result=await webExports.POST(Object.assign(request,{nextUrl:new URL(request.url)}))
  assert.equal(result.status,200)
  assert.equal((await result.json()).handledBy,'private-context')
  assert.equal(requests.at(-1),text)
}
console.log('Actual dashboard POST routes saved links and decision recall before browser/booking')
