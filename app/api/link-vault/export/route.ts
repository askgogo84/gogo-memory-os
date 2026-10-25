import { NextResponse } from 'next/server'
import { getSession } from '@/lib/dashboard/session'
import { exportLinkVaultJson } from '@/lib/services/link-vault'

export const dynamic='force-dynamic'

export async function GET(){
  const session=await getSession()
  if(!session)return NextResponse.json({ok:false},{status:401})
  try{
    const payload=await exportLinkVaultJson(Number(session.telegramId))
    return new NextResponse(JSON.stringify(payload,null,2),{
      headers:{
        'Content-Type':'application/json; charset=utf-8',
        'Content-Disposition':'attachment; filename="askgogo-link-vault.json"',
        'Cache-Control':'no-store',
      },
    })
  }catch(err:any){
    console.error('LINK_VAULT_EXPORT_FAILED:',err?.message||err)
    return NextResponse.json({ok:false,error:'export_failed'},{status:500})
  }
}
