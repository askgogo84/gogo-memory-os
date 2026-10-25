import {NextResponse} from 'next/server'
import {isAgentSession, requireAgentSession} from '@/lib/agent/session'
import {supabaseAdmin} from '@/lib/supabase-admin'
import {projectTravelEvidence} from '@/lib/openui/travel-observation'

// Read-only UI projection, not a provider search or a booking executor.
export const dynamic='force-dynamic'
export async function GET(req:Request, context:{params:Promise<{id:string}>}){
  const session=await requireAgentSession(req)
  if(!isAgentSession(session))return session
  const {id}=await context.params
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
    return NextResponse.json({error:'invalid_run'},{status:400})
  const owner=String(session.telegramId)
  try{
    const {data:run,error:runError}=await supabaseAdmin.from('agent_runs')
      .select('id,status,title,type,metadata_json').eq('id',id).eq('telegram_id',owner)
      .eq('type','travel_research').maybeSingle()
    if(runError)return NextResponse.json({error:'read_unavailable'},{status:503})
    if(!run)return NextResponse.json({error:'not_found'},{status:404})
    const {data:step,error:stepError}=await supabaseAdmin.from('agent_steps')
      .select('run_id,tool_name,status,output_json,completed_at')
      .eq('run_id',id).eq('telegram_id',owner).eq('tool_name','travel')
      .eq('status','completed').order('ordinal',{ascending:false}).limit(1).maybeSingle()
    if(stepError)return NextResponse.json({error:'read_unavailable'},{status:503})
    const result=projectTravelEvidence(run,step)
    if(!result)return NextResponse.json({error:'no_verified_travel_result'},{status:404})
    return NextResponse.json(result,{headers:{'Cache-Control':'private, no-store'}})
  }catch{return NextResponse.json({error:'read_unavailable'},{status:503})}
}
