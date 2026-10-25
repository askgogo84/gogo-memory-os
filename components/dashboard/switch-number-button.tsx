'use client'

// Signs out and returns to sign-in, keeping the page the person was trying to open (a result link from chat).
import { useState } from 'react'

export function SwitchNumberButton() {
  const [busy, setBusy] = useState(false)
  async function go() {
    if (busy) return
    setBusy(true)
    const here = window.location.pathname
    try { await fetch('/api/dashboard/session', { method: 'DELETE' }) } catch {}
    window.location.replace('/dashboard' + (/^\/dashboard\/reports\/[0-9a-f-]{36}$/i.test(here) ? '?next=' + encodeURIComponent(here) : ''))
  }
  return <button type="button" onClick={go} disabled={busy}
    className="mt-5 inline-flex min-h-11 items-center rounded-xl border border-[#2A2A2A] px-4 text-[16px] text-[#F2EFEA] hover:border-[#2FB8A6] disabled:opacity-50">
    {busy ? 'Signing out…' : 'Sign in with another number'}
  </button>
}
