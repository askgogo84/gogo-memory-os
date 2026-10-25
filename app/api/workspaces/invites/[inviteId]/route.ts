// SecondBrain for Business: the invitee accepts or declines. respondToInvite only finds invitations
// addressed to the signed-in caller, so nobody can answer someone else's.
import { NextResponse } from 'next/server'
import { isAgentSession, requireAgentMutationOrigin, requireAgentSession } from '@/lib/agent/session'
import { respondToInvite } from '@/lib/workspaces/access'
import { workspaceErrorResponse } from '@/lib/workspaces/http'

export const dynamic = 'force-dynamic'

export async function POST(request: Request, context: { params: Promise<{ inviteId: string }> }) {
  const blocked = requireAgentMutationOrigin(request)
  if (blocked) return blocked
  const session = await requireAgentSession(request)
  if (!isAgentSession(session)) return session
  const { inviteId } = await context.params
  const body = await request.json().catch(() => null)
  try {
    return NextResponse.json(await respondToInvite(session.telegramId, inviteId, body?.decision))
  } catch (err) { return workspaceErrorResponse(err, 'respond_invite') }
}
