import { NextResponse } from 'next/server'
import { isAgentSession, requireAgentMutationOrigin, requireAgentSession } from '@/lib/agent/session'
import { resolveAgentActor } from '@/lib/agent/actor'
import { runAgentCommand } from '@/lib/agent/orchestrator'
import { tryRunExpiryReminderPlan } from '@/lib/agent/compound-planner'
import { tryPrepareTravelCalendarPlan } from '@/lib/agent/travel-calendar-plan'
import { tryCreateWebWatchFromCommand } from '@/lib/agent/watch-command'
import { tryRunBrowserCommand } from '@/lib/agent/browser-command'
import { tryRunGeneralPlan } from '@/lib/agent/general-planner'

export const dynamic = 'force-dynamic'
// First use of a user-specific Secure Computer may need to bootstrap Chromium.
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

    // Background watch intent wins over direct browsing: "watch this URL" should
    // remain a background job rather than opening an interactive browser run.
    const webWatch = await tryCreateWebWatchFromCommand({ actor, surface:session.surface, text })
    if (webWatch) return NextResponse.json(webWatch, { status:200 })

    // Direct URL tasks run inside a user-isolated Secure Computer. Read/draft
    // operations may proceed according to Browser permission; submit/booking/
    // purchase requests stop behind a one-shot approval.
    const browser = await tryRunBrowserCommand({ actor, surface:session.surface, text })
    if (browser) return NextResponse.json(browser, { status:browser.status === 'waiting_approval' ? 202 : 200 })

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
