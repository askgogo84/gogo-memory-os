import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import {createHash} from 'node:crypto'
import ts from 'typescript'
import * as timezone from '../lib/timezone'
import * as diningContext from '../lib/agent/reservation-dining-context'

// Actual preparation + context exports. Every database/provider operation below
// is inert and owner-checked; this test cannot create/arm a real reservation.
const fixtureNow=Date.parse('2026-10-18T10:00:00Z')
class FixtureDate extends Date {constructor(value?:any){super(value===undefined?fixtureNow:value)}static now(){return fixtureNow}}
function load(file:string,deps:Record<string,unknown>){const exports:any={};runInNewContext(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:(name:string)=>deps[name]||{},Date:FixtureDate,Intl,console,URL,Set,Map});return exports}
const context=load('lib/agent/context-brain.ts',{'node:crypto':{createHash}})
const futureTravel={id:'synthetic-travel',source:'travel_presence',summary:'Synthetic owner travel',startAt:'2026-10-21T00:00:00Z',endAt:'2026-10-24T23:00:00Z',location:'Synthetic away city',score:1,confidence:1,participants:['Synthetic Owner'],sourceRefs:[{type:'travel_ticket',id:'synthetic-travel'}]}
const facts=[futureTravel,{...futureTravel,id:'unrelated',source:'semantic_memory',summary:'Unrelated private memory',location:'Unrelated private location'}]
const pack={facts,reservationTravel:{ownerId:'123',facts,incomplete:false,coveredFrom:'2026-10-18T10:00:00Z',coveredUntil:'2026-12-17T10:00:00Z'}}
const writes:Array<{table:string;payload:any}>=[]
let revising=false
const db={from(table:string){let updating=false;const q:any={
 select:()=>q,eq:(key:string,value:unknown)=>{if(key==='telegram_id')assert.equal(String(value),'123');return q},
 in:()=>q,order:()=>q,limit:()=>q,
 update:(payload:any)=>{updating=true;writes.push({table,payload});return q},
 maybeSingle:async()=>({data:updating?{id:'existing-context-run'}:table==='users'?{timezone:'Asia/Kolkata'}:revising&&table==='life_events'?{id:'synthetic-life_events'}:revising&&table==='agent_runs'?{id:'existing-context-run',status:'paused',error:'restaurant_context_review_required',metadata_json:{}}:revising&&table==='agent_approvals'?{id:'expired-approval',status:'expired'}:null,error:null}),
 upsert:(payload:any)=>{assert.equal(String(payload.telegram_id),'123');writes.push({table,payload});return q},
 insert:(payload:any)=>{assert.equal(String(payload.telegram_id),'123');writes.push({table,payload});return q},
 single:async()=>({data:{id:revising&&table==='agent_runs'?'existing-context-run':'synthetic-'+table},error:null}),then:(resolve:any)=>resolve({error:null})};return q}}
let inspected=0
let bindingInput:any
const actual=load('lib/agent/restaurant-reservation.ts',{
 'node:crypto':{createHash},'@/lib/supabase-admin':{supabaseAdmin:db},'@/lib/timezone':timezone,
 './reservation-dining-context':diningContext,
 './secure-computer':{runSecureBrowser:async(input:any)=>{assert.equal(input.mode,'read');inspected++;return{status:'completed',pageText:'Sold out. Bookings open every Monday at 8 PM.'}}},
 './approval-binding':{buildApprovalBinding:(input:any)=>{bindingInput=input;return{}}},
 './context-brain':{buildContextPack:async(input:any)=>{assert.equal(input.actor.legacyTelegramId,123);return pack},travelContextAt:context.travelContextAt,contextSourceRefs:context.contextSourceRefs}
})
const result=await actual.tryRunRestaurantReservation({actor:{legacyTelegramId:123,userId:'synthetic-user',name:'Synthetic Owner'},surface:'dashboard',text:'Book Naru Noodle Bar for 2 at the next available slot between 7 PM and 9 PM.'})
assert.equal(result.status,'waiting_approval');assert.equal(inspected,1)
const payload=writes.find(row=>row.table==='life_event_actions')!.payload.payload_json
assert.equal(context.travelContextAt(pack,'2026-10-22T15:00:00Z').length,1,'Actual context helper identifies dining-date travel')
assert.ok(payload.contextWindows.some((window:any)=>Date.parse(window.startAt)===Date.parse(futureTravel.startAt)),'Travel starting after release must remain available for checking a later dining slot')
assert.doesNotMatch(JSON.stringify(payload.contextWindows),/Unrelated private/,'Unrelated private context must not enter reservation constraints')
assert.ok(bindingInput.payload.diningContext.windows.some((window:any)=>Date.parse(window.startAt)===Date.parse(futureTravel.startAt)),'The staged approval input must bind the retained travel constraints')
revising=true;writes.length=0
const revised=await actual.tryRunRestaurantReservation({actor:{legacyTelegramId:123,userId:'synthetic-user',name:'Synthetic Owner'},surface:'dashboard',text:'Book Naru Noodle Bar for 2 at the next available slot between 7 PM and 9 PM.'})
assert.equal(revised.status,'waiting_approval','Changed context must be refreshable with a new bounded approval')
assert.equal(revised.runId,'existing-context-run','Context review retains the reservation mission')
assert.ok(writes.some(row=>row.table==='agent_approvals'&&row.payload.status==='pending'))
console.log('Actual reservation preparation retains relevant dining-date travel after release without unrelated context; inert synthetic operations only.')
