'use client'

import { useEffect, useState } from 'react'

type Status = 'loading' | 'idle' | 'saving' | 'saved' | 'error'

function formatTime(value: string) {
  const [hh, mm] = String(value || '08:00').split(':')
  const h = Number(hh || 8)
  const m = Number(mm || 0)
  const suffix = h >= 12 ? 'PM' : 'AM'
  const hour = h % 12 || 12
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`
}

export function DailyBriefEmail() {
  const [email, setEmail] = useState('')
  const [enabled, setEnabled] = useState(false)
  const [briefingTime, setBriefingTime] = useState('08:00')
  const [status, setStatus] = useState<Status>('loading')
  const [message, setMessage] = useState('')

  useEffect(() => {
    fetch('/api/dashboard/daily-brief-email', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        if (!data?.ok) throw new Error('failed')
        setEmail(String(data.email || ''))
        setEnabled(Boolean(data.enabled))
        setBriefingTime(String(data.briefingTime || '08:00'))
        setStatus('idle')
      })
      .catch(() => setStatus('error'))
  }, [])

  async function enable(e: React.FormEvent) {
    e.preventDefault()
    if (status === 'saving') return
    setStatus('saving')
    setMessage('')
    try {
      const response = await fetch('/api/dashboard/daily-brief-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data?.ok) {
        setStatus('error')
        setMessage(data?.error || 'Couldn’t save that preference. Try again.')
        return
      }
      setEmail(String(data.email || email))
      setEnabled(true)
      setStatus('saved')
      setMessage(`Daily Brief email is on for ${formatTime(briefingTime)}.`)
    } catch {
      setStatus('error')
      setMessage('Couldn’t save that preference. Try again.')
    }
  }

  async function disable() {
    if (status === 'saving') return
    setStatus('saving')
    setMessage('')
    try {
      const response = await fetch('/api/dashboard/daily-brief-email', { method: 'DELETE' })
      if (!response.ok) throw new Error('failed')
      setEnabled(false)
      setStatus('idle')
      setMessage('Daily Brief email is off. Your WhatsApp briefing is unchanged.')
    } catch {
      setStatus('error')
      setMessage('Couldn’t update that preference. Try again.')
    }
  }

  return (
    <section className="rounded-[28px] border border-gogo-ink/8 bg-gogo-surface/80 p-6 shadow-[0_18px_50px_rgba(62,35,18,0.04)] backdrop-blur-xl">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-xl">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-[15px] bg-gogo-plum/10 text-xl">☀️</span>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-gogo-plum">Daily Brief email</p>
              <h2 className="mt-0.5 font-serif text-[25px] font-semibold text-gogo-ink">Wake up to the day already organised</h2>
            </div>
          </div>
          <p className="mt-4 text-[13px] leading-6 text-gogo-ink-2">
            A personalized morning email built from your AskGogo calendar, reminders, travel and the same Daily Brief data you use on WhatsApp.
          </p>
          <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-gogo-ink/8 bg-gogo-cream/55 px-3 py-2 text-[11.5px] text-gogo-ink-2">
            <span className="h-2 w-2 rounded-full bg-gogo-orange" />
            Scheduled for {formatTime(briefingTime)} IST
          </div>
          <p className="mt-2 text-[11.5px] leading-5 text-gogo-ink-3">
            To change the time, tell Gogo on WhatsApp: “set my briefing to 7:30 AM”. Email and WhatsApp can be switched on independently.
          </p>
        </div>

        <form onSubmit={enable} className="w-full lg:max-w-[430px]">
          <label htmlFor="daily-brief-email" className="text-[11px] font-bold uppercase tracking-[0.1em] text-gogo-ink-3">Send Daily Brief to</label>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <input
              id="daily-brief-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              disabled={status === 'loading' || status === 'saving'}
              className="min-w-0 flex-1 rounded-[15px] border border-gogo-ink/10 bg-gogo-cream/50 px-4 py-3 text-[14px] text-gogo-ink outline-none transition focus:border-gogo-orange disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={status === 'loading' || status === 'saving' || !email.trim()}
              className="shrink-0 rounded-[15px] bg-gogo-ink px-4 py-3 text-[12.5px] font-bold text-white transition hover:opacity-90 disabled:opacity-45"
            >
              {status === 'saving' ? 'Saving…' : enabled ? 'Update email' : 'Email my Daily Brief'}
            </button>
          </div>
          <div className="mt-3 flex min-h-5 flex-wrap items-center justify-between gap-2">
            <div className={`text-[11.5px] ${status === 'error' ? 'text-red-600' : enabled ? 'font-semibold text-emerald-600' : 'text-gogo-ink-3'}`}>
              {message || (status === 'loading' ? 'Checking your preference…' : enabled ? 'Daily Brief email is on.' : 'Daily Brief email is off.')}
            </div>
            {enabled && (
              <button type="button" onClick={disable} disabled={status === 'saving'} className="text-[11.5px] font-semibold text-gogo-ink-3 underline decoration-gogo-ink/20 underline-offset-4 hover:text-gogo-ink">
                Turn off email brief
              </button>
            )}
          </div>
        </form>
      </div>
    </section>
  )
}
