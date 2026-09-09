import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { isAgentSession, requireAgentSession } from '@/lib/agent/session'

export const dynamic = 'force-dynamic'

const DEFAULT_PERMISSIONS = [
  ['memory', 'read', false],
  ['files', 'read', false],
  ['email', 'draft', true],
  ['calendar', 'ask', true],
  ['browser', 'draft', true],
  ['contacts', 'read', false],
  ['travel', 'draft', true],
  ['payments', 'ask', true],
] as const

export async function GET() {
  const session = await requireAgentSession()
  if (!isAgentSession(session)) return session
  const tg = session.telegramId

  const [runs, goals, ideas, approvals, permissions, artifacts] = await Promise.all([
    supabaseAdmin.from('agent_runs').select('id, goal_id, title, summary, status, capability, progress, started_at, updated_at, next_check_at, why').eq('telegram_id', tg).order('updated_at', { ascending: false }).limit(20),
    supabaseAdmin.from('agent_goals').select('id, title, outcome, status, progress, deadline, next_action, blockers').eq('telegram_id', tg).neq('status', 'cancelled').order('updated_at', { ascending: false }).limit(20),
    supabaseAdmin.from('agent_ideas').select('id, title, reason, expected_value, action_label, source_refs, status, created_at, snoozed_until').eq('telegram_id', tg).in('status', ['new','snoozed']).order('created_at', { ascending: false }).limit(20),
    supabaseAdmin.from('agent_approvals').select('id, run_id, action_type, title, description, payload_preview, risk_level, status, requested_at, resolved_at').eq('telegram_id', tg).eq('status', 'pending').order('requested_at', { ascending: false }).limit(20),
    supabaseAdmin.from('agent_permissions').select('capability, level, irreversible_always_ask, updated_at').eq('telegram_id', tg),
    supabaseAdmin.from('agent_artifacts').select('id, type, title, subtitle, updated_at').eq('telegram_id', tg).order('updated_at', { ascending: false }).limit(20),
  ])

  const queryError = runs.error || goals.error || ideas.error || approvals.error || permissions.error || artifacts.error
  if (queryError) {
    console.error('AGENT_SNAPSHOT_READ_FAILED:', queryError)
    return NextResponse.json({ error: 'read_failed' }, { status: 500 })
  }

  const permissionByCapability = new Map((permissions.data || []).map((p: any) => [p.capability, p]))
  const mergedPermissions = DEFAULT_PERMISSIONS.map(([capability, defaultLevel, irreversibleAlwaysAsk]) => {
    const stored: any = permissionByCapability.get(capability)
    return {
      capability,
      level: stored?.level || defaultLevel,
      irreversibleAlwaysAsk: stored?.irreversible_always_ask ?? irreversibleAlwaysAsk,
      updatedAt: stored?.updated_at || null,
    }
  })

  return NextResponse.json({
    runs: (runs.data || []).map((r: any) => ({
      id: r.id, goalId: r.goal_id, title: r.title, summary: r.summary, status: r.status,
      capability: r.capability, progress: r.progress, startedAt: r.started_at,
      updatedAt: r.updated_at, nextCheckAt: r.next_check_at, why: r.why,
    })),
    goals: (goals.data || []).map((g: any) => ({
      id: g.id, title: g.title, outcome: g.outcome, status: g.status, progress: g.progress,
      deadline: g.deadline, nextAction: g.next_action, blockers: Array.isArray(g.blockers) ? g.blockers : [],
    })),
    ideas: (ideas.data || []).map((i: any) => ({
      id: i.id, title: i.title, reason: i.reason, expectedValue: i.expected_value,
      actionLabel: i.action_label, sourceRefs: i.source_refs, status: i.status,
      createdAt: i.created_at, snoozedUntil: i.snoozed_until,
    })),
    approvals: (approvals.data || []).map((a: any) => ({
      id: a.id, runId: a.run_id, actionType: a.action_type, title: a.title,
      description: a.description, preview: a.payload_preview, risk: a.risk_level,
      status: a.status, requestedAt: a.requested_at, resolvedAt: a.resolved_at,
    })),
    permissions: mergedPermissions,
    artifacts: (artifacts.data || []).map((a: any) => ({
      id: a.id, type: a.type, title: a.title, subtitle: a.subtitle, updatedAt: a.updated_at,
    })),
  })
}
