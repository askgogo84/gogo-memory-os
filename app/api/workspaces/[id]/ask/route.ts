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
    const env=(globalThis as any).process?.env||{}
    const governed=env.GOGO_HACHI_ENFORCEMENT==='1'&&String(env.GOGO_HACHI_WORKSPACES||'').split(',').map((x:string)=>x.trim()).includes(id)
    const answer=governed
      ?await import('@/lib/workspaces/governed-ask').then(m=>m.governedWorkspaceAsk(session.telegramId,id,body.question))
      :await askWorkspace(session.telegramId,id,body.question)
    return NextResponse.json(answer, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    if (err instanceof WorkspaceError && err.code === 'invalid_question') return NextResponse.json({ error: 'invalid_question' }, { status: 400 })
    return workspaceErrorResponse(err, 'ask')
  }
}
