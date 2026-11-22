// Synthetic original-function expiry regression. No real provider, SQL, credential or customer access.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const source=readFileSync('lib/agent/contextual-travel-watchers.ts','utf8')
const begin=source.indexOf('export function exactTravelOwnerId(')
const end=source.indexOf('\nexport async function compileUpcomingTravelWatchers(',begin)
assert.ok(begin>=0&&end>begin,'locate original owner guard, expiry helper and compiler')
const cleanBegin=source.indexOf('function clean(value:unknown,max=160){')
const cleanEnd=source.indexOf('\nfunction validIso(',cleanBegin)
assert.ok(cleanBegin>=0&&cleanEnd>cleanBegin,'extract the exact production clean helper for Gmail term formatting')
const compiled=ts.transpileModule(source.slice(cleanBegin,cleanEnd)+'\n'+source.slice(begin,end)+'\n;(globalThis as any).__compileForUser=compileForUser;',
  {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
assert.match(source,/for\(const desired of desiredConditions\)\{\s*if\(!contextualWatchStillLive\(desired\.condition\.expiresAt,now\)\)continue/,
  'per-watch expiry must gate upsert before any reinsertion')
assert.match(source,/if\(user\?\.gmail_connected&&contextualWatchStillLive\(expiresAt,now\)\)/,
  'expired Gmail travel context must not reactivate when consent is on')

function harness(expiredTrip=false,gmailConnected=true){
  const now=Date.now()
  const past=new Date(now-60_000).toISOString()
  const future=new Date(now+60_000).toISOString()
  const root='travel:synthetic'
  const calls:Array<{type:string;condition:any}>=[]
  const retired:string[]=[]
  const old={id:'expired-flight-watcher',condition_json:{contextRoot:root,contextClass:'flight_status',expiresAt:past}}
  const owner='-123'
  const scope:any={
    exports:{},console,Date,Number,BigInt,Set,Map,Object,
    nearestRetainedTrip:(rows:any[])=>rows[0],rootFor:()=>root,
    tripExpiry:()=>expiredTrip?past:future,
    sourceRefs:()=>[{type:'travel_ticket',id:'synthetic-leg'}],
    getCostBudget:async()=>({activeWebWatchersMax:6}),
    declaredHomeCity:()=>'',routeLabel:()=> 'Bengaluru → Delhi',
    desiredWebConditions:()=>[
      {condition:{contextRoot:root,contextClass:'flight_status',contextKey:root+':flight_status',expiresAt:past}},
      {condition:{contextRoot:root,contextClass:'destination_weather',contextKey:root+':destination_weather',expiresAt:future}},
      {condition:{contextRoot:root,contextClass:'airline_news',contextKey:root+':airline_news',expiresAt:'not-a-time'}},
    ],
    upsertContextWatcher:async({type,condition}:any)=>{calls.push({type,condition});return {id:'created',created:true,stopped:false}},
    supabaseAdmin:{from(table:string){
      let operation='select',selectCols='',hasContextualFilter=false
      const q:any={
        select(v:string){selectCols=v;return q},
        eq(field:string){if(field==='condition_json->>contextualKind')hasContextualFilter=true;return q},
        in(field:string,value:string[]){if(operation==='update'&&field==='id')retired.push(...value);return q},
        order(){return q},limit(){return q},or(){return q},gte(){return q},
        update(){operation='update';return q},
        insert(){operation='insert';return q},
        maybeSingle(){return Promise.resolve({data:table==='users'?{telegram_id:owner,name:'Fixture',gmail_connected:gmailConnected}:null,error:null})},
        then(resolve:any,reject:any){
          let result:any={data:[],error:null}
          if(operation!=='select')result={error:null}
          else if(table==='agent_watchers'&&hasContextualFilter)result={data:[old],error:null}
          else if(table==='memories')result={data:[],error:null}
          else if(table==='agent_watchers'&&selectCols==='id,condition_json')result={data:[],error:null}
          return Promise.resolve(result).then(resolve,reject)
        },
      };return q
    }},
  }
  runInNewContext(compiled,scope,{timeout:3000})
  const live=scope.exports.contextualWatchStillLive as (value:unknown,now:number)=>boolean
  const compile=scope.__compileForUser as (owner:string,rows:any[])=>Promise<any>
  assert.equal(typeof live,'function')
  assert.equal(typeof compile,'function')
  const trip=[{id:'synthetic-leg',telegram_id:owner,booking_group:null,leg_index:1,from_city:'Bengaluru',
    to_city:'Delhi',depart_at:new Date(now+60_000).toISOString(),arrive_at:future,passengers:[],raw:{}}]
  return {now,past,future,calls,retired,live,execute:()=>compile(owner,trip)}
}

const fixture=harness()
assert.equal(fixture.live(fixture.past,fixture.now),false)
assert.equal(fixture.live(fixture.future,fixture.now),true)
assert.equal(fixture.live(fixture.future,Date.parse(fixture.future)),false,'expiry is exclusive')
for(const invalid of ['',null,undefined,'invalid','2035-99-99T99:99:99Z'])
  assert.equal(fixture.live(invalid,fixture.now),false,'malformed/no expiry fails closed')
assert.equal(fixture.live(fixture.future,Number.NaN),false,'invalid clock fails closed')
const result=await fixture.execute()
assert.deepEqual(fixture.retired,['expired-flight-watcher'],'previous expired monitor is retired')
assert.deepEqual(fixture.calls.map(x=>x.condition.contextClass),['destination_weather','travel_email'],
  'expired flight and malformed news monitor must not be re-created; live weather and consent-bound email retained')
assert.equal(result.created,2)
assert.equal(result.skipped,0,'expired watches are not misreported as skipped by plan limit')
console.log('PASS: original compiler does not re-enable an expired per-flight monitor during retained trip context')

const oldTrip=harness(true)
await oldTrip.execute()
assert.deepEqual(oldTrip.calls.map(x=>x.condition.contextClass),['destination_weather'],
  'expired whole-trip email watcher never recreated, even when previously connected Gmail consent exists')
const noMail=harness(false,false)
await noMail.execute()
assert.deepEqual(noMail.calls.map(x=>x.condition.contextClass),['destination_weather'],
  'without Gmail connection no email watcher is created')
console.log('PASS: contextual watcher expiry is fail-closed, source-bounded and consent-aware; no provider or DB I/O')
