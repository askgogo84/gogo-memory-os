import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {
  canonicalItems, purchaseState, purchaseView, sameSnapshot,
  snapshotFromVerifiedCart, PurchaseBoundaryError, PURCHASE_MAX_PAISE,
} from '../lib/commerce/purchase-contract'

const runId='af1b16b8-1d2e-4111-8cfa-27dc7ace7cfa'
const checkedAt = '2026-11-15T06:00:00.000Z'
const now = Date.parse(checkedAt) + 10_000
const items = [{spinId:'item-1',skuId:'sku-1',quantity:1},{spinId:'item-2',skuId:'sku-2',quantity:2}]
function task() {
  return {
    id:runId, type:'grocery_comparison',status:'paused',updated_at:checkedAt,summary:'verified',
    metadata_json:{
      state:'cart_contents_verified',
      commerce:{
        provider:'swiggy',
        address:{id:'addr-1',source:'provider_saved_address'},
        cartOperation:{addressId:'addr-1',verifiedAt:checkedAt,expected:items.map(item=>({...item}))},
        cartReceipt:{cartId:'cart-1',addressId:'addr-1',items:items.map(item=>({...item})),payablePaise:18790,checkedAt,providerUrl:null,phoneVerified:false}
      },
    },
  } as any
}
const fails = (fn: () => unknown, code: string) =>
  assert.throws(fn, error => error instanceof PurchaseBoundaryError && error.code === code, code)
let passed=0
function test(name:string, fn:()=>void) {fn();passed++;console.log('✓ '+name)}

test('verified provider cart produces immutable five-minute proposal with no checkout',()=>{
  const s=snapshotFromVerifiedCart('owner-a',task(),now)
  assert.equal(s.amountPaise,18790)
  assert.equal(s.currency,'INR')
  assert.equal(s.checkoutUrl,null)
  assert.equal(purchaseState(s),'awaiting_provider_handoff')
  assert.equal(s.expiresAt,new Date(Date.parse(checkedAt)+300000).toISOString())
  assert.match(s.sha256,/^[a-f0-9]{64}$/)
})
test('canonical basket ordering is deterministic',()=>{
  const original=snapshotFromVerifiedCart('owner-a',task(),now)
  const t=task()
  t.metadata_json.commerce.cartReceipt.items.reverse()
  t.metadata_json.commerce.cartOperation.expected.reverse()
  const reordered=snapshotFromVerifiedCart('owner-a',t,now)
  assert.equal(reordered.sha256,original.sha256)
  assert.deepEqual(canonicalItems(items),canonicalItems([...items].reverse()))
})
test('owner is cryptographically bound in the approval fingerprint',()=>{
  assert.notEqual(snapshotFromVerifiedCart('owner-a',task(),now).sha256,snapshotFromVerifiedCart('owner-b',task(),now).sha256)
})
test('amount change invalidates exact snapshot',()=>{
  const a=snapshotFromVerifiedCart('owner-a',task(),now)
  const t=task();t.metadata_json.commerce.cartReceipt.payablePaise=18900
  assert.notEqual(snapshotFromVerifiedCart('owner-a',t,now).sha256,a.sha256)
})
test('a provider checkout link alone is insufficient: phone cart must match',()=>{
  const t=task()
  t.metadata_json.commerce.cartReceipt.providerUrl='https://www.swiggy.com/checkout/cart'
  const s=snapshotFromVerifiedCart('owner-a',t,now)
  assert.equal(purchaseState(s),'awaiting_provider_handoff')
})
test('verified link and phone cart can form a reviewable proposal',()=>{
  const t=task()
  t.metadata_json.commerce.cartReceipt.providerUrl='https://www.swiggy.com/checkout/cart'
  t.metadata_json.commerce.cartReceipt.phoneVerified=true
  const s=snapshotFromVerifiedCart('owner-a',t,now)
  assert.equal(purchaseState(s),'pending_approval')
  const row={owner_telegram_id:'owner-a',source_run_id:runId,snapshot_sha256:s.sha256,provider:'swiggy',cart_id:'cart-1',address_id:'addr-1',amount_paise:18790,currency:'INR',checkout_url:s.checkoutUrl,phone_cart_verified:s.phoneCartVerified,expires_at:s.expiresAt,items_snapshot:s.items}
  assert.equal(sameSnapshot(row,s),true)
  assert.equal(sameSnapshot({...row, owner_telegram_id:'owner-b'},s),false)
  assert.equal(sameSnapshot({...row, amount_paise:1},s),false)
})
test('unsafe payment URLs are never accepted',()=>{
  for(const url of ['http://www.swiggy.com/checkout','https://swiggy.com.evil.tld/pay','https://evil.tld/checkout',
    'javascript:alert(1)','https://user:pass@swiggy.com/checkout','https://www.swiggy.com.evil.tld/cart']){
    const t=task();t.metadata_json.commerce.cartReceipt.providerUrl=url
    fails(()=>snapshotFromVerifiedCart('owner-a',t,now),'unsafe_provider_checkout_url')
  }
})
test('stale cart is rejected',()=>fails(()=>snapshotFromVerifiedCart('owner-a',task(),Date.parse(checkedAt)+300001),'cart_refresh_required'))
test('future timestamp is rejected',()=>fails(()=>snapshotFromVerifiedCart('owner-a',task(),Date.parse(checkedAt)-1),'cart_refresh_required'))
test('verifiedAt must match provider cart readback evidence',()=>{
  const t=task();t.metadata_json.commerce.cartOperation.verifiedAt='2026-11-15T05:59:59.000Z'
  fails(()=>snapshotFromVerifiedCart('owner-a',t,now),'cart_refresh_required')
})
test('unverified or overly expensive total is rejected',()=>{
  for(const total of [null,0,1.5,NaN,PURCHASE_MAX_PAISE+1]){
    const t=task();t.metadata_json.commerce.cartReceipt.payablePaise=total
    fails(()=>snapshotFromVerifiedCart('owner-a',t,now),'delivered_total_unverified_or_limit')
  }
})
test('changed address cannot flow into checkout',()=>{
  const t=task();t.metadata_json.commerce.cartReceipt.addressId='other'
  fails(()=>snapshotFromVerifiedCart('owner-a',t,now),'cart_address_unverified')
})
test('cart mismatch cannot flow into checkout',()=>{
  const t=task();t.metadata_json.commerce.cartReceipt.items[0].quantity=9
  fails(()=>snapshotFromVerifiedCart('owner-a',t,now),'cart_contents_changed')
})
test('duplicate SKU lines are rejected',()=>{
  const t=task();t.metadata_json.commerce.cartReceipt.items.push({...t.metadata_json.commerce.cartReceipt.items[0]})
  fails(()=>snapshotFromVerifiedCart('owner-a',t,now),'cart_duplicate_items')
})
test('non-canonical cart states are blocked',()=>{
  for(const state of ['waiting_item_selection','cart_outcome_unknown','browser_research']){
    const t=task();t.metadata_json.state=state
    fails(()=>snapshotFromVerifiedCart('owner-a',t,now),'verified_cart_required')
  }
})
test('GET never advertises a successful payment or order',()=>{
  const base={id:'purchase-1',source_run_id:runId,provider:'swiggy',amount_paise:18790,currency:'INR',
    phone_cart_verified:false,checkout_url:'https://www.swiggy.com/cart',expires_at:new Date(now+10000).toISOString(),
    snapshot_sha256:'a'.repeat(64),items_snapshot:items}
  for(const status of ['awaiting_provider_handoff','pending_approval','approved','handoff_released']){
    const v=purchaseView({...base,status},now)
    assert.equal(v.paymentVerified,false)
    assert.equal(v.orderPlaced,false)
    assert.equal(v.checkoutUrl,status==='handoff_released'?base.checkout_url:null)
  }
  assert.equal(purchaseView({...base,status:'approved'},now+11000).state,'expired')
  const released=purchaseView({...base,status:'handoff_released'},now+11000)
  assert.equal(released.state,'handoff_expired')
  assert.equal(released.checkoutUrl,null)
})
test('service and endpoints require immutable owner and approval evidence',()=>{
  const svc=readFileSync('lib/commerce/purchase-handoff.ts','utf8')
  const create=readFileSync('app/api/commerce/purchases/route.ts','utf8')
  const detail=readFileSync('app/api/commerce/purchases/[id]/route.ts','utf8')
  assert.match(svc,/eq\('owner_telegram_id', owner\)/)
  assert.match(svc,/input\.acknowledge !== true/)
  assert.match(svc,/input\.snapshotSha256 !== row\.snapshot_sha256/)
  assert.match(svc,/input\.totalPaise !== row\.amount_paise/)
  assert.match(svc,/\.gt\('expires_at', new Date\(\)\.toISOString\(\)\)/)
  assert.match(svc,/if \(!sameSnapshot\(row, latest\)/)
  assert.match(create,/requireAgentMutationOrigin\(request\)/)
  assert.match(detail,/requireAgentMutationOrigin\(request\)/)
  assert.doesNotMatch(svc,/api\.razorpay\.com|\/v1\/payments|capture_payment/)
})
test('no payment authority is derived from the model or customer-submitted URLs',()=>{
  const svc=readFileSync('lib/commerce/purchase-handoff.ts','utf8')
  const detail=readFileSync('app/api/commerce/purchases/[id]/route.ts','utf8')
  assert.doesNotMatch(svc,/input\.checkoutUrl|input\.paymentToken|input\.cardNumber/)
  assert.doesNotMatch(detail,/input\.checkoutUrl|input\.paymentToken|input\.cardNumber/)
})
console.log('✅ commerce purchase handoff '+passed+' independent contract checks passed')
