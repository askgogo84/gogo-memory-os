'use client'

import { useEffect, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'

const PLANS = {
    lite:    { key: 'lite',    name: 'Lite',        amount: 99,  color: '#16a34a', emoji: '🌱' },
    starter: { key: 'starter', name: 'Starter',     amount: 149, color: '#2563eb', emoji: '⚡' },
    pro:     { key: 'pro',     name: 'Pro',          amount: 299, color: '#7c3aed', emoji: '🚀' },
    founder: { key: 'founder', name: 'Founder Pro', amount: 499, color: '#b45309', emoji: '👑' },
} as const

type PlanKey = keyof typeof PLANS

function PayContent() {
    const params = useSearchParams()
    const planKey = (params.get('plan') || 'pro').replace('founder_pro', 'founder') as PlanKey
    const phoneParam = params.get('phone') || ''

  const plan = PLANS[planKey] || PLANS.pro
    const [phone, setPhone] = useState(phoneParam.replace(/^\+91/, '').replace(/\D/g, ''))
    const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')
    const [error, setError] = useState('')

  const handlePay = async () => {
        const digits = phone.replace(/\D/g, '')
        if (digits.length !== 10) { setError('Enter a valid 10-digit WhatsApp number'); return }
        setStatus('loading')
        setError('')
        const fullPhone = `+91${digits}`
        try {
                const res = await fetch('/api/payments/create-link', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ phone: fullPhone, whatsappId: fullPhone, plan: plan.key }),
                })
                const data = await res.json()
                if (!res.ok || !data.success || !data.payment_url) throw new Error(data.error || 'Could not create payment link')
                window.location.href = data.payment_url
        } catch (err: any) {
                setError(err.message || 'Something went wrong. Please try again.')
                setStatus('error')
        }
  }

  return (
        <div style={s.wrap}>
                <div style={s.card}>
                          <div style={{ marginBottom: 20 }}>
                                      <div style={{ fontSize: 13, fontWeight: 700, color: plan.color, letterSpacing: '0.1em', textTransform: 'uppercase' as const, marginBottom: 6 }}>
                                        {plan.emoji} AskGogo {plan.name}
                                      </div>div>
                                      <div style={{ fontSize: 48, fontWeight: 800, color: '#0f172a', lineHeight: 1 }}>
                                                    ₹{plan.amount}<span style={{ fontSize: 16, fontWeight: 400, color: '#94a3b8' }}>/mo</span>span>
                                      </div>div>
                          </div>div>
                          <div style={s.divider} />
                          <label style={s.label}>Your WhatsApp Number</label>label>
                          <div style={s.inputRow}>
                                      <span style={s.prefix}>🇮🇳 +91</span>span>
                                      <input
                                                    type="tel"
                                                    inputMode="numeric"
                                                    placeholder="98765 43210"
                                                    value={phone}
                                                    onChange={e => { setPhone(e.target.value.replace(/\D/g, '').slice(0, 10)); setError('') }}
                                                    style={s.input}
                                                  />
                          </div>div>
                          <p style={s.hint}>Plan confirmation sent to this number via WhatsApp</p>p>
                  {error && <p style={s.err}>{error}</p>p>}
                          <button
                              onClick={handlePay}
                                      disabled={status === 'loading'}
                                      style={{ ...s.btn, background: status === 'loading' ? '#94a3b8' : plan.color, cursor: status === 'loading' ? 'not-allowed' : 'pointer', marginTop: 20 }}
                                    >
                            {status === 'loading' ? 'Creating payment link...' : `Pay ₹${plan.amount} →`}
                          </button>button>
                        <p style={s.secure}>🔒 Secured by Razorpay · UPI · Cards · NetBanking</p>p>
                        <button onClick={() => window.history.back()} style={s.back}>← Back</button>button>
                </div>div>
        </div>div>
      )
}

const s: Record<string, React.CSSProperties> = {
    wrap:     { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 16px', background: '#f8fafc', fontFamily: 'system-ui, -apple-system, sans-serif' },
    card:     { background: '#fff', borderRadius: 20, padding: '36px 32px', maxWidth: 420, width: '100%', boxShadow: '0 4px 32px rgba(0,0,0,0.08)' },
    divider:  { borderTop: '1px solid #f1f5f9', margin: '20px 0' },
    label:    { display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 8 },
    inputRow: { display: 'flex', alignItems: 'center', border: '1.5px solid #e2e8f0', borderRadius: 10, overflow: 'hidden', background: '#f8fafc' },
    prefix:   { padding: '12px 10px', fontSize: 14, fontWeight: 600, color: '#374151', borderRight: '1px solid #e2e8f0', whiteSpace: 'nowrap', background: '#f1f5f9' },
    input:    { flex: 1, border: 'none', background: 'transparent', padding: '12px 14px', fontSize: 16, outline: 'none', color: '#0f172a' },
    hint:     { fontSize: 12, color: '#94a3b8', margin: '6px 0 0' },
    err:      { color: '#dc2626', fontSize: 13, margin: '8px 0 0' },
    btn:      { display: 'block', width: '100%', padding: '14px', borderRadius: 10, border: 'none', color: '#fff', fontSize: 16, fontWeight: 700 },
    secure:   { fontSize: 12, color: '#94a3b8', marginTop: 12, textAlign: 'center' as const },
    back:     { background: 'none', border: 'none', color: '#94a3b8', fontSize: 13, cursor: 'pointer', marginTop: 12, textDecoration: 'underline', display: 'block', width: '100%', textAlign: 'center' as const },
}
  
  export default function PayPage() {
      return (
            <Suspense fallback={<div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Loading...</div>div>}>
                  <PayContent />
            </Suspense>Suspense>
          )
  }</button>
