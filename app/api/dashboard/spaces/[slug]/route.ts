import { NextResponse } from 'next/server'
import { getSession } from '@/lib/dashboard/session'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

// One Space + its block data. ?workspace=<uuid> reads a workspace Space after a membership check ('view').
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  const owner = String(session.telegramId)
  const live = await import('@/lib/spaces/sources-live')
  if (!live.spacesEnabledFor(owner)) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })
  const { slug } = await params
  if (!/^[a-z][a-z0-9_]{0,40}$/.test(slug)) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })
  const ws = new URL(request.url).searchParams.get('workspace')
  let scope: { kind: 'user'; telegramId: string } | { kind: 'workspace'; workspaceId: string } = { kind: 'user', telegramId: owner }
  if (ws) {
    if (!/^[0-9a-f-]{36}$/i.test(ws)) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })
    try { await (await import('@/lib/workspaces/access')).requireWorkspaceRole(owner, ws, 'view') } catch { return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 }) }
    scope = { kind: 'workspace', workspaceId: ws }
  }
  const st = await import('@/lib/spaces/store')
  try {
    const space = await st.getSpace(supabaseAdmin, scope, slug)
    if (!space) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })
    const { rowId: _r, ...doc } = space
    const { resolveSpace } = await import('@/lib/spaces/sources')
    const permission = scope.kind === 'workspace' ? (() => 'read' as const) : await live.permissionReader(owner)
    const data = await resolveSpace(doc, { owner, now: Date.now(), tz: 'Asia/Kolkata', deps: live.liveSourceDeps() }, permission)
    return NextResponse.json({ ok: true, space: doc, data }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e: any) { return NextResponse.json({ ok: false, error: e?.code || 'failed' }, { status: e?.code === 'spaces_not_enabled' ? 503 : 500 }) }
}
