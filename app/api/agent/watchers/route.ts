import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { isAgentSession, requireAgentMutationOrigin, requireAgentSession } from '@/lib/agent/session'
import { createDeadlineWatcher, normalizeDeadlineWatcher } from '@/lib/agent/watchers'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const session = await requireAgentSession(request)
  if (!isAgentSession(session)) return session
  const { data, error } = await supabaseAdmin.from('agent_watchers')
    .select('id, goal_id, type, condition_json, cadence_minutes, active, last_checked_at, next_check_at, created_at, updated_at')
    .eq('telegram_id', session.telegramId)
    .order('created_at', { ascending:false })
    .limit(50)
  if (error) return NextResponse.json({ error:'read_failed' }, { status:500 })
  return NextResponse.json({ watchers:data || [] })
}

export async function POST(request: Request) {
  const blocked = requireAgentMutationOrigin(request)
  if (blocked) return blocked
  const session = await requireAgentSession(request)
  if (!isAgentSession(session)) return session
  const body = await request.json().catch(() => null) as any
  if (String(body?.type || 'deadline') !== 'deadline') return NextResponse.json({ error:'watcher_type_not_available' }, { status:400 })
  const condition = normalizeDeadlineWatcher(body)
  if (!condition) return NextResponse.json({ error:'invalid_deadline_watcher' }, { status:400 })
  try {
    const watcher = await createDeadlineWatcher({ telegramId:session.telegramId, condition, goalId:body?.goalId || null })
    await supabaseAdmin.from('agent_activity').insert({
      telegram_id:session.telegramId,
      event_type:'watcher_created',
      message:`Background Gogo is watching: ${condition.title}`,
      metadata_json:{ watcher_id:watcher.id, type:'deadline', delivery:condition.delivery },
    })
    return NextResponse.json({ watcher }, { status:201 })
  } catch (err:any) {
    console.error('AGENT_WATCHER_CREATE_FAILED:', err?.message || err)
    return NextResponse.json({ error:'create_failed' }, { status:500 })
  }
}
