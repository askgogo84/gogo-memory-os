import { NextResponse } from 'next/server'
import { requireAgentMutationOrigin, requireAgentSession, isAgentSession } from '@/lib/agent/session'
import { changeDatedFact, readDatedFacts, FactError } from '@/lib/memory/dated-facts'

export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'private, no-store' }

export async function POST(request: Request) {
  const blocked = requireAgentMutationOrigin(request)
  if (blocked) return blocked
  const session = await requireAgentSession(request)
  if (!isAgentSession(session)) return session
  try {
    const raw = await request.text()
    if (raw.length > 8192) throw new FactError(413, 'Request is too large.')
    let body
    try { body = JSON.parse(raw) } catch { throw new FactError(400, 'Invalid request.') }
    if (!body || typeof body !== 'object' || Array.isArray(body) || !Object.hasOwn(body, 'workspace'))
      throw new FactError(400, 'Choose a scope.')
    if (body.action === 'read' || body.action === 'brief') {
      if (body.action === 'read' && typeof body.topic !== 'string') throw new FactError(400, 'Enter a topic.')
      const facts = await readDatedFacts(session.telegramId, body.workspace, body.action === 'brief' ? null : body.topic, body.day)
      return NextResponse.json({ facts }, { headers })
    }
    await changeDatedFact(session.telegramId, body.workspace, body)
    return NextResponse.json({ ok: true }, { headers })
  } catch (error) {
    return NextResponse.json({ error: error instanceof FactError ? error.message : 'Could not verify the request.' },
      { status: error instanceof FactError ? error.status : 503, headers })
  }
}
