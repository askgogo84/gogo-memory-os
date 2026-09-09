import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { isAgentSession, requireAgentMutationOrigin, requireAgentSession } from '@/lib/agent/session'

export const dynamic='force-dynamic'

function clean(v:unknown,max=180){return String(v??'').replace(/\s+/g,' ').trim().slice(0,max)}

export async function GET(request:Request){
  const session=await requireAgentSession(request);if(!isAgentSession(session))return session
  const {data,error}=await supabaseAdmin.from('agent_threads').select('id,title,status,context_json,created_at,updated_at').eq('telegram_id',session.telegramId).eq('status','active').order('updated_at',{ascending:false}).limit(50)
  if(error)return NextResponse.json({error:'read_failed'},{status:500})
  return NextResponse.json({threads:(data||[]).map((t:any)=>({id:t.id,title:t.title,status:t.status,context:t.context_json||{},createdAt:t.created_at,updatedAt:t.updated_at}))})
}

export async function POST(request:Request){
  const blocked=requireAgentMutationOrigin(request);if(blocked)return blocked
  const session=await requireAgentSession(request);if(!isAgentSession(session))return session
  const body=await request.json().catch(()=>null) as any
  const title=clean(body?.title,160);if(!title)return NextResponse.json({error:'title_required'},{status:400})
  const context=body?.context&&typeof body.context==='object'&&!Array.isArray(body.context)?body.context:{}
  const {data,error}=await supabaseAdmin.from('agent_threads').insert({telegram_id:session.telegramId,title,context_json:context}).select('id,title,status,context_json,created_at,updated_at').single()
  if(error||!data)return NextResponse.json({error:'create_failed'},{status:500})
  return NextResponse.json({thread:{id:data.id,title:data.title,status:data.status,context:data.context_json||{},createdAt:data.created_at,updatedAt:data.updated_at}},{status:201})
}
