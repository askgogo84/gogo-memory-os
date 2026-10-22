// SecondBrain for Business: invite an existing AskGogo user by WhatsApp number (admin+ only).
// requireWorkspaceRole(…, 'invite') runs inside inviteMember before any read or write.
import { NextResponse } from 'next/server'
import { isAgentSession, requireAgentMutationOrigin, requireAgentSession } from '@/lib/agent/session'
import { inviteMember } from '@/lib/workspaces/access'
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
    return NextResponse.json(await inviteMember(session.telegramId, id, body?.whatsapp, body?.role ?? 'member'), { status: 201 })
  } catch (err) { return workspaceErrorResponse(err, 'invite') }
}
