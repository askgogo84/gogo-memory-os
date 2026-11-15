import {NextResponse} from 'next/server'
import {isAgentSession, requireAgentSession} from '@/lib/agent/session'
import {readVerifiedMerchantOutcome} from '@/lib/commerce/purchase-outcome-store'
import {PurchaseBoundaryError} from '@/lib/commerce/purchase-contract'

export const dynamic = 'force-dynamic'
type Ctx = {params: Promise<{id:string}>}
const headers = {'Cache-Control':'no-store'}
/** Customer can READ independently verified merchant outcomes, never submit them. */
export async function GET(request: Request, context: Ctx) {
  const session = await requireAgentSession(request)
  if (!isAgentSession(session)) return session
  try {
    const result = await readVerifiedMerchantOutcome(session.telegramId,(await context.params).id)
    return NextResponse.json(result,{headers})
  } catch (error) {
    const code=error instanceof PurchaseBoundaryError ? error.code : 'purchase_unavailable'
    const status=code==='purchase_not_found'||code==='purchase_feature_disabled'?404:503
    return NextResponse.json({error:code},{status,headers})
  }
}
