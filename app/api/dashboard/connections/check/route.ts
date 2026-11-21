import { NextResponse } from 'next/server'
import { isAgentSession, requireAgentMutationOrigin, requireAgentSession } from '@/lib/agent/session'
import { resolveAgentActor } from '@/lib/agent/actor'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// 22 Nov (owner-approved mock): the Connections page's "Check now" runs the same read-only checks as the
// self-diagnostic. POST (never prefetched) and same-origin; it reads providers and the owner's own records and changes
// nothing. One check per owner every 15 seconds per instance, so repeated taps do not hammer Google.
const lastRun = new Map<string, number>()
const COOLDOWN_MS = 15_000

export async function POST(request: Request) {
  const blocked = requireAgentMutationOrigin(request)
  if (blocked) return blocked
  const session = await requireAgentSession(request)
  if (!isAgentSession(session)) return session
  const owner = String(session.telegramId)
  const now = Date.now()
  if (now - (lastRun.get(owner) || 0) < COOLDOWN_MS) return NextResponse.json({ error: 'too_soon', message: 'Checked a moment ago. Try again in a few seconds.' }, { status: 429, headers: { 'Cache-Control': 'no-store' } })
  lastRun.set(owner, now)
  try {
    const actor = await resolveAgentActor(session)
    const { runSystemDiagnostic } = await import('@/lib/agent/system-diagnostic')
    const out = await runSystemDiagnostic(actor, { full: true })
    return NextResponse.json({ checkedAt: new Date(now).toISOString(), checks: out.checks }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error: any) {
    console.error('CONNECTIONS_CHECK_FAILED:', String(error?.message || 'error').replace(/[^a-z0-9_:]/gi, '').slice(0, 60))
    return NextResponse.json({ error: 'check_failed', message: "The check couldn't finish, so nothing is marked as working. Nothing was changed." }, { status: 502, headers: { 'Cache-Control': 'no-store' } })
  }
}
