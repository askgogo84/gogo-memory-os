// SecondBrain for Business: one workspace (members, my role, shared artifact titles only) and rename.
// Membership is checked inside getWorkspaceDetail / renameWorkspace (requireWorkspaceRole) before any read.
import { NextResponse } from 'next/server'
import { isAgentSession, requireAgentMutationOrigin, requireAgentSession } from '@/lib/agent/session'
import { getWorkspaceDetail, renameWorkspace } from '@/lib/workspaces/access'
import { workspaceErrorResponse } from '@/lib/workspaces/http'

export const dynamic = 'force-dynamic'

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireAgentSession(request)
  if (!isAgentSession(session)) return session
  const { id } = await context.params
  try {
    return NextResponse.json({ workspace: await getWorkspaceDetail(session.telegramId, id) })
  } catch (err) { return workspaceErrorResponse(err, 'detail') }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const blocked = requireAgentMutationOrigin(request)
  if (blocked) return blocked
  const session = await requireAgentSession(request)
  if (!isAgentSession(session)) return session
  const { id } = await context.params
  const body = await request.json().catch(() => null)
  try {
    return NextResponse.json(await renameWorkspace(session.telegramId, id, body?.name))
  } catch (err) { return workspaceErrorResponse(err, 'rename') }
}
