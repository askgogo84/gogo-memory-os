import { NextResponse } from 'next/server'
import { isAgentSession, requireAgentMutationOrigin, requireAgentSession } from '@/lib/agent/session'
import { resolveAgentActor } from '@/lib/agent/actor'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// 22 Nov (owner-approved mock): the Connections page's "Check now" runs the same read-only checks as the
// self-diagnostic. POST (never prefetched) and same-origin; it reads providers and the owner's own records and changes
// nothing. Review (PR #1564): within 15 seconds the same result is returned (or the check already running is awaited)
// instead of an error, so a remount or a double tap never shows a failure and Google is not asked twice.
type Result = { checkedAt: string; checks: unknown[] }
const recent = new Map<string, { at: number; result: Promise<Result> }>()
const COOLDOWN_MS = 15_000

export async function POST(request: Request) {
  const blocked = requireAgentMutationOrigin(request)
  if (blocked) return blocked
  const session = await requireAgentSession(request)
  if (!isAgentSession(session)) return session
  const owner = String(session.telegramId)
  const now = Date.now()
  for (const [k, v] of recent) if (now - v.at > COOLDOWN_MS) recent.delete(k)
  let entry = recent.get(owner)
  if (!entry) {
    const result = (async () => {
      const actor = await resolveAgentActor(session)
      const { runSystemDiagnostic } = await import('@/lib/agent/system-diagnostic')
      const out = await runSystemDiagnostic(actor, { full: true })
      return { checkedAt: new Date(now).toISOString(), checks: out.checks }
    })()
    entry = { at: now, result }
    recent.set(owner, entry)
  }
  try {
    return NextResponse.json(await entry.result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error: any) {
    if (recent.get(owner) === entry) recent.delete(owner)
    console.error('CONNECTIONS_CHECK_FAILED:', String(error?.message || 'error').replace(/[^a-z0-9_:]/gi, '').slice(0, 60))
    return NextResponse.json({ error: 'check_failed', message: "The check couldn't finish, so nothing is marked as working. Nothing was changed." }, { status: 502, headers: { 'Cache-Control': 'no-store' } })
  }
}
