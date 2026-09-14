import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { resumePersistentGeneralPlan } from '@/lib/agent/persistent-general-plan'
import type { AgentActor } from '@/lib/agent/actor'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

function authorized(request: Request) {
  const expected = process.env.CRON_SECRET
  if (!expected) return false
  const url = new URL(request.url)
  const query = url.searchParams.get('secret')
  const bearer = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
  return query === expected || bearer === expected
}

async function actorFor(telegramId:string):Promise<AgentActor|null> {
  const {data,error}=await supabaseAdmin.from('users')
    .select('id,telegram_id,whatsapp_id,name')
    .eq('telegram_id',Number(telegramId)).maybeSingle()
  if(error){console.error('AUTONOMOUS_CRON_ACTOR_FAILED:',error.message);return null}
  if(!data?.id||!data?.telegram_id)return null
  return {
    userId:String(data.id),
    legacyTelegramId:Number(data.telegram_id),
    whatsappId:String(data.whatsapp_id||''),
    name:String(data.name||'Gogo'),
  }
}

export async function GET(request:Request){
  if(!authorized(request))return NextResponse.json({error:'unauthorized'},{status:401})
  try{
    const {data:runs,error}=await supabaseAdmin.from('agent_runs')
      .select('id,telegram_id,status,metadata_json,updated_at')
      .eq('type','autonomous')
      .in('status',['running','queued'])
      .order('updated_at',{ascending:true})
      .limit(20)
    if(error)throw new Error(`autonomous_cron_read_failed:${error.message}`)

    let checked=0,resumed=0,completed=0,failed=0,skipped=0
    const results:any[]=[]
    for(const run of runs||[]){
      checked++
      const meta:any=run.metadata_json||{}
      if(!meta.persistent_general_plan){skipped++;continue}
      const actor=await actorFor(String(run.telegram_id))
      if(!actor){skipped++;continue}
      try{
        const result=await resumePersistentGeneralPlan({actor,runId:String(run.id),maxWaves:6})
        resumed++
        if(result.status==='completed')completed++
        results.push({runId:String(run.id),status:result.status,executed:result.executed})
      }catch(err:any){
        failed++
        console.error('AUTONOMOUS_CRON_RUN_FAILED:',run.id,err?.message||err)
        results.push({runId:String(run.id),status:'error'})
      }
    }
    return NextResponse.json({ok:true,checked,resumed,completed,failed,skipped,results})
  }catch(err:any){
    console.error('AUTONOMOUS_CRON_FAILED:',err?.message||err)
    return NextResponse.json({ok:false,error:'autonomous_worker_failed'},{status:500})
  }
}
