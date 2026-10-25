import { NextResponse } from 'next/server'
import { isAgentSession, requireAgentSession } from '@/lib/agent/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { loadTaskMeasurements } from '@/lib/metering/task-measurements'

export const dynamic = 'force-dynamic'
export async function GET(request: Request) {
  const session = await requireAgentSession(request)
  if (!isAgentSession(session)) return session
  try {
    const measurements = await loadTaskMeasurements(String(session.telegramId), supabaseAdmin)
    return NextResponse.json({ measurements }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ error: 'measurements_unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }
}
