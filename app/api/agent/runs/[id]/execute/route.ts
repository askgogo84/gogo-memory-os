import { NextResponse } from 'next/server'
import { isAgentSession, requireAgentMutationOrigin, requireAgentSession } from '@/lib/agent/session'
import { resolveAgentActor } from '@/lib/agent/actor'
import { executeApprovedAgentRun } from '@/lib/agent/orchestrator'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const blocked = requireAgentMutationOrigin(request)
  if (blocked) return blocked

  const session = await requireAgentSession(request)
  if (!isAgentSession(session)) return session
  const { id } = await context.params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'invalid_run' }, { status: 400 })

  try {
    const actor = await resolveAgentActor(session)
    const result = await executeApprovedAgentRun({ actor, runId: id })
    return NextResponse.json(result)
  } catch (error: any) {
    const message = String(error?.message || '')
    console.error('AGENT_APPROVED_EXECUTION_FAILED:', message || error)
    if (message === 'agent_run_not_found') return NextResponse.json({ error: message }, { status: 404 })
    if (message === 'agent_run_already_claimed') return NextResponse.json({ error: message }, { status: 409 })
    return NextResponse.json({ error: 'agent_execution_failed' }, { status: 500 })
  }
}
