import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { isAgentSession, requireAgentSession } from '@/lib/agent/session'

export const dynamic = 'force-dynamic'

const DEFAULT_PERMISSIONS = [
  { capability: 'memory', level: 'ask', irreversibleAlwaysAsk: false, label: 'Memory', description: 'Read and save private AskGogo memory.' },
  { capability: 'files', level: 'ask', irreversibleAlwaysAsk: false, label: 'Files & documents', description: 'Read and save connected files and document context.' },
  { capability: 'reminders', level: 'auto', irreversibleAlwaysAsk: false, label: 'Reminders', description: 'Create, move and snooze private reminders.' },
  { capability: 'lists', level: 'auto', irreversibleAlwaysAsk: false, label: 'Lists', description: 'Read and update your AskGogo lists.' },
  { capability: 'tasks', level: 'auto', irreversibleAlwaysAsk: false, label: 'Tasks', description: 'Read and update tasks and to-dos.' },
  { capability: 'email', level: 'draft', irreversibleAlwaysAsk: true, label: 'Email', description: 'Read and draft email. Sending always asks.' },
  { capability: 'calendar', level: 'ask', irreversibleAlwaysAsk: true, label: 'Calendar', description: 'Read calendar freely; changes require approval.' },
  { capability: 'browser', level: 'draft', irreversibleAlwaysAsk: true, label: 'Browser', description: 'Research and prepare forms. Submission always asks.' },
  { capability: 'contacts', level: 'read', irreversibleAlwaysAsk: false, label: 'Contacts', description: 'Read saved people and contact context.' },
  { capability: 'travel', level: 'draft', irreversibleAlwaysAsk: true, label: 'Travel', description: 'Research and organize trips. Booking always asks.' },
  { capability: 'payments', level: 'ask', irreversibleAlwaysAsk: true, label: 'Payments', description: 'Prepare payment actions. Spending always asks.' },
] as const

export async function GET(request: Request) {
  const session = await requireAgentSession(request)
  if (!isAgentSession(session)) return session
  const tg = session.telegramId

  const [runs, steps, goals, ideas, approvals, permissions, artifacts] = await Promise.all([
    supabaseAdmin.from('agent_runs').select('id, goal_id, title, summary, status, capability, progress, started_at, updated_at, next_check_at, why').eq('telegram_id', tg).order('updated_at', { ascending: false }).limit(20),
    supabaseAdmin.from('agent_steps').select('id, run_id, ordinal, tool_name, title, status, output_json, error, started_at, completed_at').eq('telegram_id', tg).order('created_at', { ascending: false }).limit(120),
    supabaseAdmin.from('agent_goals').select('id, title, outcome, status, progress, deadline, next_action, blockers').eq('telegram_id', tg).neq('status', 'cancelled').order('updated_at', { ascending: false }).limit(20),
    supabaseAdmin.from('agent_ideas').select('id, title, reason, expected_value, action_label, source_refs, status, created_at, snoozed_until').eq('telegram_id', tg).in('status', ['new','snoozed']).order('created_at', { ascending: false }).limit(20),
    supabaseAdmin.from('agent_approvals').select('id, run_id, action_type, title, description, payload_preview, risk_level, status, requested_at, resolved_at').eq('telegram_id', tg).eq('status', 'pending').order('requested_at', { ascending: false }).limit(20),
    supabaseAdmin.from('agent_permissions').select('capability, level, irreversible_always_ask, updated_at').eq('telegram_id', tg),
    supabaseAdmin.from('agent_artifacts').select('id, type, title, subtitle, updated_at').eq('telegram_id', tg).order('updated_at', { ascending: false }).limit(20),
  ])

  const queryError = runs.error || steps.error || goals.error || ideas.error || approvals.error || permissions.error || artifacts.error
  if (queryError) {
    console.error('AGENT_SNAPSHOT_READ_FAILED:', queryError)
    return NextResponse.json({ error: 'read_failed' }, { status: 500 })
  }

  const stepsByRun = new Map<string, any[]>()
  for (const step of (steps.data || []) as any[]) {
    const key = String(step.run_id)
    const list = stepsByRun.get(key) || []
    list.push({
      id: step.id,
      ordinal: step.ordinal,
      toolName: step.tool_name,
      title: step.title,
      status: step.status,
      output: step.output_json || {},
      error: step.error || null,
      startedAt: step.started_at || null,
      completedAt: step.completed_at || null,
    })
    stepsByRun.set(key, list)
  }
  for (const list of stepsByRun.values()) list.sort((a, b) => a.ordinal - b.ordinal)

  const permissionByCapability = new Map((permissions.data || []).map((p: any) => [p.capability, p]))
  const mergedPermissions = DEFAULT_PERMISSIONS.map((definition) => {
    const stored: any = permissionByCapability.get(definition.capability)
    return {
      capability: definition.capability,
      label: definition.label,
      description: definition.description,
      level: stored?.level || definition.level,
      irreversibleAlwaysAsk: stored?.irreversible_always_ask ?? definition.irreversibleAlwaysAsk,
      updatedAt: stored?.updated_at || null,
    }
  })

  return NextResponse.json({
    surface: session.surface,
    runs: (runs.data || []).map((r: any) => ({
      id: r.id, goalId: r.goal_id, title: r.title, summary: r.summary, status: r.status,
      capability: r.capability, progress: r.progress, startedAt: r.started_at,
      updatedAt: r.updated_at, nextCheckAt: r.next_check_at, why: r.why,
      steps: stepsByRun.get(String(r.id)) || [],
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
      description: a.description, preview: Array.isArray(a.payload_preview) ? a.payload_preview : [], risk: a.risk_level,
      status: a.status, requestedAt: a.requested_at, resolvedAt: a.resolved_at,
      primaryLabel: 'Approve & run', secondaryLabel: 'Not now',
    })),
    permissions: mergedPermissions,
    artifacts: (artifacts.data || []).map((a: any) => ({
      id: a.id, type: a.type, title: a.title, subtitle: a.subtitle, updatedAt: a.updated_at,
    })),
  })
}
