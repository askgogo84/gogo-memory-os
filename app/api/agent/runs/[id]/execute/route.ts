import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { isAgentSession, requireAgentMutationOrigin, requireAgentSession } from '@/lib/agent/session'
import { resolveAgentActor } from '@/lib/agent/actor'
import { executeApprovedAgentRun } from '@/lib/agent/orchestrator'
import { executeApprovedTravelCalendarPlan } from '@/lib/agent/travel-calendar-plan'
import { resumeApprovedGeneralPlan } from '@/lib/agent/general-planner'
import { executeApprovedBrowserCommand } from '@/lib/agent/browser-command'
import { finalizeApprovedAppointmentRun } from '@/lib/agent/appointment-followup'
import { executeApprovedWorkspaceMeetingPlan } from '@/lib/agent/workspace-meeting-approval'
import { executeApprovedLifeEventCheckin } from '@/lib/agent/life-event-execution'
import { executeApprovedBookingCalendar } from '@/lib/agent/booking-calendar-execution'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const blocked = requireAgentMutationOrigin(request)
  if (blocked) return blocked

  const session = await requireAgentSession(request)
  if (!isAgentSession(session)) return session
  const { id } = await context.params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'invalid_run' }, { status: 400 })

  try {
    const actor = await resolveAgentActor(session)
    const { data: run, error: runError } = await supabaseAdmin
      .from('agent_runs')
      .select('metadata_json')
      .eq('id', id)
      .eq('telegram_id', session.telegramId)
      .maybeSingle()
    if (runError) throw new Error(`agent_run_read_failed:${runError.message}`)
    if (!run) return NextResponse.json({ error: 'agent_run_not_found' }, { status: 404 })

    const planType = String((run.metadata_json as any)?.plan_type || '')
    let result: any
    if (planType === 'memory_ticket_to_calendar') {
      result = await executeApprovedTravelCalendarPlan({ actor, runId: id })
    } else if (planType === 'secure_browser') {
      const browserResult = await executeApprovedBrowserCommand({ actor, runId: id })
      // Ordinary secure-browser runs pass straight through. Appointment runs carry
      // appointment_selection metadata; those are fail-closed here and only become
      // Life Events when provider confirmation plus an exact slot are verified.
      result = await finalizeApprovedAppointmentRun({ actor, runId: id, result: browserResult })
    } else if (planType === 'general_multi_tool') {
      result = await resumeApprovedGeneralPlan({ actor, runId: id })
    } else if (planType === 'workspace_meeting_prep') {
      result = await executeApprovedWorkspaceMeetingPlan({ actor, runId: id })
    } else if (planType === 'life_event_checkin') {
      result = await executeApprovedLifeEventCheckin({ actor, runId: id })
    } else if (planType === 'booking_event_calendar') {
      result = await executeApprovedBookingCalendar({ actor, runId: id })
    } else {
      result = await executeApprovedAgentRun({ actor, runId: id })
    }
    return NextResponse.json(result, { status: result.status === 'waiting_approval' ? 202 : 200 })
  } catch (error: any) {
    const message = String(error?.message || '')
    console.error('AGENT_APPROVED_EXECUTION_FAILED:', message || error)
    if (message === 'agent_run_not_found') return NextResponse.json({ error: message }, { status: 404 })
    if (message === 'agent_run_already_claimed') return NextResponse.json({ error: message }, { status: 409 })
    if (message === 'approval_required' || message === 'general_plan_approval_missing') return NextResponse.json({ error: message }, { status: 409 })
    if (message === 'permission_off' || message === 'permission_insufficient') return NextResponse.json({ error: message }, { status: 403 })
    return NextResponse.json({ error: 'agent_execution_failed' }, { status: 500 })
  }
}