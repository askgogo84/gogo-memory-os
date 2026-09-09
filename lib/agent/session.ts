import { NextResponse } from 'next/server'
import { getSession } from '@/lib/dashboard/session'
import { verifySameOrigin } from '@/lib/dashboard/guard'

export type AgentSession = { telegramId: string }

export async function requireAgentSession(): Promise<AgentSession | NextResponse> {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const telegramId = String(session.telegramId || '').trim()
  if (!telegramId) return NextResponse.json({ error: 'invalid_session' }, { status: 400 })
  return { telegramId }
}

export function requireAgentMutationOrigin(request: Request): NextResponse | null {
  return verifySameOrigin(request)
}

export function isAgentSession(value: AgentSession | NextResponse): value is AgentSession {
  return !(value instanceof NextResponse)
}
