// Duet parity (23 Oct): the owner cancels a task from the dashboard (Cancel task on the activity page), not only from
// chat. Same-origin for browsers, bearer for the mobile apps; owner-scoped. Shares the chat cancel core
// (lib/agent/run-cancel.ts cancelOwnedRun): only queued/running/waiting_approval/paused runs, pending approvals
// rejected, unfinished steps cancelled, handoff released, one agent_activity row.
import { NextResponse } from 'next/server'
import { isAgentSession, requireAgentMutationOrigin, requireAgentSession } from '@/lib/agent/session'
import { cancelRunById } from '@/lib/agent/run-cancel'

export const dynamic = 'force-dynamic'

const STATUS_FOR: Record<string, number> = { not_found: 404, not_cancellable: 409, changed: 409, read_failed: 500, approval_read_failed: 500, save_failed: 500 }

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const blocked = requireAgentMutationOrigin(request)
  if (blocked) return blocked
  const session = await requireAgentSession(request)
  if (!isAgentSession(session)) return session
  const { id } = await context.params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'invalid_run' }, { status: 400 })
  try {
    // Owner-scoped: cancelRunById reads and writes the run only with .eq('telegram_id', session.telegramId).
    const result = await cancelRunById({ telegramId: session.telegramId }, id, { surface: 'dashboard' })
    if (!result.ok) return NextResponse.json({ error: result.error, text: result.text }, { status: STATUS_FOR[result.error] || 500 })
    return NextResponse.json({ ok: true, runId: result.runId, text: result.text, possiblySubmitted: result.possiblySubmitted, rejectedApprovalIds: result.rejectedApprovalIds })
  } catch (err: any) {
    console.error('RUN_CANCEL_ROUTE_FAILED:', String(err?.message || err).slice(0, 200))
    return NextResponse.json({ error: 'cancel_failed', text: 'Could not cancel this task. Nothing was changed.' }, { status: 500 })
  }
}
