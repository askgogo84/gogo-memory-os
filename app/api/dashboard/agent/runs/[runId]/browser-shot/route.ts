import { NextResponse } from 'next/server'
import { getSession } from '@/lib/dashboard/session'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic='force-dynamic'

export async function GET(_request:Request,{params}:{params:Promise<{runId:string}>}){
  const session=await getSession()
  if(!session)return NextResponse.json({error:'unauthorized'},{status:401})
  const {runId}=await params
  const {data,error}=await supabaseAdmin.from('agent_runs')
    .select('metadata_json')
    .eq('id',runId)
    .eq('telegram_id',String(session.telegramId))
    .maybeSingle()
  if(error)return NextResponse.json({error:'read_failed'},{status:500})
  if(!data)return NextResponse.json({error:'not_found'},{status:404})

  const handoff:any=(data.metadata_json as any)?.handoff||{}
  const takeover=String(handoff?.takeoverUrl||'')
  if(!takeover)return NextResponse.json({error:'browser_preview_unavailable'},{status:404})

  let url:URL
  try{
    url=new URL(takeover)
    const token=url.searchParams.get('token')
    if(!token)throw new Error('missing_token')
    url.pathname='/shot'
    url.search=''
    url.searchParams.set('token',token)
  }catch{
    return NextResponse.json({error:'browser_preview_invalid'},{status:400})
  }

  try{
    const res=await fetch(url,{cache:'no-store'})
    if(!res.ok)return NextResponse.json({error:'browser_preview_failed'},{status:502})
    const bytes=await res.arrayBuffer()
    return new NextResponse(bytes,{status:200,headers:{'content-type':'image/png','cache-control':'no-store, max-age=0'}})
  }catch{
    return NextResponse.json({error:'browser_preview_failed'},{status:502})
  }
}
