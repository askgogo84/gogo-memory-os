'use client'

import {useEffect, useState} from 'react'
import Link from 'next/link'
import type {FoodCatalogue, CommerceBrowserRead} from '@/lib/commerce/task'

type Provider = {provider: string; label: string; state: string}
type Task = {service: 'food' | 'grocery'; runId: string; summary: string; subject: string; state: string; provider?: string; addressLabel?: string; catalogue?: FoodCatalogue | null; browserReads?:CommerceBrowserRead[]}
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
  async function useBrowser(provider:string,action:'read'|'take_control'='read'){
    if(!task)return
    setBusy('browser');setMessage('Opening the provider in Gogo’s browser. This can take a few minutes…')
    try{
      const response=await fetch('/api/commerce/tasks/'+encodeURIComponent(task.runId)+'/browser',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({provider,action})})
      const data=await response.json()
      if(response.ok){setTask(data);setMessage(action==='take_control'?'Open the browser task below to choose your account or delivery address, then resume the task.':'')}
      else{if(data.task)setTask(data.task);setMessage(data.error==='browser_in_use'?'Another browser check is running. Refresh this comparison shortly.':'The browser check is incomplete. Open its task for the current blocker or sign-in step.')}
    }catch{await load(task.runId).catch(()=>{});setMessage('The request was interrupted. Refresh to see the saved browser state before continuing.')}
    finally{setBusy(null)}
  }
  async function refreshTask(){
    setBusy('refresh')
    try{await load(runId);setMessage('')}
    catch{setMessage('Could not refresh the saved task. Please try again.')}
    finally{setBusy(null)}
  }
  async function readAddresses(page: number) {
    setBusy('swiggy'); setMessage(''); setAddresses(null)
    try {
      const response = await fetch('/api/commerce/swiggy/addresses?page=' + page + '&service=' + (task?.service || 'food'), {cache: 'no-store'})
      if (!response.ok) throw new Error()
      setAddresses(await response.json())
    } catch { setMessage('Saved addresses could not be verified. Reconnect if sign-in has expired, then retry.') }
    finally { setBusy(null) }
  }
  async function readCatalogue(restaurantId?: string, taskId = task?.runId) {
    if (!taskId) return
    setBusy('swiggy'); setMessage('Reading available options for your saved address…')
    try {
      const response = await fetch('/api/commerce/tasks/' + encodeURIComponent(taskId) + '/catalogue', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(restaurantId ? {restaurantId} : {})})
      const data = await response.json()
      if (!response.ok) {
        if (data.task) setTask(data.task)
        setMessage(data.error === 'reauth_required' ? 'Please reconnect Swiggy, then continue this same comparison.' : data.error === 'refresh_restaurants' ? 'These options need refreshing. Read available restaurants again.' : 'The provider options could not be verified. Your task and selected address are preserved; retry or choose your address again.')
        return
      }
      setTask(data); setMessage('Available options checked. Item prices and delivered totals are still unverified; nothing was added to a cart.')
    } catch { setMessage('The provider could not be reached. Your comparison is preserved; retry shortly.') }
    finally { setBusy(null) }
  }
  async function cart(action: 'add' | 'check', spinId?: string, skuId?: string) {
    if (!task) return
    setBusy('swiggy'); setMessage('Checking the cart…')
    try {
      const response = await fetch('/api/commerce/tasks/' + encodeURIComponent(task.runId) + '/cart', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({action, spinId, skuId, quantity: 1})})
      const data = await response.json()
      if (response.ok) { setTask(data); setMessage('') }
      else { if (data.task) setTask(data.task); setMessage('The cart result could not be confirmed. Refresh this task and use Check cart outcome; do not repeat the addition.') }
    } catch { await load(task.runId).catch(() => {}); setMessage('The connection was interrupted. Refresh this task and check the outcome before any further addition.') }
    finally { setBusy(null) }
  }
  async function selectAddress(addressId: string) {
    if (!addresses || !task) return
    setBusy('swiggy'); setMessage('')
    try {
      const response = await fetch('/api/commerce/swiggy/addresses', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({runId: task.runId, addressId, page: addresses.page})})
      if (!response.ok) throw new Error()
      const saved = await response.json()
      setTask(saved); setAddresses(null)
      await readCatalogue(undefined, saved.runId)
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
      <p className="whitespace-pre-line">{task.summary}</p>
      <button disabled={busy!==null} onClick={refreshTask} className="rounded-lg border border-[#292929] px-4 py-2 disabled:opacity-50">Refresh saved progress</button>
      {task.state === 'cart_outcome_unknown' && <button disabled={busy !== null} onClick={() => cart('check')} className="rounded-lg border border-[#2fb8a6] px-4 py-2 disabled:opacity-50">Check cart outcome — no new addition</button>}
      {task.addressLabel && <p>Selected address: {task.addressLabel}</p>}
      <Link href="/dashboard/chat" className="text-[#2fb8a6]">Back to Gogo</Link>
    </section>}
    <section className="rounded-xl border border-[#2fb8a6] p-5 space-y-3">
      <h2 className="text-lg font-medium">Use browser</h2>
      <p className="text-sm text-[#a0a0a0]">Gogo can check the provider website without an account connection below. If sign-in is needed, open the browser task, take control, then resume it. Website access may still be blocked.</p>
      {task&&!task.state.startsWith('cart_')?<>
        <div className="flex flex-wrap gap-3">{(task.service==='food'?[['swiggy','Swiggy Food']]:[['instamart','Instamart'],['zepto','Zepto'],['blinkit','Blinkit']]).map(([key,label])=>{
          const read=task.browserReads?.find(item=>item.provider===key)
          return <button key={key} disabled={busy!==null||!!read&&['running','completed','queued'].includes(read.status)} onClick={()=>useBrowser(key)} className="rounded-lg border border-[#2fb8a6] px-4 py-2 disabled:opacity-50">{read?'Continue '+label:'Check '+label}</button>
        })}</div>
        {task.browserReads?.map(read=><div key={read.runId} className="border-t border-[#292929] pt-3">
          <p>{read.provider} · {read.status}</p>
          <a href={read.taskUrl} className="text-[#2fb8a6]">Open browser task / take control</a>
          <button disabled={busy!==null||['running','queued'].includes(read.status)} onClick={()=>useBrowser(read.provider,'take_control')} className="block mt-2 rounded-lg border border-[#292929] px-4 py-2 disabled:opacity-50">Choose account or delivery location in browser</button>
        </div>)}
        <p className="text-sm text-[#a0a0a0]">These checks do not change your cart or place orders. A completed browser read does not mean delivered totals or a phone cart are verified.</p>
      </>:<p className="text-sm">Start a food or grocery comparison in <Link href="/dashboard/chat" className="text-[#2fb8a6]">Gogo</Link>, then open its comparison link to choose a browser check.</p>}
    </section>
    {providers.map(provider => <section key={provider.provider} className="rounded-xl border border-[#292929] p-5 space-y-3">
      <h2 className="text-lg font-medium">{provider.label}{provider.provider === 'swiggy' ? ' Food and Instamart' : ''}</h2>
      <p className="text-sm text-[#a0a0a0]">{provider.state === 'provider_approval_required' ? 'Account connection is not enabled in AskGogo. Provider approval and setup are still required; this is not an application-status check.' : provider.state === 'authorized' ? 'Account authorized. Address, price and cart verification are still required for each task.' : 'Not connected, or sign-in has expired.'}</p>
      {provider.state !== 'provider_approval_required' && <button disabled={busy !== null || (!!runId && (!task || task.state==='browser_research' || task.state.startsWith('cart_') || provider.provider !== 'swiggy'))} onClick={() => act(provider.provider, provider.state === 'authorized' && !runId ? 'disconnect' : 'connect')} className="rounded-lg bg-[#2fb8a6] px-4 py-2 text-sm text-black disabled:opacity-50">
        {busy === provider.provider ? 'Please wait…' : provider.state === 'authorized' ? (!runId ? 'Disconnect' : 'Use connected ' + provider.label + ' account') : 'Connect ' + provider.label}
      </button>}
      {runId && provider.provider === 'zepto' && <p className="text-sm text-[#a0a0a0]">{task?.service === 'grocery' ? 'Zepto comparison is waiting for provider access and verified integration.' : 'Zepto groceries cannot be compared with a restaurant meal.'}</p>}
      {task && task.state!=='browser_research' && !task.state.startsWith('cart_') && task.provider === 'swiggy' && provider.provider === 'swiggy' && provider.state === 'authorized' && <button disabled={busy !== null} onClick={() => readAddresses(1)} className="block rounded-lg border border-[#2fb8a6] px-4 py-2 disabled:opacity-50">Choose saved delivery address</button>}
    </section>)}
    {task?.addressLabel && task.state!=='browser_research' && !task.state.startsWith('cart_') && task.provider === 'swiggy' && providers.some(provider => provider.provider === 'swiggy' && provider.state === 'authorized') && <section className="space-y-3">
      <button disabled={busy !== null} onClick={() => readCatalogue()} className="rounded-lg border border-[#2fb8a6] px-4 py-2 disabled:opacity-50">{task.service === 'grocery' ? 'Read available grocery products' : 'Read available restaurants'}</button>
      {task.catalogue?.observedAt && <p className="text-sm text-[#a0a0a0]">Checked: {new Date(task.catalogue.observedAt).toLocaleString()}</p>}
      {task.catalogue?.restaurants?.map(restaurant => <button key={restaurant.id} disabled={busy !== null} onClick={() => readCatalogue(restaurant.id)} className="block w-full rounded-xl border border-[#292929] p-4 text-left disabled:opacity-50">
        <strong>{restaurant.name}</strong>
        <p>{restaurant.distanceKm !== null ? restaurant.distanceKm + ' km away' : 'Distance not provided'} · {restaurant.deliveryMinutes !== null ? 'Estimated ' + restaurant.deliveryMinutes + ' min' : 'Delivery estimate not provided'}</p>
        <span className="text-sm text-[#2fb8a6]">Read matching menu items</span>
      </button>)}
      {task.catalogue?.products?.map(item => <div key={item.id + ':' + item.skuId} className="rounded-xl border border-[#292929] p-4">
        <strong>{item.name} — {item.variant}</strong>
        <p className="text-sm text-[#a0a0a0]">Available at the last check. Price and delivered total remain unverified. Nothing has been added to your cart.</p>
        {task.state === 'waiting_item_selection' && <button disabled={busy !== null} onClick={() => cart('add', item.id, item.skuId)} className="mt-3 rounded-lg border border-[#2fb8a6] px-4 py-2 disabled:opacity-50">Add 1 to Instamart cart — price unverified</button>}
      </div>)}
      {task.catalogue?.items?.map(item => <div key={item.id} className="rounded-xl border border-[#292929] p-4">
        <strong>{item.name}</strong>
        <p className="text-sm text-[#a0a0a0]">Available at the last check. Price and delivered total not verified.{item.needsCustomization ? ' Options must be confirmed before any cart preparation.' : ''}</p>
      </div>)}
    </section>}
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
