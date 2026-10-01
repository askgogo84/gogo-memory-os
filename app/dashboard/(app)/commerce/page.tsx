'use client'

import {useEffect, useState} from 'react'
import Link from 'next/link'

type Provider = {provider: string; label: string; state: string}
export default function CommerceConnectionsPage() {
  const [providers, setProviders] = useState<Provider[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState('Loading connections…')
  async function load() {
    try {
      const response = await fetch('/api/commerce', {cache: 'no-store'})
      if (!response.ok) throw new Error()
      const data = await response.json()
      setProviders(data.providers)
      setMessage('')
    } catch { setMessage('Unable to read connections. Sign in again or retry shortly.') }
  }
  useEffect(() => { void load() }, [])
  async function act(provider: string, action: 'connect' | 'disconnect') {
    setBusy(provider); setMessage('')
    try {
      const response = await fetch(`/api/commerce/${provider}/${action}`, {method: 'POST'})
      const data = await response.json()
      if (!response.ok) throw new Error()
      if (action === 'connect') {
        const url = new URL(data.authorizationUrl)
        if (url.protocol !== 'https:' || !['mcp.swiggy.com', 'auth.zepto.co.in'].includes(url.hostname)) throw new Error()
        window.location.assign(url.href)
      } else {
        await load()
        setMessage(data.providerRevocationVerified ? 'Disconnected from AskGogo and the provider.' : 'Disconnected from AskGogo. Provider-side revocation could not be verified.')
      }
    } catch { setMessage('The connection could not be completed. Please retry after provider access is available.') }
    finally { setBusy(null) }
  }
  return <div className="mx-auto max-w-3xl space-y-6 pb-10">
    <Link href="/dashboard/connections" className="text-sm text-[#2fb8a6]">← Connections</Link>
    <h1 className="text-3xl font-medium">Food and groceries</h1>
    <p className="text-sm text-[#a0a0a0]">Connect your own account to use saved delivery addresses. Sign-in happens with the provider; do not send your OTP in chat.</p>
    <p role="status" className="text-sm text-[#a0a0a0]">{message}</p>
    {providers.map(provider => <section key={provider.provider} className="rounded-xl border border-[#292929] p-5 space-y-3">
      <h2 className="text-lg font-medium">{provider.label}{provider.provider === 'swiggy' ? ' Food and Instamart' : ''}</h2>
      <p className="text-sm text-[#a0a0a0]">{provider.state === 'provider_approval_required' ? 'Waiting for provider access approval.' : provider.state === 'authorized' ? 'Account authorized. Address, price and cart verification are still required for each task.' : 'Not connected, or sign-in has expired.'}</p>
      {provider.state !== 'provider_approval_required' && <button disabled={busy !== null} onClick={() => act(provider.provider, provider.state === 'authorized' ? 'disconnect' : 'connect')} className="rounded-lg bg-[#2fb8a6] px-4 py-2 text-sm text-black disabled:opacity-50">
        {busy === provider.provider ? 'Please wait…' : provider.state === 'authorized' ? 'Disconnect' : `Connect ${provider.label}`}
      </button>}
    </section>)}
    <p className="text-sm text-[#a0a0a0]">Connecting an account does not place an order. Cart preparation and phone handoff will only be reported as verified after provider readback.</p>
  </div>
}
