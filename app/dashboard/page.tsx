'use client'
// Preview redeploy marker: refreshes Vercel Preview env after OTP secret updates.

import { useEffect, useMemo, useState } from 'react'
import { waLink } from '@/lib/product-urls'

const WA_DASHBOARD_LINK = waLink('dashboard')
const DASHBOARD_HOME = '/dashboard/home'

type Phase = 'checking' | 'redeeming' | 'ready' | 'error'
type OtpStep = 'phone' | 'code'

export default function Dashboard() {
  const [phase, setPhase] = useState<Phase>('checking')
  const [code, setCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [codeError, setCodeError] = useState(false)

  const [otpStep, setOtpStep] = useState<OtpStep>('phone')
  const [phone, setPhone] = useState('+91 ')
  const [otp, setOtp] = useState('')
  const [challengeId, setChallengeId] = useState('')
  const [otpBusy, setOtpBusy] = useState(false)
  const [otpError, setOtpError] = useState('')
  const [otpInfo, setOtpInfo] = useState('')
  const [resendIn, setResendIn] = useState(0)

  const googleStatus = useMemo(() => {
    if (typeof window === 'undefined') return ''
    return new URLSearchParams(window.location.search).get('google') || ''
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const token = params.get('t')

    if (token) {
      setPhase('redeeming')
      fetch('/api/dashboard/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
        .then((res) => {
          if (res.ok) window.location.replace(DASHBOARD_HOME)
          else setPhase('error')
        })
        .catch(() => setPhase('error'))
      return
    }

    fetch('/api/dashboard/session/status', { cache: 'no-store' })
      .then((res) => res.json())
      .then((data) => {
        if (data?.ok) window.location.replace(DASHBOARD_HOME)
        else setPhase('ready')
      })
      .catch(() => setPhase('ready'))
  }, [])

  useEffect(() => {
    if (resendIn <= 0) return
    const timer = window.setInterval(() => setResendIn((value) => Math.max(0, value - 1)), 1000)
    return () => window.clearInterval(timer)
  }, [resendIn])

  const submitCode = (e: React.FormEvent) => {
    e.preventDefault()
    if (submitting || !code.trim()) return
    setSubmitting(true)
    setCodeError(false)
    fetch('/api/dashboard/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code.trim() }),
    })
      .then((res) => {
        if (res.ok) window.location.replace(DASHBOARD_HOME)
        else {
          setCodeError(true)
          setSubmitting(false)
        }
      })
      .catch(() => {
        setCodeError(true)
        setSubmitting(false)
      })
  }

  const requestOtp = async () => {
    if (otpBusy) return
    setOtpBusy(true)
    setOtpError('')
    setOtpInfo('')
    try {
      const res = await fetch('/api/dashboard/otp/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (res.status === 429) setOtpError(`Please wait ${data?.retryAfterSeconds || 30} seconds before requesting another code.`)
        else if (data?.reason === 'invalid') setOtpError('Enter a valid WhatsApp number, including the country code.')
        else setOtpError('I could not send the code right now. Please try again shortly.')
        return
      }
      setChallengeId(String(data.challengeId || ''))
      setOtpStep('code')
      setOtp('')
      setResendIn(Number(data.retryAfterSeconds || 30))
      setOtpInfo('If this number is linked to AskGogo, the 6-digit code is on its way in WhatsApp.')
    } finally {
      setOtpBusy(false)
    }
  }

  const verifyOtp = async (e: React.FormEvent) => {
    e.preventDefault()
    if (otpBusy || otp.replace(/\D/g, '').length !== 6 || !challengeId) return
    setOtpBusy(true)
    setOtpError('')
    try {
      const res = await fetch('/api/dashboard/otp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeId, otp }),
      })
      if (res.ok) {
        window.location.replace(DASHBOARD_HOME)
        return
      }
      setOtpError('That code is incorrect or has expired. Please try again or request a new code.')
    } catch {
      setOtpError('I could not verify the code. Please try again.')
    } finally {
      setOtpBusy(false)
    }
  }

  const resendOtp = async () => {
    if (resendIn > 0 || otpBusy) return
    setOtpStep('phone')
    setChallengeId('')
    setOtp('')
    await requestOtp()
  }

  if (phase === 'checking' || phase === 'redeeming') {
    return (
      <main className="min-h-screen bg-[#fbf6ef] text-[#3e2312] grid place-items-center px-6">
        <div className="text-center">
          <div className="mx-auto mb-4 h-11 w-11 rounded-2xl bg-[#f18219] text-white grid place-items-center text-xl">✦</div>
          <p className="text-sm text-[#9a8778]">Opening your AskGogo dashboard…</p>
        </div>
      </main>
    )
  }

  const googleMessage = googleStatus === 'unlinked'
    ? 'This Google account is not linked to AskGogo yet. Sign in once with your WhatsApp number, then connect Google from You.'
    : googleStatus === 'expired'
      ? 'That Google sign-in attempt expired. Please try again.'
      : googleStatus === 'already-linked'
        ? 'That Google account is already linked to another AskGogo profile.'
        : googleStatus === 'error'
          ? 'Google sign-in could not be completed. You can retry or use WhatsApp.'
          : ''

  return (
    <main className="min-h-screen bg-[#fbf6ef] text-[#3e2312] flex items-center justify-center px-6 py-12">
      <section className="w-full max-w-[1040px] overflow-hidden rounded-[34px] border border-[#eadfd3] bg-white shadow-[0_28px_90px_rgba(74,43,22,0.10)] grid md:grid-cols-[1.08fr_.92fr]">
        <div className="p-8 md:p-14 bg-[radial-gradient(circle_at_top_left,#fff3e4_0,#fbf6ef_48%,#f4ebe2_100%)]">
          <div className="inline-flex items-center gap-3 rounded-full border border-white/70 bg-white/80 px-4 py-2 shadow-sm">
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-[#f18219] text-white">✦</span>
            <span className="font-semibold">AskGogo</span>
          </div>

          <div className="mt-12 max-w-xl">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#714c77]">Your personal control center</p>
            <h1 className="mt-4 font-serif text-4xl md:text-6xl leading-[0.98] tracking-[-0.045em]">Everything AskGogo remembers, organised for you.</h1>
            <p className="mt-6 max-w-lg text-base md:text-lg leading-7 text-[#6b4a34]">Reminders, memory, calendar, lists and your saved files — one secure dashboard, still powered by WhatsApp.</p>
          </div>

          <div className="mt-10 grid gap-3 text-sm text-[#6b4a34] sm:grid-cols-3">
            <div className="rounded-2xl border border-white/80 bg-white/70 p-4"><strong className="block text-[#3e2312]">Memory</strong>Find saved notes and documents.</div>
            <div className="rounded-2xl border border-white/80 bg-white/70 p-4"><strong className="block text-[#3e2312]">Today</strong>Your reminders and calendar.</div>
            <div className="rounded-2xl border border-white/80 bg-white/70 p-4"><strong className="block text-[#3e2312]">Private</strong>Your session stays on this device.</div>
          </div>
        </div>

        <div className="p-8 md:p-14 flex flex-col justify-center">
          <p className="text-sm font-semibold text-[#714c77]">Welcome back</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-[-0.03em]">Open your calm space</h2>
          <p className="mt-2 text-sm leading-6 text-[#9a8778]">Use the WhatsApp number you already use with AskGogo. We’ll send a private 6-digit code.</p>

          {googleMessage && <div className="mt-5 rounded-2xl bg-[#fdf0e2] px-4 py-3 text-sm leading-5 text-[#6b4a34]">{googleMessage}</div>}
          {phase === 'error' && <div className="mt-5 rounded-2xl bg-[#fff1ee] px-4 py-3 text-sm text-[#8a3d31]">That old WhatsApp link has expired or was already used. Sign in with your number instead.</div>}

          <div className="mt-7 rounded-[24px] border border-[#eee5dc] bg-[#fffdfa] p-5">
            {otpStep === 'phone' ? (
              <div>
                <label className="text-xs font-semibold uppercase tracking-[0.12em] text-[#9a8778]">WhatsApp number</label>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+91 98765 43210"
                  inputMode="tel"
                  autoComplete="tel"
                  className="mt-2 w-full rounded-2xl border border-[#ddd6cc] bg-white px-4 py-3.5 text-base outline-none focus:border-[#25D366]"
                />
                <button onClick={requestOtp} disabled={otpBusy || phone.replace(/\D/g, '').length < 10} className="mt-3 w-full rounded-2xl bg-[#25D366] px-5 py-3.5 font-semibold text-white transition hover:brightness-95 disabled:opacity-40">
                  {otpBusy ? 'Sending…' : 'Send code on WhatsApp'}
                </button>
              </div>
            ) : (
              <form onSubmit={verifyOtp}>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#9a8778]">6-digit code</p>
                    <p className="mt-1 text-xs text-[#b09c8b]">Sent to {phone}</p>
                  </div>
                  <button type="button" onClick={() => { setOtpStep('phone'); setOtpError(''); setOtpInfo('') }} className="text-xs font-semibold text-[#714c77]">Change number</button>
                </div>
                <input
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  className="mt-4 w-full rounded-2xl border border-[#ddd6cc] bg-white px-4 py-3.5 text-center text-2xl tracking-[0.32em] outline-none focus:border-[#25D366]"
                />
                <button type="submit" disabled={otpBusy || otp.length !== 6} className="mt-3 w-full rounded-2xl bg-[#3e2312] px-5 py-3.5 font-semibold text-white disabled:opacity-40">
                  {otpBusy ? 'Checking…' : 'Verify & open dashboard'}
                </button>
                <button type="button" disabled={resendIn > 0 || otpBusy} onClick={resendOtp} className="mt-3 w-full text-xs font-semibold text-[#714c77] disabled:text-[#b8a797]">
                  {resendIn > 0 ? `Resend code in ${resendIn}s` : 'Resend code'}
                </button>
              </form>
            )}

            {otpInfo && <p className="mt-3 text-xs leading-5 text-[#6f7f67]">{otpInfo}</p>}
            {otpError && <p className="mt-3 text-xs leading-5 text-[#a14a3b]">{otpError}</p>}
          </div>

          <div className="my-6 flex items-center gap-3 text-xs uppercase tracking-[0.14em] text-[#b8a797]"><span className="h-px flex-1 bg-[#eee5dc]" />or<span className="h-px flex-1 bg-[#eee5dc]" /></div>

          <a href="/api/dashboard/google/start?mode=login" className="flex h-13 items-center justify-center gap-3 rounded-2xl border border-[#ded7cf] bg-white px-5 font-semibold text-[#3e2312] shadow-sm transition hover:bg-[#fffaf5]">
            <span className="grid h-7 w-7 place-items-center rounded-full border border-[#e6e0da] text-sm font-bold">G</span>
            Continue with Google
          </a>

          <details className="mt-5 rounded-2xl border border-[#eee5dc] bg-[#fffdfa] p-4">
            <summary className="cursor-pointer text-sm font-semibold">Other sign-in options</summary>
            <a href={WA_DASHBOARD_LINK} className="mt-4 flex h-11 items-center justify-center rounded-xl border border-[#dfe8df] bg-white px-4 text-sm font-semibold text-[#207c45]">Ask AskGogo for the old login link</a>
            <form onSubmit={submitCode} className="mt-4">
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="ABCD-EFGH" aria-label="Dashboard code" className="w-full rounded-xl border border-[#ddd6cc] bg-white px-4 py-3 text-center text-base tracking-[0.16em] outline-none focus:border-[#f18219]" />
              <button type="submit" disabled={submitting || !code.trim()} className="mt-3 w-full rounded-xl bg-[#6b4a34] px-4 py-3 text-sm font-semibold text-white disabled:opacity-40">{submitting ? 'Checking…' : 'Use existing dashboard code'}</button>
              {codeError && <p className="mt-3 text-xs leading-5 text-[#a14a3b]">That code did not work. Request a fresh WhatsApp code above.</p>}
            </form>
          </details>

          <p className="mt-6 text-xs leading-5 text-[#b8a797]">After you sign in, this browser stays signed in for up to 30 days unless you sign out.</p>
        </div>
      </section>
    </main>
  )
}
