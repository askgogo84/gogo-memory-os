import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { isAgentSession, requireAgentMutationOrigin, requireAgentSession } from '@/lib/agent/session'
import { guardApprovalFreshness } from '@/lib/agent/approval-guard'

export const dynamic = 'force-dynamic'

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const blocked = requireAgentMutationOrigin(request)
  if (blocked) return blocked
  const session = await requireAgentSession(request)
  if (!isAgentSession(session)) return session
  const { id } = await context.params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'invalid_approval' }, { status: 400 })

  const body = await request.json().catch(() => null) as any
  const decision = String(body?.decision || '').trim()
  if (decision !== 'approve' && decision !== 'reject') {
    return NextResponse.json({ error: 'invalid_decision' }, { status: 400 })
  }

  // Shared freshness guard (same as WhatsApp and the typed approval turn): an expired card is closed
  // as expired, owner-bound and only while still pending, and is never approved or queued.
  const { data: pending, error: pendingError } = await supabaseAdmin
    .from('agent_approvals')
    .select('id, run_id, title, action_type, risk_level, status, requested_at, execution_payload')
    .eq('id', id)
    .eq('telegram_id', session.telegramId)
    .eq('status', 'pending')
    .maybeSingle()
  if (pendingError) {
    console.error('AGENT_APPROVAL_READ_FAILED:', pendingError)
    return NextResponse.json({ error: 'resolve_failed' }, { status: 500 })
  }
  if (!pending) return NextResponse.json({ error: 'not_found_or_already_resolved' }, { status: 409 })
  let fresh: Awaited<ReturnType<typeof guardApprovalFreshness>>
  try {
    fresh = await guardApprovalFreshness({ telegramId: session.telegramId, row: pending as any, surface: 'dashboard' })
  } catch (guardError) {
    console.error('AGENT_APPROVAL_EXPIRE_FAILED:', guardError)
    return NextResponse.json({ error: 'resolve_failed' }, { status: 500 })
  }
  if (fresh.expired) return NextResponse.json({ error: 'approval_expired', message: fresh.text }, { status: 409 })

  const status = decision === 'approve' ? 'approved' : 'rejected'
  const resolvedAt = new Date().toISOString()

  const { data, error } = await supabaseAdmin
    .from('agent_approvals')
    .update({ status, resolved_at: resolvedAt })
    .eq('id', id)
    .eq('telegram_id', session.telegramId)
    .eq('status', 'pending')
    .select('id, run_id, action_type, title, description, payload_preview, risk_level, status, requested_at, resolved_at')
    .maybeSingle()

  if (error) {
    console.error('AGENT_APPROVAL_RESOLVE_FAILED:', error)
    return NextResponse.json({ error: 'resolve_failed' }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'not_found_or_already_resolved' }, { status: 409 })

  if (data.run_id) {
    const { error: runError } = await supabaseAdmin
      .from('agent_runs')
      .update({ status: decision === 'approve' ? 'queued' : 'paused', updated_at: resolvedAt })
      .eq('id', data.run_id)
      .eq('telegram_id', session.telegramId)
      .eq('status', 'waiting_approval')
    if (runError) console.error('AGENT_APPROVAL_RUN_UPDATE_FAILED:', runError)
  }

  const { error: activityError } = await supabaseAdmin.from('agent_activity').insert({
    telegram_id: session.telegramId,
    run_id: data.run_id,
    event_type: decision === 'approve' ? 'approval_granted' : 'approval_rejected',
    message: `${decision === 'approve' ? 'Approved' : 'Rejected'}: ${data.title}`,
    metadata_json: { approval_id: data.id, action_type: data.action_type, risk_level: data.risk_level, surface: session.surface },
  })
  if (activityError) console.error('AGENT_APPROVAL_ACTIVITY_FAILED:', activityError)

  return NextResponse.json({ approval: {
    id: data.id,
    runId: data.run_id,
    actionType: data.action_type,
    title: data.title,
    description: data.description,
    preview: data.payload_preview,
    risk: data.risk_level,
    status: data.status,
    requestedAt: data.requested_at,
    resolvedAt: data.resolved_at,
  } })
}
