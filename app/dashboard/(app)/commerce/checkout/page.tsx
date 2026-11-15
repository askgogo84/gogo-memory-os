'use client'

import {useEffect, useState} from 'react'
import Link from 'next/link'
import VerifiedMerchantOutcome from './VerifiedMerchantOutcome'
import NativePaymentOptions from './NativePaymentOptions'
import VerifiedCreditIQRewards from './VerifiedCreditIQRewards'
import NativeCheckoutReview from './NativeCheckoutReview'
import NativeOrderStatus from './NativeOrderStatus'

type Purchase = {
  purchaseId: string; sourceRunId: string; provider: string; state: string
  totalPaise: number; currency: string; cartVerified: boolean
  phoneCartVerified: boolean; checkoutLinkVerified: boolean
  expiresAt: string; snapshotSha256: string
  items: Array<{spinId: string; skuId: string; quantity: number}>
  checkoutUrl: string | null; paymentVerified: boolean; orderPlaced: boolean
  notice: string
}

function merchantUrl(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password) return null
    if (!['swiggy.com','zepto.com','zepto.co.in'].some(domain => url.hostname === domain || url.hostname.endsWith('.' + domain))) return null
    return url.href
  } catch { return null }
}

export default function CommerceCheckoutPage() {
  const [runId, setRunId] = useState('')
  const [purchase, setPurchase] = useState<Purchase | null>(null)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [ack, setAck] = useState(false)
  const [message, setMessage] = useState('')
  const [link, setLink] = useState<string | null>(null)
  useEffect(() => {
    const query = new URLSearchParams(window.location.search)
    setRunId(query.get('run') || '')
    const id = query.get('purchase')
    if (!id) {setReady(true); return}
    void fetch('/api/commerce/purchases/' + encodeURIComponent(id), {cache: 'no-store'})
      .then(async response => {if (!response.ok) throw new Error('unavailable'); setPurchase(await response.json())})
      .catch(() => setMessage('Purchase status could not be loaded. No payment was performed.'))
      .finally(() => setReady(true))
  }, [])

  async function prepare() {
    if (!runId) return
    setBusy(true); setMessage(''); setLink(null)
    try {
      const response = await fetch('/api/commerce/purchases', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({runId}), cache:'no-store',
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'unavailable')
      setPurchase(body)
      window.history.replaceState(null, '', '/dashboard/commerce/checkout?purchase=' + encodeURIComponent(body.purchaseId))
    } catch (error) {setMessage('Cannot prepare checkout: ' + (error instanceof Error ? error.message : 'unavailable') + '. Nothing was ordered.')}
    finally {setBusy(false)}
  }

  async function act(action: 'approve'|'open'|'cancel') {
    if (!purchase) return
    setBusy(true); setMessage(''); setLink(null)
    const input = action === 'approve'
      ? {action, acknowledge: ack, snapshotSha256: purchase.snapshotSha256, totalPaise: purchase.totalPaise, merchant: purchase.provider}
      : action === 'open' ? {action, snapshotSha256: purchase.snapshotSha256} : {action}
    try {
      const response = await fetch('/api/commerce/purchases/' + encodeURIComponent(purchase.purchaseId), {
        method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(input), cache:'no-store',
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'unavailable')
      setPurchase(data)
      if (action === 'open') {
        const verified = merchantUrl(data.checkoutUrl)
        if (!verified) throw new Error('provider_link_unverified')
        setLink(verified)
      }
    } catch (error) {setMessage('Request not completed: ' + (error instanceof Error ? error.message : 'unavailable') + '. Refresh before retrying.')}
    finally {setBusy(false)}
  }

  return <div className="mx-auto max-w-2xl space-y-5 pb-10">
    <Link href="/dashboard/commerce" className="text-[#2fb8a6]">← Food and groceries</Link>
    <h1 className="text-3xl font-medium">Review merchant checkout</h1>
    <p className="text-[#a0a0a0]">AskGogo does not hold your card or UPI PIN. Final order placement, payment and authentication happen at the merchant. The link-handoff pilot never makes a purchase. A separately enabled native checkout pilot can create an order only after explicit final approval.</p>
    {message && <p role="alert" className="rounded-lg border border-[#605035] p-3">{message}</p>}
    {ready && !purchase && <section className="rounded-xl border border-[#292929] p-5 space-y-3">
      <p>A verified cart is required before a purchase proposal can be prepared.</p>
      <button disabled={busy || !runId} onClick={prepare} className="rounded-lg border border-[#2fb8a6] px-4 py-2 disabled:opacity-50">
        {busy ? 'Checking provider evidence…' : 'Prepare checkout review'}
      </button>
      {!runId && <p className="text-[#a0a0a0]">Open this page from an active commerce comparison with a verified cart.</p>}
    </section>}
    {purchase && <section className="rounded-xl border border-[#292929] p-5 space-y-4">
      <h2 className="text-xl font-medium">Your cart proposal</h2>
      <p>Merchant: {purchase.provider} · Status: {purchase.state.replaceAll('_',' ')}</p>
      <p className="text-2xl font-medium">₹{(purchase.totalPaise/100).toFixed(2)}</p>
      <p className="text-sm text-[#a0a0a0]">{purchase.items.length} cart line(s). Verify quantities again inside the provider checkout before paying.</p>
      <p className="text-sm text-[#a0a0a0]">Expires: {new Date(purchase.expiresAt).toLocaleString('en-IN')}</p>
      <p className="text-[#a0a0a0]">{purchase.notice}</p>
      {purchase.state === 'awaiting_provider_handoff' && <p className="rounded-lg border border-[#605035] p-3">Merchant-link checkout is blocked: a provider checkout link and correct phone-cart verification are required. Native checkout is a separately gated flow. Do not use an invented or guessed payment link.</p>}
      {purchase.state === 'pending_approval' && <>
        <label className="flex gap-3">
          <input type="checkbox" checked={ack} onChange={event => setAck(event.target.checked)}/>
          <span>I reviewed this exact merchant, cart and ₹{(purchase.totalPaise/100).toFixed(2)} total. I understand payment will happen on the merchant website.</span>
        </label>
        <button disabled={busy || !ack} onClick={() => act('approve')} className="rounded-lg border border-[#2fb8a6] px-4 py-2 disabled:opacity-50">Approve merchant checkout handoff</button>
      </>}
      {purchase.state === 'approved' && <button disabled={busy} onClick={() => act('open')} className="rounded-lg border border-[#2fb8a6] px-4 py-2 disabled:opacity-50">Get verified merchant checkout link</button>}
      {purchase.state === 'handoff_released' && <button disabled={busy} onClick={() => act('open')} className="rounded-lg border border-[#2fb8a6] px-4 py-2 disabled:opacity-50">Reopen verified provider link</button>}
      {link && <a href={link} rel="noopener noreferrer" target="_blank" className="block w-fit rounded-lg bg-[#2fb8a6] px-4 py-2 text-black">Continue at the merchant ↗</a>}
      {['pending_approval','awaiting_provider_handoff','approved'].includes(purchase.state) && <button disabled={busy} onClick={() => act('cancel')} className="block rounded-lg border border-[#292929] px-4 py-2 disabled:opacity-50">Cancel this proposal</button>}
      {['awaiting_provider_handoff','pending_approval'].includes(purchase.state) && <NativePaymentOptions purchaseId={purchase.purchaseId}/>}
      {purchase.state === 'awaiting_provider_handoff' && <NativeCheckoutReview purchaseId={purchase.purchaseId}/>}
      {purchase.state === 'native_checkout_started' && <NativeOrderStatus purchaseId={purchase.purchaseId}/>}
      <VerifiedCreditIQRewards purchaseId={purchase.purchaseId}/>
      <VerifiedMerchantOutcome purchaseId={purchase.purchaseId}/>
      <p className="text-sm text-[#a0a0a0]">A checkout link is not payment proof. AskGogo will not display “paid”, “ordered” or “refunded” without independently verified merchant evidence.</p>
    </section>}
  </div>
}
