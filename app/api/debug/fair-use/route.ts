import { NextResponse } from 'next/server'
import { getPlanLimits } from '@/lib/data/limits'

export const dynamic = 'force-dynamic'

export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json({
    ok: true,
    version: 'fair-use-guardrails-v2',
    plans: getPlanLimits(),
    protected_features: [
      'monthly AI actions',
      'daily AI actions',
      'voice notes',
      'calendar events',
      'active reminders',
      'web searches',
    ],
    checked_at: new Date().toISOString(),
  })
}
