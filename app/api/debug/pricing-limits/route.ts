import { NextResponse } from 'next/server'
import { getPlanLimits } from '@/lib/data/limits'

export const dynamic = 'force-dynamic'

export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json({
    ok: true,
    version: 'pricing-v4-free-lite-pro-power',
    limits: getPlanLimits(),
    pricing: {
      free: '₹0 — 25 AI actions/month',
      lite: '₹99/month — 60 AI actions/month',
      pro: '₹299/month — 250 AI actions/month',
      power: '₹499/month — 600 AI actions/month',
    },
    legacy_internal_tiers: ['starter', 'founder_pro'],
    checked_at: new Date().toISOString(),
  })
}
