import { NextResponse } from 'next/server'
import { isAgentSession, requireAgentMutationOrigin, requireAgentSession } from '@/lib/agent/session'
import { askWorkspace } from '@/lib/workspaces/ask'
import { WorkspaceError } from '@/lib/workspaces/access'
import { workspaceErrorResponse } from '@/lib/workspaces/http'

export const dynamic = 'force-dynamic'

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const blocked = requireAgentMutationOrigin(request)
  if (blocked) return blocked
  const session = await requireAgentSession(request)
  if (!isAgentSession(session)) return session
  let raw: string
  try { raw = await request.text() } catch { return NextResponse.json({ error: 'invalid_question' }, { status: 400 }) }
  if (raw.length > 4096) return NextResponse.json({ error: 'invalid_question' }, { status: 400 })
  let body: any
  try { body = JSON.parse(raw) } catch { return NextResponse.json({ error: 'invalid_question' }, { status: 400 }) }
  if (typeof body?.question !== 'string' || !body.question.trim() || body.question.length > 300) return NextResponse.json({ error: 'invalid_question' }, { status: 400 })
  const { id } = await context.params
  try {
    return NextResponse.json(await askWorkspace(session.telegramId, id, body.question), { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    if (err instanceof WorkspaceError && err.code === 'invalid_question') return NextResponse.json({ error: 'invalid_question' }, { status: 400 })
    return workspaceErrorResponse(err, 'ask')
  }
}
