'use client'

// Choose your companion (Gogo crew, 12 Nov 2026). Saving refreshes the page so the shell, chat and panel all
// switch to the new character together.
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Crewmate } from '@/components/gogo/crewmate'
import { CREW_IDS, CREW_LOOKS, type CrewId } from '@/lib/gogo/crew'

export function CompanionPicker({ initial }: { initial: CrewId | null }) {
  const router = useRouter()
  const [picked, setPicked] = useState<CrewId>(initial || 'gogo')
  const [status, setStatus] = useState('')
  async function choose(id: CrewId) {
    if (id === picked) return
    const before = picked
    setPicked(id); setStatus('Saving…')
    try {
      const res = await fetch('/api/dashboard/experience', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ companion: id }) })
      if (!res.ok) throw new Error(String(res.status))
      setStatus(`${CREW_LOOKS[id].name} is your companion now.`)
      router.refresh()
    } catch {
      setPicked(before); setStatus('Couldn’t save that just now. Please try again.')
    }
  }
  return <section className="mt-5 final-dark-panel px-4 py-4" aria-labelledby="companion-title">
    <h2 id="companion-title" className="text-[15px] font-semibold text-[#ecebe8]">Your companion</h2>
    <p className="mt-1 text-[13px] text-[#8a8a86]">Who keeps you company across the dashboard. Move your pointer: they watch you.</p>
    <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
      {CREW_IDS.map(id => {
        const on = id === picked, look = CREW_LOOKS[id]
        return <button key={id} type="button" onClick={() => choose(id)} aria-pressed={on}
          className="flex min-h-[104px] flex-col items-center justify-center gap-1 rounded-[14px] border-2 bg-[#f6f1e8] p-2 text-[#3e2312] transition hover:-translate-y-px"
          style={{ borderColor: on ? look.dot : 'transparent', background: on ? look.wash : '#f6f1e8' }}>
          <Crewmate kind={id} mood="idle" size={60} label=""/>
          <span className="text-[13px] font-semibold">{look.name}</span>
        </button>
      })}
    </div>
    <p className="mt-2 min-h-[18px] text-[13px] text-[#8a8a86]" role="status" aria-live="polite">{status || CREW_LOOKS[picked].line}</p>
  </section>
}
