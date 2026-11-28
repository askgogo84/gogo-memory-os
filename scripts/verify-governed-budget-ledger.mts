import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {PGlite} from '@electric-sql/pglite'
import {runGovernedAttempt} from '../lib/agent/governed-budget-ledger'
const db=new PGlite()
await db.exec('create role anon; create role authenticated; create role service_role bypassrls;')
await db.exec(readFileSync(new URL('../supabase/governed-run-ledger-v1.sql',import.meta.url),'utf8'))
const ws='00000000-0000-4000-8000-000000000001'
await db.exec(`insert into public.gogo_governed_runs(scope_kind,scope_id,run_id,actor_id,deadline_at,max_cost_micros,max_tokens,max_model_calls,max_tool_calls) values
('personal','101','run-a','101',now()+interval '1 hour',100,100,2,2),
('personal','102','run-a','102',now()+interval '1 hour',100,100,2,2),
('workspace','${ws}','run-a','101',now()+interval '1 hour',100,100,2,2),
('personal','101','expired','101',now()-interval '1 hour',100,100,2,2);`)
const reserve=(kind:string,id:string,actor:string,call:string,cost:number|null,tokens:number|null,run='run-a',op='model')=>db.query<{r:string}>('select public.gogo_reserve_governed_attempt($1,$2,$3,$4,$5,$6,$7,$8) as r',[kind,id,run,actor,call,op,cost,tokens]).then(r=>r.rows[0].r)
const settle=(kind:string,id:string,actor:string,call:string,cost:number|null,tokens:number|null)=>db.query<{r:string}>('select public.gogo_settle_governed_attempt($1,$2,$3,$4,$5,$6,$7) as r',[kind,id,'run-a',actor,call,cost,tokens]).then(r=>r.rows[0].r)
assert.equal(await reserve('personal','101','102','bad',1,1),'unavailable')
assert.equal(await reserve('workspace',ws,'102','bad',1,1),'unavailable')
assert.equal(await reserve('personal','101','101','bad',1,1,'expired'),'deadline')
assert.equal(await reserve('personal','101','101','bad',null,1),'invalid')
assert.equal(await reserve('personal','101','101','bad',1,101),'tokens')
assert.equal(await reserve('personal','101','101','a',80,80),'reserved')
assert.equal(await reserve('personal','101','101','a',1,1),'duplicate')
assert.equal(await reserve('personal','101','101','b',21,1),'cost')
assert.equal(await settle('personal','101','102','a',0,0),'unavailable')
assert.equal(await settle('personal','101','101','a',20,20),'settled')
assert.equal(await settle('personal','101','101','a',0,0),'duplicate')
assert.equal(await reserve('personal','101','101','b',80,80),'reserved')
assert.equal(await settle('personal','101','101','b',null,null),'unknown')
assert.equal(await reserve('personal','101','101','c',0,0,'run-a','tool'),'breach')
assert.equal(await reserve('personal','102','102','a',5,5),'reserved')
assert.equal(await reserve('workspace',ws,'101','a',5,5),'reserved')
assert.equal(await settle('workspace',ws,'101','a',6,5),'breach')
assert.equal(await reserve('workspace',ws,'101','b',1,1),'breach')
const row=(await db.query<{charged_cost_micros:unknown,breached:boolean}>("select charged_cost_micros,breached from public.gogo_governed_runs where scope_id='101' and run_id='run-a'")).rows[0]
assert.equal(Number(row.charged_cost_micros),100);assert.equal(row.breached,true)
await db.exec('set role authenticated')
await assert.rejects(()=>db.query('select * from public.gogo_governed_attempts'))
await assert.rejects(()=>reserve('personal','101','101','evil',1,1))
await db.exec('reset role')
await db.close()
let dispatch=0,check=0,settled:unknown[]=[]
const scope={kind:'personal' as const,id:'101',actorId:'101',runId:'test'}
const attempt={id:'one',kind:'tool' as const,ceiling:{costMicrosInr:20,tokens:5}}
const fixture={scope,attempt,authorize:async()=>true,rpc:async(name:string,args:Record<string,unknown>)=>{if(name.includes('settle')){settled.push(args);return{data:'settled',error:null}}return{data:'reserved',error:null}},execute:async()=>{dispatch++;return{value:'verified',usage:{costMicrosInr:10,tokens:2}}}}
assert.deepEqual(await runGovernedAttempt(fixture),{state:'completed',value:'verified'})
assert.equal(dispatch,1)
assert.equal((await runGovernedAttempt({...fixture,authorize:async()=>++check===1})).state,'blocked')
assert.equal(dispatch,1)
assert.equal((settled.at(-1) as any).p_cost_micros,0)
assert.equal((await runGovernedAttempt({...fixture,rpc:async()=>({data:'duplicate',error:null})})).state,'blocked')
assert.equal((await runGovernedAttempt({...fixture,scope:{...scope,id:'999'}})).state,'blocked')
assert.equal(dispatch,1)
assert.equal((await runGovernedAttempt({...fixture,execute:async()=>{throw Error('transport')}})).state,'unknown')
assert.equal((settled.at(-1) as any).p_cost_micros,null)
assert.equal((await runGovernedAttempt({...fixture,rpc:async(name)=>({data:name.includes('reserve')?'reserved':null,error:name.includes('settle')?'down':null})})).state,'unknown')
console.log('GOVERNED_LEDGER_OK — SQL reservation/settlement, scope and privilege isolation, dispatch denial and unknown outcomes; concurrent PostgreSQL fixture still required')
