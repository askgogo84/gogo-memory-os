import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { isAgentSession, requireAgentMutationOrigin, requireAgentSession } from '@/lib/agent/session'

export const dynamic = 'force-dynamic'

const STATUSES = new Set(['active','paused','completed','cancelled'])

function cleanText(value: unknown, max: number): string | undefined {
  if (value === undefined) return undefined
  return String(value ?? '').trim().slice(0, max)
}

function parseDeadline(value: unknown): string | null | undefined | 'invalid' {
  if (value === undefined) return undefined
  if (value === null || value === '') return null
  const date = new Date(String(value))
  return Number.isFinite(date.getTime()) ? date.toISOString() : 'invalid'
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const blocked = requireAgentMutationOrigin(request)
  if (blocked) return blocked
  const session = await requireAgentSession()
  if (!isAgentSession(session)) return session
  const { id } = await context.params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'invalid_goal' }, { status: 400 })

  const body = await request.json().catch(() => null) as any
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }

  const title = cleanText(body?.title, 160)
  const outcome = cleanText(body?.outcome, 2000)
  const nextAction = cleanText(body?.nextAction, 1000)
  const deadline = parseDeadline(body?.deadline)
  const status = body?.status === undefined ? undefined : String(body.status)

  if (title !== undefined) {
    if (!title) return NextResponse.json({ error: 'invalid_title' }, { status: 400 })
    patch.title = title
  }
  if (outcome !== undefined) {
    if (!outcome) return NextResponse.json({ error: 'invalid_outcome' }, { status: 400 })
    patch.outcome = outcome
  }
  if (nextAction !== undefined) patch.next_action = nextAction || null
  if (deadline === 'invalid') return NextResponse.json({ error: 'invalid_deadline' }, { status: 400 })
  if (deadline !== undefined) patch.deadline = deadline
  if (status !== undefined) {
    if (!STATUSES.has(status)) return NextResponse.json({ error: 'invalid_status' }, { status: 400 })
    patch.status = status
    if (status === 'completed') patch.progress = 100
  }

  if (Object.keys(patch).length === 1) return NextResponse.json({ error: 'no_changes' }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from('agent_goals')
    .update(patch)
    .eq('id', id)
    .eq('telegram_id', session.telegramId)
    .select('id, title, outcome, status, progress, deadline, next_action, blockers, created_at, updated_at')
    .maybeSingle()

  if (error) {
    console.error('AGENT_GOAL_UPDATE_FAILED:', error)
    return NextResponse.json({ error: 'update_failed' }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const { error: activityError } = await supabaseAdmin.from('agent_activity').insert({
    telegram_id: session.telegramId,
    event_type: 'goal_updated',
    message: `Goal updated: ${data.title}`,
    metadata_json: { goal_id: data.id, status: data.status },
  })
  if (activityError) console.error('AGENT_GOAL_ACTIVITY_FAILED:', activityError)

  return NextResponse.json({ goal: {
    id: data.id, title: data.title, outcome: data.outcome, status: data.status, progress: data.progress,
    deadline: data.deadline, nextAction: data.next_action, blockers: data.blockers || [],
    createdAt: data.created_at, updatedAt: data.updated_at,
  } })
}
