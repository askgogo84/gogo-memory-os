// SecondBrain for Business: share one of MY OWN agent_artifacts into a workspace, or unshare it.
// shareArtifact verifies artifact.telegram_id === me; both run requireWorkspaceRole(…, 'share_artifact') first.
import { NextResponse } from 'next/server'
import { isAgentSession, requireAgentMutationOrigin, requireAgentSession } from '@/lib/agent/session'
import { shareArtifact, unshareArtifact } from '@/lib/workspaces/access'
import { workspaceErrorResponse } from '@/lib/workspaces/http'

export const dynamic = 'force-dynamic'

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const blocked = requireAgentMutationOrigin(request)
  if (blocked) return blocked
  const session = await requireAgentSession(request)
  if (!isAgentSession(session)) return session
  const { id } = await context.params
  const body = await request.json().catch(() => null)
  try {
    return NextResponse.json(await shareArtifact(session.telegramId, id, body?.artifactId), { status: 201 })
  } catch (err) { return workspaceErrorResponse(err, 'share') }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const blocked = requireAgentMutationOrigin(request)
  if (blocked) return blocked
  const session = await requireAgentSession(request)
  if (!isAgentSession(session)) return session
  const { id } = await context.params
  const body = await request.json().catch(() => null)
  const artifactId = body?.artifactId ?? new URL(request.url).searchParams.get('artifactId')
  try {
    return NextResponse.json(await unshareArtifact(session.telegramId, id, artifactId))
  } catch (err) { return workspaceErrorResponse(err, 'unshare') }
}
