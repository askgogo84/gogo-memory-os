'use client'

import {use, useEffect, useState} from 'react'
import Link from 'next/link'
import {COMPARISON_PROVIDERS, comparisonHandoffPath, type ProviderObservation} from '@/lib/commerce/comparison-model'
import {OpenUISearchResults} from '@/components/dashboard/openui-search-results'

type Report = {subject: string; request: string; status: string; updatedAt: string; providers: ProviderObservation[]}
export default function ComparisonPage({params}: {params: Promise<{id: string}>}) {
  const {id} = use(params)
  const [report, setReport] = useState<Report|null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    let busy = false
    // A route/account change must not show observations from the previous request.
    setReport(null)
    setError('')
    async function refresh() {
      if (busy || (typeof document !== 'undefined' && document.hidden)) return
      busy = true
      try {
        const response = await fetch('/api/comparisons/' + encodeURIComponent(id), {
          credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(12000),
        })
        if (!response.ok) throw new Error(response.status === 401 ? 'Sign in to AskGogo to view your private comparison.' : 'This comparison could not be loaded. Try refreshing.')
        const body = await response.json()
        if (!body || !Array.isArray(body.providers)) throw new Error('Saved comparison evidence was incomplete. Try refreshing.')
        if (active) { setReport(body as Report); setError('') }
      } catch (err) {
        // 401, network loss and invalid responses all revoke displayed saved evidence.
        if (active) {
          setReport(null)
          setError(err instanceof Error ? err.message : 'Unable to load comparison.')
        }
      } finally { busy = false }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 15000)
    return () => { active = false; clearInterval(timer) }
  }, [id])
  return <main className="mx-auto max-w-3xl space-y-6 pb-12">
    <Link href="/dashboard/chat" className="text-[16px] text-[#2fb8a6]">← Back to Gogo</Link>
    <p className="text-[14px] uppercase tracking-widest text-[#a0a0a0]">Your saved comparison</p>
    <h1 className="text-3xl font-medium">{report?.subject || 'Price comparison'}</h1>
    {error && <p role="alert">{error}</p>}
    {!report && !error && <p role="status">Loading your comparison…</p>}
    {report && <>
      <p role="status" className="text-[16px] text-[#a0a0a0]">{report.providers.some(row => comparisonHandoffPath(row)) ? 'Some store checks are waiting for your browser task. Continue it below.' : report.status === 'queued' ? 'Store checks are in progress. Results appear here as each check finishes.' : report.status === 'completed' ? 'Store checks finished. Review the observations and limits below.' : 'Checks finished with gaps. Available observations are saved below.'}</p>
      <details className="rounded-2xl border border-white/10 p-4"><summary>Your request and criteria</summary><p className="mt-3 whitespace-pre-wrap text-[16px]">{report.request}</p></details>
      <OpenUISearchResults data={report}/>
      <section className="space-y-2 rounded-2xl border border-white/10 p-5 text-[16px] text-[#a0a0a0]"><h2 className="font-medium text-white">What this comparison establishes</h2><p>These are dated page observations, not a verified delivered-total ranking. A listed price can change with your delivery location. Cart, bank and membership discounts are conditional. Missing stock, seller, warranty or delivery fees remain unknown.</p><p>No cart changes or purchases are made by these checks. Retailer links open on your device; app opening depends on the retailer and your phone settings.</p></section>
    </>}
  </main>
}
