import { NextResponse } from 'next/server'
import { isAgentSession, requireAgentSession } from '@/lib/agent/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { activityObservationFromRun } from '@/lib/openui/activity-observation'

export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'private, no-store' }

/** Only already-saved owner-bound sports venue discovery; absolutely no live booking I/O. */
export async function GET(request: Request, context: { params: Promise<{id: string}> }) {
  const session = await requireAgentSession(request)
  if (!isAgentSession(session)) return session
  const { id } = await context.params
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: 'invalid_run' }, { status: 400, headers })
  }
  try {
    const owner = String(session.telegramId)
    const { data: run, error: runError } = await supabaseAdmin.from('agent_runs')
      .select('id,type,status,updated_at,metadata_json')
      .eq('id', id)
      .eq('telegram_id', owner)
      .eq('type', 'appointment_research')
      .maybeSingle()
    if (runError) return NextResponse.json({ error: 'read_unavailable' }, { status: 503, headers })
    if (!run) return NextResponse.json({ error: 'not_found' }, { status: 404, headers })
    const { data: steps, error: stepError } = await supabaseAdmin.from('agent_steps')
      .select('run_id,tool_name,status,completed_at,output_json')
      .eq('run_id', id)
      .eq('telegram_id', owner)
      .eq('tool_name', 'web_search')
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
      .limit(5)
    if (stepError) return NextResponse.json({ error: 'read_unavailable' }, { status: 503, headers })
    const result = activityObservationFromRun(run, steps || [])
    if (!result) return NextResponse.json({ error: 'not_found' }, { status: 404, headers })
    return NextResponse.json(result, { headers })
  } catch {
    return NextResponse.json({ error: 'read_unavailable' }, { status: 503, headers })
  }
}
