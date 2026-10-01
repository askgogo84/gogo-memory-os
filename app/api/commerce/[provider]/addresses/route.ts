import {NextResponse} from 'next/server'
import {isAgentSession, requireAgentMutationOrigin, requireAgentSession} from '@/lib/agent/session'
import {commerceEnabled, commerceProvider} from '@/lib/commerce/providers'
import {readCommerceConnection} from '@/lib/commerce/connection-store'
import {CommerceMcpClient, CommerceMcpError} from '@/lib/commerce/mcp'
import {swiggyAddressPage} from '@/lib/commerce/addresses'

import {readCommerceTask, selectCommerceTaskAddress, commerceTaskView} from '@/lib/commerce/task'

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

// Re-read the selected provider page; never trust an address supplied by the browser.
export async function POST(request: Request, context: {params: Promise<{provider: string}>}) {
  const blocked = requireAgentMutationOrigin(request)
  if (blocked) return blocked
  const session = await requireAgentSession(request)
  if (!isAgentSession(session)) return session
  const provider = commerceProvider((await context.params).provider)
  if (provider !== 'swiggy' || !commerceEnabled(provider)) return NextResponse.json({error: 'provider_unavailable'}, {status: 409})
  let input: any
  try { input = await request.json() } catch { return NextResponse.json({error: 'invalid_selection'}, {status: 400}) }
  if (!input || typeof input.runId !== 'string' || typeof input.addressId !== 'string' || input.addressId.length > 512
      || !Number.isSafeInteger(input.page) || input.page < 1 || input.page > 50) return NextResponse.json({error: 'invalid_selection'}, {status: 400})
  try {
    const task = await readCommerceTask(session.telegramId, input.runId)
    if (!task || task.metadata_json.commerce?.provider !== provider) return NextResponse.json({error: 'task_unavailable'}, {status: 404})
    const token = await readCommerceConnection(session.telegramId, provider)
    if (!token) return NextResponse.json({error: 'reauth_required'}, {status: 401})
    const client = new CommerceMcpClient(provider, 'food', token.accessToken)
    const page = swiggyAddressPage(await client.readTool('get_addresses', {page: input.page, pageSize: 10}))
    const matches = page.addresses.filter(address => address.id === input.addressId)
    if (matches.length !== 1) return NextResponse.json({error: 'address_changed_reload'}, {status: 409})
    const saved = await selectCommerceTaskAddress(session.telegramId, task, provider, matches[0], input.page)
    return NextResponse.json(commerceTaskView(saved), {headers: {'Cache-Control': 'no-store'}})
  } catch (error) {
    if (error instanceof CommerceMcpError && error.reason === 'reauth_required') return NextResponse.json({error: 'reauth_required'}, {status: 401})
    return NextResponse.json({error: 'selection_unverified_reload_task'}, {status: 409, headers: {'Cache-Control': 'no-store'}})
  }
}
