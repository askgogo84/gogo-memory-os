import {NextResponse} from 'next/server'
import {isAgentSession,requireAgentMutationOrigin,requireAgentSession} from '@/lib/agent/session'
import {prepareNativeCheckout,executeApprovedNativeCheckout} from '@/lib/commerce/native-checkout-executor'
import {PurchaseBoundaryError} from '@/lib/commerce/purchase-contract'
export const dynamic='force-dynamic'
const headers={'Cache-Control':'no-store'}
type Ctx={params:Promise<{id:string}>}
function failure(error:unknown){
 const code=error instanceof PurchaseBoundaryError?error.code:'native_checkout_unavailable'
 const status=code==='native_checkout_disabled'||code==='purchase_feature_disabled'?404:
    code==='native_checkout_already_attempted'?409:
    code==='purchase_store_unavailable'||code==='native_checkout_unavailable'?503:400
 return NextResponse.json({error:code},{headers,status})
}
export async function GET(request:Request,context:Ctx) {
 const session=await requireAgentSession(request)
 if(!isAgentSession(session))return session
 try{return NextResponse.json(await prepareNativeCheckout(session.telegramId,(await context.params).id),{headers})}
 catch(error){return failure(error)}
}
export async function POST(request:Request,context:Ctx) {
 const blocked=requireAgentMutationOrigin(request)
 if(blocked)return blocked
 const session=await requireAgentSession(request)
 if(!isAgentSession(session))return session
 try{
   const raw=await request.text()
   if(raw.length>2048)throw new PurchaseBoundaryError('invalid_request')
   const consent=JSON.parse(raw) as Record<string,unknown>
   if(!consent||typeof consent!=='object'||Array.isArray(consent)||
      Object.keys(consent).some(key=>!['reviewId','reviewSha256','snapshotSha256',
       'totalPaise','methodId','mode','acknowledge','addressAccepted'].includes(key)))
      throw new PurchaseBoundaryError('invalid_request')
   return NextResponse.json(
      await executeApprovedNativeCheckout(session.telegramId,(await context.params).id,consent),
      {headers})
 }catch(error){return failure(error)}
}
