// Port of #982 onto main: the restaurant reservation worker must refuse a rounded or
// malformed owner BEFORE it claims the action lease or reads life_events / agent_approvals.
// Main's actorFor contract (restaurant_reservation_actor_missing, exact safe numeric lookup,
// row echo) is asserted as-is; only the pre-claim fence is new. Inert DB, no provider.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'

const file='lib/agent/restaurant-reservation-worker.ts'
function load(deps:Record<string,unknown>,extra=''){
  const exports:any={}
  const out=ts.transpileModule(readFileSync(file,'utf8')+extra,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
  runInNewContext(out,{exports,require:(name:string)=>deps[name]||{},Date,Intl,console,URL,Set,Map})
  return exports
}

// 1) actorFor on main already binds exactly (main's contract kept: actor_missing).
function actorFixture(row:any){
  const selectors:Array<[string,unknown]>=[]
  const db={from(table:string){
    assert.equal(table,'users','owner resolver may read only its owner row')
    const q:any={select:()=>q,eq:(c:string,v:unknown)=>{selectors.push([c,v]);return q},maybeSingle:async()=>({data:row,error:null})}
    return q
  }}
  const mod=load({'@/lib/supabase-admin':{supabaseAdmin:db}},'\nexports.__actorFor = actorFor')
  return {resolve:mod.__actorFor as (o:string)=>Promise<any>,selectors}
}
const foreign={id:'owner-A',telegram_id:'9007199254740992',whatsapp_id:'whatsapp:+15550111111',name:'Foreign'}
for(const bad of ['9007199254740993','9007199254740992','+123','00123','12.3','','Infinity']){
  const f=actorFixture(foreign)
  await assert.rejects(()=>f.resolve(bad),/restaurant_reservation_actor_missing/,`actorFor must refuse ${JSON.stringify(bad)}`)
  assert.deepEqual(f.selectors,[],`no users read for ${JSON.stringify(bad)}`)
}
const good=actorFixture({id:'owner-123',telegram_id:123,whatsapp_id:'whatsapp:+15550123456',name:'Owner'})
const actor=await good.resolve('123')
assert.equal(actor.userId,'owner-123');assert.equal(actor.legacyTelegramId,123)
assert.deepEqual(good.selectors,[['telegram_id',123]],'main looks up the exact safe owner')
await assert.rejects(()=>actorFixture({id:'owner-456',telegram_id:'456'}).resolve('123'),/restaurant_reservation_actor_missing/,'row must echo the owner')
await assert.rejects(()=>actorFixture({id:'owner-123',telegram_id:9007199254740992}).resolve('123'),/restaurant_reservation_actor_missing/,'rounded DB owner refused')
console.log('PASS main actorFor: exact owner, echo and unsafe refusal unchanged')

// 2) NEW: processOne fences the owner before claim / life_events / approvals.
for(const bad of ['9007199254740993','+123','00123','12.3','',' 123',null,undefined,9007199254740993,1.5]){
  let reads=0
  const mod=load({'@/lib/supabase-admin':{supabaseAdmin:{from:()=>{reads++;throw Error('unsafe owner reached DB')}}}})
  await assert.rejects(()=>mod.processOne({id:'inert-action',telegram_id:bad,payload_json:{}}),/restaurant_reservation_invalid_owner/,
    `processOne must refuse ${String(bad)} before claiming`)
  assert.equal(reads,0,`zero DB side effects for ${String(bad)}`)
}
console.log('PASS processOne refuses rounded/malformed owners before lease claim, event or approval reads')

// 3) A valid owner (string or safe number) passes the fence and reaches the claim, bound to the exact string.
for(const ok of ['123',123]){
  const seen:Array<[string,string,unknown]>=[]
  const db={from(table:string){const q:any={update:()=>q,select:()=>q,eq:(c:string,v:unknown)=>{seen.push([table,c,v]);return q},maybeSingle:async()=>({data:null,error:null})};return q}}
  const mod=load({'@/lib/supabase-admin':{supabaseAdmin:db}})
  const r=await mod.processOne({id:'inert-action',telegram_id:ok,payload_json:{}})
  assert.equal(r.status,'skipped','unclaimed lease is skipped, not executed')
  assert.ok(seen.some(([t,c,v])=>t==='life_event_actions'&&c==='telegram_id'&&v==='123'),'claim bound to the exact owner string')
  assert.ok(!seen.some(([t])=>t==='life_events'||t==='agent_approvals'),'no owner-scoped reads when the claim is lost')
}
console.log('PASS valid owners reach the lease claim bound to the exact string')
console.log('Restaurant reservation pre-claim owner fence passed (inert actual module).')
