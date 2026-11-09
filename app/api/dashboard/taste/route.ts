import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/dashboard/session'
import { forgetTaste, listTaste, tasteFrom } from '@/lib/agent/taste'

export const dynamic = 'force-dynamic'

function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get('origin')
  if (!origin) return false
  try { return new URL(origin).host === req.nextUrl.host } catch { return false }
}

// Remember and suggest, Phase 1: the owner's food taste. The session's telegram id stays a string throughout.
export async function GET() {
  const session = await getSession()
  if (!session?.telegramId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const facts = await listTaste(String(session.telegramId))
  if (!facts) return NextResponse.json({ ready: false, facts: [] })
  return NextResponse.json({ ready: true, facts: facts.map(f => ({ id: f.id, text: f.value, from: tasteFrom(f) })) })
}

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const session = await getSession()
  if (!session?.telegramId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => null) as { forget?: unknown } | null
  const id = typeof body?.forget === 'string' && /^[0-9a-f-]{36}$/i.test(body.forget) ? body.forget : null
  if (!id) return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  const gone = await forgetTaste(String(session.telegramId), { id })
  if (gone === null) return NextResponse.json({ error: 'not_ready' }, { status: 503 })
  if (!gone.length) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
