'use client'
import {useCallback, useEffect, useState} from 'react'

type Outcome = {
  verification: 'not_available' | 'authenticated_merchant_readback'
  orderVerified: boolean; paymentVerified: boolean; refundVerified: boolean
  orderStatus?: string; paymentStatus?: string; orderId?: string | null
  observedAt?: string; message: string
}

export default function VerifiedMerchantOutcome({purchaseId}: {purchaseId: string}) {
  const [outcome,setOutcome] = useState<Outcome | null>(null)
  const [busy,setBusy] = useState(false)
  const [error,setError] = useState('')
  const refresh = useCallback(async () => {
    setBusy(true); setError('')
    try {
      const response=await fetch('/api/commerce/purchases/'+encodeURIComponent(purchaseId)+'/outcome',{cache:'no-store'})
      if (!response.ok) throw new Error('readback_unavailable')
      setOutcome(await response.json())
    } catch {
      setOutcome(null)
      setError('Merchant verification unavailable. Please check the merchant app directly. Do not assume payment or order success.')
    } finally {setBusy(false)}
  },[purchaseId])
  useEffect(() => {void refresh()},[refresh])
  return <section className="space-y-2 rounded-xl border border-[#292929] p-4" aria-live="polite">
    <h3 className="text-lg font-medium">Merchant order and payment verification</h3>
    {outcome?.verification==='authenticated_merchant_readback' ?
      <div className="space-y-1 text-sm">
        <p>Order: {outcome.orderVerified ? 'Verified by merchant' : 'Not verified'} ({outcome.orderStatus})</p>
        <p>Payment: {outcome.paymentVerified ? 'Verified by merchant' : 'Not verified'} ({outcome.paymentStatus})</p>
        <p>Refund: {outcome.refundVerified ? 'Verified by merchant' : 'Not verified'}</p>
        {outcome.orderId && <p>Merchant order ID: {outcome.orderId}</p>}
        {outcome.observedAt && <p>Checked: {new Date(outcome.observedAt).toLocaleString('en-IN')}</p>}
        <p className="text-[#a0a0a0]">{outcome.message}</p>
      </div>
    : <p className="text-sm text-[#a0a0a0]">{outcome?.message || 'Checking for independently verified merchant evidence…'}</p>}
    {error && <p role="alert" className="text-sm">{error}</p>}
    <button disabled={busy} onClick={() => void refresh()} className="rounded-lg border border-[#2fb8a6] px-3 py-2 text-sm disabled:opacity-50">
      {busy?'Checking…':'Refresh verified merchant status'}
    </button>
    <p className="text-xs text-[#a0a0a0]">This check cannot place, repeat, capture or refund an order.</p>
  </section>
}
