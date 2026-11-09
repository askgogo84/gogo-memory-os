import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

// Inert original-function regression: synthetic owner IDs and database, zero providers or customer data.
const source=readFileSync('lib/agent/contextual-travel-watchers.ts','utf8')
const begin=source.indexOf('export function exactTravelOwnerId(')
const end=source.indexOf('\nexport async function compileUpcomingTravelWatchers(',begin)
assert.ok(begin>=0 && end>begin,'locate actual owner guard and production compiler')
const compiled=ts.transpileModule(source.slice(begin,end)+'\n;(globalThis as any).__compileForUser=compileForUser;',
  {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const OWNER='9007199254740993',OTHER='9007199254740992'
const flight=(id:string|number)=>({id:'synthetic-leg',telegram_id:id,booking_group:null,leg_index:1,
  from_city:'Bengaluru',to_city:'New York',depart_at:'2027-01-10T01:00:00.000Z',
  arrive_at:'2027-01-10T19:00:00.000Z',passengers:[],raw:{},flight_no:'EY111',airline:'Fixture Air'})
type Config={memoryOwner?:string|number;profileOwner?:string|number;missingProfile?:boolean;failRead?:boolean}
function harness(config:Config={}){
  const reads:Array<{table:string;owner:unknown;columns:string}>=[]
  const writes:string[]=[]
  const homes:string[]=[]
  const scope:any={exports:{},console,
    nearestRetainedTrip:(rows:any[])=>rows[0],rootFor:()=> 'travel:fixture',
    tripExpiry:()=> '2027-01-14T00:00:00.000Z',
    sourceRefs:()=>[{type:'travel_ticket',id:'synthetic-leg'}],
    getCostBudget:async()=>({activeWebWatchersMax:0}),
    declaredHomeCity:(rows:any[])=>rows[0]?.content?.replace('My home city is ','')||'',
    desiredWebConditions:(_rows:any,_root:any,_expiry:any,home:string)=>{homes.push(home);return []},
    routeLabel:()=> 'Bengaluru → New York',
    upsertContextWatcher:async()=>{throw Error('unexpected watcher write')},
    supabaseAdmin:{from(table:string){
      let owner:unknown,columns=''
      const q:any={
        select(v:string){columns=v;return this},
        eq(field:string,v:unknown){if(field==='telegram_id'){owner=v;reads.push({table,owner:v,columns})}return this},
        order(){return this},limit(){return this},or(){return this},lt(){return this},in(){return this},
        insert(){writes.push(table);return Promise.resolve({error:null})},
        maybeSingle(){return Promise.resolve(resolve(true))},
        then(done:any,failed:any){return Promise.resolve(resolve(false)).then(done,failed)},
      }
      function resolve(single:boolean){
        if(table==='agent_watchers')return {data:[],error:null}
        if(table==='memories')return config.failRead?{data:null,error:{message:'synthetic error'}}
          :{data:[{telegram_id:config.memoryOwner??owner,content:'My home city is Bengaluru'}],error:null}
        if(table==='users')return {data:config.missingProfile?null:{
          telegram_id:config.profileOwner??owner,name:'Synthetic Traveller',gmail_connected:false},error:null}
        throw Error('unexpected table '+table)
      }
      return q
    }},
  }
  runInNewContext(compiled,scope,{timeout:2500})
  const compile=scope.__compileForUser as (id:string,rows:any[])=>Promise<any>
  const exact=scope.exports.exactTravelOwnerId as (id:unknown)=>string|null
  assert.equal(typeof compile,'function')
  assert.equal(typeof exact,'function')
  return {compile,exact,reads,writes,homes}
}

const good=harness()
assert.equal(good.exact(OWNER),OWNER)
assert.equal(good.exact('-42'),'-42')
assert.equal(good.exact(42),'42')
const result=await good.compile(OWNER,[flight(OWNER)])
assert.equal(result.created,0)
assert.deepEqual(good.reads.filter(x=>x.table==='memories'||x.table==='users').map(x=>[x.table,x.owner]),
  [['memories',OWNER],['users',OWNER]],'private context reads must never round the BIGINT')
assert.ok(good.reads.find(x=>x.table==='memories')?.columns.includes('telegram_id'))
assert.ok(good.reads.find(x=>x.table==='users')?.columns.includes('telegram_id'))
assert.deepEqual(good.homes,['Bengaluru'])
assert.deepEqual(good.writes,['agent_activity'])
console.log('PASS exact high-BIGINT owner, correct context and no provider send')

const neg=harness()
await neg.compile('-42',[flight('-42')])
assert.deepEqual(neg.reads.filter(x=>['memories','users'].includes(x.table)).map(x=>x.owner),['-42','-42'])
console.log('PASS valid negative owner')

for(const id of [Number(OWNER),'9223372036854775808','042','-0','42%','9.007199254740993e15',null]){
  const h=harness()
  assert.equal(h.exact(id),null,'unsafe identity must be invalid')
  await assert.rejects(h.compile(id as string,[flight(OWNER)]),/context_travel_owner_invalid/)
  assert.equal(h.reads.length,0)
  assert.equal(h.writes.length,0)
}
console.log('PASS invalid/rounded owner rejected before data or watcher access')

const foreign=harness()
await assert.rejects(foreign.compile(OWNER,[flight(OTHER)]),/context_travel_owner_invalid/)
assert.equal(foreign.reads.length,0)

for(const [name,config,error] of [
  ['foreign memory',{memoryOwner:OTHER},/context_home_owner_mismatch/],
  ['rounded memory',{memoryOwner:Number(OWNER)},/context_home_owner_mismatch/],
  ['foreign profile',{profileOwner:OTHER},/context_profile_owner_mismatch/],
  ['rounded profile',{profileOwner:Number(OWNER)},/context_profile_owner_mismatch/],
  ['unreadable memory',{failRead:true},/context_home_lookup_failed/],
  ['missing profile',{missingProfile:true},/context_owner_profile_lookup_failed/],
] as [string,Config,RegExp][]){
  const h=harness(config)
  await assert.rejects(h.compile(OWNER,[flight(OWNER)]),error,name)
  assert.equal(h.writes.length,0,name+' must not write a contextual monitor')
  assert.equal(h.homes.length,0,name+' must not synthesize mixed owner context')
}
console.log('PASS foreign, rounded and missing owner readbacks fail closed')
assert.match(source,/const key=exactTravelOwnerId\(\(row as any\)\.telegram_id\)/)
assert.match(source,/if\(!key\)\{unsafeOwnerRows\+\+;continue\}/)
assert.match(source,/const owner=exactTravelOwnerId\(telegramId\)/)
console.log('contextual-travel original-function exact owner synthetic regressions: PASS')