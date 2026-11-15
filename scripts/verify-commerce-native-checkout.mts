import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {nativeReviewHash,authorizeNativeCheckoutAttempt,summarizeNativeCheckoutResponse} from '../lib/commerce/native-checkout-contract'
import {PurchaseBoundaryError} from '../lib/commerce/purchase-contract'
const now=Date.parse('2026-11-15T13:00:00Z')
const scope={owner:'owner-a',purchaseId:'purchase-1',cartSha256:'a'.repeat(64),
 addressId:'addr-1',deliveryAddress:'12 Main St, Bengaluru',cartId:'cart-1',
 totalPaise:50000,items:[{name:'Milk',variant:'500 ml',quantity:2}],choices:[{mode:'cash_on_delivery' as const,methodId:'Cash',label:'Cash on delivery'},
 {mode:'upi_intent' as const,methodId:'gpay://upi/',label:'GPay'}]}
const reviewSha256=nativeReviewHash(scope)
assert.match(reviewSha256,/^[0-9a-f]{64}$/)
assert.notEqual(reviewSha256,nativeReviewHash({...scope,totalPaise:50001}))
assert.notEqual(reviewSha256,nativeReviewHash({...scope,addressId:'other'}))
assert.notEqual(reviewSha256,nativeReviewHash({...scope,items:[{name:'Milk',variant:'500 ml',quantity:3}]}))
assert.notEqual(reviewSha256,nativeReviewHash({...scope,deliveryAddress:'another address'}))
assert.notEqual(reviewSha256,nativeReviewHash({...scope,cartSha256:'b'.repeat(64)}))
const review={id:'review-1',review_sha256:reviewSha256,snapshot_sha256:scope.cartSha256,
 amount_paise:scope.totalPaise,choices_snapshot:scope.choices,expires_at:new Date(now+60000).toISOString()}
const consent={reviewId:'review-1',reviewSha256,snapshotSha256:scope.cartSha256,
 totalPaise:50000,methodId:'Cash',mode:'cash_on_delivery',acknowledge:true,addressAccepted:true}
assert.equal(authorizeNativeCheckoutAttempt(review,consent,now).methodId,'Cash')
assert.throws(()=>authorizeNativeCheckoutAttempt(review,{...consent,methodId:'gpay://upi/',mode:'upi_intent'},now),
 e=>e instanceof PurchaseBoundaryError&&e.code==='native_upi_handoff_not_ready')
for(const patch of [
 {reviewId:'wrong'},{reviewSha256:'b'.repeat(64)},{snapshotSha256:'b'.repeat(64)},
 {totalPaise:49999},{methodId:'other'},{mode:'upi_qr'},{acknowledge:false},{addressAccepted:false},
])assert.throws(()=>authorizeNativeCheckoutAttempt(review,{...consent,...patch},now),
 e=>e instanceof PurchaseBoundaryError)
assert.throws(()=>authorizeNativeCheckoutAttempt(review,consent,now+60001))
const summary=summarizeNativeCheckoutResponse({status:'PENDING_PAYMENT',orderId:'ord-1'})
assert.equal(summary.paymentPending,true)
assert.equal(summary.orderVerified,false)
assert.equal(summary.paymentVerified,false)
const partial=summarizeNativeCheckoutResponse({orders:[{orderId:'ord-1',status:'PLACED'},
 {orderId:'ord-2',status:'FAILED'}],successCount:1,failureCount:1})
assert.equal(partial.orderRefs.length,2)
assert.equal(partial.orderVerified,false)
const client=readFileSync('lib/commerce/mcp.ts','utf8')
const svc=readFileSync('lib/commerce/native-checkout-executor.ts','utf8')
const api=readFileSync('app/api/commerce/purchases/[id]/native/route.ts','utf8')
const sql=readFileSync('supabase/migrations/20261115180000_commerce_native_checkout_one_attempt.sql','utf8')
assert.match(client,/COMMERCE_NATIVE_CHECKOUT_ENABLED/)
assert.match(client,/name:'checkout'/)
assert.doesNotMatch(client,/confirmDuplicate: *true/)
assert.match(svc,/\.insert\(\{/)
assert.match(svc,/priorAttempt\(owner,purchaseId\)/)
assert.match(svc,/nativeReviewHash\(/)
assert.match(svc,/native_checkout_review_changed/)
assert.match(svc,/native_agentic_payment_not_allowed/)
assert.match(svc,/items:latest.cartItems/)
assert.match(svc,/enterprise_checkout_requires_separate_execution/)
assert.match(svc,/client\.placeInstamartCheckout/)
assert.match(svc,/status:'outcome_unknown'/)
assert.match(sql,/purchase_id uuid not null unique/)
assert.match(sql,/enable row level security/g)
assert.match(api,/requireAgentMutationOrigin\(request\)/)
assert.match(api,/requireAgentSession\(request\)/)
console.log('✅ native checkout exact consent, durable no-retry and partial-outcome contracts checked')
