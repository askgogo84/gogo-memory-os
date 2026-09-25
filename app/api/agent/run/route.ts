import { randomUUID } from 'node:crypto'
import { recordDecisionLearning } from '@/lib/agent/decision-learning'
import { trySameBrainIntrospection } from '@/lib/agent/brain-introspection'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { isAgentSession, requireAgentMutationOrigin, requireAgentSession } from '@/lib/agent/session'
import { resolveAgentActor } from '@/lib/agent/actor'
import { runAgentCommand } from '@/lib/agent/orchestrator'
import { tryRunExpiryReminderPlan } from '@/lib/agent/compound-planner'
import { tryPrepareTravelCalendarPlan } from '@/lib/agent/travel-calendar-plan'
import { tryCreateWebWatchFromCommand } from '@/lib/agent/watch-command'
import { tryRunBrowserCommand } from '@/lib/agent/browser-command'
import { prepareGeneralPlan, tryRunGeneralPlan } from '@/lib/agent/general-planner'
import { tryRunPersistentGeneralPlan } from '@/lib/agent/persistent-general-plan'
import { tryPrepareWorkspaceMeetingPlan } from '@/lib/agent/workspace-meeting-plan'
import { attachWorkspaceMeetingApproval } from '@/lib/agent/workspace-meeting-approval'
import { tryRunWorkspaceDriveContext } from '@/lib/agent/workspace-drive-context'
import { tryRunCreditIQHotelResearch } from '@/lib/agent/creditiq-hotel-research'
import { tryRunTravelResearch } from '@/lib/agent/travel-research'
import { hardenTravelResearchResult } from '@/lib/agent/travel-research-sanitize'
import { shouldPreferSpecialistTravel } from '@/lib/agent/specialist-routing'
import { tryRunAppointmentResearch } from '@/lib/agent/appointment-research'
import { tryRunAppointmentFollowup } from '@/lib/agent/appointment-followup'
import { appointmentPrepareOptionNumber, tryRecoverAppointmentOption } from '@/lib/agent/appointment-followup-recovery'
import { attachRunToThread, resolveThreadForUser } from '@/lib/agent/thread-context'
import { detectReadOnlyScheduleRequest, readTomorrowSchedule } from '@/lib/agent/read-only-schedule'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(request: Request) {
  const blocked = requireAgentMutationOrigin(request)
  if (blocked) return blocked

  const session = await requireAgentSession(request)
  if (!isAgentSession(session)) return session

  const body = await request.json().catch(() => null) as any
  const text = String(body?.text || '').trim().slice(0, 2000)
  if (!text) return NextResponse.json({ error: 'text_required' }, { status: 400 })

  try {
    const actor = await resolveAgentActor(session)
    const brainReply = await trySameBrainIntrospection({ actor, text })
    if (brainReply) return NextResponse.json(brainReply)
    const thread = await resolveThreadForUser(session.telegramId, body?.context?.threadId)
    const respond = async (result:any, status:number) => {
      await attachRunToThread(session.telegramId, result?.runId, thread?.id || null)
      return NextResponse.json(result, { status })
    }

    const readOnlySchedule = detectReadOnlyScheduleRequest(text)
    if (readOnlySchedule?.horizon === 'tomorrow') {
      const summary = await readTomorrowSchedule({ actor, scope: readOnlySchedule.scope })
      await recordDecisionLearning({ actor, text, domain:'calendar', handler:'read-only-schedule', decisionId:`agent-${randomUUID()}`, outcome:summary.calendarReadVerified?'verified_success':'unknown', verified:summary.calendarReadVerified }).catch(()=>{})
      return NextResponse.json({
        status: 'completed', capability: 'calendar', risk: 'low', text: summary.text,
        handledBy: 'read-only-schedule', readOnly: true, mutated: false,
      })
    }

    const cutoff = new Date(Date.now() - 90_000).toISOString()
    const { data: recentActive, error: dedupeError } = await supabaseAdmin
      .from('agent_runs')
      .select('id,status,title,summary,capability,metadata_json,started_at')
      .eq('telegram_id', String(session.telegramId))
      .in('status', ['queued','running','waiting_approval'])
      .gte('started_at', cutoff)
      .order('started_at', { ascending: false })
      .limit(8)
    if (dedupeError) console.error('AGENT_RUN_DEDUPE_READ_FAILED:', dedupeError.message)
    const duplicate = (recentActive || []).find((row:any) => String(row?.metadata_json?.input_text || '').trim() === text)
    if (duplicate?.id) {
      return respond({
        runId: String(duplicate.id), status: duplicate.status,
        capability: duplicate.capability || 'memory', risk: 'low',
        text: duplicate.summary || 'Gogo is already working on this outcome.',
        handledBy: 'active-run-dedupe', deduplicated: true,
      }, duplicate.status === 'waiting_approval' ? 202 : 200)
    }

    if (appointmentPrepareOptionNumber(text)) {
      const recovered = await tryRecoverAppointmentOption({ actor, surface:session.surface, text })
      if (recovered) return respond(recovered, recovered.status === 'waiting_approval' ? 202 : 200)
      return respond({
        runId:'', status:'paused', capability:'browser', risk:'low',
        text:'I can tell this refers to a numbered appointment option, but I cannot recover that option safely. I will not start a new search in another location. Please rerun the provider search.',
        handledBy:'appointment-followup-hard-boundary',
      }, 200)
    }

    const appointmentFollowup = await tryRunAppointmentFollowup({ actor, surface:session.surface, text })
    if (appointmentFollowup) return respond(appointmentFollowup, appointmentFollowup.status === 'waiting_approval' ? 202 : 200)

    // Pure travel research uses the specialist engine on every surface. This keeps
    // WhatsApp, dashboard and mobile app behavior identical and prevents a generic
    // planner artifact from replacing the real flight/hotel result.
    if (shouldPreferSpecialistTravel(text)) {
      const liveHotels = await tryRunCreditIQHotelResearch({ actor, surface:session.surface, text })
      if (liveHotels) return respond(liveHotels, 200)

      const travelResearch = await tryRunTravelResearch({ actor, surface:session.surface, text })
      if (travelResearch) {
        const hardened = await hardenTravelResearchResult(travelResearch, text)
        return respond(hardened, 200)
      }
    }

    const webWatch = await tryCreateWebWatchFromCommand({ actor, surface:session.surface, text })
    if (webWatch) return respond(webWatch, 200)

    const browser = await tryRunBrowserCommand({ actor, surface:session.surface, text })
    if (browser) return respond(browser, browser.status === 'waiting_approval' ? 202 : 200)

    const travelCalendar = await tryPrepareTravelCalendarPlan({ actor, surface:session.surface, text })
    if (travelCalendar) return respond(travelCalendar, travelCalendar.status === 'waiting_approval' ? 202 : 200)

    const compound = await tryRunExpiryReminderPlan({ actor, surface: session.surface, text, messageId: body?.messageId || null })
    if (compound) return respond(compound, 200)

    const workspaceMeeting = await tryPrepareWorkspaceMeetingPlan({ actor, surface:session.surface, text })
    if (workspaceMeeting) {
      const prepared = await attachWorkspaceMeetingApproval({ actor, result: workspaceMeeting })
      return respond(prepared, prepared.status === 'waiting_approval' ? 202 : 200)
    }

    const workspaceDrive = await tryRunWorkspaceDriveContext({ actor, surface:session.surface, text })
    if (workspaceDrive) return respond(workspaceDrive, 200)

    const appointmentResearch = await tryRunAppointmentResearch({ actor, surface:session.surface, text })
    if (appointmentResearch) return respond(appointmentResearch, 200)

    const prepared=await prepareGeneralPlan(text)
    const persistentPlan = await tryRunPersistentGeneralPlan({ actor, surface: session.surface, text, messageId: body?.messageId || null, prepared })
    if (persistentPlan) return respond(persistentPlan, persistentPlan.status === 'waiting_approval' ? 202 : 200)

    const generalPlan = await tryRunGeneralPlan({ actor, surface: session.surface, text, messageId: body?.messageId || null, prepared })
    if (generalPlan) return respond(generalPlan, generalPlan.status === 'waiting_approval' ? 202 : 200)

    const liveHotels = await tryRunCreditIQHotelResearch({ actor, surface:session.surface, text })
    if (liveHotels) return respond(liveHotels, 200)

    const travelResearch = await tryRunTravelResearch({ actor, surface:session.surface, text })
    if (travelResearch) {
      const hardened = await hardenTravelResearchResult(travelResearch, text)
      return respond(hardened, 200)
    }

    const result = await runAgentCommand({
      actor, surface: session.surface, text,
      context: { ...(body?.context || {}), ...(thread ? { threadTitle:thread.title, threadContext:thread.context } : {}) },
      messageId: body?.messageId || null,
    })
    return respond(result, result.status === 'waiting_approval' ? 202 : 200)
  } catch (error: any) {
    console.error('AGENT_RUN_FAILED:', error?.message || error)
    const message = String(error?.message || '')
    if (message === 'whatsapp_identity_required') return NextResponse.json({ error: message }, { status: 409 })
    if (message === 'agent_actor_not_found') return NextResponse.json({ error: message }, { status: 404 })
    if (message === 'invalid_thread' || message === 'thread_not_found') return NextResponse.json({ error: message }, { status: 400 })
    return NextResponse.json({ error: 'agent_run_failed' }, { status: 500 })
  }
}


