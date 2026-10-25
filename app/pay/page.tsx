'use client'

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'

const PLANS = {
  essential: { key:'essential', name:'Gogo Essential', amount:249, tagline:'Let Gogo help', accent:'#157A6E' },
  plus: { key:'plus', name:'Gogo Plus', amount:499, tagline:'Let Gogo handle it', accent:'#EF7A27' },
  pro: { key:'pro', name:'Gogo Pro', amount:999, tagline:'Gogo, take it from here', accent:'#76556F' },
} as const

type PlanKey = keyof typeof PLANS

function normalizePlan(value: string | null): PlanKey {
  const key = String(value || 'plus').toLowerCase().replace(/[\s-]+/g, '_')
  if (key === 'essential' || key === 'lite') return 'essential'
  if (key === 'pro' || key === 'gogo_pro' || key === 'power' || key === 'founder' || key === 'founder_pro') return 'pro'
  return 'plus'
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
        throw new Error('This WhatsApp number already has an active Gogo plan.')
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
    <div className="flex min-h-screen items-center justify-center bg-gogo-cream px-4 py-8 font-sans text-gogo-ink">
      <div className="w-full max-w-[430px] rounded-[32px] border border-gogo-ink/8 bg-gogo-surface p-7 shadow-[0_28px_80px_rgba(22,19,15,.09)] sm:p-9">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[.16em] text-gogo-teal">AskGogo</div>
            <h1 className="mt-1 font-serif text-4xl font-normal tracking-[-.03em]">{plan.name}</h1>
          </div>
          <span className="h-3 w-3 rounded-full" style={{background:plan.accent}} />
        </div>
        <p className="mt-2 text-sm text-gogo-ink-3">{plan.tagline}</p>
        <div className="mt-5 font-serif text-6xl font-normal leading-none">₹{plan.amount}<span className="font-sans text-base font-normal text-gogo-ink-4">/month</span></div>
        <p className="mt-3 text-sm leading-6 text-gogo-ink-3">7-day free trial. Authorize once with Razorpay; billing starts after the trial and renews monthly. Cancel anytime.</p>

        <div className="my-6 h-px bg-gogo-ink/7" />
        <label className="mb-2 block text-xs font-semibold text-gogo-ink-2">Your WhatsApp number</label>
        <div className="flex overflow-hidden rounded-[16px] border border-gogo-ink/12 bg-gogo-cream/45 focus-within:border-gogo-teal/45">
          <span className="flex items-center border-r border-gogo-ink/8 px-3 text-sm font-semibold text-gogo-ink-2">🇮🇳 +91</span>
          <input type="tel" inputMode="numeric" placeholder="98765 43210" value={phone} onChange={e => { setPhone(e.target.value.replace(/\D/g, '').slice(0, 10)); setError('') }} className="min-w-0 flex-1 bg-transparent px-4 py-3.5 text-base outline-none" />
        </div>
        <p className="mt-2 text-xs text-gogo-ink-4">Use the same number you use with Gogo on WhatsApp.</p>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

        <button onClick={handlePay} disabled={status === 'loading'} className="mt-6 w-full rounded-full bg-gogo-ink px-5 py-3.5 text-base font-semibold text-gogo-cream transition hover:bg-gogo-teal disabled:cursor-not-allowed disabled:opacity-50">
          {status === 'loading' ? 'Preparing secure subscription…' : 'Start 7-day free trial →'}
        </button>
        <p className="mt-3 text-center text-xs text-gogo-ink-4">Secured by Razorpay · UPI · Cards</p>
        <button onClick={() => window.history.back()} className="mt-3 block w-full text-center text-xs text-gogo-ink-4 underline">← Back</button>
      </div>
    </div>
  )
}

export default function PayPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-gogo-cream">Loading…</div>}>
      <PayContent />
    </Suspense>
  )
}
