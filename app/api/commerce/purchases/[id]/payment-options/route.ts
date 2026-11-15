import {NextResponse} from 'next/server'
import {isAgentSession,requireAgentSession} from '@/lib/agent/session'
import {readNativeInstamartPaymentOptions} from '@/lib/commerce/native-payment-options'
import {PurchaseBoundaryError} from '@/lib/commerce/purchase-contract'

export const dynamic='force-dynamic'
const headers={'Cache-Control':'no-store'}
type Ctx={params:Promise<{id:string}>}
export async function GET(request:Request,context:Ctx){
  const session=await requireAgentSession(request)
  if(!isAgentSession(session)) return session
  try{return NextResponse.json(await readNativeInstamartPaymentOptions(session.telegramId,(await context.params).id),{headers})}
  catch(error){
    const code=error instanceof PurchaseBoundaryError ? error.code:'provider_payment_options_unavailable'
    const status=code==='purchase_feature_disabled'||code==='purchase_not_found'?404:
      code==='provider_payment_options_unavailable'?503:409
    return NextResponse.json({error:code},{status,headers})
  }
}
