// SecondBrain for Business: pending invitations addressed to me (consent-based membership).
import { NextResponse } from 'next/server'
import { isAgentSession, requireAgentSession } from '@/lib/agent/session'
import { listMyInvites } from '@/lib/workspaces/access'
import { workspaceErrorResponse } from '@/lib/workspaces/http'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const session = await requireAgentSession(request)
  if (!isAgentSession(session)) return session
  try {
    return NextResponse.json({ invites: await listMyInvites(session.telegramId) })
  } catch (err) { return workspaceErrorResponse(err, 'my_invites') }
}
