import { NextResponse } from 'next/server'
import { getSession } from '@/lib/dashboard/session'
import { verifySameOrigin } from '@/lib/dashboard/guard'
import { revealGeneratedVaultSecret } from '@/lib/vault/credential-store'

export const dynamic='force-dynamic'

const NO_STORE={'cache-control':'no-store, max-age=0','pragma':'no-cache'}

// Shows a password Gogo generated while creating an account, to its signed-in owner only, so they
// can finish the sign-up or sign in themselves. Passwords the person typed are never shown.
export async function POST(request:Request){
  const blocked=verifySameOrigin(request)
  if(blocked)return blocked
  const session=await getSession()
  if(!session)return NextResponse.json({ok:false},{status:401,headers:NO_STORE})
  let body:any={}
  try{body=await request.json()}catch{return NextResponse.json({ok:false,error:'invalid_body'},{status:400,headers:NO_STORE})}
  const id=String(body?.id||'').trim()
  if(!id)return NextResponse.json({ok:false,error:'missing_id'},{status:400,headers:NO_STORE})
  try{
    const secret=await revealGeneratedVaultSecret(session.telegramId,id)
    return NextResponse.json({ok:true,secret},{headers:NO_STORE})
  }catch(err:any){
    const reason=String(err?.message||'')
    if(reason==='vault_reveal_not_allowed')return NextResponse.json({ok:false,error:'not_allowed'},{status:403,headers:NO_STORE})
    if(reason==='vault_credential_unavailable')return NextResponse.json({ok:false,error:'not_found'},{status:404,headers:NO_STORE})
    console.error('VAULT_REVEAL_ROUTE_FAILED:',reason.slice(0,120))
    return NextResponse.json({ok:false,error:'reveal_failed'},{status:500,headers:NO_STORE})
  }
}
