'use client'

import {useEffect, useState} from 'react'
import Link from 'next/link'

type Provider = {provider: string; label: string; state: string}
type Task = {runId: string; summary: string; subject: string; state: string; provider?: string; addressLabel?: string}
type AddressPage = {addresses: Array<{id: string; label: string; addressLine: string}>; page: number; hasMore: boolean}
export default function CommerceConnectionsPage() {
  const [providers, setProviders] = useState<Provider[]>([])
  const [runId, setRunId] = useState('')
  const [task, setTask] = useState<Task | null>(null)
  const [addresses, setAddresses] = useState<AddressPage | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState('Loading connections…')
  async function load(id: string) {
    const response = await fetch('/api/commerce', {cache: 'no-store'})
    if (!response.ok) throw new Error()
    setProviders((await response.json()).providers)
    if (id) {
      const result = await fetch('/api/commerce/tasks/' + encodeURIComponent(id), {cache: 'no-store'})
      if (!result.ok) { setTask(null); throw new Error() }
      setTask(await result.json())
    }
  }
  useEffect(() => {
    const query = new URLSearchParams(window.location.search)
    const id = query.get('run') || ''
    setRunId(id)
    void load(id).then(() => setMessage(query.get('result') === 'connection_failed' ? 'Sign-in did not complete. You can try again.' : query.get('result') === 'authorized_task_unavailable' ? 'Account connected, but the original task has changed. Open your current comparison from chat.' : ''))
      .catch(() => setMessage('Unable to read this connection or task. Refresh, or open your current comparison from chat.'))
  }, [])
  async function act(provider: string, action: 'connect' | 'disconnect') {
    setBusy(provider); setMessage(''); setAddresses(null)
    try {
      const response = await fetch('/api/commerce/' + provider + '/' + action, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(action === 'connect' && runId ? {runId} : {})})
      const data = await response.json()
      if (!response.ok) throw new Error()
      if (data.taskContinued) { await load(runId); return }
      if (action === 'connect') {
        const url = new URL(data.authorizationUrl)
        if (url.protocol !== 'https:' || !['mcp.swiggy.com', 'auth.zepto.co.in'].includes(url.hostname)) throw new Error()
        window.location.assign(url.href)
      } else {
        await load(runId)
        setMessage(data.providerRevocationVerified ? 'Disconnected from AskGogo and the provider.' : 'Disconnected from AskGogo. Provider-side revocation could not be verified.')
      }
    } catch { setMessage('The connection could not be completed. Please retry after provider access is available.') }
    finally { setBusy(null) }
  }
  async function readAddresses(page: number) {
    setBusy('swiggy'); setMessage(''); setAddresses(null)
    try {
      const response = await fetch('/api/commerce/swiggy/addresses?page=' + page, {cache: 'no-store'})
      if (!response.ok) throw new Error()
      setAddresses(await response.json())
    } catch { setMessage('Saved addresses could not be verified. Reconnect if sign-in has expired, then retry.') }
    finally { setBusy(null) }
  }
  async function selectAddress(addressId: string) {
    if (!addresses || !task) return
    setBusy('swiggy'); setMessage('')
    try {
      const response = await fetch('/api/commerce/swiggy/addresses', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({runId: task.runId, addressId, page: addresses.page})})
      if (!response.ok) throw new Error()
      setTask(await response.json()); setAddresses(null)
      setMessage('Saved address selected for the same comparison. Availability, prices and cart are not yet verified.')
    } catch { setMessage('Selection was not saved. Refresh the task and saved addresses, then try again.') }
    finally { setBusy(null) }
  }
  return <div className="mx-auto max-w-3xl space-y-6 pb-10">
    <Link href="/dashboard/connections" className="text-sm text-[#2fb8a6]">← Connections</Link>
    <h1 className="text-3xl font-medium">Food and groceries</h1>
    <p className="text-sm text-[#a0a0a0]">Connect your own account to use saved delivery addresses. Sign-in happens with the provider; do not send your OTP in chat.</p>
    <p role="status" className="text-sm text-[#a0a0a0]">{message}</p>
    {task && <section className="rounded-xl border border-[#292929] p-5 space-y-2">
      <h2 className="text-lg font-medium">Your {task.subject} comparison</h2>
      <p>{task.summary}</p>
      {task.addressLabel && <p>Selected address: {task.addressLabel}</p>}
      <Link href="/dashboard/chat" className="text-[#2fb8a6]">Back to Gogo</Link>
    </section>}
    {providers.map(provider => <section key={provider.provider} className="rounded-xl border border-[#292929] p-5 space-y-3">
      <h2 className="text-lg font-medium">{provider.label}{provider.provider === 'swiggy' ? ' Food and Instamart' : ''}</h2>
      <p className="text-sm text-[#a0a0a0]">{provider.state === 'provider_approval_required' ? 'Waiting for provider access approval.' : provider.state === 'authorized' ? 'Account authorized. Address, price and cart verification are still required for each task.' : 'Not connected, or sign-in has expired.'}</p>
      {provider.state !== 'provider_approval_required' && <button disabled={busy !== null || (!!runId && (!task || provider.provider !== 'swiggy'))} onClick={() => act(provider.provider, provider.state === 'authorized' && !runId ? 'disconnect' : 'connect')} className="rounded-lg bg-[#2fb8a6] px-4 py-2 text-sm text-black disabled:opacity-50">
        {busy === provider.provider ? 'Please wait…' : provider.state === 'authorized' ? (!runId ? 'Disconnect' : 'Use connected ' + provider.label + ' account') : 'Connect ' + provider.label}
      </button>}
      {runId && provider.provider === 'zepto' && <p className="text-sm text-[#a0a0a0]">Zepto groceries cannot be compared with a restaurant meal.</p>}
      {task && task.provider === 'swiggy' && provider.provider === 'swiggy' && provider.state === 'authorized' && <button disabled={busy !== null} onClick={() => readAddresses(1)} className="block rounded-lg border border-[#2fb8a6] px-4 py-2 disabled:opacity-50">Choose saved delivery address</button>}
    </section>)}
    {addresses && <section aria-label="Saved delivery addresses" className="space-y-3">
      <h2 className="text-lg font-medium">Choose your delivery address</h2>
      {!addresses.addresses.length && <p>No saved addresses on this page. Add an address in Swiggy, then reload.</p>}
      {addresses.addresses.map(address => <button key={address.id} disabled={busy !== null} onClick={() => selectAddress(address.id)} className="block w-full rounded-xl border border-[#292929] p-4 text-left disabled:opacity-50"><strong>{address.label}</strong><br />{address.addressLine}</button>)}
      <div className="flex gap-4">
        {addresses.page > 1 && <button disabled={busy !== null} onClick={() => readAddresses(addresses.page - 1)}>Previous addresses</button>}
        {addresses.hasMore && addresses.page < 50 && <button disabled={busy !== null} onClick={() => readAddresses(addresses.page + 1)}>More addresses</button>}
      </div>
    </section>}
    <p className="text-sm text-[#a0a0a0]">Connecting an account does not place an order. Cart preparation and phone handoff will only be reported as verified after provider readback.</p>
  </div>
}
