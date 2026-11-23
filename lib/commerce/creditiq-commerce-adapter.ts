import {createHmac} from 'node:crypto'
import {supabaseAdmin} from '@/lib/supabase-admin'
import {assertPurchaseFeatureEnabled,getPurchase} from './purchase-handoff'
import {rankVerifiedCreditIQBenefits, type CardBenefitRanking, type VerifiedCardBenefit} from './creditiq-rewards'
import {PurchaseBoundaryError} from './purchase-contract'
import {readCommerceTask} from './task'
import {sameSnapshot,snapshotFromVerifiedCart} from './purchase-contract'

/**
 * CreditIQ's existing travel bridge uses an HMAC-signed, service-only API.
 * Commerce rewards are intentionally a SEPARATE capability: existing
 * catalogue/points/statement data is NOT issuer-verified merchant cashback.
 *
 * This connector only accepts issuer-attested, cart-exact evidence from
 * CreditIQ's future dedicated commerce endpoint. Without a validated service,
 * it returns NO verified offers; it never estimates a promotion from the card
 * catalogue and never moves funds or chooses a payment instrument.
 */
const REWARDS_ENABLED=()=>process.env.CREDITIQ_COMMERCE_REWARDS_ENABLED==='true'
const ENDPOINT='https://creditiq.app/api/internal/gogo/commerce/merchant-benefits'
const DISCLAIMER='CreditIQ reward offers require a live issuer-verified merchant quote. Card ownership and points balances alone do not establish any eligible offer.'
type RemotePayload={
  contract:string; userLinkId:string;cartSha256:string;provider:string;
  currency:string;totalPaise:number;quotes:VerifiedCardBenefit[]
}

export function verifiedCreditIQMerchantPayload(
  response:RemotePayload, scope:{owner:string;userLinkId:string;cartSha256:string;provider:string;totalPaise:number},
): VerifiedCardBenefit[] {
  if(!response || response.contract!=='gogo-creditiq-merchant-benefits-v1' ||
    response.userLinkId!==scope.userLinkId ||
    response.cartSha256!==scope.cartSha256 || response.provider!==scope.provider ||
    response.currency!=='INR'||response.totalPaise!==scope.totalPaise ||
    !Array.isArray(response.quotes)||response.quotes.length>30) {
    throw new PurchaseBoundaryError('creditiq_issuer_quote_unverified')
  }
  // Ownership is bound by the server's linked CreditIQ user ID, not by
  // trusting a customer-supplied userId, card number or raw provider reply.
  if(response.quotes.some(q=>!q || q.owner!==scope.userLinkId ||
    q.cartSha256!==scope.cartSha256 || q.provider!==scope.provider)) {
    throw new PurchaseBoundaryError('creditiq_issuer_quote_unverified')
  }
  return response.quotes.map(q=>({...q,owner:scope.owner}))
}

export async function readVerifiedCreditIQMerchantBenefits(owner:string,purchaseId:string):Promise<CardBenefitRanking&{reason:string}>{
  assertPurchaseFeatureEnabled()
  const purchase=await getPurchase(owner,purchaseId)
  if(!purchase) throw new PurchaseBoundaryError('purchase_not_found')
  if(!REWARDS_ENABLED()) return {...rankVerifiedCreditIQBenefits({
    owner,cartSha256:purchase.snapshot_sha256,provider:purchase.provider,totalPaise:purchase.amount_paise,
  },[]), reason:'verified_rewards_adapter_not_enabled'}
  const {data:link,error}=await supabaseAdmin.from('wa_creditiq_links').select('consumer_user_id')
    .eq('sender',owner).maybeSingle()
  if(error) throw new PurchaseBoundaryError('purchase_store_unavailable')
  if(!link?.consumer_user_id) return {...rankVerifiedCreditIQBenefits({
    owner,cartSha256:purchase.snapshot_sha256,provider:purchase.provider,totalPaise:purchase.amount_paise,
  },[]), reason:'creditiq_account_not_linked'}
  const task=await readCommerceTask(owner,purchase.source_run_id)
  if(!task) throw new PurchaseBoundaryError('commerce_task_changed')
  const snapshot=snapshotFromVerifiedCart(owner,task,Date.now(),purchase.budget_paise)
  if(!sameSnapshot(purchase,snapshot)) throw new PurchaseBoundaryError('purchase_snapshot_changed_new_task_required')
  const secret=String(process.env.CREDITIQ_GOGO_SERVICE_SECRET||'').trim()
  if(!secret) return {...rankVerifiedCreditIQBenefits({
    owner,cartSha256:purchase.snapshot_sha256,provider:purchase.provider,totalPaise:purchase.amount_paise,
  },[]), reason:'creditiq_service_unconfigured'}
  const ctx={
    owner, userLinkId:String(link.consumer_user_id),cartSha256:purchase.snapshot_sha256 as string,
    provider:purchase.provider as string,totalPaise:purchase.amount_paise as number,
  }
  if(!/^[0-9a-f-]{8,80}$/i.test(ctx.userLinkId)) throw new PurchaseBoundaryError('creditiq_link_unverified')
  const raw=JSON.stringify({
    userLinkId:ctx.userLinkId,cartSha256:ctx.cartSha256,provider:ctx.provider,
    currency:'INR',totalPaise:ctx.totalPaise,
  })
  const timestamp=String(Date.now())
  const signature=createHmac('sha256',secret).update(timestamp+'.'+raw).digest('hex')
  try{
    const response=await fetch(ENDPOINT,{method:'POST',redirect:'error',cache:'no-store',
      headers:{'Content-Type':'application/json','Accept':'application/json',
        'X-Gogo-Timestamp':timestamp,'X-Gogo-Signature':signature},
      body:raw,signal:AbortSignal.timeout(10000)})
    if(!response.ok) throw new Error('creditiq_provider_unavailable')
    const rawReply=await response.text()
    if(rawReply.length>65000) throw new Error('creditiq_response_too_large')
    const payload=JSON.parse(rawReply) as RemotePayload
    const quotes=verifiedCreditIQMerchantPayload(payload,ctx)
    return {...rankVerifiedCreditIQBenefits({
      owner,cartSha256:ctx.cartSha256,provider:ctx.provider,totalPaise:ctx.totalPaise,
    },quotes),reason:'issuer_quote_validation_complete'}
  }catch{
    return {...rankVerifiedCreditIQBenefits({
      owner,cartSha256:ctx.cartSha256,provider:ctx.provider,totalPaise:ctx.totalPaise,
    },[]),reason:'verified_issuer_offers_unavailable'}
  }
}
export const CREDITIQ_COMMERCE_ADVISORY_NOTICE=DISCLAIMER
