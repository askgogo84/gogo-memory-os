import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'
import * as providers from '../lib/commerce/providers'
import * as oauth from '../lib/commerce/oauth'
import * as addresses from '../lib/commerce/addresses'
import * as vault from '../lib/security/vault-crypto'

process.env.NEXT_PUBLIC_APP_URL='https://app.askgogo.in'
process.env.COMMERCE_SWIGGY_ENABLED='true'
process.env.VAULT_MASTER_KEY_V1=Buffer.alloc(32,8).toString('base64')
const original={id:'run-original',telegram_id:'owner-a',type:'food_comparison',status:'paused',updated_at:'2026-01-01T00:00:00.000Z',summary:'Needs connection',metadata_json:{state:'provider_connection_required',subject:'vegetarian burger',request_text:'Compare my burger',location:{pin:'560086',source:'user'}}}
const rows:any[]=[structuredClone(original),{...structuredClone(original),id:'run-newer'}]
let failWrite=false, conflict=false, writes=0
const db={from(table:string){
  assert.equal(table,'agent_runs')
  const filters:Array<(r:any)=>boolean>=[]
  let patch:any=null
  const q:any={select(){return q},eq(key:string,value:any){filters.push(r=>r[key]===value);return q},update(value:any){patch=value;return q},async maybeSingle(){
    if(patch&&conflict)return {data:null,error:null}
    if(patch&&failWrite)return {data:null,error:{message:'fixture write error'}}
    const row=rows.find(r=>filters.every(f=>f(r)))
    if(patch&&row){writes++;Object.assign(row,patch)}
    return {data:row?structuredClone(row):null,error:null}
  }};return q
}}
function moduleWith(file:string, deps:Record<string,any>){
  const exports:any={}
  runInNewContext(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {exports,console,process,URL,URLSearchParams,Date,Buffer,require(name:string){if(name in deps)return deps[name];throw Error('Unexpected '+name)}})
  return exports
}
const tasks=moduleWith('lib/commerce/task.ts',{'@/lib/supabase-admin':{supabaseAdmin:db},'./providers':providers})
assert.equal(await tasks.readCommerceTask('owner-b','run-original'),null)
assert.equal(await tasks.resumeCommerceTaskAfterAuth('owner-b','run-original','swiggy'),null)
const resumed=await tasks.resumeCommerceTaskAfterAuth('owner-a','run-original','swiggy')
assert.equal(resumed.id,'run-original')
assert.equal(resumed.metadata_json.state,'waiting_address')
assert.equal(resumed.metadata_json.request_text,original.metadata_json.request_text)
assert.equal(resumed.metadata_json.location.pin,'560086')
assert.equal(rows[1].metadata_json.state,'provider_connection_required','auth must not resume a newer unrelated task')
rows[0].metadata_json.state='closed'
assert.equal(await tasks.resumeCommerceTaskAfterAuth('owner-a','run-original','swiggy'),null,'closed task is not resurrected')
rows[0]=structuredClone(resumed)
conflict=true
await assert.rejects(()=>tasks.selectCommerceTaskAddress('owner-a',resumed,'swiggy',{id:'a1',label:'Home',addressLine:'Private street'}),/task_changed/)
conflict=false

let owner='owner-a', blocked=false, reads=0, connection=true
const response={NextResponse:{json:(body:any,options:any)=>({body,status:options?.status||200,headers:options?.headers}),redirect:(location:any,options:any)=>({location,...options})}}
const sessions={requireAgentMutationOrigin:()=>blocked?{status:403}:null,requireAgentSession:async()=>({telegramId:owner,surface:'web'}),isAgentSession:()=>true}
const tokens={readCommerceConnection:async(id:string)=>{assert.equal(id,owner);return connection?{accessToken:'fixture-token'}:null}}
class FixtureClient {
  constructor(provider:string,service:string,token:string){assert.equal(provider,'swiggy');assert.equal(service,'food');assert.equal(token,'fixture-token')}
  async readTool(name:string,args:any){reads++;assert.equal(name,'get_addresses');assert.equal(args.page,2);assert.equal(args.pageSize,10);return {addresses:[{id:'a1',addressTag:'Home',addressLine:'Private street',phoneNumber:'private-phone'}],pagination:{hasMore:false}}}
}
class FixtureError extends Error {reason='fixture'}
const addressRoute=moduleWith('app/api/commerce/[provider]/addresses/route.ts',{
  'next/server':response,'@/lib/agent/session':sessions,'@/lib/commerce/providers':providers,'@/lib/commerce/connection-store':tokens,
  '@/lib/commerce/mcp':{CommerceMcpClient:FixtureClient,CommerceMcpError:FixtureError},'@/lib/commerce/addresses':addresses,'@/lib/commerce/task':tasks,
})
const context={params:Promise.resolve({provider:'swiggy'})}
const request=(addressId='a1')=>({json:async()=>({runId:'run-original',addressId,page:2})})
blocked=true
assert.equal((await addressRoute.POST(request(),context)).status,403)
assert.equal(reads,0)
blocked=false;owner='owner-b'
assert.equal((await addressRoute.POST(request(),context)).status,404)
assert.equal(reads,0,'wrong owner cannot read provider data or write selection')
owner='owner-a'
const before=writes
assert.equal((await addressRoute.POST(request('forged-address'),context)).status,409)
assert.equal(writes,before)
const selected=await addressRoute.POST(request(),context)
assert.equal(selected.status,200)
assert.equal(selected.body.runId,'run-original')
assert.equal(selected.body.state,'waiting_verified_quote')
assert.equal(selected.body.addressLabel,'Home')
assert.equal(rows[0].metadata_json.commerce.address.id,'a1')
assert(!JSON.stringify(rows[0]).includes('Private street'))
assert(!JSON.stringify(rows[0]).includes('private-phone'))
assert.match(selected.body.summary,/still unverified/)
assert(!('accessToken' in selected.body))
const taskRoute=moduleWith('app/api/commerce/tasks/[runId]/route.ts',{'next/server':response,'@/lib/agent/session':sessions,'@/lib/commerce/task':tasks})
const fetched=await taskRoute.GET({}, {params:Promise.resolve({runId:'run-original'})})
assert.equal(fetched.body.summary,selected.body.summary,'dashboard reads the exact persisted chat/task summary')
owner='owner-b'
assert.equal((await taskRoute.GET({}, {params:Promise.resolve({runId:'run-original'})})).status,404)
owner='owner-a';connection=false
assert.equal((await addressRoute.POST(request(),context)).status,401)
connection=true;failWrite=true
assert.equal((await addressRoute.POST(request(),context)).status,409,'never confirm a failed persistence')
failWrite=false

// The real connect handler reuses an authorized account without another login.
let registrations=0,cookie='',exchanges=0,saves=0
const jar={get:()=>({value:cookie}),set:(_key:string,value:string)=>{cookie=value}}
const connect=moduleWith('app/api/commerce/[provider]/connect/route.ts',{
  'next/server':response,'next/headers':{cookies:async()=>jar},'@/lib/agent/session':sessions,
  '@/lib/security/vault-crypto':vault,'@/lib/commerce/providers':providers,'@/lib/commerce/task':tasks,'@/lib/commerce/connection-store':tokens,
  '@/lib/commerce/oauth':{...oauth,registerCommerceClient:async()=>{registrations++;return 'fixture-client'}},
})
const connectRequest={text:async()=>JSON.stringify({runId:'run-original'})}
const reuse=await connect.POST(connectRequest,context)
assert.equal(reuse.body.taskContinued,true)
assert.equal(registrations,0)
connection=false
const start=await connect.POST(connectRequest,context)
assert.equal(start.status,200)
assert.equal(registrations,1)
const flow=JSON.parse(vault.decryptVaultValue(cookie))
assert.equal(flow.runId,'run-original')
assert.equal(flow.owner,'owner-a')
const callback=moduleWith('app/api/commerce/[provider]/callback/route.ts',{
  'next/server':response,'next/headers':{cookies:async()=>jar},'@/lib/dashboard/session':{getSession:async()=>({telegramId:owner})},
  '@/lib/security/vault-crypto':vault,'@/lib/commerce/providers':providers,'@/lib/commerce/task':tasks,
  '@/lib/commerce/oauth':{...oauth,exchangeCommerceCode:async()=>{exchanges++;return {accessToken:'fixture',expiresAt:Date.now()+300000,scope:''}}},
  '@/lib/commerce/connection-store':{saveCommerceConnection:async()=>{saves++}},
})
const callbackRequest={url:'https://app.askgogo.in/api/commerce/swiggy/callback?code=fixture&state='+flow.state}
const result=await callback.GET(callbackRequest,context)
assert.equal(new URL(result.location).searchParams.get('run'),'run-original')
assert.equal(new URL(result.location).searchParams.get('result'),'authorized')
assert.equal(exchanges,1);assert.equal(saves,1)
assert.equal(rows[0].metadata_json.state,'waiting_address')
assert.equal(rows[1].metadata_json.state,'provider_connection_required')
rows[0].metadata_json.state='closed';cookie=vault.encryptVaultValue(JSON.stringify(flow))
const closed=await callback.GET(callbackRequest,context)
assert.equal(new URL(closed.location).searchParams.get('result'),'authorized_task_unavailable')
assert.equal(rows[0].metadata_json.state,'closed')
console.log('PASS: exact owned task survives OAuth, existing-account reuse, provider address readback/selection, cross-surface status, closed/conflicting task protection')
