import {supabaseAdmin} from '@/lib/supabase-admin'
import {acquireBrainUserLease, releaseBrainUserLease} from '@/lib/agent/brain-runtime-guard'
import {NextResponse} from 'next/server'
import {isAgentSession, requireAgentMutationOrigin, requireAgentSession} from '@/lib/agent/session'
import {commerceEnabled} from '@/lib/commerce/providers'
import {readCommerceConnection} from '@/lib/commerce/connection-store'
import {readCommerceTask, commerceTaskView} from '@/lib/commerce/task'
import {CommerceMcpClient} from '@/lib/commerce/mcp'
import {prepareInstamartCart, reconcileInstamartCart} from '@/lib/commerce/instamart-cart'

export const dynamic = 'force-dynamic'
export async function POST(request: Request, context: {params: Promise<{runId: string}>}) {
  const blocked = requireAgentMutationOrigin(request)
  if (blocked) return blocked
  const session = await requireAgentSession(request)
  if (!isAgentSession(session)) return session
  if (!commerceEnabled('swiggy')) return NextResponse.json({error: 'provider_approval_required'}, {status: 409})
  let input: any
  try { input = await request.json() } catch { return NextResponse.json({error: 'invalid_selection'}, {status: 400}) }
  if (!input || !['add', 'check'].includes(input.action)) return NextResponse.json({error: 'invalid_selection'}, {status: 400})
  const runId = (await context.params).runId
  const leaseKey = 'commerce:swiggy:' + session.telegramId
  let lease: {ownerToken: string} | null = null
  try {
    lease = await acquireBrainUserLease(leaseKey, 600)
    if (!lease) return NextResponse.json({error: 'cart_in_use'}, {status: 409})
    const task = await readCommerceTask(session.telegramId, runId)
    if (!task || task.type !== 'grocery_comparison') return NextResponse.json({error: 'task_unavailable'}, {status: 404})
    // Swiggy update_cart replaces a shared account cart. Serialize tasks for this owner
    // and refuse a new addition while any earlier write still needs reconciliation.
    if (input.action === 'add') {
      const {data: pending, error} = await supabaseAdmin.from('agent_runs').select('id').eq('telegram_id', session.telegramId).eq('type', 'grocery_comparison').eq('status', 'outcome_unknown').limit(1).maybeSingle()
      if (error || pending) return NextResponse.json({error: 'previous_cart_outcome_unverified'}, {status: 409})
    }
    const token = await readCommerceConnection(session.telegramId, 'swiggy')
    if (!token) return NextResponse.json({error: 'reauth_required'}, {status: 401})
    const client = new CommerceMcpClient('swiggy', 'grocery', token.accessToken)
    const saved = input.action === 'check'
      ? await reconcileInstamartCart(session.telegramId, task, token.accessToken, client)
      : await prepareInstamartCart(session.telegramId, task, token.accessToken, client, {spinId: input.spinId, skuId: input.skuId, quantity: input.quantity})
    return NextResponse.json(commerceTaskView(saved), {headers: {'Cache-Control': 'no-store'}})
  } catch {
    // Failure text must not imply a retry is safe: the outbound write may have applied.
    const current = await readCommerceTask(session.telegramId, runId).catch(() => null)
    return NextResponse.json({error: 'cart_unverified_reload', ...(current ? {task: commerceTaskView(current)} : {})}, {status: 409, headers: {'Cache-Control': 'no-store'}})
  } finally {
    if (lease) await releaseBrainUserLease(leaseKey, lease.ownerToken).catch(() => false)
  }
}
