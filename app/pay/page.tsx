'use client'

import { useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'

const PLANS = {
        lite:    { key: 'lite',    name: 'Lite',        amount: 99,  color: '#16a34a' },
        starter: { key: 'starter', name: 'Starter',     amount: 149, color: '#2563eb' },
        pro:     { key: 'pro',     name: 'Pro',          amount: 299, color: '#7c3aed' },
        founder: { key: 'founder', name: 'Founder Pro', amount: 499, color: '#b45309' },
}

type PlanKey = keyof typeof PLANS

function PayContent() {
        const params = useSearchParams()
        const rawPlan = (params.get('plan') || 'pro').replace('founder_pro', 'founder') as PlanKey
        const plan = PLANS[rawPlan] || PLANS.pro
        const [phone, setPhone] = useState(
                  (params.get('phone') || '').replace(/^\+91/, '').replace(/\D/g, '')
                )
        const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')
        const [error, setError] = useState('')

  async function handlePay() {
            const digits = phone.replace(/\D/
