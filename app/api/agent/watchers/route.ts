import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { isAgentSession, requireAgentMutationOrigin, requireAgentSession } from '@/lib/agent/session'
import {
  createDeadlineWatcher,
  createWebSearchWatcher,
  normalizeDeadlineWatcher,
  normalizeWebSearchWatcher,
} from '@/lib/agent/watchers'

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
  const type = String(body?.type || 'deadline')

  try {
    if (type === 'deadline') {
      const condition = normalizeDeadlineWatcher(body)
      if (!condition) return NextResponse.json({ error:'invalid_deadline_watcher' }, { status:400 })
      const watcher = await createDeadlineWatcher({ telegramId:session.telegramId, condition, goalId:body?.goalId || null })
      await supabaseAdmin.from('agent_activity').insert({
        telegram_id:session.telegramId,
        event_type:'watcher_created',
        message:`Background Gogo is watching: ${condition.title}`,
        metadata_json:{ watcher_id:watcher.id, type:'deadline', delivery:condition.delivery },
      })
      return NextResponse.json({ watcher }, { status:201 })
    }

    if (type === 'web_search') {
      const condition = normalizeWebSearchWatcher(body)
      if (!condition) return NextResponse.json({ error:'invalid_web_search_watcher' }, { status:400 })
      const watcher = await createWebSearchWatcher({ telegramId:session.telegramId, condition, goalId:body?.goalId || null })
      await supabaseAdmin.from('agent_activity').insert({
        telegram_id:session.telegramId,
        event_type:'watcher_created',
        message:`Background Gogo is watching the web: ${condition.title}`,
        metadata_json:{ watcher_id:watcher.id, type:'web_search', delivery:condition.delivery, cadence_minutes:condition.cadenceMinutes },
      })
      return NextResponse.json({ watcher }, { status:201 })
    }

    return NextResponse.json({ error:'watcher_type_not_available' }, { status:400 })
  } catch (err:any) {
    console.error('AGENT_WATCHER_CREATE_FAILED:', err?.message || err)
    return NextResponse.json({ error:'create_failed' }, { status:500 })
  }
}
