'use client'

import { useEffect, useState } from 'react'

// ── Why this redeemer is a CLIENT-SIDE POST — and must stay one ────────────────
// The magic link (…/dashboard?t=<token>) is delivered over WhatsApp. WhatsApp's
// link-preview crawler FETCHES every URL it finds in a message — a plain GET.
// A GET route handler (or a server-component redeem) would run against that
// crawler fetch and BURN the single-use token before the user ever taps the
// link, so every dashboard link would arrive already "expired".
//
// The crawler does not execute JavaScript. Redeeming from a client-side POST in
// useEffect is therefore invisible to it and safe. DO NOT "simplify" this into a
// GET route handler or a server-side redeem — that reintroduces the burn.

const WA_DASHBOARD_LINK = 'https://wa.me/15797006612?text=dashboard'
const CREAM = '#fbf6ef'

type Phase = 'checking' | 'redeeming' | 'error' | 'no-token'

export default function Dashboard() {
  const [phase, setPhase] = useState<Phase>('checking')
  const [code, setCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [codeError, setCodeError] = useState(false)

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('t')
    if (!token) {
      setPhase('no-token')
      return
    }
    setPhase('redeeming')
    fetch('/api/dashboard/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then((res) => {
        if (res.ok) {
          // Land on the app and drop ?t= from history in one replace, so the
          // token never lingers in the URL bar or back-stack.
          window.location.replace('/dashboard/today')
        } else {
          setPhase('error')
        }
      })
      .catch(() => setPhase('error'))
  }, [])

  // Typed-code redeem. Same route, same generic-failure contract: any non-ok
  // response is shown as one message — we never say wrong vs expired vs used.
  // The code is sent as typed (with or without hyphen); the server normalises.
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
        if (res.ok) {
          window.location.replace('/dashboard/today')
        } else {
          setCodeError(true)
          setSubmitting(false)
        }
      })
      .catch(() => {
        setCodeError(true)
        setSubmitting(false)
      })
  }

  // Full-bleed cream fills the viewport at every width; the card floats centred
  // on top. At 375px the card is full-width with the same 24px gutters and 64px
  // top offset as before, so mobile is pixel-identical. On wider/taller screens
  // the cream now reaches the edges and the card centres vertically.
  const shell = (children: React.ReactNode) => (
    <main
      style={{
        fontFamily: 'system-ui',
        background: CREAM,
        minHeight: '100vh',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        padding: '64px 24px',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 420,
          textAlign: 'center',
        }}
      >
        {children}
      </div>
    </main>
  )

  if (phase === 'redeeming' || phase === 'checking') {
    return shell(<p style={{ color: '#666', fontSize: 15 }}>Signing you in…</p>)
  }

  const heading = phase === 'error' ? 'That link has expired.' : 'Your dashboard is here.'
  const body =
    phase === 'error'
      ? 'Dashboard links work once and last 15 minutes. Enter the code AskGogo sent, or ask for a fresh one.'
      : 'Message AskGogo on WhatsApp to get your private link and code.'

  return shell(
    <>
      <h1 style={{ fontSize: 24, margin: '0 0 12px' }}>{heading}</h1>
      <p style={{ color: '#666', fontSize: 15, lineHeight: 1.6, margin: '0 0 28px' }}>
        {body} Send <strong>dashboard</strong>.
      </p>

      <form onSubmit={submitCode} style={{ margin: '0 0 28px' }}>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoComplete="one-time-code"
          inputMode="text"
          autoCapitalize="characters"
          placeholder="Enter your code"
          aria-label="Dashboard code"
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: '14px 16px',
            fontSize: 17,
            letterSpacing: 2,
            textAlign: 'center',
            borderRadius: 12,
            border: '1px solid #ddd6cc',
            background: '#fff',
            marginBottom: 12,
          }}
        />
        <button
          type="submit"
          disabled={submitting || !code.trim()}
          style={{
            width: '100%',
            padding: '14px 16px',
            fontSize: 15,
            fontWeight: 600,
            color: '#fff',
            background: '#1c1c1c',
            border: 'none',
            borderRadius: 100,
            cursor: submitting || !code.trim() ? 'default' : 'pointer',
            opacity: submitting || !code.trim() ? 0.5 : 1,
          }}
        >
          {submitting ? 'Checking…' : 'Open dashboard'}
        </button>
        {codeError && (
          <p style={{ color: '#a33', fontSize: 14, margin: '12px 0 0' }}>
            That code didn't work. It may be wrong, expired, or already used — ask AskGogo for a fresh one.
          </p>
        )}
      </form>

      <a
        href={WA_DASHBOARD_LINK}
        style={{
          display: 'inline-block',
          background: '#25D366',
          color: '#fff',
          padding: '12px 24px',
          borderRadius: 100,
          fontSize: 15,
          fontWeight: 600,
          textDecoration: 'none',
        }}
      >
        Open WhatsApp →
      </a>
    </>,
  )
}
