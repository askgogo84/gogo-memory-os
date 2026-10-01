import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import * as crypto from 'node:crypto'
import ts from 'typescript'
import * as providers from '../lib/commerce/providers'
import * as addresses from '../lib/commerce/addresses'
import * as reads from '../lib/commerce/swiggy-read'
import {CommerceMcpClient} from '../lib/commerce/mcp'

process.env.COMMERCE_SWIGGY_ENABLED='true'
const seed:any={id:'cart-run',telegram_id:'42',type:'grocery_comparison',status:'paused',updated_at:'2026-01-01T00:00:00Z',summary:'Choose milk',metadata_json:{state:'waiting_item_selection',subject:'Amul milk',commerce:{provider:'swiggy',address:{id:'home',page:1,source:'provider_saved_address'},catalogue:{observedAt:new Date().toISOString(),products:[{id:'milk',skuId:'one-litre',productId:'p1',name:'Amul milk',variant:'1 litre',maxQuantity:6,pricePaise:null}]}}}}
let leaseBusy=false
let row:any,failClaim=false,failReceipt=false,owner='42',blocked=false,mode='success',writeCalls=0,providerCalls=0
let cartData:any
const reset=()=>{row=structuredClone(seed);cartData={cartId:'cart1',selectedAddressDetails:{id:'home'},cartTotalAmount:'₹185',billBreakdown:{toPay:{value:'₹185'}},items:[{spinId:'bread',skuId:'loaf',quantity:2,isInStockAndAvailable:true}]};failClaim=false;failReceipt=false;owner='42';blocked=false;mode='success';writeCalls=0;providerCalls=0}
reset()
const db={from(table:string){assert.equal(table,'agent_runs');const filters:Array<(row:any)=>boolean>=[];let patch:any=null;const q:any={select(){return q},limit(){return q},eq(k:string,v:any){filters.push(r=>r[k]===v);return q},update(p:any){patch=p;return q},async maybeSingle(){
  if(!filters.every(f=>f(row)))return {data:null,error:null}
  if(patch&&((failClaim&&patch.status==='outcome_unknown')||(failReceipt&&patch.status==='paused')))return {data:null,error:{message:'fixture write error'}}
  if(patch)Object.assign(row,patch)
  return {data:structuredClone(row),error:null}
}};return q}}
function load(file:string,deps:Record<string,any>){const exports:any={};runInNewContext(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,process,Date,URL,console,require(name:string){if(name in deps)return deps[name];throw Error(name)}});return exports}
const tasks=load('lib/commerce/task.ts',{'@/lib/supabase-admin':{supabaseAdmin:db},'./providers':providers})
const executor=load('lib/commerce/instamart-cart.ts',{'node:crypto':crypto,'@/lib/supabase-admin':{supabaseAdmin:db},'./swiggy-read':reads,'./addresses':addresses})
class Client {
  async readTool(name:string,_args:any){providerCalls++
    if(name==='get_addresses')return {addresses:[{id:'home',addressLine:'Private street',addressTag:'Home'}],pagination:{hasMore:false}}
    if(name==='search_products')return {products:[{productId:'p1',inStock:true,isAvail:true,variations:[{spinId:'milk',skuId:'one-litre',displayName:'Amul milk',quantityDescription:'1 litre',isInStockAndAvailable:true,maxQuantity:6}]}]}
    assert.equal(name,'get_cart');return structuredClone(cartData)
  }
  async updateInstamartCart(addressId:string,items:any[]){
    assert.equal(row.status,'outcome_unknown','durable uncertainty must precede outbound mutation')
    assert.equal(row.metadata_json.state,'cart_outcome_unknown');assert.equal(addressId,'home')
    writeCalls++
    assert.deepEqual(JSON.parse(JSON.stringify(items.find(item=>item.spinId==='bread'))),{spinId:'bread',skuId:'loaf',quantity:2},'unrelated existing cart items must be preserved')
    if(mode==='timeout-no-change')throw Error('timeout')
    cartData.items=items.map(item=>({...item,isInStockAndAvailable:true}))
    if(mode==='clamped')cartData.items=cartData.items.filter((item:any)=>item.spinId!=='milk')
    if(mode==='timeout-applied')throw Error('lost acknowledgement')
  }
}
const deps={
  '@/lib/supabase-admin':{supabaseAdmin:db},
  '@/lib/agent/brain-runtime-guard':{acquireBrainUserLease:async(key:string)=>{assert.equal(key,'commerce:swiggy:'+owner);return leaseBusy?null:{ownerToken:'lease'}},releaseBrainUserLease:async()=>true},
  'next/server':{NextResponse:{json:(body:any,options:any)=>({body,status:options?.status||200})}},
  '@/lib/agent/session':{requireAgentMutationOrigin:()=>blocked?{status:403}:null,requireAgentSession:async()=>({telegramId:owner}),isAgentSession:()=>true},
  '@/lib/commerce/providers':providers,'@/lib/commerce/task':tasks,'@/lib/commerce/instamart-cart':executor,
  '@/lib/commerce/connection-store':{readCommerceConnection:async()=>({accessToken:'fixture-token'})},'@/lib/commerce/mcp':{CommerceMcpClient:Client},
}
const route=load('app/api/commerce/tasks/[runId]/cart/route.ts',deps)
const ctx={params:Promise.resolve({runId:'cart-run'})}
const request=(action='add',spinId='milk')=>({json:async()=>({action,spinId,skuId:'one-litre',quantity:1})})
owner='other'
assert.equal((await route.POST(request(),ctx)).status,404);assert.equal(providerCalls,0)
owner='42';blocked=true
assert.equal((await route.POST(request(),ctx)).status,403);assert.equal(providerCalls,0)
blocked=false;leaseBusy=true
assert.equal((await route.POST(request(),ctx)).body.error,'cart_in_use');assert.equal(providerCalls,0)
leaseBusy=false
assert.equal((await route.POST(request('add','forged'),ctx)).status,409);assert.equal(writeCalls,0)
failClaim=true
assert.equal((await route.POST(request(),ctx)).status,409);assert.equal(writeCalls,0,'failed durable claim must prevent outbound write')
reset()
const success=await route.POST(request(),ctx)
assert.equal(success.status,200)
assert.equal(success.body.state,'cart_contents_verified')
assert.equal(row.metadata_json.commerce.cartReceipt.payablePaise,18500)
assert.equal(row.metadata_json.commerce.cartReceipt.items.length,2)
assert.equal(row.metadata_json.commerce.cartReceipt.providerUrl,null)
assert.equal(row.metadata_json.commerce.cartReceipt.phoneVerified,false)
assert.equal(success.body.summary,row.summary)
assert(!JSON.stringify(success.body).includes('tokenBinding'))
assert(!JSON.stringify(row).includes('fixture-token'))
assert.match(row.summary,/No order was placed/)
assert.equal(writeCalls,1)
await route.POST(request(),ctx)
assert.equal(writeCalls,1,'repeated addition click cannot repeat the write')
assert.equal(await tasks.resumeCommerceTaskAfterAuth('42','cart-run','swiggy'),null,'connection reuse must not erase a cart operation')
reset();mode='timeout-applied'
assert.equal((await route.POST(request(),ctx)).body.state,'cart_contents_verified','lost acknowledgement can be resolved only by matching readback')
assert.equal(writeCalls,1)
reset();mode='timeout-no-change'
const unknown=await route.POST(request(),ctx)
assert.equal(unknown.body.state,'cart_outcome_unknown');assert.equal(row.status,'outcome_unknown')
await route.POST(request(),ctx)
await route.POST(request('check'),ctx)
assert.equal(writeCalls,1,'unknown outcome never automatically retries the mutation')
const before=providerCalls
await assert.rejects(()=>executor.reconcileInstamartCart('42',structuredClone(row),'different-account-token',new Client()),/account_or_operation_changed/)
assert.equal(providerCalls,before)
cartData.items=row.metadata_json.commerce.cartOperation.expected.map((item:any)=>({...item,isInStockAndAvailable:true}))
assert.equal((await route.POST(request('check'),ctx)).body.state,'cart_contents_verified')
assert.equal(writeCalls,1)
reset();mode='clamped'
assert.equal((await route.POST(request(),ctx)).body.state,'cart_outcome_unknown','provider substitution/removal is not a verified requested basket')
reset();failReceipt=true
assert.equal((await route.POST(request(),ctx)).body.state,'cart_outcome_unknown','failed receipt persistence cannot confirm success')
assert.equal(row.status,'outcome_unknown')
reset();cartData.selectedAddressDetails.id='another-address'
assert.equal((await route.POST(request(),ctx)).status,409);assert.equal(writeCalls,0)
reset();cartData.cartTotalAmount='185';cartData.billBreakdown.toPay.value='185'
assert.equal((await route.POST(request(),ctx)).body.state,'cart_contents_verified')
assert.equal(row.metadata_json.commerce.cartReceipt.payablePaise,null)
assert.match(row.summary,/Payable total.*unverified/)

// Exercise the actual transport: writes are fixed to Instamart update_cart and have no retry.
let toolCalls=0
const transport=new CommerceMcpClient('swiggy','grocery','fixture', (async(_url:any,options:any)=>{
  const body=JSON.parse(options.body)
  if(body.method==='notifications/initialized')return new Response(null,{status:202})
  if(body.method==='initialize')return Response.json({jsonrpc:'2.0',id:body.id,result:{protocolVersion:'2025-06-18'}})
  toolCalls++;assert.equal(body.params.name,'update_cart')
  assert.deepEqual(body.params.arguments,{selectedAddressId:'home',items:[{spinId:'milk',skuId:'one-litre',quantity:1}]})
  throw Error('fixture timeout')
}) as typeof fetch)
await assert.rejects(()=>transport.updateInstamartCart('home',[{spinId:'milk',skuId:'one-litre',quantity:1}]))
assert.equal(toolCalls,1)
await assert.rejects(()=>transport.readTool('update_cart',{}),/tool_not_allowed/)
const food=new CommerceMcpClient('swiggy','food','fixture', (async()=>{throw Error('must not call')}) as typeof fetch)
await assert.rejects(()=>food.updateInstamartCart('home',[{spinId:'milk',skuId:'one-litre',quantity:1}]),/tool_not_allowed/)
console.log('PASS: explicit owned Instamart selection, preserve existing basket, durable unknown-before-write, exact readback, no duplicate retry, auth binding, persisted confirmation, no checkout/order tools')
