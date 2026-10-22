// Duet parity: only the owner marks a task complete (Mark complete) or sends it back (Not yet).
// Same-origin for browsers, bearer for the mobile apps; owner-scoped; never changes run status or re-executes.
import { NextResponse } from 'next/server'
import { isAgentSession, requireAgentMutationOrigin, requireAgentSession } from '@/lib/agent/session'
import { resolveAgentActor } from '@/lib/agent/actor'
import { parseOwnerDecision, recordOwnerDecision } from '@/lib/agent/owner-confirmation'

export const dynamic = 'force-dynamic'

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const blocked = requireAgentMutationOrigin(request)
  if (blocked) return blocked
  const session = await requireAgentSession(request)
  if (!isAgentSession(session)) return session
  const { id } = await context.params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'invalid_run' }, { status: 400 })
  const parsed = parseOwnerDecision(await request.json().catch(() => null))
  if (!parsed) return NextResponse.json({ error: 'invalid_decision' }, { status: 400 })
  try {
    const actor = await resolveAgentActor(session)
    const result = await recordOwnerDecision({ telegramId: session.telegramId, runId: id, actorId: String(actor.userId), decision: parsed.decision, note: parsed.note, surface: session.surface })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.error === 'not_found' ? 404 : 409 })
    return NextResponse.json(result)
  } catch (err: any) {
    console.error('OWNER_CONFIRMATION_FAILED:', String(err?.message || err).slice(0, 200))
    return NextResponse.json({ error: 'confirmation_failed' }, { status: 500 })
  }
}
