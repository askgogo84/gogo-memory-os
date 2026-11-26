import {NextResponse} from 'next/server'
import {requireAgentMutationOrigin,requireAgentSession,isAgentSession} from '@/lib/agent/session'
import {confirmNativePaidOrderOnce} from '@/lib/commerce/native-order-confirmation'
import {PurchaseBoundaryError} from '@/lib/commerce/purchase-contract'
export const dynamic='force-dynamic'
type Ctx={params:Promise<{id:string}>}
const headers={'Cache-Control':'no-store'}
export async function POST(request:Request,ctx:Ctx){
 const origin=requireAgentMutationOrigin(request)
 if(origin)return origin
 const session=await requireAgentSession(request)
 if(!isAgentSession(session))return session
 try{
   const raw=await request.text()
   if(raw.length>128)throw new PurchaseBoundaryError('invalid_request')
   const body=JSON.parse(raw) as Record<string,unknown>
   if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==1||body.action!=='confirm')
     throw new PurchaseBoundaryError('invalid_request')
   return NextResponse.json(await confirmNativePaidOrderOnce(session.telegramId,(await ctx.params).id),{headers})
 }catch(error){
   const code=error instanceof PurchaseBoundaryError?error.code:'native_confirmation_unavailable'
   const status=code==='native_confirmation_disabled'||code==='purchase_feature_disabled'?404:
      code==='native_confirmation_already_attempted'?409:
      code==='invalid_request'?400:503
   return NextResponse.json({error:code},{status,headers})
 }
}
