'use client'

// Duet parity (23 Oct): the owner can cancel a task from its activity page, not only from chat. Two taps, never a
// browser confirm() dialog: Cancel task -> "Cancel this task? Nothing more will be done." -> Cancel task / Keep it.
import { useRouter } from 'next/navigation'
import { useState } from 'react'

type Phase = 'idle' | 'confirm' | 'busy' | 'done' | 'error'

export function CancelTaskButton({ runId }: { runId: string }) {
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>('idle')
  const [message, setMessage] = useState('')

  async function cancel() {
    if (phase === 'busy') return
    setPhase('busy'); setMessage('')
    try {
      const res = await fetch(`/api/agent/runs/${encodeURIComponent(runId)}/cancel`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: '{}',
      })
      const body = await res.json().catch(() => ({}))
      const text = String(body?.text || '').replace(/\*/g, '')
      if (!res.ok) { setPhase('error'); setMessage(text || 'Could not cancel this task. Nothing was changed.'); return }
      setPhase('done'); setMessage(text || 'Cancelled. Nothing further will run for it.')
      setTimeout(() => router.refresh(), 1500)
    } catch {
      setPhase('error'); setMessage('Could not reach Gogo. Nothing was changed. Try once more.')
    }
  }

  if (phase === 'done') return <p role="status" className="rounded-[12px] bg-[#161616] px-4 py-3 text-[15px] leading-5 text-[#F2EFEA]">{message}</p>

  return <div className="flex flex-col gap-2">
    {phase === 'idle' || phase === 'error' ? <button type="button" onClick={() => setPhase('confirm')}
      className="min-h-11 w-full rounded-[10px] border border-[#2A2A2A] bg-[#111111] px-4 text-[16px] font-bold text-[#F2EFEA] hover:border-[#6A6A6A] sm:w-auto">Cancel task</button>
    : <div role="group" aria-label="Confirm cancel" className="rounded-[12px] border border-[#2A2A2A] bg-[#161616] p-4">
      <p className="text-[16px] font-semibold leading-5 text-[#F2EFEA]">Cancel this task? Nothing more will be done.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={cancel} disabled={phase === 'busy'}
          className="min-h-11 flex-1 rounded-[10px] bg-[#D9A441] px-4 text-[16px] font-bold text-[#111111] disabled:opacity-50 sm:flex-none">{phase === 'busy' ? 'Cancelling…' : 'Cancel task'}</button>
        <button type="button" onClick={() => setPhase('idle')} disabled={phase === 'busy'}
          className="min-h-11 flex-1 rounded-[10px] border border-[#2A2A2A] bg-[#111111] px-4 text-[16px] font-bold text-[#F2EFEA] disabled:opacity-50 sm:flex-none">Keep it</button>
      </div>
    </div>}
    {phase === 'error' && message && <p role="alert" className="text-[14px] text-[#D9A441]">{message}</p>}
  </div>
}
