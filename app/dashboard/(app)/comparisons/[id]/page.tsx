'use client'

import {use, useEffect, useState} from 'react'
import Link from 'next/link'
import {COMPARISON_PROVIDERS, type ProviderObservation} from '@/lib/commerce/comparison-model'

type Report = {subject: string; request: string; status: string; updatedAt: string; providers: ProviderObservation[]}
export default function ComparisonPage({params}: {params: Promise<{id: string}>}) {
  const {id} = use(params)
  const [report, setReport] = useState<Report|null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    async function refresh() {
      try {
        const response = await fetch('/api/comparisons/' + encodeURIComponent(id), {cache: 'no-store'})
        if (!response.ok) throw new Error(response.status === 401 ? 'Sign in to AskGogo to view your private comparison.' : 'This comparison could not be loaded. Try refreshing.')
        const body = await response.json()
        if (active) { setReport(body); setError('') }
      } catch (err) { if (active) setError(err instanceof Error ? err.message : 'Unable to load comparison.') }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 15000)
    return () => { active = false; clearInterval(timer) }
  }, [id])
  return <main className="mx-auto max-w-3xl space-y-6 pb-12">
    <Link href="/dashboard/chat" className="text-sm text-[#2fb8a6]">← Back to Gogo</Link>
    <p className="text-xs uppercase tracking-widest text-[#a0a0a0]">Your saved comparison</p>
    <h1 className="text-3xl font-medium">{report?.subject || 'Price comparison'}</h1>
    {error && <p role="alert">{error}</p>}
    {!report && !error && <p role="status">Loading your comparison…</p>}
    {report && <>
      <p role="status" className="text-sm text-[#a0a0a0]">{report.status === 'queued' ? 'Store checks are in progress. Results appear here as each check finishes.' : report.status === 'completed' ? 'Store checks finished. Review the observations and limits below.' : 'Checks finished with gaps. Available observations are saved below.'}</p>
      <details className="rounded-2xl border border-white/10 p-4"><summary>Your request and criteria</summary><p className="mt-3 whitespace-pre-wrap text-sm">{report.request}</p></details>
      {report.providers.map(row => <section key={row.provider} className="space-y-3 rounded-2xl border border-white/10 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-xl">{COMPARISON_PROVIDERS[row.provider].label}</h2><span className="text-sm text-[#a0a0a0]">{row.status === 'observed' ? 'Page evidence found' : row.status === 'blocked' ? (row.needsInput ? 'Needs your input' : 'Access limited') : row.status === 'failed' ? 'Not verified' : row.status === 'checking' ? 'Checking' : 'Queued'}</span></div>
        {row.checkedAt && <p className="text-xs text-[#a0a0a0]">Checked {new Date(row.checkedAt).toLocaleString('en-IN', {timeZone: 'Asia/Kolkata'})} IST</p>}
        {row.evidence && <><p className="text-xs text-[#a0a0a0]">Observed on the provider page</p><blockquote className="whitespace-pre-wrap break-words text-sm leading-6">{row.evidence}</blockquote></>}
        {row.reason && <p className="text-sm">{row.reason}</p>}
        {row.sourceUrl && <a href={row.sourceUrl} target="_blank" rel="noopener noreferrer" className="block text-[#2fb8a6]">Open {COMPARISON_PROVIDERS[row.provider].label} product page ↗</a>}
        {row.runId && <Link href={'/dashboard/activity/' + row.runId + '/browser'} className="block text-sm text-[#a0a0a0]">{row.needsInput ? 'Continue this same browser task →' : 'View this store check →'}</Link>}
      </section>)}
      <section className="space-y-2 rounded-2xl border border-white/10 p-5 text-sm text-[#a0a0a0]"><h2 className="font-medium text-white">What this comparison establishes</h2><p>These are dated page observations, not a verified delivered-total ranking. A listed price can change with your delivery location. Cart, bank and membership discounts are conditional. Missing stock, seller, warranty or delivery fees remain unknown.</p><p>No cart changes or purchases are made by these checks. Retailer links open on your device; app opening depends on the retailer and your phone settings.</p></section>
    </>}
  </main>
}
