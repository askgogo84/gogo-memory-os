'use client'

import { useEffect, useState } from 'react'

type Status = 'loading' | 'idle' | 'saving' | 'saved' | 'error'

export function EmailPreferences() {
  const [email, setEmail] = useState('')
  const [enabled, setEnabled] = useState(false)
  const [status, setStatus] = useState<Status>('loading')
  const [message, setMessage] = useState('')

  useEffect(() => {
    fetch('/api/dashboard/email-preferences', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        if (data?.ok) {
          setEmail(String(data.email || ''))
          setEnabled(Boolean(data.enabled))
          setStatus('idle')
        } else {
          setStatus('error')
        }
      })
      .catch(() => setStatus('error'))
  }, [])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (status === 'saving') return
    setStatus('saving')
    setMessage('')

    try {
      const response = await fetch('/api/dashboard/email-preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data?.ok) {
        setStatus('error')
        setMessage(data?.error || 'Couldn’t save that email. Try again.')
        return
      }
      setEmail(String(data.email || email))
      setEnabled(true)
      setStatus('saved')
      setMessage('Gogo Tips are on. Your first email will start the 30-day sequence.')
    } catch {
      setStatus('error')
      setMessage('Couldn’t save that email. Try again.')
    }
  }

  async function pause() {
    if (status === 'saving') return
    setStatus('saving')
    setMessage('')
    try {
      const response = await fetch('/api/dashboard/email-preferences', { method: 'DELETE' })
      if (!response.ok) throw new Error('failed')
      setEnabled(false)
      setStatus('idle')
      setMessage('Gogo Tips are paused. WhatsApp reminders and product messages are unchanged.')
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
            <span className="grid h-11 w-11 place-items-center rounded-[15px] bg-gogo-orange-tint text-xl">✉️</span>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-gogo-orange">Gogo Tips</p>
              <h2 className="mt-0.5 font-serif text-[25px] font-semibold text-gogo-ink">A useful idea, one at a time</h2>
            </div>
          </div>
          <p className="mt-4 text-[13px] leading-6 text-gogo-ink-2">
            Get one short AskGogo idea a day for your first month — reminders, documents, lists, travel, memory, dashboard shortcuts and more. Original AskGogo guidance, not generic marketing.
          </p>
          <p className="mt-2 text-[11.5px] leading-5 text-gogo-ink-3">
            This is optional. You can pause it here or unsubscribe from any email. We do not enrol your connected Gmail address automatically.
          </p>
          <a href="/api/dashboard/email-preview?day=0" target="_blank" rel="noreferrer" className="mt-3 inline-flex text-[12px] font-bold text-gogo-plum no-underline hover:text-gogo-plum-deep">
            Preview the first Gogo Tip →
          </a>
        </div>

        <form onSubmit={save} className="w-full lg:max-w-[430px]">
          <label htmlFor="gogo-tips-email" className="text-[11px] font-bold uppercase tracking-[0.1em] text-gogo-ink-3">Email address</label>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <input
              id="gogo-tips-email"
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
              className="shrink-0 rounded-[15px] bg-gogo-orange px-4 py-3 text-[12.5px] font-bold text-white transition hover:bg-gogo-orange-deep disabled:opacity-45"
            >
              {status === 'saving' ? 'Saving…' : enabled ? 'Update email' : 'Send me Gogo Tips'}
            </button>
          </div>

          <div className="mt-3 flex min-h-5 flex-wrap items-center justify-between gap-2">
            <div className={`text-[11.5px] ${status === 'error' ? 'text-red-600' : enabled ? 'font-semibold text-emerald-600' : 'text-gogo-ink-3'}`}>
              {message || (status === 'loading' ? 'Checking your preference…' : enabled ? 'Gogo Tips are on.' : 'No lifecycle emails are being sent.')}
            </div>
            {enabled && (
              <button type="button" onClick={pause} disabled={status === 'saving'} className="text-[11.5px] font-semibold text-gogo-ink-3 underline decoration-gogo-ink/20 underline-offset-4 hover:text-gogo-ink">
                Pause emails
              </button>
            )}
          </div>
        </form>
      </div>
    </section>
  )
}
