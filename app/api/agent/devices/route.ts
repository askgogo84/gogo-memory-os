import { NextResponse } from 'next/server'
import { isAgentSession, requireAgentMutationOrigin, requireAgentSession } from '@/lib/agent/session'
import { resolveAgentActor } from '@/lib/agent/actor'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic='force-dynamic'

function clean(value:unknown,max=500){return String(value??'').trim().slice(0,max)}

export async function POST(request:Request){
  const blocked=requireAgentMutationOrigin(request);if(blocked)return blocked
  const session=await requireAgentSession(request);if(!isAgentSession(session))return session
  if(session.surface==='web')return NextResponse.json({error:'native_session_required'},{status:400})
  const body=await request.json().catch(()=>null) as any
  const installationId=clean(body?.installationId,160)
  const expoPushToken=clean(body?.expoPushToken,500)||null
  const nativePushToken=clean(body?.nativePushToken,1000)||null
  const permissionStatus=clean(body?.permissionStatus,40)||'undetermined'
  if(!installationId)return NextResponse.json({error:'installation_id_required'},{status:400})
  try{
    const actor=await resolveAgentActor(session)
    const now=new Date().toISOString()
    const {data,error}=await supabaseAdmin.from('agent_devices').upsert({
      user_id:actor.userId,telegram_id:String(actor.legacyTelegramId),installation_id:installationId,
      platform:session.surface,expo_push_token:expoPushToken,native_push_token:nativePushToken,
      permission_status:permissionStatus,enabled:permissionStatus==='granted',last_seen_at:now,updated_at:now,
    },{onConflict:'telegram_id,installation_id'}).select('id,platform,permission_status,enabled,last_seen_at').single()
    if(error||!data)throw new Error(error?.message||'device_registration_failed')
    return NextResponse.json({ok:true,device:{id:String(data.id),platform:data.platform,permissionStatus:data.permission_status,enabled:data.enabled,lastSeenAt:data.last_seen_at}})
  }catch(err:any){console.error('AGENT_DEVICE_REGISTER_FAILED:',err?.message||err);return NextResponse.json({error:'device_registration_failed'},{status:500})}
}

export async function DELETE(request:Request){
  const blocked=requireAgentMutationOrigin(request);if(blocked)return blocked
  const session=await requireAgentSession(request);if(!isAgentSession(session))return session
  const body=await request.json().catch(()=>null) as any
  const installationId=clean(body?.installationId,160)
  if(!installationId)return NextResponse.json({error:'installation_id_required'},{status:400})
  try{
    const actor=await resolveAgentActor(session)
    const {error}=await supabaseAdmin.from('agent_devices').update({enabled:false,updated_at:new Date().toISOString()})
      .eq('telegram_id',String(actor.legacyTelegramId)).eq('installation_id',installationId)
    if(error)throw error
    return NextResponse.json({ok:true})
  }catch(err:any){console.error('AGENT_DEVICE_DISABLE_FAILED:',err?.message||err);return NextResponse.json({error:'device_disable_failed'},{status:500})}
}
