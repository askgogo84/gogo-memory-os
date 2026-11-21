import {NextResponse} from 'next/server'
import {isAgentSession, requireAgentMutationOrigin, requireAgentSession} from '@/lib/agent/session'
import {readPurchaseView, approvePurchase, openPurchaseHandoff, cancelPurchase} from '@/lib/commerce/purchase-handoff'
import {PurchaseBoundaryError} from '@/lib/commerce/purchase-contract'

export const dynamic = 'force-dynamic'
const headers = {'Cache-Control': 'no-store'}
type Ctx = {params: Promise<{id: string}>}
const failure = (err: unknown) => {
  const code = err instanceof PurchaseBoundaryError ? err.code : 'purchase_unavailable'
  const status = code === 'purchase_feature_disabled' || code === 'purchase_not_found' ? 404
    : code === 'invalid_request' ? 400
    : code === 'purchase_store_unavailable' || code === 'purchase_unavailable' ? 503 : 409
  return NextResponse.json({error:code}, {status, headers})
}

export async function GET(request: Request, context: Ctx) {
  const session = await requireAgentSession(request)
  if (!isAgentSession(session)) return session
  try {
    return NextResponse.json(await readPurchaseView(session.telegramId, (await context.params).id), {headers})
  } catch (error) { return failure(error) }
}

export async function POST(request: Request, context: Ctx) {
  const blocked = requireAgentMutationOrigin(request)
  if (blocked) return blocked
  const session = await requireAgentSession(request)
  if (!isAgentSession(session)) return session
  try {
    const raw = await request.text()
    if (raw.length > 2048) throw new PurchaseBoundaryError('invalid_request')
    const input: Record<string, unknown> = JSON.parse(raw)
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new PurchaseBoundaryError('invalid_request')
    const id = (await context.params).id
    let result: unknown
    if (input.action === 'approve') {
      if (Object.keys(input).some(k => !['action','acknowledge','snapshotSha256','totalPaise','merchant'].includes(k))) throw new PurchaseBoundaryError('invalid_request')
      result = await approvePurchase(session.telegramId, id, input)
    } else if (input.action === 'open') {
      if (Object.keys(input).some(k => !['action','snapshotSha256'].includes(k))) throw new PurchaseBoundaryError('invalid_request')
      result = await openPurchaseHandoff(session.telegramId, id, input.snapshotSha256)
    } else if (input.action === 'cancel') {
      if (Object.keys(input).length !== 1) throw new PurchaseBoundaryError('invalid_request')
      result = await cancelPurchase(session.telegramId, id)
    } else throw new PurchaseBoundaryError('invalid_request')
    return NextResponse.json(result, {headers})
  } catch (error) { return failure(error) }
}
