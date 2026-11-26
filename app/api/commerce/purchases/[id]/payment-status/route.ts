import {NextResponse} from 'next/server'
import {requireAgentMutationOrigin,requireAgentSession,isAgentSession} from '@/lib/agent/session'
import {checkNativePaymentOnce} from '@/lib/commerce/native-payment-status'
import {PurchaseBoundaryError} from '@/lib/commerce/purchase-contract'
export const dynamic='force-dynamic'
const headers={'Cache-Control':'no-store'}
type Ctx={params:Promise<{id:string}>}
export async function POST(request:Request,ctx:Ctx){
  const origin=requireAgentMutationOrigin(request)
  if(origin)return origin
  const session=await requireAgentSession(request)
  if(!isAgentSession(session))return session
  try{
    const raw=await request.text()
    if(raw.length>128)throw new PurchaseBoundaryError('invalid_request')
    const body=JSON.parse(raw) as Record<string,unknown>
    if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==1||body.action!=='check')
      throw new PurchaseBoundaryError('invalid_request')
    return NextResponse.json(await checkNativePaymentOnce(session.telegramId,(await ctx.params).id),{headers})
  }catch(error){
    const code=error instanceof PurchaseBoundaryError?error.code:'payment_readback_unavailable'
    const status=code==='purchase_feature_disabled'||code==='native_checkout_disabled'?404:
      code==='payment_check_in_progress'||code==='payment_check_too_soon'?429:
      code==='invalid_request'?400:503
    return NextResponse.json({error:code},{status,headers})
  }
}
