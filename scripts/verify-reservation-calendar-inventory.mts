import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import {createHash} from 'node:crypto'
import ts from 'typescript'
import * as redaction from '../lib/bot/memory-redaction'
import * as intervals from '../lib/calendar-intervals'

// Exercise the real context producer. Calendar/database transports below are
// inert, owner-checked fixtures: no token refresh, provider read or write occurs.
const now=Date.parse('2026-10-18T10:00:00Z')
class FixtureDate extends Date {constructor(value?:any){super(value===undefined?now:value)}static now(){return now}}
let calendarReads=0,accessReads=0
const db={from(table:string){const q:any={select:()=>q,eq:(key:string,value:unknown)=>{if(key==='telegram_id')assert.equal(String(value),'123');return q},order:()=>q,limit:()=>q,in:()=>q,or:()=>q,
 maybeSingle:async()=>({data:table==='users'?{google_calendar_connected:true,google_refresh_token:'inert-fixture-token',timezone:'Asia/Kolkata'}:{memory_enabled:false,gmail_enabled:false},error:null}),then:(resolve:any)=>resolve({data:[],error:null})};return q}}
const deps:Record<string,unknown>={
 'node:crypto':{createHash},'@/lib/supabase-admin':{supabaseAdmin:db},
 './typed-object-context':{latestTypedContext:async()=>null},'@/lib/bot/memory-redaction':redaction,
 '../calendar-intervals':intervals,'@/lib/calendar-intervals':intervals,
 '@/lib/services/google-calendar-accounts':{
  getCalendarAccountAccess:async(owner:number,token:string)=>{accessReads++;assert.equal(owner,123);assert.equal(token,'inert-fixture-token');return[{email:'one@example.test',accessToken:'inert-access-one',primary:true},{email:'two@example.test',accessToken:'inert-access-two',primary:false}]},
  fetchMergedCalendarEventsPage:async(accounts:unknown[],from:string,until:string)=>{calendarReads++;assert.equal(accounts.length,2);assert.equal(Date.parse(from),now);assert.equal(Date.parse(until),now+60*86400_000);return{events:[{id:'busy-fixture',summary:'Private synthetic appointment',attendees:[{email:'private@example.test'}],_account:'two@example.test',start:{dateTime:'2026-10-22T14:00:00Z'},end:{dateTime:'2026-10-22T17:00:00Z'}}],hasMore:false,accountsRead:2,accountsTotal:2}},
 },
}
const actual:any={}
runInNewContext(ts.transpileModule(readFileSync('lib/agent/context-brain.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
 {exports:actual,require:(name:string)=>deps[name]||{},Date:FixtureDate,Intl,console,Set,Map})
const pack=await actual.buildContextPack({actor:{legacyTelegramId:123,userId:'fixture-owner',name:'Synthetic Owner'},text:'Dining reservation',options:{includeSemantic:false,includeReservationTravel:true,includeReservationCalendar:true,horizonDays:60,maxFacts:4}})
assert.equal(calendarReads,1,'Reservation safety context must read all linked Calendar accounts before claiming bounded dining coverage')
assert.equal(accessReads,1)
assert.equal(pack.reservationCalendar.ownerId,'123')
assert.equal(pack.reservationCalendar.incomplete,false)
assert.equal(pack.reservationCalendar.connected,true)
assert.equal(pack.reservationCalendar.windows.length,1)
assert.equal(Date.parse(pack.reservationCalendar.windows[0].startAt),Date.parse('2026-10-22T14:00:00Z'))
assert.equal(Date.parse(pack.reservationCalendar.windows[0].endAt),Date.parse('2026-10-22T17:00:00Z'))
assert.doesNotMatch(JSON.stringify(pack.reservationCalendar),/Private synthetic|private@|two@|inert-access|inert-fixture-token/,'The safety inventory must omit titles, attendees, account addresses and credentials')
console.log('Actual reservation context producer reads linked Calendar busy intervals with minimal owner-bound output; inert transports only.')
