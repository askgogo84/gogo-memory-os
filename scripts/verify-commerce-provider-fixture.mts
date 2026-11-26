import assert from 'node:assert/strict'
import {CommerceMcpClient,CommerceMcpError} from '../lib/commerce/mcp'

const original={
  COMMERCE_NATIVE_CHECKOUT_ENABLED:process.env.COMMERCE_NATIVE_CHECKOUT_ENABLED,
  COMMERCE_PURCHASES_ENABLED:process.env.COMMERCE_PURCHASES_ENABLED,
  COMMERCE_SWIGGY_ENABLED:process.env.COMMERCE_SWIGGY_ENABLED,
  COMMERCE_NATIVE_CONFIRMATION_ENABLED:process.env.COMMERCE_NATIVE_CONFIRMATION_ENABLED,
}
const reset=()=>{for(const [key,value] of Object.entries(original)){
  if(value===undefined)delete process.env[key]
  else process.env[key]=value
}}
let writes:Array<{name:string;args:Record<string,unknown>}>=[]
let rpcRequests=0
let failNext=false
const fakeFetch:typeof fetch=(async(_url:any,init?:RequestInit)=>{
  const req=JSON.parse(String(init?.body||'{}'))
  if(req.method==='notifications/initialized')return new Response(null,{status:200})
  const payload=req.method==='initialize'?{protocolVersion:'2025-06-18'}:
    req.method==='tools/call'?(()=>{
      writes.push({name:req.params.name,args:req.params.arguments})
      if(failNext){failNext=false;return null}
      return {structuredContent:{success:true,data:
        req.params.name==='checkout'?{orderId:'order-1',status:'PLACED',paymentMethod:req.params.arguments.paymentMethod}:
        req.params.name==='confirm_order'?{orderId:'order-1',status:'PLACED'}:
        {paasId:'paas-1',orderId:'order-1',status:'PENDING',terminal:false,isTerminalSuccess:false,isTerminalFailure:false}
      }}
    })():{}
  rpcRequests++
  if(payload===null)return new Response('unavailable',{status:503})
  return new Response(JSON.stringify({jsonrpc:'2.0',id:req.id,result:payload}),
    {status:200,headers:{'Content-Type':'application/json'}})
}) as typeof fetch
try{
  process.env.COMMERCE_NATIVE_CHECKOUT_ENABLED='false'
  process.env.COMMERCE_PURCHASES_ENABLED='true'
  process.env.COMMERCE_SWIGGY_ENABLED='true'
  process.env.COMMERCE_NATIVE_CONFIRMATION_ENABLED='false'
  const client=new CommerceMcpClient('swiggy','grocery','fixture-token',fakeFetch)
  await assert.rejects(client.placeInstamartCheckout('addr-1',{mode:'cash_on_delivery',methodId:'Cash'}),
    e=>e instanceof CommerceMcpError&&e.reason==='tool_not_allowed')
  assert.equal(writes.length,0)
  process.env.COMMERCE_NATIVE_CHECKOUT_ENABLED='true'
  await assert.rejects(client.placeInstamartCheckout('addr-1',{mode:'cash_on_delivery',methodId:'Invalid'}),
    e=>e instanceof CommerceMcpError&&e.reason==='tool_not_allowed')
  assert.equal(writes.length,0)
  const placed=await client.placeInstamartCheckout('addr-1',{mode:'cash_on_delivery',methodId:'COD'})
  assert.equal(placed.orderId,'order-1')
  assert.equal(writes.length,1)
  assert.deepEqual(writes[0],{name:'checkout',args:{addressId:'addr-1',paymentMethod:'COD'}})
  const paid=await client.readTool('check_payment_status',{paasId:'paas-1',orderId:'order-1'})
  assert.equal(paid.terminal,false)
  assert.equal(writes[1].name,'check_payment_status')
  await assert.rejects(client.confirmInstamartPaidOrder('order-1','paas-1'),
    e=>e instanceof CommerceMcpError&&e.reason==='tool_not_allowed')
  assert.equal(writes.filter(x=>x.name==='confirm_order').length,0)
  process.env.COMMERCE_NATIVE_CONFIRMATION_ENABLED='true'
  await client.confirmInstamartPaidOrder('order-1','paas-1')
  assert.deepEqual(writes.at(-1),{name:'confirm_order',args:{orderId:'order-1',paasId:'paas-1'}})
  failNext=true
  const before=writes.length
  await assert.rejects(client.placeInstamartCheckout('addr-1',{mode:'cash_on_delivery',methodId:'Cash'}),
    e=>e instanceof CommerceMcpError&&e.reason==='provider_unavailable')
  assert.equal(writes.length,before+1,'merchant mutation cannot be retried automatically')
  assert.equal(writes[before].name,'checkout')
  console.log('✅ in-memory MCP fixture validates flags, exact payment methods, native checkout no-retry, readback and confirmation arguments')
}finally{reset()}
