import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/dashboard/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { confirmGogoAgentRun, runGogoAgent } from '@/lib/agent/runtime'
import { getAgentRunForUser, getAgentSteps } from '@/lib/agent/run-store'
import type { AgentActor, AgentContext } from '@/lib/agent/types'

export const dynamic = 'force-dynamic'

function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get('origin')
  if (!origin) return false
  try { return new URL(origin).host === req.nextUrl.host } catch { return false }
}

async function resolveActor(): Promise<AgentActor | null> {
  const session = await getSession()
  if (!session) return null
  const legacyTelegramId = Number(session.telegramId)
  if (!Number.isFinite(legacyTelegramId)) return null

  const { data, error } = await supabaseAdmin
    .from('users')
    .select('id, telegram_id, whatsapp_id, name')
    .eq('telegram_id', legacyTelegramId)
    .maybeSingle()

  if (error || !data?.id || !data?.whatsapp_id) return null
  return {
    userId: String(data.id),
    legacyTelegramId: Number(data.telegram_id),
    whatsappId: String(data.whatsapp_id),
    name: data.name || 'Gogo',
  }
}

function cleanContext(value: unknown): AgentContext {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const raw = value as Record<string, unknown>
  return {
    screen: typeof raw.screen === 'string' ? raw.screen.slice(0, 100) : null,
    selectedItemId: typeof raw.selectedItemId === 'string' ? raw.selectedItemId.slice(0, 200) : null,
    selectedItemType: typeof raw.selectedItemType === 'string' ? raw.selectedItemType.slice(0, 100) : null,
    deepLink: typeof raw.deepLink === 'string' ? raw.deepLink.slice(0, 500) : null,
    locale: typeof raw.locale === 'string' ? raw.locale.slice(0, 30) : null,
    timezone: typeof raw.timezone === 'string' ? raw.timezone.slice(0, 80) : null,
  }
}

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const actor = await resolveActor()
  if (!actor) return NextResponse.json({ error: 'unauthorized_or_whatsapp_not_linked' }, { status: 401 })

  const body = await req.json().catch(() => null) as any
  if (!body) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })

  try {
    if (body.action === 'confirm') {
      const runId = String(body.runId || '').trim()
      if (!runId) return NextResponse.json({ error: 'run_id_required' }, { status: 400 })
      const result = await confirmGogoAgentRun({ runId, actor, surface: 'web' })
      return NextResponse.json(result)
    }

    const text = String(body.text || '').trim().slice(0, 2000)
    if (!text) return NextResponse.json({ error: 'text_required' }, { status: 400 })

    const result = await runGogoAgent({
      actor,
      surface: 'web',
      text,
      context: cleanContext(body.context),
    })
    return NextResponse.json(result)
  } catch (error: any) {
    console.error('GOGO_AGENT_RUN_FAILED:', error?.message || error)
    const known = String(error?.message || '')
    if (known === 'agent_run_not_found') return NextResponse.json({ error: known }, { status: 404 })
    if (known === 'agent_run_not_awaiting_confirmation') return NextResponse.json({ error: known }, { status: 409 })
    return NextResponse.json({ error: 'agent_run_failed', message: 'Gogo had trouble with that. Try once more.' }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  const actor = await resolveActor()
  if (!actor) return NextResponse.json({ error: 'unauthorized_or_whatsapp_not_linked' }, { status: 401 })
  const runId = String(req.nextUrl.searchParams.get('runId') || '').trim()
  if (!runId) return NextResponse.json({ error: 'run_id_required' }, { status: 400 })

  try {
    const run = await getAgentRunForUser(runId, actor.userId)
    if (!run) return NextResponse.json({ error: 'agent_run_not_found' }, { status: 404 })
    const steps = await getAgentSteps(runId)
    return NextResponse.json({ run, steps })
  } catch (error: any) {
    console.error('GOGO_AGENT_RUN_READ_FAILED:', error?.message || error)
    return NextResponse.json({ error: 'agent_run_read_failed' }, { status: 500 })
  }
}
