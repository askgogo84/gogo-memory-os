import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { isAgentSession, requireAgentMutationOrigin, requireAgentSession } from '@/lib/agent/session'
import { isMissingColumnError, parseWatcherAction, pausePatch, resumePatch, watcherState } from '@/lib/agent/watcher-pause'

export const dynamic = 'force-dynamic'

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const blocked = requireAgentMutationOrigin(request)
  if (blocked) return blocked
  const session = await requireAgentSession(request)
  if (!isAgentSession(session)) return session
  const { id } = await context.params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error:'invalid_watcher' }, { status:400 })
  const now = new Date().toISOString()
  const { data, error } = await supabaseAdmin.from('agent_watchers')
    .update({ active:false, next_check_at:null, updated_at:now })
    .eq('id', id).eq('telegram_id', session.telegramId)
    .select('id, active').maybeSingle()
  if (error) return NextResponse.json({ error:'stop_failed' }, { status:500 })
  if (!data) return NextResponse.json({ error:'not_found' }, { status:404 })
  await supabaseAdmin.from('agent_activity').insert({ telegram_id:session.telegramId, event_type:'watcher_stopped', message:'Background Gogo watch stopped.', metadata_json:{ watcher_id:id } })
  return NextResponse.json({ watcher:data })
}

/** G5: pause or resume a watch. Owner-scoped; a stopped watch cannot be resumed (ask Gogo again instead). */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const blocked = requireAgentMutationOrigin(request)
  if (blocked) return blocked
  const session = await requireAgentSession(request)
  if (!isAgentSession(session)) return session
  const { id } = await context.params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error:'invalid_watcher' }, { status:400 })
  const action = parseWatcherAction(await request.json().catch(() => null))
  if (!action) return NextResponse.json({ error:'invalid_action' }, { status:400 })
  const now = new Date()
  const { data, error } = await supabaseAdmin.from('agent_watchers')
    .update(action === 'pause' ? pausePatch(now) : resumePatch(now))
    .eq('id', id).eq('telegram_id', session.telegramId).eq('active', true)
    .select('id, active, paused_at, next_check_at').maybeSingle()
  if (isMissingColumnError(error)) return NextResponse.json({ error:'migration_required', message:'Pause needs the agent_watchers.paused_at migration (20261109190000).' }, { status:409 })
  if (error) return NextResponse.json({ error:`${action}_failed` }, { status:500 })
  if (!data) return NextResponse.json({ error:'not_found' }, { status:404 })
  await supabaseAdmin.from('agent_activity').insert({ telegram_id:session.telegramId, event_type:action === 'pause' ? 'watcher_paused' : 'watcher_resumed', message:action === 'pause' ? 'Background Gogo watch paused.' : 'Background Gogo watch resumed.', metadata_json:{ watcher_id:id } })
  return NextResponse.json({ watcher:{ ...data, state: watcherState(data) } })
}
