// Chat step narration: the steps of one of the owner's tasks (title, tool, status only). Owner-scoped, read-only.
import { NextResponse } from 'next/server'
import { isAgentSession, requireAgentSession } from '@/lib/agent/session'
import { getRunSteps } from '@/lib/dashboard/run-steps'

export const dynamic = 'force-dynamic'

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireAgentSession(request)
  if (!isAgentSession(session)) return session
  const { id } = await context.params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'invalid_run' }, { status: 400 })
  const steps = await getRunSteps(session.telegramId, id).catch(() => null)
  if (!steps) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json(steps)
}
