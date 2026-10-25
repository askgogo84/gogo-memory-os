import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'
import * as providers from '../lib/commerce/providers'
import * as addresses from '../lib/commerce/addresses'
import * as reads from '../lib/commerce/swiggy-read'
import * as intent from '../lib/agent/food-comparison-intent'

process.env.COMMERCE_SWIGGY_ENABLED='true'
process.env.NEXT_PUBLIC_APP_URL='https://app.askgogo.in'
const rows:any[]=[]
let failWrite=false, readCount=0
const db={from(table:string){
  assert.equal(table,'agent_runs');readCount++
  const filters:Array<(row:any)=>boolean>=[];let patch:any=null,insert:any=null,max=Infinity
  const q:any={select(){return q},eq(k:string,v:any){filters.push(row=>row[k]===v);return q},order(){return q},limit(n:number){max=n;return q},update(p:any){patch=p;return q},insert(p:any){insert=p;return q},
    async maybeSingle(){
      if(failWrite&&(patch||insert))return {data:null,error:{message:'fixture'}}
      if(insert){const row={id:'grocery-'+(rows.length+1),...insert};rows.unshift(row);return {data:structuredClone(row),error:null}}
      const row=rows.filter(r=>filters.every(f=>f(r))).slice(0,max)[0]
      if(row&&patch)Object.assign(row,patch)
      return {data:row?structuredClone(row):null,error:null}
    },async single(){return q.maybeSingle()}}
  return q
}}
function load(file:string,deps:Record<string,any>){const exports:any={};runInNewContext(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,process,Date,URL,console,require(name:string){if(name in deps)return deps[name];throw Error(name)}});return exports}
const tasks=load('lib/commerce/task.ts',{'@/lib/supabase-admin':{supabaseAdmin:db},'./providers':providers})
const grocery=load('lib/agent/grocery-comparison.ts',{'@/lib/supabase-admin':{supabaseAdmin:db},'@/lib/commerce/task':tasks})
const entry=load('lib/agent/food-comparison.ts',{'@/lib/supabase-admin':{supabaseAdmin:db},'@/lib/commerce/task':tasks,'./grocery-comparison':grocery,'./food-comparison-intent':intent,'@/lib/web-search':{searchWebResults:()=>{throw Error('no public search expected')}}})
const run=(text:string,owner=42,surface='whatsapp')=>entry.tryFoodComparison({telegramId:owner,text,surface})
const initial=await run('Compare grocery prices for Amul Taaza toned milk, 1 litre')
assert.equal(initial.handledBy,'grocery-comparison')
assert.equal(rows[0].type,'grocery_comparison')
assert.match(initial.text,/Zepto comparison awaits/)
assert.equal(rows[0].metadata_json.subject,'Amul Taaza toned milk, 1 litre')
const id=initial.runId
const initialReadCount=readCount
assert.equal(await run('22000'),null)
assert.equal(await grocery.tryGroceryComparison({telegramId:42,text:'my pin is 560086'}),null)
assert.equal(readCount,initialReadCount,'paused grocery flow cannot claim arbitrary amounts or PINs')
assert.equal(await tasks.readCommerceTask('43',id),null)
await tasks.resumeCommerceTaskAfterAuth('42',id,'swiggy')

let owner='42',failProvider=false,token=true,blocked=false
const calls:Array<{service:string;name:string;args:any}>=[]
class Client {
  constructor(_provider:string,private service:string,_token:string){}
  async readTool(name:string,args:any){
    calls.push({service:this.service,name,args});assert.equal(this.service,'grocery')
    if(failProvider)throw Error('fixture provider unavailable')
    if(name==='get_addresses')return {addresses:[{id:'home',addressLine:'Private street',addressTag:'Home',phoneNumber:'private-phone'}],pagination:{hasMore:false}}
    assert.equal(name,'search_products');assert.equal(args.addressId,'home');assert.equal(args.query,'Amul Taaza toned milk, 1 litre')
    return {products:[{productId:'milk',inStock:true,isAvail:true,variations:[{spinId:'spin',skuId:'sku',displayName:'Amul Taaza',quantityDescription:'1 litre',isInStockAndAvailable:true},{spinId:'no-stock',skuId:'no-stock',displayName:'Other',quantityDescription:'1 litre',isInStockAndAvailable:false}]}]}
  }
}
class McpError extends Error {reason='fixture'}
const deps={
  'next/server':{NextResponse:{json:(body:any,options:any)=>({body,status:options?.status||200})}},
  '@/lib/agent/session':{requireAgentMutationOrigin:()=>blocked?{status:403}:null,requireAgentSession:async()=>({telegramId:owner}),isAgentSession:()=>true},
  '@/lib/commerce/providers':providers,'@/lib/commerce/task':tasks,'@/lib/commerce/addresses':addresses,'@/lib/commerce/swiggy-read':reads,
  '@/lib/commerce/connection-store':{readCommerceConnection:async()=>token?{accessToken:'fixture'}:null},
  '@/lib/commerce/mcp':{CommerceMcpClient:Client,CommerceMcpError:McpError},
}
const addressRoute=load('app/api/commerce/[provider]/addresses/route.ts',deps)
const catalogueRoute=load('app/api/commerce/tasks/[runId]/catalogue/route.ts',deps)
const ctx={params:Promise.resolve({runId:id})}
const addressCtx={params:Promise.resolve({provider:'swiggy'})}
const req=(body:any)=>({json:async()=>body})
blocked=true
assert.equal((await catalogueRoute.POST(req({}),ctx)).status,403)
assert.equal(calls.length,0)
blocked=false
const selected=await addressRoute.POST(req({runId:id,addressId:'home',page:1}),addressCtx)
assert.equal(selected.status,200)
assert.equal(selected.body.service,'grocery')
assert.equal(selected.body.runId,id)
assert(!JSON.stringify(rows).includes('Private street'))
assert(!JSON.stringify(rows).includes('private-phone'))
owner='43';const before=calls.length
assert.equal((await catalogueRoute.POST(req({}),ctx)).status,409)
assert.equal(calls.length,before)
owner='42'
const result=await catalogueRoute.POST(req({}),ctx)
assert.equal(result.status,200)
assert.equal(result.body.state,'waiting_item_selection')
assert.equal(result.body.catalogue.products.length,1)
assert.equal(result.body.catalogue.products[0].variant,'1 litre')
assert.equal(result.body.catalogue.products[0].pricePaise,null)
const status=await run('Show my grocery comparison.',42,'web')
assert.equal(status.runId,id)
assert(status.text.startsWith(result.body.summary),'WhatsApp and dashboard read the same saved summary')
assert.match(status.text,/Instamart/)
assert.match(status.text,/1 litre/)
assert.equal(rows.length,1,'sign-in, address, catalogue and status keep the same task')
failProvider=true
const failed=await catalogueRoute.POST(req({}),ctx)
assert.equal(failed.status,409)
assert.equal(failed.body.task.runId,id)
assert.equal(failed.body.task.summary,rows[0].summary)
assert.match((await run('Show my grocery comparison.')).text,/could not be verified/)
assert.equal(rows[0].metadata_json.commerce.blocker.reason,'provider_unverified')
failProvider=false;token=false
assert.equal((await catalogueRoute.POST(req({}),ctx)).status,401)
assert.match(rows[0].summary,/Sign in to Swiggy again/)
token=true
assert.equal((await catalogueRoute.POST(req({}),ctx)).status,200)
assert.equal(rows[0].metadata_json.commerce.blocker,null)
assert(calls.every(c=>['get_addresses','search_products'].includes(c.name)),'grocery discovery must never mutate a cart')
failWrite=true
await assert.rejects(()=>run('Compare grocery prices for bread'),/create_failed/)
console.log('PASS: grocery request → same-task auth/address → Instamart catalogue → shared stored status/blockers, owner isolation, no invented prices and no cart writes')
