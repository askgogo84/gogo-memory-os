// TEST-ONLY / expected safety RED: run unmodified booking queue through an entirely inert in-memory Supabase fixture.
// No real network, Supabase, Twilio, browser, provider, user account, booking or delivery.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

type Row=Record<string,any>
const events: Row[]=[]
const actions: Row[]=[]
let nextEvent=0, registrationCalls=0, actionUpserts=0, eventUpdates=0
const copy=(v:Row):Row=>structuredClone(v)

class EventQuery {
  filters: Array<[string,string]> = []
  constructor(readonly operation:'select'|'update',readonly patch:Row={}){}
  select(_columns:string){return this}
  eq(key:string,value:unknown){this.filters.push([key,String(value)]);return this}
  order(_key:string,_options:unknown){return this}
  limit(max:number){return Promise.resolve({data:events.filter(row=>this.filters.every(([k,v])=>String(row[k])===v)).slice(0,max).map(copy),error:null})}
  then(resolve:(v:any)=>any,reject?:(e:any)=>any){
    if(this.operation!=='update')return Promise.reject(new Error('unexpected_select_query')).then(resolve,reject)
    let matched=0
    for(const row of events.filter(row=>this.filters.every(([k,v])=>String(row[k])===v))){
      Object.assign(row,copy(this.patch)); matched++
    }
    eventUpdates+=matched
    return Promise.resolve({data:null,error:null}).then(resolve,reject)
  }
}

const fakeDb={
  from(table:string){
    if(table==='life_events') return {
      select(_columns:string){return new EventQuery('select')},
      update(patch:Row){return new EventQuery('update',patch)},
    }
    if(table==='life_event_actions') return {
      async upsert(row:Row,options:Row){
        assert.equal(options?.onConflict,'life_event_id,action_key','deduplication conflict key must be exactly event+action')
        actionUpserts++
        const old=actions.find(x=>String(x.life_event_id)===String(row.life_event_id)&&x.action_key===row.action_key)
        if(old)Object.assign(old,copy(row))
        else actions.push({id:'action-'+(actions.length+1),...copy(row)})
        return{error:null}
      },
    }
    throw new Error('unexpected_table_'+table)
  },
}
const registerLifeEvent=async(params:Row)=>{
  registrationCalls++
  const id='evt-'+(++nextEvent)
  events.push({id,telegram_id:String(params.telegramId),event_type:params.eventType,metadata_json:copy(params.metadata||{}),source_refs:copy(params.sourceRefs||[]),title:params.title,provider:params.provider,updated_at:new Date().toISOString()})
  return {id}
}
const original=readFileSync('lib/agent/booking-queue.ts','utf8')
assert.ok(original.includes("action_key: 'booking-closure'"),'test must exercise the active booking-closure queue')
const generated=ts.transpileModule(original,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const moduleRef:{exports:Row}={exports:{}}
vm.runInNewContext(generated,{
  module:moduleRef,exports:moduleRef.exports,URL,Date,console,
  require(id:string){
    if(id==='@/lib/supabase-admin')return{supabaseAdmin:fakeDb}
    if(id==='./life-event-engine')return{registerLifeEvent}
    throw new Error('unexpected_import_'+id)
  },
},{filename:'unmodified-lib/agent/booking-queue.ts'})
const queueBookingClosure=moduleRef.exports.queueBookingClosure as (params:{telegramId:number;text:string;whatsappTo:string})=>Promise<any>
assert.equal(typeof queueBookingClosure,'function')
const url='https://tickets.example.test/fixture-event-42'
const text='Please save this movie ticket: '+url
const owner={telegramId:4242,text,whatsappTo:'whatsapp:+910000000042'}
const foreign={telegramId:5252,text,whatsappTo:'whatsapp:+910000000052'}
let controlsPassed=0,safetyPassed=0
const failures:string[]=[]
async function control(name:string,fn:()=>Promise<void>){
  try{await fn();controlsPassed++;console.log('CONTROL PASS '+name)}
  catch(e){failures.push('CONTROL FAILED '+name+': '+String(e));console.error(failures.at(-1))}
}
async function safety(name:string,fn:()=>Promise<void>){
  try{await fn();safetyPassed++;console.log('SAFETY PASS '+name)}
  catch(e){failures.push('SAFETY RED '+name+': '+String(e));console.error(failures.at(-1))}
}
await control('no URL means no life-event registration or action write',async()=>{
  assert.equal(await queueBookingClosure({...owner,text:'remember a movie'}),null)
  assert.equal(events.length,0);assert.equal(actions.length,0);assert.equal(actionUpserts,0)
})
await control('first legitimate owner message creates exactly one ready action',async()=>{
  const reply=await queueBookingClosure(owner)
  assert.match(reply?.text||'',/handling this booking now/i)
  assert.equal(events.length,1);assert.equal(actions.length,1)
  assert.equal(actions[0]?.status,'ready')
  assert.equal(actions[0]?.life_event_id,events[0]?.id)
  assert.equal(actions[0]?.telegram_id,String(owner.telegramId))
  assert.equal(registrationCalls,1)
})
await control('same owner and URL reuses prior event and conflict key',async()=>{
  const reply=await queueBookingClosure(owner)
  assert.equal(reply?.lifeEventId,events[0]?.id)
  assert.equal(events.length,1);assert.equal(actions.length,1)
  assert.equal(registrationCalls,1)
})
await control('different owner with same URL creates a distinct owner-bound event/action',async()=>{
  const existingId=events[0]?.id
  const reply=await queueBookingClosure(foreign)
  assert.equal(events.length,2);assert.equal(actions.length,2)
  assert.notEqual(reply?.lifeEventId,existingId)
  assert.equal(actions[0]?.telegram_id,String(owner.telegramId))
  assert.equal(actions[1]?.telegram_id,String(foreign.telegramId))
})
await control('event mutation stays scoped by existing event ID and owner',async()=>{
  assert.equal(eventUpdates,3)
  assert.equal(actions.filter(a=>a.telegram_id===String(owner.telegramId)).length,1)
})

const action=actions[0],initialId=action.id,ownerEventId=action.life_event_id
const previousCreated=events.length
for(const fixture of [
  {name:'completed ticket work',status:'completed',payload:{closedAt:'2026-10-31T00:00:00Z',receipt:'fixture-receipt'},due:null},
  {name:'active worker lease',status:'running',payload:{leaseUntil:'2099-01-01T00:00:00Z',attempt:4},due:null},
  {name:'blocked human screenshot handoff',status:'blocked',payload:{deviceHandoffRequired:true,providerBlock:'cloudflare'},due:null},
  {name:'blocked unknown provider effect',status:'blocked',payload:{outcomeUnknown:true,reconciliationRequired:true},due:null},
  {name:'terminal unresolved retry budget',status:'blocked',payload:{unresolvedAttempts:6,retryAt:null,lastError:'unresolved'},due:null},
  {name:'already-started uncertain send intent',status:'ready',payload:{outcomeUnknown:true,sendStarted:true,lastError:'transport_timeout'},due:null},
] as const){
  await safety('duplicate booking link must not re-arm '+fixture.name,async()=>{
    Object.assign(action,{status:fixture.status,due_at:fixture.due,payload_json:{originalText:text,bookingUrl:url,...fixture.payload},updated_at:'2026-10-31T00:00:00Z'})
    const before=copy(action)
    const result=await queueBookingClosure(owner)
    assert.equal(result?.lifeEventId,ownerEventId)
    assert.equal(events.length,previousCreated)
    assert.equal(action.id,initialId)
    assert.equal(action.status,before.status,'duplicate rearmed a protected '+fixture.status+' action')
    assert.equal(action.due_at,before.due_at,'duplicate scheduled an already-in-progress or terminal action')
    for(const [key,value] of Object.entries(fixture.payload)) assert.deepEqual(action.payload_json?.[key],value,'lost prior work/uncertain-outcome evidence: '+key)
  })
}
console.log(JSON.stringify({controlsPassed,controlsExpected:5,safetyPassed,safetyExpected:6,failures:failures.length,actionUpserts,registrationCalls}))
assert.equal(controlsPassed,5,'a setup failure invalidates any defect claim')
if(failures.length)process.exitCode=1
