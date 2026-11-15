// Executes the literal TypeScript service in an inert in-memory DB. No network,
// provider, checkout, migration, card or user account is touched.
'use strict'
const assert = require('node:assert/strict')
const {readFileSync} = require('node:fs')
const {randomUUID} = require('node:crypto')
const ts = require('typescript')

function load(path, deps) {
  const js = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: {target:ts.ScriptTarget.ES2022, module:ts.ModuleKind.CommonJS},
  }).outputText
  const exports = {}
  new Function('require', 'exports', 'process', 'console', js)(
    name => Object.hasOwn(deps, name) ? deps[name] : require(name),
    exports, {env:{COMMERCE_PURCHASES_ENABLED:'true'}}, console,
  )
  return exports
}
const evidence = load('lib/commerce/evidence.ts', {})
const contract = load('lib/commerce/purchase-contract.ts', {'./evidence':evidence})
const now=new Date().toISOString(), runId=randomUUID()
let source={
  id:runId,type:'grocery_comparison',status:'paused',updated_at:now,summary:'read back',
  metadata_json:{state:'cart_contents_verified',commerce:{
    provider:'swiggy', address:{id:'address-a',source:'provider_saved_address'},
    cartOperation:{addressId:'address-a',verifiedAt:now,expected:[{spinId:'spin-1',skuId:'sku-1',quantity:1}]},
    cartReceipt:{cartId:'cart-a',addressId:'address-a',items:[{spinId:'spin-1',skuId:'sku-1',quantity:1}],
      payablePaise:42500,checkedAt:now,providerUrl:null,phoneVerified:false}
  }}
}
let rows=[], writes=0, lastReadOwner=null
function copy(value) {return JSON.parse(JSON.stringify(value))}
function query(){
  let mode='read',payload=null
  const filters=[], greater=[]
  const q={
    select(){return q},
    eq(key,value){filters.push([key,value]);return q},
    gt(key,value){greater.push([key,value]);return q},
    insert(value){mode='insert';payload=copy(value);return q},
    update(value){mode='update';payload=copy(value);return q},
    async maybeSingle(){return exec()},
    async single(){return exec()},
  }
  function matches(row){
    return filters.every(([k,v])=>row[k]===v) && greater.every(([k,v])=>row[k]>v)
  }
  async function exec(){
    if(mode==='insert'){
      if(rows.some(row=>row.owner_telegram_id===payload.owner_telegram_id && row.source_run_id===payload.source_run_id)) return {data:null,error:{code:'23505'}}
      const row={...payload,id:randomUUID(),created_at:new Date().toISOString(),updated_at:new Date().toISOString()}
      rows.push(row);writes++
      return {data:copy(row),error:null}
    }
    const found=rows.find(matches)
    if(mode==='update'){
      if(!found)return {data:null,error:null}
      Object.assign(found,payload);writes++
      return {data:copy(found),error:null}
    }
    return {data:found?copy(found):null,error:null}
  }
  return q
}
const supabaseAdmin={from(name){assert.equal(name,'commerce_purchase_intents');return query()}}
const service=load('lib/commerce/purchase-handoff.ts',{
  '@/lib/supabase-admin':{supabaseAdmin},
  './task':{readCommerceTask:async(owner,id)=>{lastReadOwner=owner;return owner==='owner-a' && id===source.id?copy(source):null}},
  './providers':{commerceEnabled:provider=>provider==='swiggy'},
  './purchase-contract':contract,
})
async function code(fn,expected){
  await assert.rejects(fn,error=>error instanceof contract.PurchaseBoundaryError && error.code===expected,expected)
}
;(async()=>{
  const awaiting=await service.createPurchase('owner-a',runId)
  assert.equal(awaiting.state,'awaiting_provider_handoff')
  assert.equal(awaiting.checkoutUrl,null)
  assert.equal(rows.length,1)
  assert.equal((await service.createPurchase('owner-a',runId)).purchaseId,awaiting.purchaseId)
  assert.equal(rows.length,1,'duplicate create never inserts a new purchase')
  assert.equal(await service.getPurchase('owner-b',awaiting.purchaseId),null,'other owner cannot read intent')
  await code(()=>service.approvePurchase('owner-a',awaiting.purchaseId,{action:'approve',acknowledge:true}),'purchase_not_ready')
  assert.equal(writes,1,'blocked approval never updates')
  await code(()=>service.createPurchase('owner-b',runId),'verified_cart_required')
  console.log('✓ owner isolation, absent checkout proof and idempotent create')

  // New independent task, with a synthetic merchant-attested checkout and phone matching.
  source=copy(source);source.id=randomUUID()
  const cart=source.metadata_json.commerce.cartReceipt
  cart.providerUrl='https://www.swiggy.com/checkout'
  cart.phoneVerified=true
  const ready=await service.createPurchase('owner-a',source.id)
  assert.equal(ready.state,'pending_approval')
  assert.equal(ready.checkoutUrl,null)
  const id=ready.purchaseId
  const payload={action:'approve',acknowledge:true,snapshotSha256:ready.snapshotSha256,totalPaise:42500,merchant:'swiggy'}
  await code(()=>service.approvePurchase('owner-a',id,{...payload,totalPaise:42501}),'approval_snapshot_mismatch')
  await code(()=>service.approvePurchase('owner-a',id,{...payload,merchant:'zepto'}),'approval_snapshot_mismatch')
  await code(()=>service.approvePurchase('owner-a',id,{...payload,acknowledge:false}),'approval_snapshot_mismatch')
  await code(()=>service.openPurchaseHandoff('owner-a',id,ready.snapshotSha256),'purchase_not_approved')
  assert.equal((await service.approvePurchase('owner-a',id,payload)).state,'approved')
  await code(()=>service.approvePurchase('owner-a',id,payload),'purchase_not_ready')
  await code(()=>service.openPurchaseHandoff('owner-a',id,'bad-sha'),'approval_snapshot_mismatch')
  assert.equal((await service.openPurchaseHandoff('owner-a',id,ready.snapshotSha256)).state,'handoff_opened')
  assert.equal((await service.openPurchaseHandoff('owner-a',id,ready.snapshotSha256)).checkoutUrl,cart.providerUrl)
  await code(()=>service.cancelPurchase('owner-a',id),'purchase_handoff_may_be_active')
  assert.equal((await service.readPurchaseView('owner-a',id)).paymentVerified,false)
  console.log('✓ exact amount, merchant, acknowledgement, one-shot approval and handoff state')

  source=copy(source);source.id=randomUUID()
  source.metadata_json.commerce.cartReceipt.providerUrl='https://www.swiggy.com/checkout'
  const cancellable=await service.createPurchase('owner-a',source.id)
  assert.equal((await service.cancelPurchase('owner-a',cancellable.purchaseId)).state,'cancelled')
  await code(()=>service.approvePurchase('owner-a',cancellable.purchaseId,{
    ...payload,snapshotSha256:cancellable.snapshotSha256,
  }),'purchase_not_ready')
  console.log('✓ cancel/revocation before checkout cannot be overridden by stale approval')

  source=copy(source);source.id=randomUUID()
  const drift=await service.createPurchase('owner-a',source.id)
  source.metadata_json.commerce.cartReceipt.payablePaise+=100
  await code(()=>service.approvePurchase('owner-a',drift.purchaseId,{
    ...payload,snapshotSha256:drift.snapshotSha256,
  }),'purchase_snapshot_changed_new_task_required')
  console.log('✓ provider quote drift cannot use earlier approval')
  console.log('✅ 4 ledger/service suites passed; '+writes+' inert DB writes; 0 network or provider writes')
})().catch(error=>{console.error(error);process.exitCode=1})
