'use client'

// Duet parity step 2 (approved 22 Oct mock, screen 5): what you hear about and how often.
import { useState } from 'react'
import { ALERT_TOPICS, CHECK_EVERY_OPTIONS, TOPIC_LABEL, type AlertPreferences, type AlertTopic } from '@/lib/agent/alert-preferences-shared'

type Brief = { enabled: boolean; time: string }
const HOURS = Array.from({ length: 24 }, (_, h) => h)
const BRIEF_TIMES = Array.from({ length: 14 }, (_, i) => { const m = 5 * 60 + i * 30; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${m % 60 ? '30' : '00'}` })
const clock = (h: number, m = 0) => new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 0, 1, h, m)))
const briefLabel = (t: string) => clock(Number(t.slice(0, 2)), Number(t.slice(3, 5)))

export function AlertSettings({ initial, initialBrief }: { initial: AlertPreferences; initialBrief: Brief }) {
  const [prefs, setPrefs] = useState(initial)
  const [brief, setBrief] = useState(initialBrief)
  const [state, setState] = useState<'' | 'saving' | 'saved' | 'error' | 'not_ready'>('')
  const set = (next: Partial<AlertPreferences>) => { setPrefs(p => ({ ...p, ...next })); setState('') }
  const toggle = (t: AlertTopic) => set({ topics: { ...prefs.topics, [t]: !prefs.topics[t] } })
  const awakeHours = prefs.quietStart === prefs.quietEnd ? 24 : (prefs.quietStart - prefs.quietEnd + 24) % 24
  const perDay = Math.max(1, Math.floor((awakeHours * 60) / prefs.checkEveryMinutes))

  async function save() {
    setState('saving')
    try {
      const res = await fetch('/api/agent/alert-preferences', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ checkEveryMinutes: prefs.checkEveryMinutes, topics: prefs.topics, quietStart: prefs.quietStart, quietEnd: prefs.quietEnd, brief }),
      })
      if (res.status === 503) { setState('not_ready'); return }
      setState(res.ok ? 'saved' : 'error')
    } catch { setState('error') }
  }

  const section = 'text-[12px] font-semibold uppercase tracking-[.06em] text-[#8a8a86]'
  const card = 'rounded-[16px] border border-[#222] bg-[#121212]'
  return <div className="flex flex-col gap-6">
    <section className="flex flex-col gap-2">
      <h2 className={section}>Morning brief</h2>
      <div className={`${card} flex flex-wrap items-center justify-between gap-3 px-4 py-3`}>
        <label className="flex min-h-11 items-center gap-3 text-[15px] text-[#f2efea]">
          <input type="checkbox" checked={brief.enabled} onChange={e => { setBrief(b => ({ ...b, enabled: e.target.checked })); setState('') }} className="h-5 w-5 accent-[#2fb8a6]"/>
          Send me a morning brief
        </label>
        <label className="flex items-center gap-2 text-[14px] text-[#9a9a96]">
          at
          <select value={brief.time} disabled={!brief.enabled} onChange={e => { setBrief(b => ({ ...b, time: e.target.value })); setState('') }}
            className="min-h-11 rounded-[10px] border border-[#262626] bg-[#151515] px-2 text-[15px] text-[#f2efea] disabled:opacity-50">
            {(BRIEF_TIMES.includes(initialBrief.time) ? BRIEF_TIMES : [initialBrief.time, ...BRIEF_TIMES]).map(t => <option key={t} value={t}>{briefLabel(t)}</option>)}
          </select>
        </label>
      </div>
    </section>

    <section className="flex flex-col gap-2">
      <h2 className={section} id="freq-label">How often Gogo checks your apps</h2>
      <div role="radiogroup" aria-labelledby="freq-label" className="grid grid-cols-4 gap-1 rounded-[14px] border border-[#222] bg-[#151515] p-1">
        {CHECK_EVERY_OPTIONS.map(m => {
          const on = prefs.checkEveryMinutes === m
          return <button key={m} type="button" role="radio" aria-checked={on} onClick={() => set({ checkEveryMinutes: m })}
            className={`min-h-11 rounded-[10px] text-[14px] font-medium ${on ? 'bg-[#232323] text-[#f2efea]' : 'text-[#9a9a96] hover:text-[#f2efea]'}`}>{m / 60} h</button>
        })}
      </div>
      <p className="text-[13px] text-[#9a9a96]">At most about {perDay} update{perDay === 1 ? '' : 's'} a day outside quiet hours. Approvals you’re waiting on always come through.</p>
    </section>

    <section className="flex flex-col gap-2">
      <h2 className={section}>Tell me about</h2>
      <div className={`${card} flex flex-col`}>
        {ALERT_TOPICS.map((t, i) => <label key={t} className={`flex min-h-14 items-center gap-3 px-4 py-2.5 ${i ? 'border-t border-[#1f1f1f]' : ''}`}>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-[15px] text-[#f2efea]">{TOPIC_LABEL[t].label}</span>
            <span className="text-[12px] text-[#9a9a96]">{TOPIC_LABEL[t].sub}</span>
          </span>
          <input type="checkbox" checked={prefs.topics[t]} onChange={() => toggle(t)} className="h-5 w-5 shrink-0 accent-[#2fb8a6]"/>
        </label>)}
      </div>
      <p className="text-[13px] text-[#9a9a96]">Turned-off topics still show here in the app; they just don’t message you.</p>
    </section>

    <section className="flex flex-col gap-2">
      <h2 className={section}>Quiet hours</h2>
      <div className={`${card} flex flex-wrap items-center gap-3 px-4 py-3 text-[15px] text-[#f2efea]`}>
        <label className="flex items-center gap-2">From
          <select value={prefs.quietStart} onChange={e => set({ quietStart: Number(e.target.value) })} className="min-h-11 rounded-[10px] border border-[#262626] bg-[#151515] px-2 text-[15px] text-[#f2efea]">
            {HOURS.map(h => <option key={h} value={h}>{clock(h)}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2">to
          <select value={prefs.quietEnd} onChange={e => set({ quietEnd: Number(e.target.value) })} className="min-h-11 rounded-[10px] border border-[#262626] bg-[#151515] px-2 text-[15px] text-[#f2efea]">
            {HOURS.map(h => <option key={h} value={h}>{clock(h)}</option>)}
          </select>
        </label>
      </div>
      <p className="text-[13px] text-[#9a9a96]">No background updates in this window. Price and travel alerts are not held back yet.</p>
    </section>

    <div className="flex flex-wrap items-center gap-3">
      <button type="button" onClick={save} disabled={state === 'saving'} className="min-h-12 rounded-full bg-[#2fb8a6] px-6 text-[15px] font-semibold text-[#04201c] disabled:opacity-50">{state === 'saving' ? 'Saving…' : 'Save'}</button>
      <span role="status" className="text-[14px]">
        {state === 'saved' && <span className="text-[#5fd3c3]">Saved.</span>}
        {state === 'error' && <span className="text-[#d9a441]">Couldn’t save. Try once more.</span>}
        {state === 'not_ready' && <span className="text-[#d9a441]">Settings are being switched on. Try again in a little while.</span>}
      </span>
    </div>
  </div>
}
