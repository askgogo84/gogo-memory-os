import {NextResponse} from 'next/server'
import {isAgentSession, requireAgentMutationOrigin, requireAgentSession} from '@/lib/agent/session'
import {COMMERCE_PROVIDERS, commerceProvider} from '@/lib/commerce/providers'
import {readCommerceConnection, deleteCommerceConnection} from '@/lib/commerce/connection-store'

export const dynamic = 'force-dynamic'
export async function POST(request: Request, context: {params: Promise<{provider: string}>}) {
  const blocked = requireAgentMutationOrigin(request)
  if (blocked) return blocked
  const session = await requireAgentSession(request)
  if (!isAgentSession(session)) return session
  const provider = commerceProvider((await context.params).provider)
  if (!provider) return NextResponse.json({error: 'unknown_provider'}, {status: 404})
  try {
    const token = await readCommerceConnection(session.telegramId, provider)
    let providerRevocationVerified = false
    if (token) {
      try {
        const response = await fetch(COMMERCE_PROVIDERS[provider].revoke, {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
          headers: provider === 'swiggy' ? {Authorization: `Bearer ${token.accessToken}`} : {'Content-Type': 'application/x-www-form-urlencoded'},
          ...(provider === 'zepto' ? {body: new URLSearchParams({token: token.accessToken, token_type_hint: 'access_token'}).toString()} : {}),
        })
        providerRevocationVerified = response.ok
      } catch { /* Local disconnect still removes access if provider revocation is unavailable. */ }
    }
    await deleteCommerceConnection(session.telegramId, provider)
    return NextResponse.json({disconnected: true, providerRevocationVerified}, {headers: {'Cache-Control': 'no-store'}})
  } catch {
    return NextResponse.json({error: 'disconnect_unverified'}, {status: 503})
  }
}
