import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { isAgentSession, requireAgentSession } from '@/lib/agent/session'

export const dynamic = 'force-dynamic'

type HomeItem = {
  id: string
  kind: 'approval' | 'working' | 'watching' | 'idea' | 'done'
  title: string
  body: string
  timestamp: string | null
  actionLabel?: string
  runId?: string
  approvalId?: string
  watcherId?: string
  ideaId?: string
  progress?: number | null
  capability?: string | null
}

export async function GET(request: Request) {
  const session = await requireAgentSession(request)
  if (!isAgentSession(session)) return session
  const tg = session.telegramId

  const [runs, watchers, ideas, approvals, reminders] = await Promise.all([
    supabaseAdmin
      .from('agent_runs')
      .select('id,title,summary,status,capability,progress,updated_at,started_at')
      .eq('telegram_id', tg)
      .order('updated_at', { ascending: false })
      .limit(24),
    supabaseAdmin
      .from('agent_watchers')
      .select('id,type,condition_json,last_checked_at,next_check_at,created_at')
      .eq('telegram_id', tg)
      .eq('active', true)
      .order('created_at', { ascending: false })
      .limit(16),
    supabaseAdmin
      .from('agent_ideas')
      .select('id,title,reason,expected_value,action_label,created_at')
      .eq('telegram_id', tg)
      .eq('status', 'new')
      .order('created_at', { ascending: false })
      .limit(12),
    supabaseAdmin
      .from('agent_approvals')
      .select('id,run_id,title,description,risk_level,requested_at')
      .eq('telegram_id', tg)
      .eq('status', 'pending')
      .order('requested_at', { ascending: false })
      .limit(12),
    supabaseAdmin
      .from('reminders')
      .select('id,message,remind_at,due_at_utc,due_at_local,timezone,status,sent,created_at')
      .eq('telegram_id', tg)
      .or('status.eq.pending,status.is.null')
      .eq('sent', false)
      .order('remind_at', { ascending: true })
      .limit(12),
  ])

  const queryError = runs.error || watchers.error || ideas.error || approvals.error || reminders.error
  if (queryError) {
    console.error('AGENT_HOME_READ_FAILED:', queryError)
    return NextResponse.json({ error: 'read_failed' }, { status: 500 })
  }

  const runRows = (runs.data || []) as any[]
  const watcherRows = (watchers.data || []) as any[]
  const ideaRows = (ideas.data || []) as any[]
  const approvalRows = (approvals.data || []) as any[]
  const reminderRows = (reminders.data || []) as any[]

  const activeRuns = runRows.filter((r) => ['queued', 'running', 'watching', 'waiting_approval'].includes(String(r.status)))
  const completedRuns = runRows.filter((r) => String(r.status) === 'completed')

  const items: HomeItem[] = []

  for (const a of approvalRows) {
    items.push({
      id: `approval:${a.id}`,
      kind: 'approval',
      title: String(a.title || 'Gogo needs your approval'),
      body: String(a.description || 'Review this consequential action before Gogo continues.'),
      timestamp: a.requested_at || null,
      actionLabel: 'Review',
      runId: a.run_id || undefined,
      approvalId: a.id,
    })
  }

  for (const r of activeRuns.slice(0, 6)) {
    items.push({
      id: `run:${r.id}`,
      kind: 'working',
      title: String(r.title || 'Gogo is working'),
      body: String(r.summary || 'Working on this in the background.'),
      timestamp: r.updated_at || r.started_at || null,
      actionLabel: 'View activity',
      runId: r.id,
      progress: typeof r.progress === 'number' ? r.progress : null,
      capability: r.capability || null,
    })
  }

  for (const reminder of reminderRows.slice(0, 6)) {
    const due = reminder.due_at_local || reminder.due_at_utc || reminder.remind_at
    const dueLabel = due ? String(due) : 'scheduled time'
    items.push({
      id: `reminder:${reminder.id}`,
      kind: 'watching',
      title: `Reminder: ${String(reminder.message || 'Scheduled reminder')}`,
      body: `Scheduled for ${dueLabel}${reminder.timezone ? ` · ${reminder.timezone}` : ''}`,
      timestamp: reminder.created_at || reminder.remind_at || null,
      actionLabel: 'Scheduled',
      capability: 'reminders',
    })
  }

  for (const w of watcherRows.slice(0, 5)) {
    const condition = w.condition_json && typeof w.condition_json === 'object' ? w.condition_json : {}
    items.push({
      id: `watcher:${w.id}`,
      kind: 'watching',
      title: String(condition.title || 'Gogo is watching this'),
      body: w.next_check_at ? `Next check ${new Date(w.next_check_at).toISOString()}` : 'Gogo will surface a meaningful change when it happens.',
      timestamp: w.last_checked_at || w.created_at || null,
      actionLabel: 'Open watch',
      watcherId: w.id,
    })
  }

  for (const i of ideaRows.slice(0, 5)) {
    items.push({
      id: `idea:${i.id}`,
      kind: 'idea',
      title: String(i.title || 'An idea from Gogo'),
      body: String(i.reason || i.expected_value || 'Gogo found something that may help.'),
      timestamp: i.created_at || null,
      actionLabel: String(i.action_label || 'Tell me more'),
      ideaId: i.id,
    })
  }

  for (const r of completedRuns.slice(0, 4)) {
    items.push({
      id: `done:${r.id}`,
      kind: 'done',
      title: String(r.title || 'Done'),
      body: String(r.summary || 'Gogo completed this.'),
      timestamp: r.updated_at || r.started_at || null,
      actionLabel: 'See result',
      runId: r.id,
      capability: r.capability || null,
    })
  }

  const priority: Record<HomeItem['kind'], number> = { approval: 0, working: 1, watching: 2, idea: 3, done: 4 }
  items.sort((a, b) => {
    const rank = priority[a.kind] - priority[b.kind]
    if (rank !== 0) return rank
    return String(b.timestamp || '').localeCompare(String(a.timestamp || ''))
  })

  const working = activeRuns.filter((r) => ['queued', 'running'].includes(String(r.status))).length
  const watching = reminderRows.length + watcherRows.length + activeRuns.filter((r) => String(r.status) === 'watching').length
  const waiting = approvalRows.length

  const state = waiting > 0 ? 'waiting' : working > 0 ? 'working' : watching > 0 ? 'watching' : items.length > 0 ? 'ready' : 'idle'

  return NextResponse.json({
    surface: session.surface,
    state,
    counts: { working, watching, waiting, ideas: ideaRows.length },
    headline:
      waiting > 0
        ? `${waiting} ${waiting === 1 ? 'thing needs' : 'things need'} you.`
        : working > 0
          ? `Gogo is working on ${working} ${working === 1 ? 'thing' : 'things'}.`
          : watching > 0
            ? `Gogo is watching ${watching} ${watching === 1 ? 'thing' : 'things'} for you.`
            : 'What can Gogo take off your plate?',
    subline:
      waiting > 0
        ? 'Everything else can keep moving in the background.'
        : 'Your memory, tools, approvals and activity stay shared with WhatsApp.',
    items: items.slice(0, 18),
  })
}
