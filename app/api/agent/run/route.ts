import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { isAgentSession, requireAgentMutationOrigin, requireAgentSession } from '@/lib/agent/session'
import { resolveAgentActor } from '@/lib/agent/actor'
import { runAgentCommand } from '@/lib/agent/orchestrator'
import { tryRunExpiryReminderPlan } from '@/lib/agent/compound-planner'
import { tryPrepareTravelCalendarPlan } from '@/lib/agent/travel-calendar-plan'
import { tryCreateWebWatchFromCommand } from '@/lib/agent/watch-command'
import { tryRunBrowserCommand } from '@/lib/agent/browser-command'
import { tryRunGeneralPlan } from '@/lib/agent/general-planner'
import { tryRunCreditIQHotelResearch } from '@/lib/agent/creditiq-hotel-research'
import { tryRunTravelResearch } from '@/lib/agent/travel-research'
import { hardenTravelResearchResult } from '@/lib/agent/travel-research-sanitize'
import { attachRunToThread, resolveThreadForUser } from '@/lib/agent/thread-context'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(request: Request) {
  const blocked = requireAgentMutationOrigin(request)
  if (blocked) return blocked

  const session = await requireAgentSession(request)
  if (!isAgentSession(session)) return session

  const body = await request.json().catch(() => null) as any
  const text = String(body?.text || '').trim().slice(0, 2000)
  if (!text) return NextResponse.json({ error: 'text_required' }, { status: 400 })

  try {
    const actor = await resolveAgentActor(session)
    const thread = await resolveThreadForUser(session.telegramId, body?.context?.threadId)
    const respond = async (result:any, status:number) => {
      await attachRunToThread(session.telegramId, result?.runId, thread?.id || null)
      return NextResponse.json(result, { status })
    }

    // Browser retries / impatient double-clicks must not create two live missions and
    // two approval cards. Reuse an identical active run started in the last 90 seconds.
    // We intentionally dedupe only ACTIVE runs, so intentionally repeating a completed
    // mission later still works.
    const cutoff = new Date(Date.now() - 90_000).toISOString()
    const { data: recentActive, error: dedupeError } = await supabaseAdmin
      .from('agent_runs')
      .select('id,status,title,summary,capability,metadata_json,started_at')
      .eq('telegram_id', String(session.telegramId))
      .in('status', ['queued','running','waiting_approval'])
      .gte('started_at', cutoff)
      .order('started_at', { ascending: false })
      .limit(8)
    if (dedupeError) console.error('AGENT_RUN_DEDUPE_READ_FAILED:', dedupeError.message)
    const duplicate = (recentActive || []).find((row:any) =>
      String(row?.metadata_json?.input_text || '').trim() === text
    )
    if (duplicate?.id) {
      return respond({
        runId: String(duplicate.id),
        status: duplicate.status,
        capability: duplicate.capability || 'memory',
        risk: 'low',
        text: duplicate.summary || 'Gogo is already working on this outcome.',
        handledBy: 'active-run-dedupe',
        deduplicated: true,
      }, duplicate.status === 'waiting_approval' ? 202 : 200)
    }

    // Explicit background watches and explicit URL/browser commands are deterministic
    // and should always win before open-ended planning.
    const webWatch = await tryCreateWebWatchFromCommand({ actor, surface:session.surface, text })
    if (webWatch) return respond(webWatch, 200)

    const browser = await tryRunBrowserCommand({ actor, surface:session.surface, text })
    if (browser) return respond(browser, browser.status === 'waiting_approval' ? 202 : 200)

    // Specialist cross-feature plans remain ahead of the general planner because
    // they carry tighter deterministic parsing and approval semantics.
    const travelCalendar = await tryPrepareTravelCalendarPlan({ actor, surface:session.surface, text })
    if (travelCalendar) return respond(travelCalendar, travelCalendar.status === 'waiting_approval' ? 202 : 200)

    const compound = await tryRunExpiryReminderPlan({
      actor,
      surface: session.surface,
      text,
      messageId: body?.messageId || null,
    })
    if (compound) return respond(compound, 200)

    // Multi-step missions must be planned before single-feature fallbacks. This is
    // the Muse-style outcome path: memory/research/actions/approval/artifact can be
    // one run instead of a travel keyword collapsing the request into one search.
    const generalPlan = await tryRunGeneralPlan({
      actor,
      surface: session.surface,
      text,
      messageId: body?.messageId || null,
    })
    if (generalPlan) return respond(generalPlan, generalPlan.status === 'waiting_approval' ? 202 : 200)

    // Live hotels are supplied by CreditIQ through a signed service bridge. If the
    // service is not configured or returns no live inventory, this returns null and
    // the hardened public-web travel fallback remains available.
    const liveHotels = await tryRunCreditIQHotelResearch({ actor, surface:session.surface, text })
    if (liveHotels) return respond(liveHotels, 200)

    // Simple current-market travel research is a single-feature fallback. It still
    // runs before saved-travel retrieval, and its output is hardened for direction,
    // dates and fare claims. Flight requests prefer CreditIQ live inventory inside
    // this path before falling back to public search.
    const travelResearch = await tryRunTravelResearch({ actor, surface:session.surface, text })
    if (travelResearch) {
      const hardened = await hardenTravelResearchResult(travelResearch, text)
      return respond(hardened, 200)
    }

    const result = await runAgentCommand({
      actor,
      surface: session.surface,
      text,
      context: { ...(body?.context || {}), ...(thread ? { threadTitle:thread.title, threadContext:thread.context } : {}) },
      messageId: body?.messageId || null,
    })
    return respond(result, result.status === 'waiting_approval' ? 202 : 200)
  } catch (error: any) {
    console.error('AGENT_RUN_FAILED:', error?.message || error)
    const message = String(error?.message || '')
    if (message === 'whatsapp_identity_required') return NextResponse.json({ error: message }, { status: 409 })
    if (message === 'agent_actor_not_found') return NextResponse.json({ error: message }, { status: 404 })
    if (message === 'invalid_thread' || message === 'thread_not_found') return NextResponse.json({ error: message }, { status: 400 })
    return NextResponse.json({ error: 'agent_run_failed' }, { status: 500 })
  }
}
