
'use client'

import { useEffect, useRef, useState } from 'react'

type Device = { id: string; device_name: string | null; approved_at: string | null; expires_at: string | null }
type Review = { id: string; device_name: string; scope: 'ask:read' }
type Pairing = { code: string; qr?: string }

const handoffKey = 'askgogo.tvPairing'
const signIn = '/dashboard?next=%2Ftv%2Fpair'

function readPairing(): Pairing | null {
  const match = /^#([A-Za-z0-9_-]{22})\.([0-9A-HJKMNP-TV-Z]{8})$/.exec(window.location.hash)
  let pairing: Pairing | null = match ? { code: match[2], qr: match[1] } : null
  try {
    const saved = sessionStorage.getItem(handoffKey)
    sessionStorage.removeItem(handoffKey)
    if (!pairing && saved) {
      const { expires, value } = JSON.parse(saved)
      if (Date.now() < expires) pairing = value
    }
  } catch { /* The manual code remains available when browser storage is blocked. */ }
  if (match) history.replaceState(history.state, '', window.location.pathname)
  return pairing
}

const formattedCode = (code: string) => code.toUpperCase().replace(/[ -]/g, '').replace(/^(.{4})(.+)$/, '$1-$2')
const action = 'rounded-lg border px-4 py-3 font-medium focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50'

export default function PairTv() {
  const started = useRef(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const [devices, setDevices] = useState<Device[]>([])
  const [pairing, setPairing] = useState<Pairing>({ code: '' })
  const [review, setReview] = useState<Review | null>(null)
  const [busy, setBusy] = useState(true)
  const [signedIn, setSignedIn] = useState<boolean | null>(null)
  const [pairingEnabled, setPairingEnabled] = useState(false)
  const [message, setMessage] = useState('Checking your account…')
  const [approvedId, setApprovedId] = useState<string | null>(null)
  const waitingId = approvedId ?? devices.find(device => !device.approved_at)?.id ?? null

  async function load() {
    const response = await fetch('/api/tv/account', { cache: 'no-store' })
    if (response.status === 401) {
      setSignedIn(false)
      setDevices([])
      setMessage('Sign in to AskGogo to approve your TV.')
      return false
    }
    if (!response.ok) throw Error()
    const body = await response.json()
    setSignedIn(true)
    setDevices(body.devices)
    setPairingEnabled(body.pairingEnabled)
    setMessage(body.pairingEnabled ? '' : 'New TV pairing is disabled.')
    return body.pairingEnabled === true
  }

  async function update(body: Record<string, string>) {
    setBusy(true)
    setMessage(body.action === 'review' ? 'Looking up your TV…' : 'Saving your choice…')
    try {
      const response = await fetch('/api/tv/account', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      if (response.status === 401) {
        setSignedIn(false)
        setDevices([])
        setReview(null)
        setMessage('Sign in to AskGogo to continue.')
      } else if (response.status === 400 || response.status === 409) {
        setReview(null)
        setMessage('This code could not be used. Check the TV screen for a current code, or try again in a few minutes.')
      } else if (!response.ok) {
        setMessage('TV pairing is temporarily unavailable. Try again.')
      } else if (body.action === 'review') {
        const result = await response.json()
        setReview(result.pairing)
        setMessage('')
      } else {
        setReview(null)
        if (body.action !== 'revoke') setPairing({ code: '' })
        if (body.action === 'approve') setApprovedId(body.id)
        if (body.action === 'revoke' && body.id === approvedId) setApprovedId(null)
        await load()
        setMessage(body.action === 'approve' ? 'TV approved. Waiting for AskGogo to open on your TV.'
          : body.action === 'deny' ? 'Pairing declined.' : 'TV access revoked.')
      }
    } catch {
      setMessage('Could not confirm the request. Refresh to check your connected TVs.')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (started.current) return
    started.current = true
    const initial = readPairing()
    if (initial) setPairing(initial)
    void (async () => {
      try {
        if (await load() && initial) await update({ action: 'review', ...initial })
      } catch {
        setMessage('TV pairing is temporarily unavailable. Refresh to try again.')
      } finally {
        setBusy(false)
      }
    })()
  }, [])

  useEffect(() => {
    if (review) heading.current?.focus()
  }, [review])

  useEffect(() => {
    if (!waitingId || busy) return
    const controller = new AbortController()
    const deadline = Date.now() + 300_000
    let timer: ReturnType<typeof setTimeout>

    async function refreshConnection() {
      try {
        const response = await fetch('/api/tv/account', { cache: 'no-store', signal: controller.signal })
        if (controller.signal.aborted) return
        if (response.status === 401) {
          setSignedIn(false)
          setDevices([])
          setApprovedId(null)
          setMessage('Sign in to AskGogo to check your TV.')
          return
        }
        if (response.ok) {
          const { devices: next }: { devices: Device[] } = await response.json()
          if (controller.signal.aborted) return
          setDevices(next)
          const current = next.find(device => device.id === waitingId)
          if (!current || current.approved_at) {
            setApprovedId(null)
            setMessage(current ? 'TV connected. AskGogo is ready on your TV.'
              : 'This pairing ended. Open AskGogo on your TV for a fresh code.')
            return
          }
        }
      } catch {
        if (controller.signal.aborted) return
      }
      if (Date.now() < deadline) {
        timer = setTimeout(refreshConnection, 3000)
      } else {
        setDevices(previous => previous.filter(device => device.id !== waitingId))
        setApprovedId(null)
        setMessage('The TV connection could not be confirmed. Check the TV for a current code.')
      }
    }

    timer = setTimeout(refreshConnection, 2500)
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [waitingId, busy])

  function rememberForSignIn() {
    if (!pairing.code) return
    try {
      sessionStorage.setItem(handoffKey, JSON.stringify({ value: pairing, expires: Date.now() + 300_000 }))
    } catch { /* Users can rescan after signing in. */ }
  }

  return (
    <main className="mx-auto grid max-w-lg gap-6 px-5 py-8">
      <h1 className="text-3xl font-semibold">Pair Gogo TV</h1>
      <p aria-live="polite" role="status">{message}</p>
      {signedIn === false && <a href={signIn} onClick={rememberForSignIn} className={action}>Sign in to AskGogo</a>}
      {signedIn && pairingEnabled && (review ? (
        <section className="grid gap-4 rounded-xl border p-5" aria-labelledby="tv-review">
          <h2 id="tv-review" ref={heading} tabIndex={-1} className="text-xl font-semibold">{review.device_name}</h2>
          <p>Only approve if you can see the TV and its screen shows <strong>{formattedCode(pairing.code)}</strong>.</p>
          <p>This TV can ask questions, read your calendar and matching saved facts, and transcribe recordings you choose to send.</p>
          <p>Account access is read-only. You can revoke it here at any time.</p>
          <div className="grid grid-cols-2 gap-3">
            <button className={action} disabled={busy}
              onClick={() => void update({ action: 'deny', id: review.id, ...pairing })}>Decline</button>
            <button className={action} disabled={busy}
              onClick={() => void update({ action: 'approve', id: review.id, ...pairing })}>Approve this TV</button>
          </div>
        </section>
      ) : !waitingId && (
        <form className="grid gap-3" onSubmit={event => {
          event.preventDefault()
          if (!busy) void update({ action: 'review', ...pairing })
        }}>
          <label htmlFor="tv-code">Code shown on your TV</label>
          <input id="tv-code" value={pairing.code} onChange={event => setPairing({ code: event.target.value })}
            autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={12} required className="rounded-lg border px-4 py-3" />
          <button type="submit" disabled={busy} className={action}>Review TV access</button>
        </form>
      ))}
      {devices.length > 0 && <section className="grid gap-3">
        <h2 className="text-xl font-semibold">TV access</h2>
        {devices.map(device => <div key={device.id} className="rounded-xl border p-4">
          <p className="font-medium">{device.device_name ?? 'Android TV'} · {device.id.slice(0, 8)}</p>
          <p>{device.expires_at ? `Expires ${new Date(device.expires_at).toLocaleString()}` : 'Waiting for the TV to connect'}</p>
          <button disabled={busy} className="mt-2 underline" onClick={() => void update({ action: 'revoke', id: device.id })}>
            Revoke access
          </button>
        </div>)}
      </section>}
    </main>
  )
}
