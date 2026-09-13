import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { isAgentSession, requireAgentMutationOrigin, requireAgentSession } from '@/lib/agent/session'

export const dynamic='force-dynamic'

function safe(v:unknown,max=500){return String(v??'').trim().slice(0,max)}

export async function POST(request:Request){
  const session=await requireAgentSession(request);if(!isAgentSession(session))return session
  const origin=requireAgentMutationOrigin(request);if(origin)return origin
  const body=await request.json().catch(()=>null) as any
  const installationId=safe(body?.installationId,240),permissionStatus=safe(body?.permissionStatus||'unknown',80)
  if(!installationId)return NextResponse.json({error:'installation_id_required'},{status:400})
  const platform=session.surface==='ios'?'ios':'android',now=new Date().toISOString()
  const row={user_id:session.userId||null,telegram_id:String(session.telegramId),installation_id:installationId,platform,expo_push_token:safe(body?.expoPushToken,600)||null,native_push_token:safe(body?.nativePushToken,600)||null,permission_status:permissionStatus,enabled:true,updated_at:now,last_seen_at:now}
  const{data,error}=await supabaseAdmin.from('agent_devices').upsert(row,{onConflict:'telegram_id,installation_id'}).select('id,platform,permission_status,enabled,last_seen_at').single()
  if(error){console.error('AGENT_DEVICE_UPSERT_FAILED:',error.message);return NextResponse.json({error:'device_registration_failed'},{status:500})}
  return NextResponse.json({ok:true,device:{id:String(data.id),platform:String(data.platform),permissionStatus:String(data.permission_status||'unknown'),enabled:Boolean(data.enabled),lastSeenAt:String(data.last_seen_at||now)}})
}

export async function DELETE(request:Request){
  const session=await requireAgentSession(request);if(!isAgentSession(session))return session
  const origin=requireAgentMutationOrigin(request);if(origin)return origin
  const body=await request.json().catch(()=>null) as any,installationId=safe(body?.installationId,240)
  if(!installationId)return NextResponse.json({error:'installation_id_required'},{status:400})
  const{error}=await supabaseAdmin.from('agent_devices').update({enabled:false,updated_at:new Date().toISOString(),last_seen_at:new Date().toISOString()}).eq('telegram_id',String(session.telegramId)).eq('installation_id',installationId)
  if(error){console.error('AGENT_DEVICE_DISABLE_FAILED:',error.message);return NextResponse.json({error:'device_disable_failed'},{status:500})}
  return NextResponse.json({ok:true})
}
