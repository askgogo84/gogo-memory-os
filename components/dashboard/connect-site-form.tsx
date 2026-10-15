'use client'

import Link from 'next/link'
import { FormEvent, useState } from 'react'

type Method = 'phone_code' | 'password'

/** Save how to sign in to one site: a phone number (each sign-in asks you for the text code) or a password. */
export function ConnectSiteForm(props: { siteName: string; siteDomain: string; providerKey: string; usernameLabel: string; ask: string }) {
  const [method, setMethod] = useState<Method>('phone_code')
  const [phone, setPhone] = useState('')
  const [username, setUsername] = useState('')
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const back = props.ask ? `/dashboard/chat?ask=${encodeURIComponent(props.ask)}` : '/dashboard/settings?section=connections'

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true); setError('')
    try {
      const body = method === 'phone_code'
        ? { provider: props.providerKey, method, username: phone.trim(), accountLabel: props.siteName }
        : { provider: props.providerKey, method, username: username.trim(), secret, accountLabel: props.siteName }
      const res = await fetch('/api/dashboard/vault', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const data = await res.json().catch(() => ({}))
      if (res.status === 409) throw new Error('You already have a saved login for this site. Remove it in Settings, Connections first.')
      if (data?.error === 'invalid_phone') throw new Error('Enter the mobile number you use on ' + props.siteName + '.')
      if (!res.ok || !data?.ok) throw new Error('That did not save. Try again.')
      setSecret('')
      window.location.assign(back)
    } catch (err: any) { setError(String(err?.message || 'That did not save. Try again.')) } finally { setBusy(false) }
  }

  const option = (value: Method, label: string) => <button type="button" role="radio" aria-checked={method === value} onClick={() => setMethod(value)}
    className={`flex min-h-12 w-full items-center gap-3 rounded-[12px] px-3.5 text-left text-[15px] ${method === value ? 'bg-[#2a2a2a] font-semibold text-[#ecebe8]' : 'text-[#c4c4c0]'}`}>
    <span className={`h-[18px] w-[18px] shrink-0 rounded-full ${method === value ? 'border-[5px] border-[#ecebe8]' : 'border-2 border-[#8a8a86]'}`} aria-hidden="true" />{label}
  </button>
  const field = 'mt-2 block min-h-12 w-full rounded-full bg-[#1c1c1c] px-4 text-[16px] text-[#ecebe8] placeholder:text-[#8a8a86]'

  return <form onSubmit={submit} className="pt-2">
    <Link href={back} className="inline-flex min-h-10 items-center text-[15px] text-[#2fb8a6]">← {props.ask ? 'Back to chat' : 'Back to Settings'}</Link>
    <div className="mt-3 grid h-12 w-12 place-items-center rounded-[14px] bg-[#1c1c1c] text-[20px] font-bold text-[#ecebe8]" aria-hidden="true">{props.siteName[0]}</div>
    <h1 className="mt-4 text-[26px] font-bold leading-tight text-[#ecebe8]">Connect {props.siteName}</h1>
    <p className="mt-2 text-[15px] leading-6 text-[#a8a8a4]">Saved in your Gogo vault, sealed and locked to {props.siteDomain}. Gogo&apos;s AI never sees it, and it never goes through chat.</p>

    <div className="mt-6 text-[15px] font-semibold text-[#ecebe8]">How do you sign in to {props.siteName}?</div>
    <div role="radiogroup" aria-label="Sign-in method" className="mt-2.5 space-y-1 rounded-[16px] bg-[#141414] p-1.5">
      {option('phone_code', 'Phone number and a text code')}
      {option('password', 'Password')}
    </div>

    {method === 'phone_code' ? <div className="mt-5">
      <label className="block text-[15px] text-[#c4c4c0]">Mobile number
        <input value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" required placeholder="98765 43210" className={field} />
      </label>
      <p className="mt-2.5 text-[13px] leading-5 text-[#a8a8a4]">Nothing secret is saved. Each time {props.siteName} sends a code, Gogo asks you for it. The code is used once and never stored.</p>
    </div> : <div className="mt-5 space-y-4">
      <label className="block text-[15px] text-[#c4c4c0]">{props.usernameLabel}
        <input value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" required className={field} />
      </label>
      <label className="block text-[15px] text-[#c4c4c0]">Password
        <input value={secret} onChange={e => setSecret(e.target.value)} type="password" autoComplete="current-password" required className={field} />
      </label>
      <p className="text-[13px] leading-5 text-[#a8a8a4]">Encrypted in the vault and used only on {props.siteDomain}. Remove it any time in Settings, Connections.</p>
    </div>}

    {error && <p role="alert" className="mt-4 text-[14px] text-[#d96c5f]">{error}</p>}
    <button type="submit" disabled={busy} className="mt-6 min-h-[50px] w-full rounded-full bg-[#efe6d7] text-[16px] font-bold text-[#0b0b0b] disabled:opacity-60">{busy ? 'Saving…' : props.ask ? 'Save and continue' : 'Save'}</button>
  </form>
}
