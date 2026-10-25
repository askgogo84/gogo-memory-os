import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { isAgentSession, requireAgentSession } from '@/lib/agent/session'

export const dynamic = 'force-dynamic'

export type GogoPresentationState =
  | 'idle'
  | 'planning'
  | 'searching'
  | 'browsing'
  | 'comparing'
  | 'preparing_action'
  | 'waiting_for_site'
  | 'waiting_for_user'
  | 'waiting_approval'
  | 'watching'
  | 'verified'
  | 'completed'
  | 'blocked'
  | 'failed'

function derivePresentationState(run: any, steps: any[]): GogoPresentationState {
  const status = String(run?.status || '')
  const active = steps.find(step => step.status === 'running') || steps.find(step => step.status === 'waiting_approval') || null
  const tool = String(active?.tool_name || '')
  const title = String(active?.title || '').toLowerCase()
  const summary = String(run?.summary || '').toLowerCase()
  const type = String(run?.type || '')

  if (status === 'failed') return 'failed'
  if (status === 'waiting_approval' || active?.status === 'waiting_approval') return 'waiting_approval'
  if (status === 'paused') {
    if (/otp|login|sign in|human|your input|need one detail/.test(summary)) return 'waiting_for_user'
    if (/timeout|provider|site|cloudflare|blocked/.test(summary)) return 'waiting_for_site'
    return 'blocked'
  }
  if (type === 'watcher' || /watch|monitor/.test(title)) return 'watching'
  if (status === 'completed') return 'completed'
  if (status === 'queued') return 'planning'
  if (status !== 'running') return 'idle'

  if (/compare|rank|shortlist/.test(title)) return 'comparing'
  if (/verify|confirm|evidence|reprice/.test(title)) return 'verified'
  if (/prepare|draft|fill|review details|booking/.test(title)) return 'preparing_action'
  if (tool === 'web_search' || type === 'travel_research' || /search|research|fare|flight|hotel/.test(title)) return 'searching'
  if (tool === 'browser' || type === 'secure_browser' || /browser|provider|website|site/.test(title)) return 'browsing'
  return 'planning'
}

function humanStatus(state: GogoPresentationState, run: any, steps: any[]) {
  const active = steps.find(step => ['running','waiting_approval'].includes(String(step.status)))
  if (active?.title) return String(active.title)
  if (state === 'completed') return String(run.summary || 'Completed')
  if (state === 'failed') return String(run.summary || 'Could not complete this task')
  if (state === 'waiting_for_user') return String(run.summary || 'Waiting for you')
  if (state === 'waiting_approval') return String(run.summary || 'Waiting for your approval')
  return String(run.summary || run.title || 'Gogo is working')
}

export async function GET(request: Request) {
  const session = await requireAgentSession(request)
  if (!isAgentSession(session)) return session
  const tg = session.telegramId

  const [runs, steps, activity, approvals] = await Promise.all([
    supabaseAdmin.from('agent_runs')
      .select('id,type,title,summary,status,capability,progress,source,started_at,updated_at,completed_at,next_check_at,error,metadata_json')
      .eq('telegram_id', tg)
      .order('updated_at', { ascending:false })
      .limit(30),
    supabaseAdmin.from('agent_steps')
      .select('id,run_id,ordinal,tool_name,title,status,input_json,output_json,error,started_at,completed_at,created_at')
      .eq('telegram_id', tg)
      .order('created_at', { ascending:false })
      .limit(240),
    supabaseAdmin.from('agent_activity')
      .select('id,run_id,event_type,message,metadata_json,created_at')
      .eq('telegram_id', tg)
      .order('created_at', { ascending:false })
      .limit(300),
    supabaseAdmin.from('agent_approvals')
      .select('id,run_id,title,description,risk_level,status,requested_at')
      .eq('telegram_id', tg)
      .eq('status','pending')
      .order('requested_at', { ascending:false })
      .limit(30),
  ])

  const queryError = runs.error || steps.error || activity.error || approvals.error
  if (queryError) {
    console.error('AGENT_LIVE_READ_FAILED:', queryError)
    return NextResponse.json({ error:'read_failed' }, { status:500 })
  }

  const stepsByRun = new Map<string, any[]>()
  for (const step of steps.data || []) {
    const key = String((step as any).run_id)
    const list = stepsByRun.get(key) || []
    list.push(step)
    stepsByRun.set(key, list)
  }
  for (const list of stepsByRun.values()) list.sort((a,b) => Number(a.ordinal) - Number(b.ordinal))

  const activityByRun = new Map<string, any[]>()
  for (const event of activity.data || []) {
    const key = String((event as any).run_id || '')
    if (!key) continue
    const list = activityByRun.get(key) || []
    if (list.length < 40) list.push(event)
    activityByRun.set(key, list)
  }
  for (const list of activityByRun.values()) list.sort((a,b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())

  const approvalByRun = new Map((approvals.data || []).map((a:any) => [String(a.run_id), a]))

  const normalizedRuns = (runs.data || []).map((run:any) => {
    const runSteps = stepsByRun.get(String(run.id)) || []
    const presentationState = derivePresentationState(run, runSteps)
    const activeStep = runSteps.find((step:any) => ['running','waiting_approval'].includes(String(step.status))) || null
    const completedSteps = runSteps.filter((step:any) => step.status === 'completed').length
    const pendingApproval = approvalByRun.get(String(run.id)) || null
    return {
      id:run.id,
      type:run.type,
      title:run.title,
      status:run.status,
      presentationState,
      displayText:humanStatus(presentationState, run, runSteps),
      capability:run.capability,
      progress:Number(run.progress || 0),
      source:run.source,
      startedAt:run.started_at,
      updatedAt:run.updated_at,
      completedAt:run.completed_at,
      nextCheckAt:run.next_check_at,
      error:run.error || null,
      activeStep:activeStep ? {
        id:activeStep.id,
        ordinal:activeStep.ordinal,
        title:activeStep.title,
        toolName:activeStep.tool_name,
        status:activeStep.status,
      } : null,
      stepCount:runSteps.length,
      completedStepCount:completedSteps,
      steps:runSteps.map((step:any) => ({
        id:step.id,
        ordinal:step.ordinal,
        title:step.title,
        toolName:step.tool_name,
        status:step.status,
        output:step.output_json || {},
        error:step.error || null,
        startedAt:step.started_at,
        completedAt:step.completed_at,
      })),
      activity:(activityByRun.get(String(run.id)) || []).map((event:any) => ({
        id:event.id,
        eventType:event.event_type,
        message:event.message,
        metadata:event.metadata_json || {},
        createdAt:event.created_at,
      })),
      approval:pendingApproval ? {
        id:pendingApproval.id,
        title:pendingApproval.title,
        description:pendingApproval.description,
        risk:pendingApproval.risk_level,
        requestedAt:pendingApproval.requested_at,
      } : null,
      metadata:run.metadata_json || {},
    }
  })

  const activeRuns = normalizedRuns.filter((run:any) => ['running','queued','paused','waiting_approval'].includes(run.status))
  const recentRuns = normalizedRuns.filter((run:any) => !activeRuns.some((active:any) => active.id === run.id)).slice(0,20)

  return NextResponse.json({
    surface:session.surface,
    contractVersion:1,
    states:['idle','planning','searching','browsing','comparing','preparing_action','waiting_for_site','waiting_for_user','waiting_approval','watching','verified','completed','blocked','failed'],
    activeRuns,
    recentRuns,
    generatedAt:new Date().toISOString(),
  })
}
