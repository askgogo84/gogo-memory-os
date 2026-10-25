'use client'
import Link from 'next/link'
import { use, useEffect, useState } from 'react'
import type { ActivityObservation } from '@/lib/openui/activity-observation'
import { OpenUIActivityResults } from '@/components/dashboard/openui-activity-results'

export default function ActivityResultsPage({ params }: { params: Promise<{id: string}> }) {
  const { id } = use(params)
  const [data, setData] = useState<ActivityObservation | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    const refresh = async () => {
      if (typeof document !== 'undefined' && document.hidden) return
      try {
        const response = await fetch('/api/openui/activities/' + encodeURIComponent(id), {
          cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.timeout(12000),
        })
        if (!response.ok) throw new Error(
          response.status === 401 ? 'Sign in to see your activity research.'
          : response.status === 404 ? 'No sports venue research was found for this account.'
          : 'Saved activity evidence is temporarily unavailable.'
        )
        const result = await response.json() as ActivityObservation
        if (active) { setData(result); setError('') }
      } catch (e) {
        if (active) { setData(null); setError(e instanceof Error ? e.message : 'Unable to load activity research.') }
      }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 30000)
    return () => { active = false; clearInterval(timer) }
  }, [id])
  return <main className="mx-auto w-full max-w-[760px] space-y-4 pb-10">
    <Link href="/dashboard/activity" className="text-[14px] font-semibold text-[#2fb8a6]">← Activity</Link>
    <h1 className="font-serif text-[27px] text-[#f2efea]">Sports activity discovery</h1>
    {error && <p role="alert" className="rounded-xl border border-[#665230] p-4 text-[#e2b04a]">{error}</p>}
    {!data && !error && <p role="status" className="text-[15px] text-[#b4b4b0]">Loading your saved provider discovery…</p>}
    {data && <OpenUIActivityResults data={data} />}
  </main>
}
