// Make v2: "Refresh from sources" re-runs the request that made this result through the same general-plan entry point
// the chat uses (prepareGeneralPlanForActor + tryRunGeneralPlan). Only read-only research plans are refreshed; anything
// that could change things is refused with a plain reason (409). The existing approval gates apply inside the run, and
// the regenerated result keeps the owner's edited sections and notes (mergeRegenerated in createArtifact).
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { isAgentSession, requireAgentMutationOrigin, requireAgentSession } from '@/lib/agent/session'
import { resolveAgentActor } from '@/lib/agent/actor'
import { prepareGeneralPlanForActor, tryRunGeneralPlan, type GeneralPlanStep } from '@/lib/agent/general-planner'
import { agentRunRefOf, planRefreshBlock, refreshCheck } from '@/lib/agent/artifact-versions'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const refuse = (reason: string) => NextResponse.json({ error: 'not_refreshable', reason }, { status: 409 })

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const blocked = requireAgentMutationOrigin(request)
  if (blocked) return blocked
  const session = await requireAgentSession(request)
  if (!isAgentSession(session)) return session
  const { id } = await context.params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'invalid_artifact' }, { status: 400 })
  try {
    const { data: artifact, error } = await supabaseAdmin.from('agent_artifacts')
      .select('id,type,title,content_json,source_refs,updated_at')
      .eq('id', id).eq('telegram_id', session.telegramId).maybeSingle()
    if (error) throw new Error(`artifact_refresh_read_failed:${error.message}`)
    if (!artifact) return NextResponse.json({ error: 'artifact_not_found' }, { status: 404 })
    const runRef = agentRunRefOf(artifact.source_refs)
    let run: any = null
    if (runRef) {
      const { data, error: runError } = await supabaseAdmin.from('agent_runs').select('id,status,type,title,metadata_json')
        .eq('id', runRef).eq('telegram_id', session.telegramId).maybeSingle()
      if (runError) throw new Error(`artifact_refresh_run_read_failed:${runError.message}`)
      run = data
    }
    const check = refreshCheck(artifact, run)
    if ('reason' in check) return refuse(check.reason)

    // The same request may already be running again (a chat retry, another tab).
    const { data: active, error: activeError } = await supabaseAdmin.from('agent_runs').select('id,metadata_json')
      .eq('telegram_id', session.telegramId).in('status', ['queued', 'running', 'waiting_approval', 'paused'])
      .order('started_at', { ascending: false }).limit(20)
    if (activeError) throw new Error(`artifact_refresh_active_read_failed:${activeError.message}`)
    if ((active || []).some((r: any) => String(r?.metadata_json?.input_text || '').trim() === check.missionText)) return refuse('Gogo is already working on this same request.')

    const actor = await resolveAgentActor(session)
    const prepared = await prepareGeneralPlanForActor(actor, check.missionText)
    if (!prepared.plan) return refuse('Gogo could not rebuild a plan for this result.')
    // The new plan is checked again: a re-plan that would change things is never run from here.
    const block = planRefreshBlock(prepared.plan)
    if (block) return refuse(block)
    // Point the save step at this result, so the refresh updates it (keeping owner edits) instead of making a copy.
    prepared.plan.steps = prepared.plan.steps.map((s: GeneralPlanStep) => s.tool === 'artifact'
      ? { ...s, artifactTitle: String(artifact.title || s.artifactTitle || ''), artifactType: String(artifact.type) as GeneralPlanStep['artifactType'] } : s)

    const requestedAt = new Date().toISOString()
    let mark = supabaseAdmin.from('agent_artifacts').update({ content_json: { ...(artifact.content_json || {}), refreshRequestedAt: requestedAt } })
      .eq('id', id).eq('telegram_id', session.telegramId)
    mark = artifact.updated_at ? mark.eq('updated_at', artifact.updated_at) : mark.is('updated_at', null)
    const { data: marked, error: markError } = await mark.select('id')
    if (markError) throw new Error(`artifact_refresh_mark_failed:${markError.message}`)
    if (!Array.isArray(marked) || !marked.length) return refuse('This result changed while you were looking at it. Reload and try again.')
    const { error: activityError } = await supabaseAdmin.from('agent_activity').insert({
      telegram_id: session.telegramId, run_id: check.runId, event_type: 'artifact_refresh_requested',
      message: `Refresh requested — ${String(artifact.title || 'result').slice(0, 200)}`,
      metadata_json: { artifact_id: id, by: String(actor.userId), surface: session.surface },
    })
    if (activityError) console.error('ARTIFACT_REFRESH_ACTIVITY_FAILED:', activityError.message)

    const result = await tryRunGeneralPlan({ actor, surface: session.surface, text: check.missionText, prepared })
    if (!result) return refuse('Gogo could not rebuild a plan for this result.')
    return NextResponse.json({ ok: true, runId: result.runId, status: result.status, text: String(result.text || '').slice(0, 2000) },
      { status: result.status === 'waiting_approval' ? 202 : 200 })
  } catch (err: any) {
    console.error('ARTIFACT_REFRESH_FAILED:', String(err?.message || err).slice(0, 200))
    return NextResponse.json({ error: 'refresh_failed' }, { status: 500 })
  }
}
