import { NextResponse } from 'next/server'
import { isAgentSession, requireAgentSession } from '@/lib/agent/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { diningObservationFromRun } from '@/lib/openui/dining-observation'

export const dynamic='force-dynamic'
const noStore={ 'Cache-Control':'private, no-store' }
/** Authenticated, owner-scoped, read-only saved observation. Not live availability. */
export async function GET(request:Request,context:{params:Promise<{id:string}>}){
  const session=await requireAgentSession(request)
  if(!isAgentSession(session))return session
  const {id}=await context.params
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
    return NextResponse.json({error:'invalid_run'},{status:400,headers:noStore})
  try{
    const {data,error}=await supabaseAdmin.from('agent_runs')
      .select('id,type,status,updated_at,metadata_json')
      .eq('id',id)
      .eq('telegram_id',String(session.telegramId))
      .in('type',['restaurant_reservation_slot','restaurant_reservation_research'])
      .maybeSingle()
    if(error)return NextResponse.json({error:'read_unavailable'},{status:503,headers:noStore})
    const observation=data?diningObservationFromRun(data):null
    if(!observation)return NextResponse.json({error:'not_found'},{status:404,headers:noStore})
    return NextResponse.json(observation,{headers:noStore})
  }catch{
    return NextResponse.json({error:'read_unavailable'},{status:503,headers:noStore})
  }
}
