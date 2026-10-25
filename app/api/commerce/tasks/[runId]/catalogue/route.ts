import {NextResponse} from 'next/server'
import {isAgentSession, requireAgentMutationOrigin, requireAgentSession} from '@/lib/agent/session'
import {commerceEnabled} from '@/lib/commerce/providers'
import {readCommerceConnection} from '@/lib/commerce/connection-store'
import {readCommerceTask, saveCommerceCatalogue, commerceTaskView, commerceTaskService, saveCommerceReadBlocker} from '@/lib/commerce/task'
import {CommerceMcpClient, CommerceMcpError} from '@/lib/commerce/mcp'
import {swiggyAddressPage} from '@/lib/commerce/addresses'
import {readFoodRestaurants, readFoodMenu, readInstamartProducts} from '@/lib/commerce/swiggy-read'

export const dynamic = 'force-dynamic'
export async function POST(request: Request, context: {params: Promise<{runId: string}>}) {
  const blocked = requireAgentMutationOrigin(request)
  if (blocked) return blocked
  const session = await requireAgentSession(request)
  if (!isAgentSession(session)) return session
  if (!commerceEnabled('swiggy')) return NextResponse.json({error: 'provider_approval_required'}, {status: 409})
  let input: any
  try { input = await request.json() } catch { return NextResponse.json({error: 'invalid_selection'}, {status: 400}) }
  if (!input || (input.restaurantId !== undefined && (typeof input.restaurantId !== 'string' || input.restaurantId.length > 512))) return NextResponse.json({error: 'invalid_selection'}, {status: 400})
  let task: Awaited<ReturnType<typeof readCommerceTask>> = null
  const fail = async (reason: 'reauth_required' | 'address_changed' | 'provider_unverified', error: string, status: number) => {
    const saved = task ? await saveCommerceReadBlocker(session.telegramId, task, reason) : null
    return NextResponse.json({error, ...(saved ? {task: commerceTaskView(saved)} : {})}, {status, headers: {'Cache-Control': 'no-store'}})
  }
  try {
    task = await readCommerceTask(session.telegramId, (await context.params).runId)
    if(task?.metadata_json.state==='browser_research') return NextResponse.json({error:'browser_task_active'},{status:409})
    if (task?.metadata_json.state.startsWith('cart_')) return NextResponse.json({error: 'cart_readback_required'}, {status: 409})
    const address = task?.metadata_json.commerce?.address
    if (!task || task.metadata_json.commerce?.provider !== 'swiggy' || address?.source !== 'provider_saved_address' || !address.id) return NextResponse.json({error: 'select_saved_address'}, {status: 409})
    const query = task.metadata_json.subject
    if (typeof query !== 'string' || !query.trim() || query.length > 180) return NextResponse.json({error: 'task_query_unavailable'}, {status: 409})
    if (input.restaurantId !== undefined) {
      const previous = task.metadata_json.commerce.catalogue
      const age = Date.now() - Date.parse(previous?.observedAt || '')
      if (!Number.isFinite(age) || age < 0 || age > 300000 || !previous?.restaurants?.some((item: any) => item.id === input.restaurantId)) return NextResponse.json({error: 'refresh_restaurants'}, {status: 409})
    }
    const token = await readCommerceConnection(session.telegramId, 'swiggy')
    if (!token) return await fail('reauth_required', 'reauth_required', 401)
    const client = new CommerceMcpClient('swiggy', commerceTaskService(task), token.accessToken)
    const page = swiggyAddressPage(await client.readTool('get_addresses', {page: address.page || 1, pageSize: 10}))
    if (!page.addresses.some(item => item.id === address.id)) return await fail('address_changed', 'reselect_saved_address', 409)
    if (commerceTaskService(task) === 'grocery') {
      const products = await readInstamartProducts(client, address.id, query)
      const saved = await saveCommerceCatalogue(session.telegramId, task, {observedAt: new Date().toISOString(), products})
      return NextResponse.json(commerceTaskView(saved), {headers: {'Cache-Control': 'no-store'}})
    }
    const restaurants = await readFoodRestaurants(client, address.id, query)
    let catalogue: Parameters<typeof saveCommerceCatalogue>[2]
    if (input.restaurantId !== undefined) {
      if (!restaurants.some(item => item.id === input.restaurantId)) return NextResponse.json({error: 'restaurant_no_longer_available'}, {status: 409})
      const items = await readFoodMenu(client, address.id, query, input.restaurantId, /\bvegetarian\b/i.test(query))
      catalogue = {observedAt: new Date().toISOString(), items, restaurantId: input.restaurantId}
    } else catalogue = {observedAt: new Date().toISOString(), restaurants}
    const saved = await saveCommerceCatalogue(session.telegramId, task, catalogue)
    return NextResponse.json(commerceTaskView(saved), {headers: {'Cache-Control': 'no-store'}})
  } catch (error) {
    try {
      if (error instanceof CommerceMcpError && error.reason === 'reauth_required') return await fail('reauth_required', 'reauth_required', 401)
      return await fail('provider_unverified', 'catalogue_unverified_reload', 409)
    } catch { /* A persistence conflict must not overwrite a newer task. */ }
    return NextResponse.json({error: 'catalogue_unverified_reload'}, {status: 409, headers: {'Cache-Control': 'no-store'}})
  }
}
