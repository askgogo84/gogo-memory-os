'use client'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import type { ActivityObservation, ActivityVenue } from '@/lib/openui/activity-observation'

const venuePrompt = (data: ActivityObservation, venue?: ActivityVenue) => {
  const prompt = 'Read-only: check current ' + data.service + ' slots' +
    (venue ? ' at ' + venue.title : '') +
    (data.location ? ' in ' + data.location : '') +
    (data.requestedTime ? ' around ' + data.requestedTime : '') +
    '. Verify the exact date, duration, full price, terms and availability on the provider. Do not book, reserve, submit, send, pay or change any account.'
  return '/dashboard/chat?prompt=' + encodeURIComponent(prompt.slice(0, 650))
}
const observedTime = (v: string | null) => v && Number.isFinite(Date.parse(v))
  ? new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(v)) + ' IST'
  : 'Not established'

export function OpenUIActivityResults({ data }: { data: ActivityObservation }) {
  const [sort, setSort] = useState<'name'|'provider'>('name')
  const [selected, setSelected] = useState('all')
  const providers = useMemo(() => [...new Set(data.venues.map(v => v.provider))].sort(), [data.venues])
  const venues = useMemo(() => data.venues.filter(v => selected === 'all' || v.provider === selected)
    .sort((a,b) => sort === 'name' ? a.title.localeCompare(b.title) : a.provider.localeCompare(b.provider) || a.title.localeCompare(b.title)),
    [data.venues, selected, sort])

  return <section aria-label="Recorded sports venue discovery" className="rounded-[18px] border border-[#24433e] bg-[#141414] p-4 text-[#f2efea] sm:p-5">
    <p className="text-[12px] font-bold uppercase tracking-[.1em] text-[#4cd0bd]">Interactive activity research · read-only</p>
    <h2 className="mt-2 text-[22px] font-bold">{data.service}</h2>
    <p className="mt-1 text-[14px] text-[#b4b4b0]">{data.location || 'Location not established'}{data.requestedTime ? ' · Asked: ' + data.requestedTime : ''}</p>
    <div className="mt-3 rounded-xl border border-[#665230] bg-[#1a1710] p-3">
      <p className="text-[13px] font-semibold text-[#e2b04a]">Provider discovery only · not a booking or live availability check</p>
      <p className="mt-1 text-[13px] leading-[1.5] text-[#c4c4c0]">{data.notice}</p>
      <p className="mt-2 text-[12px] text-[#a8a8a4]">Public-web search recorded: {observedTime(data.observedAt)}</p>
      <p className="mt-1 text-[12px] text-[#a8a8a4]">No checked prices, inventory, date-specific slots or provider confirmation are available in these saved results.</p>
    </div>
    {data.status === 'checking' && <p role="status" className="mt-4 text-[14px] text-[#c4c4c0]">Research has not produced a verified source card. Refresh for its saved outcome.</p>}
    {data.status === 'unverified' && <p role="status" className="mt-4 text-[14px] text-[#c4c4c0]">No source-backed venue cards yet.</p>}
    {data.venues.length > 0 && <>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <label className="text-[12px] text-[#c4c4c0]">Sort
          <select aria-label="Sort sports venues" value={sort} onChange={e => setSort(e.target.value as 'name'|'provider')}
            className="ml-2 min-h-11 rounded-lg border border-[#2f2f2f] bg-[#151515] px-2 text-[#f2efea]">
            <option value="name">Venue</option><option value="provider">Provider</option>
          </select>
        </label>
        <label className="text-[12px] text-[#c4c4c0]">Provider
          <select aria-label="Filter sports provider" value={selected} onChange={e => setSelected(e.target.value)}
            className="ml-2 min-h-11 max-w-[180px] rounded-lg border border-[#2f2f2f] bg-[#151515] px-2 text-[#f2efea]">
            <option value="all">All providers</option>
            {providers.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {venues.map(v => <article key={v.sourceUrl} className="rounded-xl border border-[#2f2f2f] bg-[#151515] p-4">
          <p className="text-[12px] text-[#8be6d8]">{v.provider} · public-web result</p>
          <h3 className="mt-1 text-[16px] font-bold">{v.title}</h3>
          <p className="mt-2 text-[12px] leading-[1.5] text-[#a8a8a4]">Listed on {observedTime(v.observedAt)}. No slot, price or ticket has been independently verified.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a href={v.sourceUrl} target="_blank" rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center rounded-xl border border-[#24433e] px-3 text-[13px] font-semibold text-[#8be6d8]">
              Open provider page ↗
            </a>
            <Link href={venuePrompt(data, v)}
              className="inline-flex min-h-11 items-center rounded-xl border border-[#2f2f2f] px-3 text-[13px] text-[#f2efea]">
              Recheck in Chat
            </Link>
          </div>
        </article>)}
      </div>
    </>}
    <div className="mt-4 flex flex-wrap gap-2">
      <Link href={venuePrompt(data)} className="inline-flex min-h-11 items-center rounded-xl bg-[#efe6d7] px-4 text-[13px] font-bold text-[#0b0b0b]">Recheck current availability</Link>
      <Link href={'/dashboard/activity/' + encodeURIComponent(data.id)} className="inline-flex min-h-11 items-center rounded-xl border border-[#2f2f2f] px-4 text-[13px] text-[#c4c4c0]">Task history</Link>
    </div>
    <p className="mt-3 text-[12px] leading-[1.55] text-[#a8a8a4]">A provider link is not a confirmed booking. Chat links prefill a question but do not send it. Any eventual reservation, ticket purchase or payment requires the normal exact-action approval and verified provider receipt.</p>
  </section>
}
