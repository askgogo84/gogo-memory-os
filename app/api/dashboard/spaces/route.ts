import { NextResponse } from 'next/server'
import { getSession } from '@/lib/dashboard/session'
import { verifySameOrigin } from '@/lib/dashboard/guard'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

// Gogo Spaces list + create from a template (six docs §5). Behind GOGO_SPACES / GOGO_SPACES_OWNERS; off → 404.
export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  const owner = String(session.telegramId)
  const { spacesEnabledFor } = await import('@/lib/spaces/sources-live')
  if (!spacesEnabledFor(owner)) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })
  const st = await import('@/lib/spaces/store')
  try { return NextResponse.json({ ok: true, spaces: await st.listSpaces(supabaseAdmin, { kind: 'user', telegramId: owner }), templates: ['my_day', 'trip_board'] }, { headers: { 'Cache-Control': 'no-store' } }) }
  catch (e: any) { return NextResponse.json({ ok: false, error: e?.code || 'failed' }, { status: e?.code === 'spaces_not_enabled' ? 503 : 500 }) }
}

export async function POST(request: Request) {
  const blocked = verifySameOrigin(request); if (blocked) return blocked
  const session = await getSession()
  if (!session) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  const owner = String(session.telegramId)
  const { spacesEnabledFor } = await import('@/lib/spaces/sources-live')
  if (!spacesEnabledFor(owner)) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })
  const body = await request.json().catch(() => null) as { template?: unknown } | null
  const template = String(body?.template || '')
  if (!['my_day', 'trip_board'].includes(template)) return NextResponse.json({ ok: false, error: 'invalid_template' }, { status: 400 })
  const st = await import('@/lib/spaces/store'); const { skillDefinition } = await import('@/lib/agent/skill-registry'); const { ensureBuiltinSkills } = await import('@/lib/agent/skills-builtin')
  ensureBuiltinSkills()
  try { const s = await st.createFromTemplate(supabaseAdmin, { kind: 'user', telegramId: owner }, template as any, owner, id => skillDefinition(id)); return NextResponse.json({ ok: true, slug: s.id, version: s.version }) }
  catch (e: any) { const code = e?.code || 'failed'; return NextResponse.json({ ok: false, error: code }, { status: code === 'exists' ? 409 : code === 'spaces_not_enabled' ? 503 : code === 'invalid' ? 400 : 500 }) }
}
