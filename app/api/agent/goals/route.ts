import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { isAgentSession, requireAgentMutationOrigin, requireAgentSession } from '@/lib/agent/session'
import { initializeBackgroundGoal } from '@/lib/agent/goal-engine'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

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
    .select('id, title, outcome, status, progress, deadline, next_action, blockers, plan_json, created_at, updated_at')
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
    plan: g.plan_json || null, createdAt: g.created_at, updatedAt: g.updated_at,
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
    .insert({ telegram_id: session.telegramId, title, outcome, deadline, status:'active', updated_at: now })
    .select('id, title, outcome, status, progress, deadline, next_action, blockers, plan_json, created_at, updated_at')
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

  let plan:any=null
  try {
    plan=await initializeBackgroundGoal({telegramId:session.telegramId,goalId:String(data.id),title,outcome})
  } catch (initError:any) {
    console.error('AGENT_GOAL_BACKGROUND_INIT_FAILED:', initError?.message || initError)
    await supabaseAdmin.from('agent_goals').update({status:'blocked',blockers:['Background planning failed. Open the goal to retry.'],updated_at:new Date().toISOString()}).eq('id',data.id).eq('telegram_id',session.telegramId)
  }

  return NextResponse.json({ goal: {
    id: data.id, title: data.title, outcome: data.outcome, status: plan ? 'active' : 'blocked', progress: data.progress,
    deadline: data.deadline, nextAction: plan?.steps?.[0]?.title || null, blockers: plan ? [] : ['Background planning failed. Open the goal to retry.'],
    plan, createdAt: data.created_at, updatedAt: data.updated_at,
  } }, { status: 201 })
}
