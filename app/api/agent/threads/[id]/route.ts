import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { isAgentSession, requireAgentMutationOrigin, requireAgentSession } from '@/lib/agent/session'

export const dynamic='force-dynamic'
function clean(v:unknown,max=180){return String(v??'').replace(/\s+/g,' ').trim().slice(0,max)}

export async function PATCH(request:Request,context:{params:Promise<{id:string}>}){
  const blocked=requireAgentMutationOrigin(request);if(blocked)return blocked
  const session=await requireAgentSession(request);if(!isAgentSession(session))return session
  const {id}=await context.params;if(!/^[0-9a-f-]{36}$/i.test(id))return NextResponse.json({error:'invalid_thread'},{status:400})
  const body=await request.json().catch(()=>null) as any;const patch:any={updated_at:new Date().toISOString()}
  if(body?.title!==undefined){const title=clean(body.title,160);if(!title)return NextResponse.json({error:'invalid_title'},{status:400});patch.title=title}
  if(body?.context!==undefined&&body.context&&typeof body.context==='object'&&!Array.isArray(body.context))patch.context_json=body.context
  if(body?.status!==undefined){if(!['active','archived'].includes(String(body.status)))return NextResponse.json({error:'invalid_status'},{status:400});patch.status=body.status}
  const {data,error}=await supabaseAdmin.from('agent_threads').update(patch).eq('id',id).eq('telegram_id',session.telegramId).select('id,title,status,context_json,created_at,updated_at').maybeSingle()
  if(error)return NextResponse.json({error:'update_failed'},{status:500});if(!data)return NextResponse.json({error:'thread_not_found'},{status:404})
  return NextResponse.json({thread:{id:data.id,title:data.title,status:data.status,context:data.context_json||{},createdAt:data.created_at,updatedAt:data.updated_at}})
}
