// SecondBrain for Business: an admin+ withdraws a pending invitation.
// requireWorkspaceRole(…, 'invite') runs inside revokeInvite before any read or write.
import { NextResponse } from 'next/server'
import { isAgentSession, requireAgentMutationOrigin, requireAgentSession } from '@/lib/agent/session'
import { revokeInvite } from '@/lib/workspaces/access'
import { workspaceErrorResponse } from '@/lib/workspaces/http'

export const dynamic = 'force-dynamic'

export async function DELETE(request: Request, context: { params: Promise<{ id: string; inviteId: string }> }) {
  const blocked = requireAgentMutationOrigin(request)
  if (blocked) return blocked
  const session = await requireAgentSession(request)
  if (!isAgentSession(session)) return session
  const { id, inviteId } = await context.params
  try {
    return NextResponse.json(await revokeInvite(session.telegramId, id, inviteId))
  } catch (err) { return workspaceErrorResponse(err, 'revoke_invite') }
}
