import { NextResponse } from 'next/server'
import { isAgentSession, requireAgentMutationOrigin, requireAgentSession } from '@/lib/agent/session'
import { askWorkspace } from '@/lib/workspaces/ask'
import { workspaceErrorResponse } from '@/lib/workspaces/http'

export const dynamic = 'force-dynamic'

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const blocked = requireAgentMutationOrigin(request)
  if (blocked) return blocked
  const session = await requireAgentSession(request)
  if (!isAgentSession(session)) return session
  const raw = await request.text()
  if (raw.length > 4096) return NextResponse.json({ error: 'invalid_question' }, { status: 400 })
  let body: any
  try { body = JSON.parse(raw) } catch { return NextResponse.json({ error: 'invalid_question' }, { status: 400 }) }
  if (typeof body?.question !== 'string' || !body.question.trim() || body.question.length > 300) return NextResponse.json({ error: 'invalid_question' }, { status: 400 })
  const { id } = await context.params
  try {
    return NextResponse.json(await askWorkspace(session.telegramId, id, body.question), { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) { return workspaceErrorResponse(err, 'ask') }
}
