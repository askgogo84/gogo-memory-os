import { after, NextResponse } from 'next/server'
import { isAgentSession, requireAgentMutationOrigin, requireAgentSession } from '@/lib/agent/session'
import { resolveAgentActor } from '@/lib/agent/actor'
import { listSiteConnections, createSiteSignInRun, openSiteSignInBrowser, confirmSiteSignIn, removeSiteConnection } from '@/lib/dashboard/site-sessions'
import { findCatalogueSite } from '@/lib/dashboard/connection-catalogue'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(request: Request) {
  const session = await requireAgentSession(request)
  if (!isAgentSession(session)) return session
  const sites = await listSiteConnections(session.telegramId)
  return NextResponse.json({ sites }, { headers: { 'Cache-Control': 'no-store' } })
}

// action: sign_in (open the site for the person to sign in), confirm (they finished), remove (stop using it).
export async function POST(request: Request) {
  const blocked = requireAgentMutationOrigin(request)
  if (blocked) return blocked
  const session = await requireAgentSession(request)
  if (!isAgentSession(session)) return session
  const body = await request.json().catch(() => null) as any
  const action = String(body?.action || '')
  const site = findCatalogueSite(body?.site)
  if (!site) return NextResponse.json({ error: 'unknown_site' }, { status: 400 })
  if (!['sign_in', 'confirm', 'remove'].includes(action)) return NextResponse.json({ error: 'invalid_action' }, { status: 400 })
  if (action !== 'remove' && site.kind === 'soon') return NextResponse.json({ error: 'not_available_yet' }, { status: 409 })
  try {
    const actor = await resolveAgentActor(session)
    if (action === 'sign_in') {
      // Respond at once and open the secure browser after the response (~50s); the browser page shows
      // "Opening…" and refreshes until it is ready, or shows why it could not open.
      const { runId } = await createSiteSignInRun(actor, site.id)
      after(() => openSiteSignInBrowser(actor, runId, site.id).catch(error => console.error('DASHBOARD_SIGN_IN_OPEN_FAILED:', site.id, runId, error?.message || error)))
      return NextResponse.json({ runId, browserPath: `/dashboard/activity/${encodeURIComponent(runId)}/browser` })
    }
    if (action === 'confirm') await confirmSiteSignIn(actor, site.id)
    else await removeSiteConnection(actor, site.id)
    return NextResponse.json({ ok: true, sites: await listSiteConnections(session.telegramId) })
  } catch (error: any) {
    console.error('DASHBOARD_CONNECTION_FAILED:', action, site.id, error?.message || error)
    return NextResponse.json({ error: action === 'sign_in' ? (error?.message === 'browser_busy' ? 'browser_busy' : 'browser_unavailable') : 'save_failed' }, { status: action === 'sign_in' && error?.message === 'browser_busy' ? 409 : 502 })
  }
}
