import { NextResponse } from 'next/server'
import { getSession } from '@/lib/dashboard/session'
import { verifySameOrigin } from '@/lib/dashboard/guard'
import { importLinkVaultJson } from '@/lib/services/link-vault'

export const dynamic='force-dynamic'

export async function POST(request:Request){
  const blocked=verifySameOrigin(request)
  if(blocked)return blocked
  const session=await getSession()
  if(!session)return NextResponse.json({ok:false},{status:401})
  let body:any
  try{body=await request.json()}catch{return NextResponse.json({ok:false,error:'invalid_json'},{status:400})}
  try{
    const result=await importLinkVaultJson(Number(session.telegramId),body)
    return NextResponse.json({ok:true,...result})
  }catch(err:any){
    console.error('LINK_VAULT_IMPORT_FAILED:',err?.message||err)
    return NextResponse.json({ok:false,error:'import_failed'},{status:500})
  }
}
