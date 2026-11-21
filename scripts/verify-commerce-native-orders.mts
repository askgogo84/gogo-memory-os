import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {reconcileNativeMerchantOrders} from '../lib/commerce/native-order-reconciliation-contract'
import {PurchaseBoundaryError} from '../lib/commerce/purchase-contract'
const refs=[{orderId:'store-1',status:'PENDING',error:null},{orderId:'store-2',status:'PENDING',error:null}]
const orders=[
 {orderId:'store-1',status:'PLACED',deliveryAddress:{id:'addr-1'},paymentStatus:'PENDING'},
 {orderId:'store-2',status:'FAILED',deliveryAddress:{id:'addr-1'},paymentStatus:'FAILED'},
]
const partial=reconcileNativeMerchantOrders(refs,orders,'addr-1')
assert.equal(partial.orders.length,2)
assert.equal(partial.anyVerified,true)
assert.equal(partial.allVerified,false)
assert.equal(partial.partial,true)
assert.equal(partial.paymentVerified,false)
assert.equal(partial.refundVerified,false)
const other=reconcileNativeMerchantOrders(refs,[{...orders[0],deliveryAddress:{id:'other'}}],'addr-1')
assert.equal(other.anyVerified,false)
const dup=reconcileNativeMerchantOrders(refs,[orders[0],orders[0]],'addr-1')
assert.equal(dup.anyVerified,false)
const missing=reconcileNativeMerchantOrders(refs,[{orderId:'unrelated',status:'DELIVERED',deliveryAddress:{id:'addr-1'}}],'addr-1')
assert.equal(missing.anyVerified,false)
assert.throws(()=>reconcileNativeMerchantOrders([],[], 'addr-1'),
 e=>e instanceof PurchaseBoundaryError)
const code=readFileSync('lib/commerce/native-order-reconciliation.ts','utf8')
const route=readFileSync('app/api/commerce/purchases/[id]/native-status/route.ts','utf8')
const client=readFileSync('lib/commerce/mcp.ts','utf8')
assert.match(code,/readTool\('get_orders'/)
assert.match(code,/eq\('owner_telegram_id',owner\)/)
assert.match(code,/purchase\.address_id/)
assert.doesNotMatch(code,/placeInstamartCheckout|checkout\(/)
assert.match(route,/requireAgentSession\(request\)/)
assert.doesNotMatch(route,/export async function POST/)
assert.match(client,/grocery: \[.*'get_orders'/)
console.log('✅ Swiggy order history exact-ID/address, partial and no-payment-guess reconciliation checks passed')
