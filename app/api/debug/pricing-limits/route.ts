import { NextResponse } from 'next/server'
import { getPlanLimits } from '@/lib/data/limits'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({
    ok: true,
    version: 'calendar-first-monthly-credits-v3-lite-99',
    limits: getPlanLimits(),
    pricing: {
      free: '₹0 — 25 AI actions/month',
      lite: '₹99/month — 60 AI actions/month',
      starter: '₹149/month — 100 AI actions/month',
      pro: '₹299/month — 250 AI actions/month',
      founder_pro: '₹499/month — 600 AI actions/month',
    },
    removed: ['family plan', 'gmail as primary feature'],
    primary_positioning: [
      'voice notes',
      'reminders',
      'calendar',
      'today briefing',
      'weather',
      'sports',
      'lists',
    ],
    checked_at: new Date().toISOString(),
  })
}
