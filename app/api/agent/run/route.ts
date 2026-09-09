import { NextResponse } from 'next/server'
import { isAgentSession, requireAgentMutationOrigin, requireAgentSession } from '@/lib/agent/session'
import { resolveAgentActor } from '@/lib/agent/actor'
import { runAgentCommand } from '@/lib/agent/orchestrator'
import { tryRunExpiryReminderPlan } from '@/lib/agent/compound-planner'

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

    // Compound plans run before the single-capability fallback. Each recognized
    // plan persists visible steps and uses existing AskGogo tools for execution.
    const compound = await tryRunExpiryReminderPlan({
      actor,
      surface: session.surface,
      text,
      messageId: body?.messageId || null,
    })
    if (compound) return NextResponse.json(compound, { status: 200 })

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
