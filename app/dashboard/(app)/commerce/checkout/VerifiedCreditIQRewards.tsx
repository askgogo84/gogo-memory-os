'use client'
import {useEffect,useState} from 'react'
type Reward={
 status:'verified_offers'|'insufficient_verified_evidence'
 reason:string; disclaimer:string;notice:string
 suggestions:Array<{cardAlias:string;offerId:string;netEstimatedBenefitPaise:number;termsUrl:string|null;guarantee:false}>
}
export default function VerifiedCreditIQRewards({purchaseId}:{purchaseId:string}){
  const [data,setData]=useState<Reward|null>(null)
  const [error,setError]=useState('')
  useEffect(()=>{
    let live=true
    void fetch('/api/commerce/purchases/'+encodeURIComponent(purchaseId)+'/rewards',{cache:'no-store'})
      .then(async response=>{if(!response.ok)throw new Error('unavailable');return response.json()})
      .then(result=>{if(live)setData(result as Reward)})
      .catch(()=>{if(live)setError('Verified CreditIQ benefits are unavailable for this cart.')})
    return ()=>{live=false}
  },[purchaseId])
  return <section className="space-y-2 rounded-xl border border-[#292929] p-4">
    <h3 className="text-lg font-medium">CreditIQ verified card benefits</h3>
    {data?.status==='verified_offers'?<div className="space-y-2">
      {data.suggestions.map(offer=><p key={offer.offerId}>
        {offer.cardAlias}: estimated net ₹{(offer.netEstimatedBenefitPaise/100).toFixed(2)} benefit
      </p>)}
      <p className="text-sm text-[#a0a0a0]">{data.disclaimer}</p>
    </div>:
    <p className="text-sm text-[#a0a0a0]">{error||'No issuer-verified cart-exact CreditIQ offer is currently available. Never assume a points balance guarantees a discount.'}</p>}
    <p className="text-xs text-[#a0a0a0]">These offers are advisory. AskGogo does not select a card, initiate payment or guarantee any reward.</p>
  </section>
}
