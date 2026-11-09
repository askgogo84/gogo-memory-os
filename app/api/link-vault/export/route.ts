import { NextResponse } from 'next/server'
import { getSession } from '@/lib/dashboard/session'
import { exportLinkVaultJson } from '@/lib/services/link-vault'
import { safeNumericLinkVaultOwnerId } from '@/lib/services/link-vault-owner'

export const dynamic='force-dynamic'

export async function GET(){
  const session=await getSession()
  if(!session)return NextResponse.json({ok:false},{status:401})
  // Never let Number() alias distinct persisted BIGINT owners across tenants.
  // Link Vault's numeric service must be migrated separately before 64-bit IDs work.
  const owner = safeNumericLinkVaultOwnerId(session.telegramId)
  if (owner === null) return NextResponse.json({ ok: false, error: 'owner_id_unrepresentable' }, { status: 409 })
  try{
    const payload=await exportLinkVaultJson(owner)
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
