'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { postAction, errorText } from './admin-client'

const TIERS: [string, string][] = [['free', 'Free'], ['starter', 'Starter'], ['pro', 'Pro'], ['founder_pro', 'Founder Pro']]
export function PlanForm({ telegramId, tier }: { telegramId: string; tier: string }) {
  const router = useRouter()
  const [value, setValue] = useState(tier)
  const [msg, setMsg] = useState('')
  const [pending, start] = useTransition()
  return (
    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <label className="sr" htmlFor="plan">Plan</label>
      <select id="plan" className="field" value={value} onChange={e => setValue(e.target.value)}>{TIERS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      <button type="button" className="btn lg" disabled={pending || value === tier} onClick={() => start(async () => { const r = await postAction('user.plan', { telegramId, tier: value }); setMsg(r.ok ? 'Plan changed.' : errorText(r.error)); if (r.ok) router.refresh() })}>Change plan</button>
      {msg ? <span role="status" style={{ fontSize: 13, color: 'var(--ink2)' }}>{msg}</span> : null}
    </span>
  )
}
