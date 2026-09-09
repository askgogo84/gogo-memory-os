import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { isAgentSession, requireAgentMutationOrigin, requireAgentSession } from '@/lib/agent/session'

export const dynamic = 'force-dynamic'

const CAPABILITIES = new Set(['memory','files','email','calendar','browser','contacts','travel','payments'])
const LEVELS = new Set(['off','read','draft','ask','auto'])
const ALWAYS_ASK = new Set(['email','calendar','browser','travel','payments'])

export async function GET() {
  const session = await requireAgentSession()
  if (!isAgentSession(session)) return session

  const { data, error } = await supabaseAdmin
    .from('agent_permissions')
    .select('capability, level, irreversible_always_ask, updated_at')
    .eq('telegram_id', session.telegramId)

  if (error) {
    console.error('AGENT_PERMISSIONS_READ_FAILED:', error)
    return NextResponse.json({ error: 'read_failed' }, { status: 500 })
  }
  return NextResponse.json({ permissions: data || [] })
}

export async function PUT(request: Request) {
  const blocked = requireAgentMutationOrigin(request)
  if (blocked) return blocked
  const session = await requireAgentSession()
  if (!isAgentSession(session)) return session

  const body = await request.json().catch(() => null) as any
  const capability = String(body?.capability || '').trim()
  const level = String(body?.level || '').trim()
  if (!CAPABILITIES.has(capability)) return NextResponse.json({ error: 'invalid_capability' }, { status: 400 })
  if (!LEVELS.has(level)) return NextResponse.json({ error: 'invalid_level' }, { status: 400 })

  // v1 deliberately refuses automatic execution for capabilities that can cause
  // an external consequence. We can selectively loosen this later only after a
  // narrowly-scoped policy exists server-side.
  if (level === 'auto' && ALWAYS_ASK.has(capability)) {
    return NextResponse.json({ error: 'auto_execution_not_available' }, { status: 409 })
  }

  const irreversibleAlwaysAsk = ALWAYS_ASK.has(capability)
  const now = new Date().toISOString()
  const { data, error } = await supabaseAdmin
    .from('agent_permissions')
    .upsert({
      telegram_id: session.telegramId,
      capability,
      level,
      irreversible_always_ask: irreversibleAlwaysAsk,
      updated_at: now,
    }, { onConflict: 'telegram_id,capability' })
    .select('capability, level, irreversible_always_ask, updated_at')
    .single()

  if (error || !data) {
    console.error('AGENT_PERMISSION_SAVE_FAILED:', error)
    return NextResponse.json({ error: 'save_failed' }, { status: 500 })
  }

  const { error: activityError } = await supabaseAdmin.from('agent_activity').insert({
    telegram_id: session.telegramId,
    event_type: 'permission_changed',
    message: `Agent permission changed: ${capability} → ${level}`,
    metadata_json: { capability, level, irreversible_always_ask: irreversibleAlwaysAsk },
  })
  if (activityError) console.error('AGENT_PERMISSION_ACTIVITY_FAILED:', activityError)

  return NextResponse.json({ permission: {
    capability: data.capability,
    level: data.level,
    irreversibleAlwaysAsk: data.irreversible_always_ask,
    updatedAt: data.updated_at,
  } })
}
