'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import {
  buildSearchObservationModel, sortSearchObservations,
  type SavedComparisonRead, type SearchObservationCard, type SearchSort,
} from '@/lib/openui/search-observation'

function checkedLabel(value: string | null) {
  if (!value) return 'Observation time unavailable'
  return 'Observed ' + new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date(value)) + ' IST'
}

function stateLabel(card: SearchObservationCard) {
  if (card.state === 'observed' && card.sourceUrl) return 'Product page observed'
  if (card.state === 'observed') return 'Evidence incomplete'
  if (card.state === 'checking') return 'Checking retailer'
  if (card.state === 'pending') return 'Waiting for check'
  if (card.state === 'blocked') return card.handoffPath ? 'Needs your browser' : 'Access restricted'
  return 'Not verified'
}

function reviewHref(subject: string, card: SearchObservationCard) {
  // Chat only pre-fills the input; the person must press Send. No provider mutation.
  const message = 'Read-only: recheck the exact ' + subject.slice(0,100) + ' listing on ' + card.label +
    (card.sourceUrl ? ' at ' + card.sourceUrl : '') +
    '. Verify its variant, current listed price and source timestamp. Do not add to cart, book or pay.'
  return '/dashboard/chat?prompt=' + encodeURIComponent(message.slice(0,800))
}

export function OpenUISearchResults({
  data, compact = false, fullHref,
}: {
  data: SavedComparisonRead
  compact?: boolean
  fullHref?: string
}) {
  const model = useMemo(()=>buildSearchObservationModel(data),[data])
  const [sort, setSort] = useState<SearchSort>('source')
  const [observedOnly,setObservedOnly] = useState(false)
  const rows = useMemo(()=>sortSearchObservations(model.items, sort, observedOnly),[model,sort,observedOnly])
  const shown = compact ? rows.slice(0,4) : rows
  return <section aria-label={'Interactive search for '+model.subject} className="w-full min-w-0 rounded-[18px] border border-[#33413f] bg-[#121a1b] p-3.5 text-[#f1f3ef] sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <div className="text-[11px] font-bold uppercase tracking-[.12em] text-[#7be4d1]">Interactive search · observed sources</div>
        <h2 className="mt-1 break-words text-[18px] font-bold leading-snug">{model.subject||'Price comparison'}</h2>
        <div className="mt-1 text-[12px] text-[#a8b8b5]">{model.observedCount} source observations · {model.pricedCount} extractable listed prices</div>
      </div>
      {fullHref && <Link href={fullHref} className="rounded-xl border border-[#465c55] px-3 py-2 text-[12px] font-semibold text-[#a4f4df]">Full report</Link>}
    </div>

    <div className="mt-4 flex flex-wrap items-center gap-2">
      <label className="flex min-h-11 flex-1 items-center gap-2 rounded-xl border border-[#40504c] px-3 text-[12px] text-[#dce9e4]">
        <input type="checkbox" checked={observedOnly} onChange={e=>setObservedOnly(e.target.checked)} className="accent-[#73ddcb]"/>
        Source-observed only
      </label>
      <label className="flex min-h-11 items-center gap-2 rounded-xl border border-[#40504c] px-3 text-[12px] text-[#dce9e4]">
        <span>Sort</span>
        <select aria-label="Sort search observations" value={sort} onChange={e=>setSort(e.target.value as SearchSort)}
          className="max-w-[134px] bg-transparent text-[12px] text-[#f1f3ef] outline-none">
          <option value="source" className="bg-[#182321]">Evidence first</option>
          <option value="price" className="bg-[#182321]">Listed price</option>
          <option value="recent" className="bg-[#182321]">Newest check</option>
          <option value="name" className="bg-[#182321]">Retailer A–Z</option>
        </select>
      </label>
    </div>

    <div className="mt-3 grid gap-3">
      {shown.map(card=><article key={card.id} className="min-w-0 rounded-[15px] border border-[#374744] bg-[#1c2828] p-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-semibold text-[#91dfcb]">{card.label}</div>
            <h3 className="mt-1 line-clamp-2 break-words text-[15px] font-semibold leading-snug">{card.title||model.subject}</h3>
            <p className="mt-1 text-[12px] text-[#b4c0bc]">{stateLabel(card)}</p>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-[17px] font-bold tabular-nums">{card.observedPrice||'—'}</div>
            <div className="max-w-[115px] text-[11px] leading-tight text-[#a6b3ad]">{card.observedPrice?'Observed listed price':'Price not verified'}</div>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-[#a6b5af]">{checkedLabel(card.checkedAt)}</p>
        {card.fee&&<p className="mt-1 text-[12px] text-[#d7c29b]">Additional page-listed fee: {card.fee}</p>}
        {card.reason&&<p className="mt-2 text-[12px] leading-[1.45] text-[#d2b789]">{card.reason}</p>}
        {card.evidence&&<details className="mt-3 rounded-xl border border-[#3a4a46] bg-[#182321] p-2.5 text-[12px]">
          <summary className="cursor-pointer font-semibold text-[#dcebe5]">View observed page evidence</summary>
          <p className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap break-words text-[#bdcec7]">{card.evidence}</p>
        </details>}
        <div className="mt-3 flex flex-wrap gap-2">
          {card.sourceUrl&&<a href={card.sourceUrl} target="_blank" rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center rounded-xl border border-[#4b665e] px-3 text-[12px] font-semibold text-[#a8ebda]">Open source ↗</a>}
          {card.handoffPath&&<Link href={card.handoffPath}
            className="inline-flex min-h-11 items-center rounded-xl border border-[#8c7148] px-3 text-[12px] font-semibold text-[#f2d8a9]">Resume browser check</Link>}
          <Link href={reviewHref(model.subject,card)} className="inline-flex min-h-11 items-center rounded-xl bg-[#7be4d1] px-3 text-[12px] font-bold text-[#0d2924]">Recheck in Chat</Link>
        </div>
      </article>)}
      {!shown.length&&<div className="rounded-xl border border-dashed border-[#455a53] p-5 text-center text-[13px] text-[#c0d1ca]">
        {observedOnly?'No source-observed results yet. Remove the filter to see pending or blocked checks.':'No provider observations are available yet.'}
      </div>}
    </div>

    {compact&&rows.length>shown.length&&fullHref&&<Link href={fullHref} className="mt-3 block text-center text-[13px] font-semibold text-[#8de8d2]">View all {rows.length} store checks</Link>}
    <p className="mt-3 text-[11px] leading-[1.55] text-[#b3c0bb]">
      Page observations are not live inventory or delivered-total quotes. Prices, availability, fees and offers can change. Opening a source or rechecking does not buy, book, pay, reserve or change an account.
    </p>
  </section>
}
