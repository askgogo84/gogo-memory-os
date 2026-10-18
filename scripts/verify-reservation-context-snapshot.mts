import assert from 'node:assert/strict'
import {buildReservationDiningContext, sameReservationRestrictions} from '../lib/agent/reservation-dining-context'

const now=new Date('2026-10-18T10:00:00Z')
const from=now.toISOString(),until='2026-12-17T10:00:00.000Z'
const actor={legacyTelegramId:123,userId:'fixture-user',name:'Synthetic Owner'}
const travel={id:'synthetic-travel',source:'travel_presence',summary:'PRIVATE SUMMARY MUST NOT BE COPIED',score:1,confidence:1,startAt:'2026-10-21T00:00:00Z',endAt:'2026-10-24T23:00:00Z',location:'Away city',participants:['Synthetic Owner'],sourceRefs:[{type:'travel_ticket',id:'synthetic-ticket',pnr:'PRIVATE-REF'}]}
function build(facts:any[]=[travel],extra:any={},params:any={}){return buildReservationDiningContext({actor,timezone:'Asia/Kolkata',releaseAt:'2026-10-19T14:30:00Z',requestedDate:'',now,pack:{facts:[],reservationTravel:{ownerId:'123',facts,incomplete:false,coveredFrom:from,coveredUntil:until,...extra}},...params})}
const future=build()
assert.equal(future.incomplete,false)
assert.equal(future.windows.length,1)
assert.equal(future.windows[0].applicability,'owner')
assert.doesNotMatch(JSON.stringify(future),/PRIVATE|Synthetic Owner|participants|summary|pnr/)
assert.equal(build([{...travel,participants:['Another Person']}]).windows.length,0)
assert.equal(build([{...travel,participants:[]}]).windows[0].applicability,'unknown')
assert.equal(build([{...travel,source:'semantic_memory'}]).windows.length,0)
assert.equal(build([{...travel,startAt:'2026-10-01T00:00:00Z',endAt:'2026-10-02T00:00:00Z'}]).windows.length,0)
assert.equal(build([{...travel,startAt:'2027-01-01T00:00:00Z',endAt:'2027-01-02T00:00:00Z'}]).windows.length,0)
assert.equal(build([travel],{}, {requestedDate:'2026-10-22'}).windows.length,1)
assert.equal(build([travel],{}, {requestedDate:'2026-10-26'}).windows.length,0)
assert.equal(build([travel],{}, {requestedDate:'2027-02-01'}).incomplete,true)
assert.equal(build([travel],{}, {requestedDate:'2026-02-30'}).incomplete,true)
assert.equal(build([travel],{}, {timezone:'Unknown/Zone'}).incomplete,true)
assert.equal(build([travel],{incomplete:true}).incomplete,true)
assert.equal(build([travel],{ownerId:'foreign'}).incomplete,true)
assert.equal(buildReservationDiningContext({actor,timezone:'Asia/Kolkata',releaseAt:'2026-10-19T14:30:00Z',requestedDate:'',now,pack:null}).incomplete,true)
assert.equal(buildReservationDiningContext({actor,timezone:'Asia/Kolkata',releaseAt:'2026-10-19T14:30:00Z',requestedDate:'',now,pack:{facts:[travel]}}).incomplete,true,'Ranked facts alone do not prove complete travel coverage')
for(const bad of [{endAt:null},{endAt:'2026-10-20T00:00:00Z'},{startAt:'invalid'}])assert.equal(build([{...travel,...bad}]).incomplete,true)
assert.equal(build(Array.from({length:41},(_,i)=>({...travel,id:'travel-'+i,location:'Away '+i}))).incomplete,true)
assert.equal(build([travel,travel]).windows.length,1,'Duplicate constraints merge before the cap')
assert.equal(build(Array.from({length:20},(_,i)=>({...travel,id:'travel-'+i,location:'Away '+i}))).windows.length,20,'No ranked-fourteen or six-window truncation')
assert.equal(sameReservationRestrictions(future,{...future,checkedAt:'2026-10-18T11:00:00Z'},now),true)
assert.equal(sameReservationRestrictions(future,build([{...travel,location:'Changed city'}]),now),false)
assert.equal(sameReservationRestrictions(future,{...future,incomplete:true},now),false)
console.log('Reservation dining snapshot: bounded future/date coverage, attribution/privacy, partial/invalid/capped refusal and material-change controls passed.')
