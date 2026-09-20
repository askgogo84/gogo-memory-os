import { NextResponse } from 'next/server'
import { getSession } from '@/lib/dashboard/session'
import { verifySameOrigin } from '@/lib/dashboard/guard'
import { getVaultProvider } from '@/lib/vault/providers'
import { listVaultCredentials, removeVaultCredential, saveVaultCredential } from '@/lib/vault/credential-store'

export const dynamic='force-dynamic'

export async function GET(){
  const session=await getSession()
  if(!session)return NextResponse.json({ok:false},{status:401})
  const items=await listVaultCredentials(session.telegramId)
  return NextResponse.json({ok:true,items})
}

export async function POST(request:Request){
  const blocked=verifySameOrigin(request)
  if(blocked)return blocked
  const session=await getSession()
  if(!session)return NextResponse.json({ok:false},{status:401})

  let body:any={}
  try{body=await request.json()}catch{return NextResponse.json({ok:false,error:'invalid_body'},{status:400})}
  const provider=getVaultProvider(String(body?.provider||''))
  if(!provider)return NextResponse.json({ok:false,error:'unsupported_provider'},{status:400})

  const username=String(body?.username||'').trim()
  const secret=String(body?.secret||'')
  const accountLabel=String(body?.accountLabel||provider.label).trim().slice(0,120)
  if(!username||!secret)return NextResponse.json({ok:false,error:'missing_credentials'},{status:400})

  try{
    const item=await saveVaultCredential({
      telegramId:session.telegramId,
      credentialId:String(body?.credentialId||'').trim()||null,
      provider:provider.key,
      accountLabel:accountLabel||provider.label,
      username,
      secret,
      allowedDomains:provider.domains,
      metadata:{login_url:provider.loginUrl,source:'dashboard'},
    })
    return NextResponse.json({ok:true,item})
  }catch(err:any){
    const reason=String(err?.message||'')
    if(reason==='vault_label_conflict')return NextResponse.json({ok:false,error:'label_conflict'},{status:409})
    if(reason==='vault_credential_not_found')return NextResponse.json({ok:false,error:'not_found'},{status:404})
    console.error('VAULT_SAVE_ROUTE_FAILED:',reason||err)
    return NextResponse.json({ok:false,error:'save_failed'},{status:500})
  }
}

export async function DELETE(request:Request){
  const blocked=verifySameOrigin(request)
  if(blocked)return blocked
  const session=await getSession()
  if(!session)return NextResponse.json({ok:false},{status:401})

  let body:any={}
  try{body=await request.json()}catch{return NextResponse.json({ok:false,error:'invalid_body'},{status:400})}
  const id=String(body?.id||'').trim()
  if(!id)return NextResponse.json({ok:false,error:'missing_id'},{status:400})
  try{
    const removed=await removeVaultCredential(session.telegramId,id)
    return NextResponse.json({ok:removed})
  }catch(err:any){
    console.error('VAULT_DELETE_ROUTE_FAILED:',err?.message||err)
    return NextResponse.json({ok:false,error:'delete_failed'},{status:500})
  }
}
