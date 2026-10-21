'use client'
// Small client pieces shared by console pages: posting an action and refreshing the page.
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

export async function postAction(action: string, body: Record<string, unknown> = {}) {
  const res = await fetch('/api/admin/console/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...body }) })
  const data = await res.json().catch(() => ({ ok: false, error: 'bad_response' }))
  return data as { ok: boolean; message?: string; error?: string; detail?: any }
}

export const ERROR_TEXT: Record<string, string> = {
  not_allowed_for_your_role: 'Your admin role cannot do this.', password: 'Your console session ended. Enter the password again.',
  cannot_block_yourself: "You can't block your own number.", nothing_selected: 'Select at least one row.', password_too_short: 'Use at least 10 characters.',
  password_set_in_vercel_env: 'The password is set in Vercel (ADMIN_CONSOLE_PASSWORD_HASH). Change it there.',
}
export const errorText = (e?: string) => (e && ERROR_TEXT[e]) || `That didn't work (${e || 'error'}).`

export function ActionButton({ action, body, label, className = 'btn sm', confirm, done }: { action: string; body?: Record<string, unknown>; label: string; className?: string; confirm?: string; done?: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState('')
  const [armed, setArmed] = useState(false)
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <button type="button" className={className} disabled={pending} onClick={() => {
        // Two-step confirm without a browser dialog: the first tap arms, the second does it.
        if (confirm && !armed) { setArmed(true); setMsg(confirm); return }
        setArmed(false)
        start(async () => {
          const r = await postAction(action, body)
          setMsg(r.ok ? (done || r.message || 'Done.') : errorText(r.error))
          if (r.ok) router.refresh()
        })
      }}>{pending ? 'Working…' : armed ? 'Tap again to confirm' : label}</button>
      {msg ? <span role="status" style={{ fontSize: 13, color: 'var(--ink2)' }}>{msg}</span> : null}
    </span>
  )
}

export function LockButton() {
  const router = useRouter()
  return <button type="button" className="btn sm" onClick={async () => { await fetch('/api/admin/console/lock', { method: 'POST' }); router.push('/admin/unlock') }}>Lock console</button>
}
