import { NextResponse } from 'next/server'
import { getSession } from '@/lib/dashboard/session'
import { verifySameOrigin } from '@/lib/dashboard/guard'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

// One edit to the owner's own Space → a new version (compare-and-set). Workspace Spaces are not editable here yet.
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const blocked = verifySameOrigin(request); if (blocked) return blocked
  const session = await getSession()
  if (!session) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  const owner = String(session.telegramId)
  const live = await import('@/lib/spaces/sources-live')
  if (!live.spacesEnabledFor(owner)) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })
  const { slug } = await params
  if (!/^[a-z][a-z0-9_]{0,40}$/.test(slug)) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })
  const body = await request.json().catch(() => null) as { expectedVersion?: unknown; edit?: any } | null
  const expectedVersion = Number(body?.expectedVersion)
  const op = body?.edit?.op
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1 || !['rename', 'add_block', 'remove_block', 'move_block', 'set_refresh', 'set_text'].includes(op)) return NextResponse.json({ ok: false, error: 'invalid_request' }, { status: 400 })
  const st = await import('@/lib/spaces/store'); const { skillDefinition } = await import('@/lib/agent/skill-registry'); const { ensureBuiltinSkills } = await import('@/lib/agent/skills-builtin')
  ensureBuiltinSkills()
  try {
    const s = await st.applyEdit(supabaseAdmin, { kind: 'user', telegramId: owner }, slug, expectedVersion, body!.edit, owner, id => skillDefinition(id))
    const { rowId: _r, ...doc } = s
    return NextResponse.json({ ok: true, space: doc })
  } catch (e: any) {
    const code = e?.code || 'failed'
    return NextResponse.json({ ok: false, error: code, detail: code === 'invalid' ? String(e.message).slice(0, 300) : undefined }, { status: code === 'stale_version' ? 409 : code === 'not_found' ? 404 : code === 'invalid' ? 400 : code === 'spaces_not_enabled' ? 503 : 500 })
  }
}
