'use client'

// Wajo-style narration under a chat reply: a live line while Gogo works ("Reading the latest Zomato Instagram
// posts…"), then "Completed 6 steps" that opens the list. Built only from the task's real steps.
import { useEffect, useRef, useState } from 'react'
import { Companion } from '@/components/gogo/companion'
import { liveStepLine, stateForStepTool, type RunSteps } from '@/lib/dashboard/run-steps-shared'

const POLL_MS = 2500
const MAX_POLL_MS = 20 * 60_000

function currentStep(data: RunSteps) {
  return data.steps.find(s => s.status === 'running') || data.steps.find(s => s.status === 'pending') || null
}

export function RunStepsLine({ runId, since, fallback }: { runId?: string | null; since?: string; fallback?: string }) {
  const [data, setData] = useState<RunSteps | null>(null)
  const [open, setOpen] = useState(false)
  const started = useRef(Date.now())

  useEffect(() => {
    if (!runId && !since) return
    let live = true
    let timer: ReturnType<typeof setTimeout> | null = null
    const url = runId ? `/api/agent/runs/${encodeURIComponent(runId)}/steps` : `/api/agent/runs/live?since=${encodeURIComponent(String(since))}`
    const tick = async () => {
      try {
        const res = await fetch(url, { cache: 'no-store' })
        const body = res.ok ? await res.json() : null
        const next: RunSteps | null = runId ? body : body?.run || null
        if (!live) return
        if (next) setData(next)
        if (next?.done) return
      } catch {}
      if (live && Date.now() - started.current < MAX_POLL_MS) timer = setTimeout(tick, POLL_MS)
    }
    void tick()
    return () => { live = false; if (timer) clearTimeout(timer) }
  }, [runId, since])

  if (!data || !data.steps.length) {
    return fallback ? <div className="flex items-center gap-3"><Companion state="thinking" size={36}/><span className="text-[16px] text-[#b4b4b0]">{fallback}<span className="animate-pulse">…</span></span></div> : null
  }
  const step = currentStep(data)
  if (!data.done && step) {
    const line = liveStepLine(step.title)
    const [verb, ...rest] = line.split(' ')
    return <div className="flex items-center gap-3" aria-live="polite">
      <Companion state={stateForStepTool(step.tool)} size={36}/>
      <span className="text-[16px] text-[#b4b4b0]"><span className="font-medium text-[#f2efea]">{verb}</span> {rest.join(' ')}<span className="animate-pulse">…</span></span>
    </div>
  }
  const finished = data.steps.filter(s => s.status === 'completed').length
  const label = data.done ? `Completed ${finished} step${finished === 1 ? '' : 's'}` : `${finished} of ${data.steps.length} steps done`
  return <div className="flex flex-col gap-2">
    <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="flex min-h-10 w-fit items-center gap-1.5 text-[14px] font-medium text-[#a8a8a4] hover:text-[#f2efea]">
      {label}
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true" className={open ? 'rotate-180' : ''}><path d="M6 9l6 6 6-6"/></svg>
    </button>
    {open && <ol className="flex flex-col gap-2 border-l border-[#222] pl-4">
      {data.steps.map((s, i) => <li key={i} className="flex items-start gap-2 text-[14px] leading-snug text-[#b4b4b0]">
        <span aria-hidden="true" className={s.status === 'completed' ? 'text-[#2fb8a6]' : 'text-[#a8a8a4]'}>{s.status === 'completed' ? '✓' : s.status === 'failed' ? '!' : '·'}</span>
        <span>{s.title}{s.status === 'failed' ? ' — did not finish' : s.status === 'skipped' ? ' — skipped' : ''}</span>
      </li>)}
    </ol>}
  </div>
}
