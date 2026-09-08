'use client'

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'

const PLANS = {
  lite:  { key: 'lite',  name: 'Lite',  amount: 99,  color: '#16a34a', emoji: '🌱' },
  pro:   { key: 'pro',   name: 'Pro',   amount: 299, color: '#7c3aed', emoji: '🚀' },
  power: { key: 'power', name: 'Power', amount: 499, color: '#b45309', emoji: '⚡' },
} as const

type PlanKey = keyof typeof PLANS

function normalizePlan(value: string | null): PlanKey {
  const key = String(value || 'pro').toLowerCase().replace(/[\s-]+/g, '_')
  if (key === 'lite') return 'lite'
  if (key === 'power' || key === 'founder' || key === 'founder_pro') return 'power'
  return 'pro'
}

function PayContent() {
  const params = useSearchParams()
  const planKey = normalizePlan(params.get('plan'))
  const phoneParam = params.get('phone') || ''
  const plan = PLANS[planKey]
  const [phone, setPhone] = useState(phoneParam.replace(/^\+?91/, '').replace(/\D/g, '').slice(-10))
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [error, setError] = useState('')

  const handlePay = async () => {
    const digits = phone.replace(/\D/g, '')
    if (digits.length !== 10) {
      setError('Enter a valid 10-digit WhatsApp number')
      return
    }

    setStatus('loading')
    setError('')
    try {
      const res = await fetch('/api/subscription/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: `+91${digits}`, plan: plan.key }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 409 && data?.error === 'already_subscribed') {
        throw new Error('This WhatsApp number already has an active AskGogo plan.')
      }
      if (!res.ok || !data?.success || !data?.short_url) {
        throw new Error('Could not start the subscription. Please try again.')
      }
      window.location.href = data.short_url
    } catch (err: any) {
      setError(err?.message || 'Something went wrong.')
      setStatus('error')
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 16px', background: '#f8fafc', fontFamily: 'system-ui,sans-serif' }}>
      <div style={{ background: '#fff', borderRadius: 20, padding: '36px 32px', maxWidth: 420, width: '100%', boxShadow: '0 4px 32px rgba(0,0,0,.08)' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: plan.color, letterSpacing: '0.1em', textTransform: 'uppercase' as const, marginBottom: 6 }}>
          {plan.emoji} AskGogo {plan.name}
        </div>
        <div style={{ fontSize: 48, fontWeight: 800, color: '#0f172a', lineHeight: 1, marginBottom: 8 }}>
          ₹{plan.amount}<span style={{ fontSize: 16, fontWeight: 400, color: '#94a3b8' }}>/month</span>
        </div>
        <p style={{ color: '#475569', fontSize: 13, lineHeight: 1.5, margin: '0 0 20px' }}>
          7-day free trial. Authorize once with Razorpay; billing starts after the trial and renews monthly. Cancel anytime.
        </p>
        <div style={{ borderTop: '1px solid #f1f5f9', margin: '20px 0' }} />
        <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 8 }}>Your WhatsApp Number</label>
        <div style={{ display: 'flex', alignItems: 'center', border: '1.5px solid #e2e8f0', borderRadius: 10, overflow: 'hidden', marginBottom: 6 }}>
          <span style={{ padding: '12px 10px', fontSize: 14, fontWeight: 600, color: '#374151', borderRight: '1px solid #e2e8f0', background: '#f1f5f9' }}>🇮🇳 +91</span>
          <input type="tel" inputMode="numeric" placeholder="98765 43210" value={phone} onChange={e => { setPhone(e.target.value.replace(/\D/g, '').slice(0, 10)); setError('') }} style={{ flex: 1, border: 'none', background: 'transparent', padding: '12px 14px', fontSize: 16, outline: 'none', color: '#0f172a' }} />
        </div>
        <p style={{ fontSize: 12, color: '#94a3b8', margin: '0 0 4px' }}>Use the same number you use with AskGogo on WhatsApp.</p>
        {error && <p style={{ color: '#dc2626', fontSize: 13, margin: '8px 0' }}>{error}</p>}
        <button onClick={handlePay} disabled={status === 'loading'} style={{ display: 'block', width: '100%', padding: '14px', borderRadius: 10, border: 'none', color: '#fff', fontSize: 16, fontWeight: 700, marginTop: 16, background: status === 'loading' ? '#94a3b8' : plan.color, cursor: status === 'loading' ? 'not-allowed' : 'pointer' }}>
          {status === 'loading' ? 'Preparing secure subscription…' : 'Start 7-day free trial →'}
        </button>
        <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 10, textAlign: 'center' as const }}>🔒 Secured by Razorpay · UPI · Cards</p>
        <button onClick={() => window.history.back()} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 13, cursor: 'pointer', marginTop: 8, textDecoration: 'underline', display: 'block', width: '100%', textAlign: 'center' as const }}>← Back</button>
      </div>
    </div>
  )
}

export default function PayPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Loading…</div>}>
      <PayContent />
    </Suspense>
  )
}
