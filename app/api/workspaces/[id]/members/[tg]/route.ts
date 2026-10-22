// SecondBrain for Business: change a member's role or remove them (anyone may leave; last owner protected).
// requireWorkspaceRole runs inside changeMemberRole / removeMember before any read or write.
import { NextResponse } from 'next/server'
import { isAgentSession, requireAgentMutationOrigin, requireAgentSession } from '@/lib/agent/session'
import { changeMemberRole, removeMember } from '@/lib/workspaces/access'
import { workspaceErrorResponse } from '@/lib/workspaces/http'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string; tg: string }> }

export async function PATCH(request: Request, context: Ctx) {
  const blocked = requireAgentMutationOrigin(request)
  if (blocked) return blocked
  const session = await requireAgentSession(request)
  if (!isAgentSession(session)) return session
  const { id, tg } = await context.params
  const body = await request.json().catch(() => null)
  try {
    return NextResponse.json(await changeMemberRole(session.telegramId, id, decodeURIComponent(tg), body?.role))
  } catch (err) { return workspaceErrorResponse(err, 'change_role') }
}

export async function DELETE(request: Request, context: Ctx) {
  const blocked = requireAgentMutationOrigin(request)
  if (blocked) return blocked
  const session = await requireAgentSession(request)
  if (!isAgentSession(session)) return session
  const { id, tg } = await context.params
  try {
    return NextResponse.json(await removeMember(session.telegramId, id, decodeURIComponent(tg)))
  } catch (err) { return workspaceErrorResponse(err, 'remove') }
}
