// Chat step narration while a reply is pending: the newest task the owner started since `since`. Read-only.
import { NextResponse } from 'next/server'
import { isAgentSession, requireAgentSession } from '@/lib/agent/session'
import { getLatestRunSince } from '@/lib/dashboard/run-steps'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const session = await requireAgentSession(request)
  if (!isAgentSession(session)) return session
  const since = new URL(request.url).searchParams.get('since') || ''
  if (!Number.isFinite(Date.parse(since))) return NextResponse.json({ error: 'invalid_since' }, { status: 400 })
  const run = await getLatestRunSince(session.telegramId, since).catch(() => null)
  return NextResponse.json({ run })
}
