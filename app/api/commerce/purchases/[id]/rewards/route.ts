import {NextResponse} from 'next/server'
import {isAgentSession,requireAgentSession} from '@/lib/agent/session'
import {readVerifiedCreditIQMerchantBenefits,CREDITIQ_COMMERCE_ADVISORY_NOTICE} from '@/lib/commerce/creditiq-commerce-adapter'
import {PurchaseBoundaryError} from '@/lib/commerce/purchase-contract'

export const dynamic='force-dynamic'
type Ctx={params:Promise<{id:string}>}
const headers={'Cache-Control':'no-store'}
/** Read only: issuer-verified advisory quotes, never a card or payment choice. */
export async function GET(request:Request,context:Ctx){
  const session=await requireAgentSession(request)
  if(!isAgentSession(session))return session
  try{
    const result=await readVerifiedCreditIQMerchantBenefits(session.telegramId,(await context.params).id)
    return NextResponse.json({...result,notice:CREDITIQ_COMMERCE_ADVISORY_NOTICE},{headers})
  }catch(error){
    const code=error instanceof PurchaseBoundaryError?error.code:'creditiq_rewards_unavailable'
    const status=code==='purchase_feature_disabled'||code==='purchase_not_found'?404:503
    return NextResponse.json({error:code},{status,headers})
  }
}
