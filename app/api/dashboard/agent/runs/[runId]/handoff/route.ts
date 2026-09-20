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
  const target=handoff?.mode==='device'?handoff?.providerUrl:handoff?.takeoverUrl
  if(!target)return NextResponse.json({error:'handoff_unavailable'},{status:404})
  let url:URL
  try{url=new URL(String(target))}catch{return NextResponse.json({error:'handoff_invalid'},{status:400})}
  if(!['https:','http:'].includes(url.protocol))return NextResponse.json({error:'handoff_invalid'},{status:400})

  return NextResponse.redirect(url)
}
