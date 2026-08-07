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

type Phase = 'checking' | 'redeeming' | 'error' | 'no-token'

export default function Dashboard() {
  const [phase, setPhase] = useState<Phase>('checking')

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
          window.location.replace('/dashboard/reminders')
        } else {
          setPhase('error')
        }
      })
      .catch(() => setPhase('error'))
  }, [])

  const shell = (children: React.ReactNode) => (
    <main
      style={{
        fontFamily: 'system-ui',
        maxWidth: 480,
        margin: '0 auto',
        padding: '64px 24px',
        textAlign: 'center',
      }}
    >
      {children}
    </main>
  )

  if (phase === 'redeeming' || phase === 'checking') {
    return shell(<p style={{ color: '#666', fontSize: 15 }}>Signing you in…</p>)
  }

  const heading = phase === 'error' ? 'That link has expired.' : 'Your dashboard is here.'
  const body =
    phase === 'error'
      ? 'Dashboard links work once and last 15 minutes. Send AskGogo another to get a fresh one.'
      : 'Message AskGogo on WhatsApp and send it to get your private link.'

  return shell(
    <>
      <h1 style={{ fontSize: 24, margin: '0 0 12px' }}>{heading}</h1>
      <p style={{ color: '#666', fontSize: 15, lineHeight: 1.6, margin: '0 0 28px' }}>
        {body} Send <strong>dashboard</strong>.
      </p>
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
