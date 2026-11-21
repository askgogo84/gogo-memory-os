import {NextResponse} from 'next/server'
import {isAgentSession,requireAgentSession} from '@/lib/agent/session'
import {readNativeMerchantOrders} from '@/lib/commerce/native-order-reconciliation'
import {PurchaseBoundaryError} from '@/lib/commerce/purchase-contract'
export const dynamic='force-dynamic'
type Ctx={params:Promise<{id:string}>}
const headers={'Cache-Control':'no-store'}
export async function GET(request:Request,context:Ctx){
 const session=await requireAgentSession(request)
 if(!isAgentSession(session))return session
 try{return NextResponse.json(await readNativeMerchantOrders(session.telegramId,(await context.params).id),{headers})}
 catch(error){
   const code=error instanceof PurchaseBoundaryError?error.code:'order_readback_unavailable'
   return NextResponse.json({error:code},{status:code==='purchase_not_found'?404:503,headers})
 }
}
