import assert from 'node:assert/strict'
import fs from 'node:fs'
import { normalizeInboxTriageWatcher, normalizeWebSearchWatcher } from '../lib/agent/watchers'

const expires='2026-10-01T03:05:00.000Z'
const web=normalizeWebSearchWatcher({
  title:'Trip weather · New York',
  query:'New York weather travel conditions 28 September 2026',
  triggerKeywords:['storm','heavy rain'],
  delivery:'both',cadenceMinutes:360,
  contextual:true,contextualKind:'travel',contextKey:'travel:test:destination_weather',contextRoot:'travel:test',
  contextClass:'destination_weather',reason:'Watch destination weather only for this trip.',
  expiresAt:expires,sourceRefs:[{type:'travel_ticket',id:'leg-1'}],
})
assert.ok(web)
assert.equal(web?.contextual,true)
assert.equal(web?.contextualKind,'travel')
assert.equal(web?.contextClass,'destination_weather')
assert.equal(web?.expiresAt,expires)
assert.match(String(web?.reason),/only for this trip/i)

const inbox=normalizeInboxTriageWatcher({
  title:'Trip email attention · New York',delivery:'whatsapp',cadenceMinutes:60,
  matchTerms:['EY239','Etihad','New York'],
  contextual:true,contextualKind:'travel',contextKey:'travel:test:travel_email',contextRoot:'travel:test',
  contextClass:'travel_email',reason:'Only itinerary-related action mail.',expiresAt:expires,
})
assert.deepEqual(inbox?.matchTerms,['EY239','Etihad','New York'])
assert.equal(inbox?.contextual,true)

const compiler=fs.readFileSync('lib/agent/contextual-travel-watchers.ts','utf8')
const watchers=fs.readFileSync('lib/agent/watchers.ts','utf8')
const commands=fs.readFileSync('lib/agent/watch-command.ts','utf8')
const cron=fs.readFileSync('app/api/cron/agent-watchers/route.ts','utf8')

assert.match(compiler,/compileUpcomingTravelWatchers/)
assert.match(compiler,/activeWebWatchersMax/)
assert.match(compiler,/manualCount/)
assert.match(compiler,/userStoppedAt/)
assert.match(compiler,/flight_status/)
assert.match(compiler,/connection_ground/)
assert.match(compiler,/destination_weather/)
assert.match(compiler,/travel_email/)
assert.match(compiler,/72\*3600_000/,'contextual travel monitoring must have a bounded post-arrival expiry')
// Destination weather follows the destination STAY, not the outbound leg's completion:
// A one-way booking has no verified stay end, so it keeps the bounded source horizon.
assert.match(compiler,/destinationStayExpiry/,'destination weather must derive its own stay-based expiry')
assert.doesNotMatch(compiler,/7\*24\*3600_000/,'a one-way booking must not extend weather a week beyond arrival')
assert.match(compiler,/function awayStay/,'destination must be the longest-stay city, not the final (home) arrival on a round trip')
assert.match(compiler,/city===originCity/,'away-stay must exclude the itinerary origin so a round trip does not pick the home arrival as destination')
assert.match(compiler,/legDates/,'the flight-status query must carry every leg date so later legs verify')
assert.doesNotMatch(compiler,/\$\{destination\}\s+news/i,'contextual proactivity must not create generic destination-news watches')
assert.match(compiler,/gmail_connected/)
assert.match(watchers,/context_window_ended/)
assert.match(watchers,/condition\.matchTerms/)
assert.match(commands,/and\\s\+why/)
assert.match(commands,/Why:/)
assert.match(commands,/Source: saved/)
assert.match(commands,/Expires:/)
assert.match(commands,/Contextual watches created from your current context/)
assert.match(commands,/Your other existing watches/)
assert.match(commands,/Source: your existing watch/)
assert.match(commands,/stays active until you stop it/)
assert.match(commands,/userStoppedAt/)
assert.match(commands,/prepare-web-checkin/)
assert.match(cron,/compileUpcomingTravelWatchers/)

console.log('✅ T2/T4 contextual travel proactivity: bounded, source-aware, explainable, stoppable and auto-expiring')


// Actual-module security regression with a wholly inert Supabase transport.
// Postgres BIGINT users 9007199254740992 and 9007199254740993 alias if
// converted to Number; no real user, provider, watcher or database is touched.
import ts from 'typescript'
import vm from 'node:vm'
import crypto from 'node:crypto'

const highOwner='9007199254740993'
const adjacentOwner='9007199254740992'
const unsafeNumber=Number(highOwner)
assert.equal(Number.isSafeInteger(unsafeNumber),false)

const future=new Date(Date.now()+3*3600_000).toISOString()
const arrival=new Date(Date.now()+8*3600_000).toISOString()
function flight(owner:string|number){
  return {id:'synthetic-ticket-001',telegram_id:owner,booking_group:null,leg_index:1,
    from_city:'Bengaluru',to_city:'New York',depart_at:future,arrive_at:arrival,
    airline:'Fixture Airways',flight_no:'FA123',passengers:[],raw:{}}
}
function secureCompilerFixture(opts:{ticketOwner:string|number;profileOwner?:string|number;
    memoryOwner?:string|number;includeMemory?:boolean}){
  const reads:Array<{table:string;owner:unknown}>=[]
  const writes:Array<{table:string;row:any}>=[]
  const watchersRows:any[]=[]
  const db={from(table:string){
    const trace={table,owner:null as unknown};reads.push(trace)
    let inserted:any=null,updated:any=null
    const q:any={
      select:()=>q,
      eq:(key:string,value:any)=>{if(key==='telegram_id')trace.owner=value;return q},
      gte:()=>q,lte:()=>q,lt:()=>q,or:()=>q,in:()=>q,
      order:()=>q,limit:()=>q,update:(row:any)=>{updated=row;return q},
      insert:(row:any)=>{inserted=row;return q},
    }
    function result(single=false){
      if(inserted){
        const row={id:'inert-watch-'+(writes.length+1),...inserted}
        writes.push({table,row})
        if(table==='agent_watchers')watchersRows.push(row)
        return {data:single?row:[row],error:null}
      }
      if(updated){writes.push({table,row:updated});return {data:[],error:null}}
      if(table==='travel_tickets')return {data:[flight(opts.ticketOwner)],error:null}
      if(table==='memories')return {data:opts.includeMemory
        ?[{id:'synthetic-memory',telegram_id:opts.memoryOwner??opts.ticketOwner,content:'My home city is Bengaluru'}]
        :[],error:null}
      if(table==='users')return {data:{telegram_id:opts.profileOwner??opts.ticketOwner,
        name:'Fixture Traveller',gmail_connected:false},error:null}
      if(table==='agent_watchers')return {data:single?null:watchersRows,error:null}
      return {data:single?null:[],error:null}
    }
    q.maybeSingle=async()=>result(true)
    q.single=async()=>result(true)
    q.then=(resolve:any,reject:any)=>Promise.resolve(result()).then(resolve,reject)
    return q
  }}
  const exports:any={}
  const compiled=ts.transpileModule(fs.readFileSync('lib/agent/contextual-travel-watchers.ts','utf8'),
    {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
  const deps:Record<string,unknown>={
    'node:crypto':crypto,
    '@/lib/supabase-admin':{supabaseAdmin:db},
    '@/lib/services/cost-guard':{getCostBudget:async()=>({activeWebWatchersMax:20})},
    '@/lib/services/travel-time':{ticketTimezone:()=> 'UTC'},
    '@/lib/timezone':{isValidTimezone:()=>true},
    './flight-leg-tracker':{normalizeFlightNo:(value:string)=>value},
  }
  vm.runInNewContext(compiled,{exports,module:{exports},require:(name:string)=>{
    if(!(name in deps))throw Error('unexpected external fixture dependency: '+name)
    return deps[name]
  },Date,Intl,console,process})
  return {worker:exports,reads,writes}
}

{
  const fixture=secureCompilerFixture({ticketOwner:highOwner})
  await assert.rejects(()=>fixture.worker.compileTravelWatchersForUser(unsafeNumber),
    /context_travel_owner_invalid/,'already-rounded numeric owner must fail before all reads')
  assert.equal(fixture.reads.length,0)
  assert.equal(fixture.writes.length,0)
}
{
  const fixture=secureCompilerFixture({ticketOwner:adjacentOwner})
  await assert.rejects(()=>fixture.worker.compileTravelWatchersForUser(highOwner),
    /context_travel_ticket_owner_mismatch/,'neighbor tenant flight must not drive owner watches')
  assert.deepEqual(fixture.reads.map(x=>x.table),['travel_tickets'])
  assert.equal(fixture.reads[0].owner,highOwner)
  assert.equal(fixture.writes.length,0)
}
{
  const fixture=secureCompilerFixture({ticketOwner:highOwner,includeMemory:true,
    memoryOwner:adjacentOwner,profileOwner:highOwner})
  await assert.rejects(()=>fixture.worker.compileTravelWatchersForUser(highOwner),
    /context_home_owner_mismatch/,'neighbor tenant memory must be rejected before watcher writes')
  assert.equal(fixture.reads.find(x=>x.table==='memories')?.owner,highOwner)
  assert.equal(fixture.writes.length,0)
}
{
  const fixture=secureCompilerFixture({ticketOwner:highOwner,
    profileOwner:adjacentOwner})
  await assert.rejects(()=>fixture.worker.compileTravelWatchersForUser(highOwner),
    /context_profile_owner_mismatch/,'neighbor tenant profile must not drive email watches')
  assert.equal(fixture.reads.find(x=>x.table==='users')?.owner,highOwner)
  assert.equal(fixture.writes.length,0)
}
{
  const fixture=secureCompilerFixture({ticketOwner:highOwner,includeMemory:true})
  const output=await fixture.worker.compileTravelWatchersForUser(highOwner)
  assert.ok(output.created>=2,'valid exact-string high owner keeps bounded travel watches')
  for(const read of fixture.reads.filter(x=>['travel_tickets','memories','users','agent_watchers'].includes(x.table))){
    assert.equal(read.owner,highOwner,'each private read stays bound to all 16 digits')
  }
  for(const write of fixture.writes.filter(x=>x.table==='agent_watchers')){
    assert.equal(write.row.telegram_id,highOwner,'watcher creation preserves exact owner')
  }
}
{
  const fixture=secureCompilerFixture({ticketOwner:unsafeNumber})
  const output=await fixture.worker.compileUpcomingTravelWatchers()
  assert.equal(output.users,0,'bulk source must skip already-rounded numeric owner rows')
  assert.equal(fixture.reads.filter(x=>x.table!=='travel_tickets').length,0)
  assert.equal(fixture.writes.length,0)
}
{
  const fixture=secureCompilerFixture({ticketOwner:42})
  const output=await fixture.worker.compileTravelWatchersForUser(42)
  assert.ok(output.created>=2,'canonical safe numeric legacy owner still works')
  assert.equal(fixture.reads.find(x=>x.table==='travel_tickets')?.owner,'42')
}
assert.doesNotMatch(compiler,/\.eq\('telegram_id',Number\(telegramId\)\)/,
  'contextual travel compiler must never round owner identity for private reads')
console.log('Contextual travel tenant-bound compilation: high BIGINT, adjacent/mismatched rows, unsafe numeric, bulk and safe legacy owner verified with inert actual-module transport')
