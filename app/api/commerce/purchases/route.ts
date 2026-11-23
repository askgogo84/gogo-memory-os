import {NextResponse} from 'next/server'
import {isAgentSession, requireAgentMutationOrigin, requireAgentSession} from '@/lib/agent/session'
import {createPurchase} from '@/lib/commerce/purchase-handoff'
import {PurchaseBoundaryError} from '@/lib/commerce/purchase-contract'

export const dynamic = 'force-dynamic'
const headers = {'Cache-Control': 'no-store'}
export async function POST(request: Request) {
  const blocked = requireAgentMutationOrigin(request)
  if (blocked) return blocked
  const session = await requireAgentSession(request)
  if (!isAgentSession(session)) return session
  try {
    const text = await request.text()
    if (text.length > 2048) return NextResponse.json({error:'invalid_request'}, {status:400, headers})
    const input = JSON.parse(text)
    if (!input || typeof input.runId !== 'string' || Object.keys(input).some(key => !['runId','budgetPaise'].includes(key))) {
      return NextResponse.json({error:'invalid_request'}, {status:400, headers})
    }
    const result = await createPurchase(session.telegramId, input.runId, input.budgetPaise)
    return NextResponse.json(result, {headers})
  } catch (err) {
    const code = err instanceof PurchaseBoundaryError ? err.code : 'purchase_unavailable'
    const status = code === 'purchase_feature_disabled' ? 404
      : ['invalid_commerce_task','invalid_request','invalid_purchase_budget'].includes(code) ? 400
      : code === 'purchase_store_unavailable' || code === 'purchase_unavailable' ? 503 : 409
    return NextResponse.json({error:code}, {status, headers})
  }
}
