// SecondBrain for Business: list my workspaces, create one (creator becomes owner; max 5 per user).
import { NextResponse } from 'next/server'
import { isAgentSession, requireAgentMutationOrigin, requireAgentSession } from '@/lib/agent/session'
import { createWorkspace, listMyWorkspaces } from '@/lib/workspaces/access'
import { workspaceErrorResponse } from '@/lib/workspaces/http'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const session = await requireAgentSession(request)
  if (!isAgentSession(session)) return session
  try {
    return NextResponse.json({ workspaces: await listMyWorkspaces(session.telegramId) })
  } catch (err) { return workspaceErrorResponse(err, 'list') }
}

export async function POST(request: Request) {
  const blocked = requireAgentMutationOrigin(request)
  if (blocked) return blocked
  const session = await requireAgentSession(request)
  if (!isAgentSession(session)) return session
  const body = await request.json().catch(() => null)
  try {
    return NextResponse.json({ workspace: await createWorkspace(session.telegramId, body?.name) }, { status: 201 })
  } catch (err) { return workspaceErrorResponse(err, 'create') }
}
