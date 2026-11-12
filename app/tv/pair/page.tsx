'use client'

import { useEffect, useState } from 'react'

type Device = { id: string; approved_at: string; expires_at: string }

export default function PairTv() {
  const [devices, setDevices] = useState<Device[]>([])
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [signedIn, setSignedIn] = useState(false)
  const [pairingEnabled, setPairingEnabled] = useState(false)
  const [message, setMessage] = useState('Checking your account…')

  async function load() {
    const response = await fetch('/api/tv/account', { cache: 'no-store' })
    setSignedIn(response.ok)
    if (response.status === 401) {
      setMessage('Sign in on your phone with your AskGogo WhatsApp code, then return to this page.')
      return
    }
    if (!response.ok) throw Error()
    const body = await response.json()
    setDevices(body.devices)
    setPairingEnabled(body.pairingEnabled)
    setMessage(body.pairingEnabled ? '' : 'New TV pairing is disabled.')
  }

  useEffect(() => {
    void load().catch(() => setMessage('TV pairing is temporarily unavailable.'))
  }, [])

  async function update(body: Record<string, string>) {
    setBusy(true)
    try {
      const response = await fetch('/api/tv/account', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      if (!response.ok) {
        setMessage(response.status === 409 ? 'Check the TV code, its expiry, and your active TV pairings.' : 'The request could not be completed.')
        return
      }
      setCode('')
      await load()
      setMessage(body.action === 'approve' ? 'TV approved. Select Check pairing on the TV.' : 'TV access revoked.')
    } catch {
      setMessage('The request could not be completed. Refresh to check its status.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto max-w-xl p-6">
      <h1 className="text-3xl font-semibold">Gogo TV</h1>
      <p className="my-4">Pair a TV you can see and control. An unlocked TV profile can show your calendar and matching saved facts.</p>
      {!signedIn && <a href="/dashboard" className="underline">Open AskGogo sign-in</a>}
      {signedIn && pairingEnabled && <form className="my-6 grid gap-3" onSubmit={event => {
        event.preventDefault()
        if (!busy) void update({ action: 'approve', code })
      }}>
        <label htmlFor="tv-code">Pairing code on your TV</label>
        <input id="tv-code" value={code} onChange={event => setCode(event.target.value)} autoComplete="off"
          autoCapitalize="characters" maxLength={32} required className="rounded border p-2" />
        <button type="submit" disabled={busy} className="rounded border p-2">Approve TV</button>
      </form>}
      <p aria-live="polite" className="my-4">{message}</p>
      {devices.length > 0 && <section className="grid gap-3">
        <h2 className="text-xl">Active TV pairings</h2>
        {devices.map(device => <div key={device.id} className="rounded border p-3">
          <p>TV {device.id.slice(0, 8)} · paired {new Date(device.approved_at).toLocaleString()}</p>
          <p>Expires {new Date(device.expires_at).toLocaleString()}</p>
          <button disabled={busy} className="underline" onClick={() => void update({ action: 'revoke', id: device.id })}>
            Revoke TV access
          </button>
        </div>)}
      </section>}
    </main>
  )
}
