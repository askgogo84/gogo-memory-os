import {NextResponse} from 'next/server'
import {isAgentSession, requireAgentSession} from '@/lib/agent/session'
import {commerceEnabled, commerceProvider} from '@/lib/commerce/providers'
import {readCommerceConnection} from '@/lib/commerce/connection-store'
import {CommerceMcpClient, CommerceMcpError} from '@/lib/commerce/mcp'
import {swiggyAddressPage} from '@/lib/commerce/addresses'

export const dynamic = 'force-dynamic'
export async function GET(request: Request, context: {params: Promise<{provider: string}>}) {
  const session = await requireAgentSession(request)
  if (!isAgentSession(session)) return session
  const provider = commerceProvider((await context.params).provider)
  if (!provider) return NextResponse.json({error: 'unknown_provider'}, {status: 404})
  if (!commerceEnabled(provider)) return NextResponse.json({error: 'provider_approval_required'}, {status: 409})
  // Zepto's authenticated tool schema has not been obtained; do not guess it.
  if (provider !== 'swiggy') return NextResponse.json({error: 'provider_address_adapter_pending'}, {status: 409})
  const page = Number(new URL(request.url).searchParams.get('page') || '1')
  if (!Number.isSafeInteger(page) || page < 1 || page > 50) return NextResponse.json({error: 'invalid_page'}, {status: 400})
  try {
    const token = await readCommerceConnection(session.telegramId, provider)
    if (!token) return NextResponse.json({error: 'reauth_required'}, {status: 401})
    const client = new CommerceMcpClient(provider, 'food', token.accessToken)
    const data = swiggyAddressPage(await client.readTool('get_addresses', {page, pageSize: 10}))
    return NextResponse.json({...data, page, observedAt: new Date().toISOString()}, {headers: {'Cache-Control': 'no-store'}})
  } catch (error) {
    if (error instanceof CommerceMcpError && error.reason === 'reauth_required') return NextResponse.json({error: 'reauth_required'}, {status: 401})
    return NextResponse.json({error: 'saved_addresses_unverified'}, {status: 502})
  }
}
