import { NextResponse } from 'next/server'
import { getPlanLimits } from '@/lib/data/limits'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({
    ok: true,
    version: 'fair-use-guardrails-v1',
    plans: getPlanLimits(),
    protected_features: [
      'monthly AI actions',
      'daily AI actions',
      'voice notes',
      'calendar events',
      'active reminders and web searches are next patch',
    ],
    note: 'Usage logs are stored in memories using ASKGOGO_USAGE prefixes. users.daily_count is monthly AI action usage.',
    checked_at: new Date().toISOString(),
  })
}
