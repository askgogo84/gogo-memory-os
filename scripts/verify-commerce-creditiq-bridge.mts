import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {verifiedCreditIQMerchantPayload} from '../lib/commerce/creditiq-commerce-adapter'
import {PurchaseBoundaryError} from '../lib/commerce/purchase-contract'
const scope={owner:'askgogo-owner',userLinkId:'f0a26b1b-4b5c-4c5c-915f-cd7e13c4a2c4',cartSha256:'a'.repeat(64),provider:'swiggy',totalPaise:50000}
const quote={owner:scope.userLinkId,cartSha256:scope.cartSha256,provider:scope.provider,currency:'INR',
 cardAlias:'Issuer card ••1111',offerId:'issuer-promo-1',evidenceId:'issuer-proof',
 evidenceSource:'creditiq_issuer_verified',checkedAt:Date.now()-1000,expiresAt:Date.now()+60000,
 eligible:true,estimatedBenefitPaise:2000,merchantFeePaise:100,termsUrl:'https://issuer.example/terms'}
const data={contract:'gogo-creditiq-merchant-benefits-v1',userLinkId:scope.userLinkId,
 cartSha256:scope.cartSha256,provider:scope.provider,currency:'INR',totalPaise:50000,quotes:[quote]}
const good=verifiedCreditIQMerchantPayload(data as any,scope)
assert.equal(good[0].owner,scope.owner)
assert.equal(good[0].evidenceSource,'creditiq_issuer_verified')
for(const changes of [
  {contract:'other'}, {userLinkId:'other'},{cartSha256:'b'.repeat(64)},
  {provider:'zepto'},{currency:'USD'},{totalPaise:40000},
  {quotes:[{...quote,owner:'another-user'}]}, {quotes:[{...quote,provider:'zepto'}]},
  {quotes:new Array(31).fill(quote)},
]){
 assert.throws(()=>verifiedCreditIQMerchantPayload({...data,...changes} as any,scope),
   e=>e instanceof PurchaseBoundaryError&&e.code==='creditiq_issuer_quote_unverified')
}
const svc=readFileSync('lib/commerce/creditiq-commerce-adapter.ts','utf8')
const api=readFileSync('app/api/commerce/purchases/[id]/rewards/route.ts','utf8')
assert.match(svc,/process\.env\.CREDITIQ_COMMERCE_REWARDS_ENABLED==='true'/)
assert.match(svc,/from\('wa_creditiq_links'\)/)
assert.match(svc,/eq\('sender',owner\)/)
assert.match(svc,/createHmac\('sha256',secret\)/)
assert.match(svc,/sameSnapshot\(purchase,snapshot\)/)
assert.match(svc,/rankVerifiedCreditIQBenefits/)
assert.doesNotMatch(svc,/api\/rewards-calculator|api\/spend-optimizer|useCardNumber|cardPan/)
assert.match(api,/requireAgentSession\(request\)/)
assert.doesNotMatch(api,/export async function POST/)
console.log('✅ CreditIQ merchant-exact signed advisory bridge contract and negative tests passed')
