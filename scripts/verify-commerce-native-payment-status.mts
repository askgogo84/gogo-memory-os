import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {validateMerchantPaymentStatus,paymentStatusPublicView} from '../lib/commerce/native-payment-status-contract'
import {PurchaseBoundaryError} from '../lib/commerce/purchase-contract'
const scope={purchaseId:'purchase-1',attemptId:'attempt-1',paasId:'paas-1',orderId:'order-1'}
const now=Date.parse('2026-11-16T05:00:00Z')
const sample={paasId:'paas-1',orderId:'order-1',status:'SUCCESS',terminal:true,
 isTerminalSuccess:true,isTerminalFailure:false,confirmed:false}
const ok=validateMerchantPaymentStatus(scope,sample,now)
assert.equal(ok.paymentVerified,true)
assert.equal(ok.orderVerified,false)
assert.equal(ok.paymentFailed,false)
assert.match(ok.evidenceSha256,/^[0-9a-f]{64}$/)
assert.equal(paymentStatusPublicView(ok).paymentVerified,true)
const auto=validateMerchantPaymentStatus(scope,{...sample,confirmed:true},now)
assert.equal(auto.orderVerified,true)
const failure=validateMerchantPaymentStatus(scope,{...sample,status:'FAILED',
 isTerminalSuccess:false,isTerminalFailure:true},now)
assert.equal(failure.paymentVerified,false)
assert.equal(failure.paymentFailed,true)
const pending=validateMerchantPaymentStatus(scope,{...sample,status:'PENDING',
 terminal:false,isTerminalSuccess:false},now)
assert.equal(pending.paymentVerified,false)
const deny=(patch:any)=>assert.throws(()=>validateMerchantPaymentStatus(scope,{...sample,...patch},now),
 e=>e instanceof PurchaseBoundaryError && e.code==='payment_readback_unverified')
deny({paasId:'other'})
deny({orderId:'other'})
deny({isTerminalFailure:true})
deny({terminal:false})
deny({status:'\n'})
deny({confirmed:true,isTerminalSuccess:false})
deny({terminal:true,isTerminalSuccess:false,isTerminalFailure:false})
const svc=readFileSync('lib/commerce/native-payment-status.ts','utf8')
const api=readFileSync('app/api/commerce/purchases/[id]/payment-status/route.ts','utf8')
const contract=readFileSync('lib/commerce/native-checkout-contract.ts','utf8')
const schema=readFileSync('supabase/migrations/20261116080000_commerce_native_payment_readbacks.sql','utf8')
const mcp=readFileSync('lib/commerce/mcp.ts','utf8')
assert.match(svc,/payment_paas_id/)
assert.match(svc,/payment_order_id/)
assert.match(svc,/payment_last_check_at/)
assert.match(svc,/check_payment_status/)
assert.match(svc,/validateMerchantPaymentStatus/)
assert.match(api,/requireAgentMutationOrigin\(request\)/)
assert.match(api,/export async function POST/)
assert.doesNotMatch(api,/export async function GET/)
assert.match(contract,/paymentReference/)
assert.match(schema,/before update or delete/)
assert.match(mcp,/grocery: \[.*'check_payment_status'/)
assert.doesNotMatch(svc,/confirm_order|placeInstamartCheckout|confirmDuplicate/)
console.log('✅ native payment-status exact provider ID, terminal guards and append-only evidence checks passed')
