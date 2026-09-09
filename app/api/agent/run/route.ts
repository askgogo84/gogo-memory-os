import { NextResponse } from 'next/server'
import { isAgentSession, requireAgentMutationOrigin, requireAgentSession } from '@/lib/agent/session'
import { resolveAgentActor } from '@/lib/agent/actor'
import { runAgentCommand } from '@/lib/agent/orchestrator'
import { tryRunExpiryReminderPlan } from '@/lib/agent/compound-planner'
import { tryPrepareTravelCalendarPlan } from '@/lib/agent/travel-calendar-plan'
import { tryCreateWebWatchFromCommand } from '@/lib/agent/watch-command'
import { tryRunGeneralPlan } from '@/lib/agent/general-planner'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

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

    // Read-only background web monitoring can be created directly from natural
    // language. Safe Mode can still disable Browser monitoring server-side.
    const webWatch = await tryCreateWebWatchFromCommand({ actor, surface:session.surface, text })
    if (webWatch) return NextResponse.json(webWatch, { status:200 })

    // Keep the deterministic, privacy-preserving specialist plans ahead of the
    // general planner. They use structured fields without exposing sensitive
    // document values to the planning model.
    const travelCalendar = await tryPrepareTravelCalendarPlan({ actor, surface:session.surface, text })
    if (travelCalendar) return NextResponse.json(travelCalendar, { status:travelCalendar.status === 'waiting_approval' ? 202 : 200 })

    const compound = await tryRunExpiryReminderPlan({
      actor,
      surface: session.surface,
      text,
      messageId: body?.messageId || null,
    })
    if (compound) return NextResponse.json(compound, { status: 200 })

    // Muse-style outcome planning: when a request genuinely spans multiple
    // capabilities, Gogo creates visible tool steps and stops at the first
    // consequential operation until the user approves it.
    const generalPlan = await tryRunGeneralPlan({
      actor,
      surface: session.surface,
      text,
      messageId: body?.messageId || null,
    })
    if (generalPlan) {
      return NextResponse.json(generalPlan, { status: generalPlan.status === 'waiting_approval' ? 202 : 200 })
    }

    // Simple one-capability requests continue through the existing same-brain
    // path so this upgrade remains additive and does not rewrite proven flows.
    const result = await runAgentCommand({
      actor,
      surface: session.surface,
      text,
      context: body?.context,
      messageId: body?.messageId || null,
    })
    return NextResponse.json(result, { status: result.status === 'waiting_approval' ? 202 : 200 })
  } catch (error: any) {
    console.error('AGENT_RUN_FAILED:', error?.message || error)
    const message = String(error?.message || '')
    if (message === 'whatsapp_identity_required') return NextResponse.json({ error: message }, { status: 409 })
    if (message === 'agent_actor_not_found') return NextResponse.json({ error: message }, { status: 404 })
    return NextResponse.json({ error: 'agent_run_failed' }, { status: 500 })
  }
}
