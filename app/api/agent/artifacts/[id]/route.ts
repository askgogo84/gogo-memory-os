import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { isAgentSession, requireAgentSession } from '@/lib/agent/session'

export const dynamic='force-dynamic'

export async function GET(request:Request,context:{params:Promise<{id:string}>}){
  const session=await requireAgentSession(request)
  if(!isAgentSession(session))return session
  const {id}=await context.params
  if(!/^[0-9a-f-]{36}$/i.test(id))return NextResponse.json({error:'invalid_artifact'},{status:400})
  const {data,error}=await supabaseAdmin.from('agent_artifacts')
    .select('id,type,title,subtitle,schema_version,content_json,source_refs,created_at,updated_at')
    .eq('id',id).eq('telegram_id',session.telegramId).maybeSingle()
  if(error){console.error('AGENT_ARTIFACT_READ_FAILED:',error);return NextResponse.json({error:'read_failed'},{status:500})}
  if(!data)return NextResponse.json({error:'artifact_not_found'},{status:404})
  return NextResponse.json({artifact:{
    id:data.id,type:data.type,title:data.title,subtitle:data.subtitle,schemaVersion:data.schema_version,
    content:data.content_json||{},sourceRefs:Array.isArray(data.source_refs)?data.source_refs:[],createdAt:data.created_at,updatedAt:data.updated_at,
  }})
}
