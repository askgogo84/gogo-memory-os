import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {MerchantOrderReadback, validateMerchantOrderReadback, merchantOutcomeView} from '../lib/commerce/purchase-outcome'
import {PurchaseBoundaryError} from '../lib/commerce/purchase-contract'

const now=Date.parse('2026-11-15T12:00:00Z')
const purchase={
 id:'a35d601a-4cde-4b77-acd4-3b6e5c1399e9',owner_telegram_id:'owner-1',
 provider:'swiggy',cart_id:'merchant-cart-1',amount_paise:25000,currency:'INR',
 status:'handoff_released',approved_at:new Date(now-120000).toISOString(),
 handoff_released_at:new Date(now-60000).toISOString(),
}
const evidence:MerchantOrderReadback={
 source:'authenticated_merchant_order_readback', provider:'swiggy',
 purchaseId:purchase.id,cartId:purchase.cart_id,accountScopeVerified:true,
 observedAt:new Date(now-30000).toISOString(),evidenceRef:'readback-1',
 orderId:'order-1',paymentId:'payment-1',refundId:null,
 orderStatus:'placed',paymentStatus:'captured',grossPaidPaise:25000,
 refundedPaise:0,currency:'INR',
}
let checks=0
const ok=(name:string,fn:()=>void)=>{fn();checks++;console.log('✓ '+name)}
const rejected=(change:Partial<MerchantOrderReadback>,p=purchase)=>{
 assert.throws(()=>validateMerchantOrderReadback(p,{...evidence,...change},now),
  err=>err instanceof PurchaseBoundaryError&&err.code==='merchant_evidence_unverified')
}
ok('exact bound provider readback succeeds only for handoff',()=>{
 const result=validateMerchantOrderReadback(purchase,evidence,now)
 assert.match(result.evidenceSha256,/^[0-9a-f]{64}$/)
 assert.equal(result.grossPaidPaise,25000)
})
ok('not an order without backend evidence',()=>{
 const empty=merchantOutcomeView(null)
 assert.equal(empty.orderVerified,false)
 assert.equal(empty.paymentVerified,false)
 assert.equal(empty.refundVerified,false)
})
ok('verified merchant proof can assert separate order and payment states',()=>{
 const view=merchantOutcomeView({order_status:'placed',payment_status:'captured',order_id:'order-1',observed_at:evidence.observedAt})
 assert.equal(view.orderVerified,true)
 assert.equal(view.paymentVerified,true)
 assert.equal(view.refundVerified,false)
})
ok('cross-provider and other purchase are rejected',()=>{
 rejected({provider:'zepto'})
 rejected({purchaseId:'other'})
 rejected({cartId:'other-cart'})
})
ok('explicit same-account verification is required',()=>rejected({accountScopeVerified:false as never}))
ok('checkout handoff must have happened first',()=>rejected({}, {...purchase,status:'approved'}))
ok('refuse stale and future merchant evidence',()=>{
 rejected({observedAt:new Date(now-86400001).toISOString()})
 rejected({observedAt:new Date(now+60000).toISOString()})
})
ok('merchant reference and order receipt required for claims',()=>{
 rejected({evidenceRef:'untrusted value !!'})
 rejected({orderId:null})
 rejected({paymentId:null})
})
ok('refunds must have exact paid gross and verified references',()=>{
 rejected({paymentStatus:'refunded',refundId:'refund-1',refundedPaise:100})
 rejected({paymentStatus:'partially_refunded',refundId:null,refundedPaise:100})
 const refund=validateMerchantOrderReadback(purchase,{...evidence,paymentStatus:'partially_refunded',refundId:'refund-1',refundedPaise:100},now)
 assert.equal(refund.refundedPaise,100)
})
ok('failure status cannot be claimed as captured',()=>rejected({paymentStatus:'failed'}))
ok('no user-writable payment verification route exists',()=>{
 const api=readFileSync('app/api/commerce/purchases/[id]/outcome/route.ts','utf8')
 assert.match(api,/export async function GET/)
 assert.doesNotMatch(api,/export async function POST|export async function PUT|export async function PATCH/)
 assert.match(api,/requireAgentSession\(request\)/)
})
ok('append-only evidence table has service-only permissions and immutability trigger',()=>{
 const sql=readFileSync('supabase/migrations/20261115120000_commerce_outcome_readbacks.sql','utf8')
 assert.match(sql,/enable row level security/)
 assert.match(sql,/revoke all.*anon, authenticated/)
 assert.match(sql,/before update or delete/)
 assert.match(sql,/unique\(provider,evidence_ref\)/)
})
console.log('✅ '+checks+' merchant-outcome contract/negative checks passed')
