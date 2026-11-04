// Original-function P1 travel-owner isolation regression. Inert fixtures only: no providers, real DB or sends.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const path='lib/agent/contextual-travel-watchers.ts'
const source=readFileSync(path,'utf8')
const ast=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS)
function original(name,sandbox){
  const node=ast.statements.find(s=>ts.isFunctionDeclaration(s)&&s.name?.text===name)
  assert.ok(node,'original source function missing: '+name)
  const compiled=ts.transpileModule(node.getText(ast).replace(/^export\s+/,''),{
    compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None},
    reportDiagnostics:true,
  })
  assert.equal((compiled.diagnostics||[]).filter(x=>x.category===ts.DiagnosticCategory.Error).length,0)
  vm.runInNewContext(compiled.outputText+'\nthis.__function = '+name,sandbox,{timeout:1000})
  return {fn:sandbox.__function,body:node.getText(ast)}
}
let pass=0
async function check(name,fn){await fn();pass++;console.log('PASS '+name)}
const ownerSandbox={}
const exact=original('exactTravelOwnerId',ownerSandbox).fn
const A='9007199254740992',B='9007199254740993'
assert.equal(String(Number(B)),A,'the two synthetic BIGINT IDs must collide under JS Number')
await check('original owner validator preserves distinct string BIGINTs and rejects imprecise numbers',async()=>{
  assert.equal(exact(A),A);assert.equal(exact(B),B)
  assert.equal(exact(Number(B)),null)
  assert.equal(exact('9223372036854775808'),null)
  assert.equal(exact('-9223372036854775809'),null)
  assert.equal(exact('0'),null);assert.equal(exact('1.0'),null)
  assert.equal(exact('123'), '123');assert.equal(exact(-123),'-123')
})
const tomorrow=new Date(Date.now()+86400_000).toISOString()
const after=new Date(Date.now()+2*86400_000).toISOString()
const trip=(owner,id)=>({id,telegram_id:owner,from_city:'BLR',to_city:'BOM',depart_at:tomorrow,arrive_at:after,flight_no:'AI101',passengers:[]})
function fakeDB({travelRows=[]}={}){
  const queries=[]
  return {queries,from(table){
    let owner=null
    const q={
      select(){return q},eq(key,value){if(key==='telegram_id'){owner=value;queries.push({table,owner:value})}return q},
      gte(){return q},lte(){return q},lt(){return q},or(){return q},order(){return q},in(){return q},
      limit(){
        let data=[]
        if(table==='memories')data=[{content:owner===A?'home city: Mumbai':'home city: Bengaluru'}]
        if(table==='travel_tickets')data=travelRows
        return Promise.resolve({data,error:null})
      },
      maybeSingle(){return Promise.resolve({data:owner===A?{name:'Owner A',gmail_connected:true}:{name:'Owner B',gmail_connected:false},error:null})},
      then(resolve,reject){return Promise.resolve({data:[],error:null}).then(resolve,reject)},
    }
    return q
  }}
}
await check('original travel compiler reads exact B home memory and B Gmail/profile, never A',async()=>{
  const db=fakeDB(),seen=[]
  const sandbox={
    exactTravelOwnerId:exact,supabaseAdmin:db,Date,Number,String,Error,
    nearestRetainedTrip:rows=>rows[0],
    rootFor:()=> 'fixture-root',tripExpiry:()=>after,sourceRefs:()=>[],
    getCostBudget:async()=>({activeWebWatchersMax:10}),
    declaredHomeCity:memories=>String(memories[0]?.content||'').replace('home city: ',''),
    desiredWebConditions:(_group,_root,_expiry,home)=>{seen.push(home);throw new Error('BOUNDED_STOP_BEFORE_WATCHER_WRITES')},
  }
  const {fn,body}=original('compileForUser',sandbox)
  assert.equal([...body.matchAll(/\.eq\('telegram_id',telegramId\)/g)].length>=2,true)
  assert.doesNotMatch(body,/\.eq\('telegram_id',\s*Number\(telegramId\)\)/)
  await assert.rejects(()=>fn(B,[trip(B,'ticket-b')]),/BOUNDED_STOP_BEFORE_WATCHER_WRITES/)
  assert.deepEqual(db.queries.filter(q=>['memories','users'].includes(q.table)).map(q=>[q.table,q.owner]),
    [['memories',B],['users',B]])
  assert.equal(seen[0],'Bengaluru','A private home city must not steer B watcher composition')
  const dbA=fakeDB(),seenA=[]
  sandbox.supabaseAdmin=dbA
  sandbox.desiredWebConditions=(_group,_root,_expiry,home)=>{seenA.push(home);throw new Error('BOUNDED_STOP_BEFORE_WATCHER_WRITES')}
  await assert.rejects(()=>fn(A,[trip(A,'ticket-a')]),/BOUNDED_STOP_BEFORE_WATCHER_WRITES/)
  assert.equal(seenA[0],'Mumbai','A must retain its own declared home city')
  assert.deepEqual(dbA.queries.filter(q=>['memories','users'].includes(q.table)).map(q=>q.owner),[A,A])
})
await check('original periodic compiler discards rounded JSON owner; keeps exact string owner',async()=>{
  const db=fakeDB({travelRows:[trip(Number(B),'unsafe-number'),trip(B,'exact-b')]})
  const called=[]
  const {fn}=original('compileUpcomingTravelWatchers',{
    exactTravelOwnerId:exact,supabaseAdmin:db,Date,Map,String,Math,
    compileForUser:async(owner,rows)=>{called.push({owner,rows});return {created:0,reused:0,stopped:0,skipped:0}},
    console:{error(){throw Error('unexpected fixture error')}},
  })
  const result=await fn()
  assert.equal(result.failed,1,'one rounded numeric row must fail closed')
  assert.equal(result.users,1)
  assert.equal(called.length,1)
  assert.equal(called[0].owner,B)
  assert.deepEqual(called[0].rows.map(row=>row.id),['exact-b'])
})
await check('original immediate compiler rejects rounded owner before query and exact-B ticket lookup remains scoped',async()=>{
  const db=fakeDB({travelRows:[]})
  const {fn}=original('compileTravelWatchersForUser',{exactTravelOwnerId:exact,supabaseAdmin:db,Date,Number,String,Error})
  await assert.rejects(()=>fn(Number(B)),/context_travel_owner_invalid/)
  assert.equal(db.queries.length,0,'unsafe numeric owner must not touch the database')
  const done=await fn(B)
  assert.equal(done.tracking,false)
  assert.deepEqual(db.queries.map(q=>[q.table,q.owner]),[['travel_tickets',B]])
})
console.log('contextual travel original-function exact owner checks PASS='+pass)
