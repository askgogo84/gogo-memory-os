import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {verifiedInstamartPaymentChoices} from '../lib/commerce/native-payment-contract'
import {PurchaseBoundaryError} from '../lib/commerce/purchase-contract'
const input={
  placeOrderToolName:'checkout',agenticPaymentEligible:true,
  allMethods:[
    {id:'Cash',displayName:'Cash on delivery'},
    {id:'SwiggyPay',displayName:'Swiggy Money'},
    {id:'gpay://upi/',displayName:'GPay',kind:'intent',enabled:true},
    {id:'QrFlow',displayName:'Scan QR',kind:'qr',enabled:true},
  ],
  cod:{available:true,id:'Cash',displayName:'Cash on delivery'},
  swiggyMoney:{available:true,id:'SwiggyPay',displayName:'Swiggy Money'},
  platforms:{mobile:{methods:[{id:'gpay://upi/',displayName:'GPay',kind:'intent'}]},
    desktop:{methods:[{id:'QrFlow',displayName:'Scan QR',kind:'qr'}]}},
}
const result=verifiedInstamartPaymentChoices(input)
assert.equal(result.choices.length,4)
assert.equal(result.agenticEligible,true)
assert.deepEqual(result.choices.map(x=>x.mode),['cash_on_delivery','swiggy_money','upi_intent','upi_qr'])
for(const malformed of [
  {...input,placeOrderToolName:'not_checkout'},
  {...input,allMethods:[]},
  {...input,allMethods:[{id:'\n',displayName:'bad'}]},
  {...input,allMethods:[input.allMethods[0],input.allMethods[0]]},
  {...input,platforms:{mobile:{methods:new Array(50).fill({id:'bad'})}}},
]){
  assert.throws(()=>verifiedInstamartPaymentChoices(malformed as any),
    e=>e instanceof PurchaseBoundaryError && e.code==='payment_options_unverified')
}
assert.equal(verifiedInstamartPaymentChoices({...input,cod:{available:false,id:'Cash'},swiggyMoney:{available:false,id:'SwiggyPay'}}).choices.length,2)
assert.equal(verifiedInstamartPaymentChoices({...input,allMethods:input.allMethods.map(x=>x.id==='gpay://upi/'?{...x,enabled:false}:x)}).choices.some(x=>x.label==='GPay'),false)
const adapter=readFileSync('lib/commerce/native-payment-options.ts','utf8')
const service=readFileSync('lib/commerce/mcp.ts','utf8')
const api=readFileSync('app/api/commerce/purchases/[id]/payment-options/route.ts','utf8')
assert.match(adapter,/client\.readTool\('get_cart'/)
assert.match(adapter,/client\.readTool\('get_payment_options'/)
assert.match(adapter,/sameSnapshot\(purchase,snapshot\)/)
assert.match(adapter,/cartTotal!==payable/)
assert.doesNotMatch(adapter,/checkout\(/)
assert.match(service,/grocery: \[.*'get_payment_options'/)
assert.doesNotMatch(service,/name: 'checkout'/)
assert.match(api,/export async function GET/)
assert.doesNotMatch(api,/export async function POST/)
console.log('✅ Swiggy live payment-options normalization and read-only gate checked')
