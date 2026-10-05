'use client'

import {useState} from 'react'
import {useRouter} from 'next/navigation'

export function RestoreBrowserHandoffButton({runId}: {runId: string}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function restore() {
    setBusy(true)
    setError('')
    try {
      const response = await fetch(`/api/dashboard/agent/runs/${encodeURIComponent(runId)}/restore-handoff`, {method: 'POST'})
      if (!response.ok) throw new Error('The browser could not be restored yet. Your saved task is unchanged; try again later.')
      router.refresh()
    } catch (cause) {
      setError(String((cause as Error).message))
    } finally { setBusy(false) }
  }
  return <div>
    <button type="button" disabled={busy} onClick={restore}
      className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-[11px] bg-[#2FB8A6] px-4 text-[13px] font-bold text-[#0B0B0B] disabled:opacity-60">
      {busy ? 'Restoring secure browser…' : 'Restore secure browser'}
    </button>
    {error && <p role="alert" className="mt-2 text-[12px] text-[#D9A441]">{error}</p>}
  </div>
}
