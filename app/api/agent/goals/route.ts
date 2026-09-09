import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { isAgentSession, requireAgentMutationOrigin, requireAgentSession } from '@/lib/agent/session'

export const dynamic = 'force-dynamic'

function cleanText(value: unknown, max: number): string {
  return String(value ?? '').trim().slice(0, max)
}

function parseDeadline(value: unknown): string | null | 'invalid' {
  if (value === null || value === undefined || value === '') return null
  const date = new Date(String(value))
  return Number.isFinite(date.getTime()) ? date.toISOString() : 'invalid'
}

export async function GET(request: Request) {
  const session = await requireAgentSession(request)
  if (!isAgentSession(session)) return session

  const { data, error } = await supabaseAdmin
    .from('agent_goals')
    .select('id, title, outcome, status, progress, deadline, next_action, blockers, created_at, updated_at')
    .eq('telegram_id', session.telegramId)
    .neq('status', 'cancelled')
    .order('updated_at', { ascending: false })

  if (error) {
    console.error('AGENT_GOALS_READ_FAILED:', error)
    return NextResponse.json({ error: 'read_failed' }, { status: 500 })
  }

  return NextResponse.json({ goals: (data || []).map((g: any) => ({
    id: g.id, title: g.title, outcome: g.outcome, status: g.status, progress: g.progress,
    deadline: g.deadline, nextAction: g.next_action, blockers: Array.isArray(g.blockers) ? g.blockers : [],
    createdAt: g.created_at, updatedAt: g.updated_at,
  })) })
}

export async function POST(request: Request) {
  const blocked = requireAgentMutationOrigin(request)
  if (blocked) return blocked
  const session = await requireAgentSession(request)
  if (!isAgentSession(session)) return session

  const body = await request.json().catch(() => null) as any
  const title = cleanText(body?.title, 160)
  const outcome = cleanText(body?.outcome, 2000)
  const deadline = parseDeadline(body?.deadline)
  if (!title || !outcome) return NextResponse.json({ error: 'title_and_outcome_required' }, { status: 400 })
  if (deadline === 'invalid') return NextResponse.json({ error: 'invalid_deadline' }, { status: 400 })

  const now = new Date().toISOString()
  const { data, error } = await supabaseAdmin
    .from('agent_goals')
    .insert({ telegram_id: session.telegramId, title, outcome, deadline, updated_at: now })
    .select('id, title, outcome, status, progress, deadline, next_action, blockers, created_at, updated_at')
    .single()

  if (error || !data) {
    console.error('AGENT_GOAL_CREATE_FAILED:', error)
    return NextResponse.json({ error: 'create_failed' }, { status: 500 })
  }

  const { error: activityError } = await supabaseAdmin.from('agent_activity').insert({
    telegram_id: session.telegramId,
    event_type: 'goal_created',
    message: `Goal created: ${title}`,
    metadata_json: { goal_id: data.id, surface: session.surface },
  })
  if (activityError) console.error('AGENT_GOAL_ACTIVITY_FAILED:', activityError)

  return NextResponse.json({ goal: {
    id: data.id, title: data.title, outcome: data.outcome, status: data.status, progress: data.progress,
    deadline: data.deadline, nextAction: data.next_action, blockers: data.blockers || [],
    createdAt: data.created_at, updatedAt: data.updated_at,
  } }, { status: 201 })
}
