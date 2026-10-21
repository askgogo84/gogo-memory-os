'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

export function UnlockForm({ mode, who }: { mode: 'unlock' | 'setup' | 'wait'; who: string }) {
  const router = useRouter()
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  if (mode === 'wait') return (
    <div><h1>Admin password</h1><p className="lede">Signed in as {who}. The owner hasn't set the admin password yet. Ask them to open the console first.</p></div>
  )

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    if (mode === 'setup' && pw !== pw2) { setErr("The two passwords don't match."); return }
    setBusy(true)
    const res = await fetch('/api/admin/console/unlock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(mode === 'setup' ? { newPassword: pw } : { password: pw }) })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    if (data.ok) { router.replace('/admin'); router.refresh(); return }
    if (data.error === 'locked') setErr('Too many wrong tries. The console is locked for 15 minutes.')
    else if (data.error === 'wrong_password') setErr(`That password didn't match. ${data.triesLeft} ${data.triesLeft === 1 ? 'try' : 'tries'} left before a 15-minute lock.`)
    else if (data.error === 'password_too_short') setErr('Use at least 10 characters.')
    else setErr("That didn't work. Try again.")
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div>
        <h1>{mode === 'setup' ? 'Set the admin password' : 'Admin password'}</h1>
        <p className="lede">Signed in as {who}. {mode === 'setup' ? 'Choose the password every admin will enter after signing in with their number. At least 10 characters.' : 'This console is limited to admin numbers, and each visit needs the admin password as a second check.'}</p>
      </div>
      <div>
        <label className="lbl" htmlFor="pw">{mode === 'setup' ? 'New password' : 'Password'}</label>
        <input id="pw" className="field" style={{ width: '100%', fontSize: 16 }} type="password" autoComplete={mode === 'setup' ? 'new-password' : 'current-password'} value={pw} onChange={e => setPw(e.target.value)} required />
      </div>
      {mode === 'setup' ? (
        <div>
          <label className="lbl" htmlFor="pw2">Type it again</label>
          <input id="pw2" className="field" style={{ width: '100%', fontSize: 16 }} type="password" autoComplete="new-password" value={pw2} onChange={e => setPw2(e.target.value)} required />
        </div>
      ) : null}
      {err ? <div role="alert" className="banner bad">{err}</div> : null}
      <button className="btn solid lg" type="submit" disabled={busy || !pw}>{busy ? 'Checking…' : mode === 'setup' ? 'Save and open console' : 'Open console'}</button>
      <p className="note">Stays unlocked for 12 hours on this device.</p>
    </form>
  )
}
