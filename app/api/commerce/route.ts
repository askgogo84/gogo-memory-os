import {NextResponse} from 'next/server'
import {isAgentSession, requireAgentSession} from '@/lib/agent/session'
import {COMMERCE_PROVIDERS, commerceEnabled, type CommerceProvider} from '@/lib/commerce/providers'
import {readCommerceConnection} from '@/lib/commerce/connection-store'

export const dynamic = 'force-dynamic'
export async function GET(request: Request) {
  const session = await requireAgentSession(request)
  if (!isAgentSession(session)) return session
  try {
    const providers = await Promise.all((Object.keys(COMMERCE_PROVIDERS) as CommerceProvider[]).map(async provider => {
      if (!commerceEnabled(provider)) return {provider, label: COMMERCE_PROVIDERS[provider].label, state: 'provider_approval_required'}
      const token = await readCommerceConnection(session.telegramId, provider)
      return {provider, label: COMMERCE_PROVIDERS[provider].label, state: token ? 'authorized' : 'not_connected'}
    }))
    return NextResponse.json({providers}, {headers: {'Cache-Control': 'no-store'}})
  } catch {
    return NextResponse.json({error: 'connection_status_unavailable'}, {status: 503})
  }
}
