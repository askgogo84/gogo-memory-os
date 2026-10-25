'use client'
import Link from 'next/link'
import { use, useEffect, useState } from 'react'
import type { ActivityObservation } from '@/lib/openui/activity-observation'
import { safeActivityProviderUrl } from '@/lib/openui/activity-observation'
import { OpenUIActivityResults } from '@/components/dashboard/openui-activity-results'

// Fail closed on unexpected HTTP 200s. The API already binds the read to the
// authenticated owner, but client navigation must also bind rendered evidence
// to the exact current saved-record ID.
function isCurrentActivityRead(value: unknown, id: string): value is ActivityObservation {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<ActivityObservation>
  return record.id === id &&
    typeof record.service === 'string' && record.service.trim().length > 0 &&
    typeof record.notice === 'string' &&
    ['checking', 'discovered', 'unverified'].includes(String(record.status)) &&
    (record.location === null || typeof record.location === 'string') &&
    (record.requestedTime === null || typeof record.requestedTime === 'string') &&
    (record.observedAt === null || (
      typeof record.observedAt === 'string' && Number.isFinite(Date.parse(record.observedAt))
    )) &&
    Array.isArray(record.venues) && record.venues.length <= 8 &&
    record.venues.every(venue => {
      if (!venue || typeof venue !== 'object' ||
          typeof venue.title !== 'string' || !venue.title.trim() ||
          typeof venue.provider !== 'string' || typeof venue.sourceUrl !== 'string' ||
          typeof venue.observedAt !== 'string' || !Number.isFinite(Date.parse(venue.observedAt))) return false
      const source = safeActivityProviderUrl(venue.sourceUrl)
      return source === venue.sourceUrl &&
        venue.provider === new URL(source).hostname.replace(/^www\./, '')
    })
}

export default function ActivityResultsPage({ params }: { params: Promise<{id: string}> }) {
  const { id } = use(params)
  const [data, setData] = useState<ActivityObservation | null>(null)
  const [error, setError] = useState<{ id: string; message: string } | null>(null)
  useEffect(() => {
    let active = true
    let busy = false
    setData(null)
    setError(null)
    const refresh = async () => {
      // The previous request must finish before a poll may start; late responses
      // from a previous route must never be displayed under a new route.
      if (busy || (typeof document !== 'undefined' && document.hidden)) return
      busy = true
      try {
        const response = await fetch('/api/openui/activities/' + encodeURIComponent(id), {
          cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.timeout(12000),
        })
        if (!response.ok) throw new Error(
          response.status === 401 ? 'Sign in to see your activity research.'
          : response.status === 404 ? 'No sports venue research was found for this account.'
          : 'Saved activity evidence is temporarily unavailable.'
        )
        const result: unknown = await response.json()
        if (!isCurrentActivityRead(result, id)) {
          throw new Error('Saved activity evidence was incomplete. Recheck this record.')
        }
        if (active) { setData(result); setError(null) }
      } catch (e) {
        if (active) {
          setData(null)
          setError({ id, message: e instanceof Error ? e.message : 'Unable to load activity research.' })
        }
      } finally { busy = false }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 30000)
    return () => { active = false; clearInterval(timer) }
  }, [id])

  // React effects run after the route renders. Never flash a previous saved
  // record or its private provider cards during the navigation frame.
  const visibleData = data?.id === id ? data : null
  const visibleError = error?.id === id ? error.message : ''
  return <main className="mx-auto w-full max-w-[760px] space-y-4 pb-10">
    <Link href="/dashboard/activity" className="text-[14px] font-semibold text-[#2fb8a6]">← Activity</Link>
    <h1 className="font-serif text-[27px] text-[#f2efea]">Sports activity discovery</h1>
    {visibleError && <p role="alert" className="rounded-xl border border-[#665230] p-4 text-[#e2b04a]">{visibleError}</p>}
    {!visibleData && !visibleError && <p role="status" className="text-[15px] text-[#b4b4b0]">Loading your saved provider discovery…</p>}
    {visibleData && <OpenUIActivityResults data={visibleData} />}
  </main>
}
