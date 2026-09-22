import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { resumePersistentGeneralPlan } from '@/lib/agent/persistent-general-plan'
import type { AgentActor } from '@/lib/agent/actor'
import { runQueuedTrainResearch } from '@/lib/agent/train-research'
import { resumePausedBrowserRun } from '@/lib/agent/browser-command'
import { sendWhatsApp } from '@/lib/whatsapp'

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
    // ---- secure_browser: continue safe read/draft work after WhatsApp timeout ----
    // WhatsApp only waits ~42s. If a provider is slow, the webhook pauses the run
    // instead of leaving the user with silence. The background worker claims that
    // exact timeout outcome and resumes the SAME persistent browser task. Execute-mode
    // work still requires its existing approval and is never auto-resumed here.
    let browserClaimed=0,browserDone=0,browserPaused=0,browserFailed=0
    const {data:pausedBrowsers,error:browserReadError}=await supabaseAdmin.from('agent_runs')
      .select('id,telegram_id,status,error,metadata_json,updated_at')
      .eq('type','secure_browser')
      .eq('status','paused')
      .eq('error','whatsapp_browser_response_timeout')
      .order('updated_at',{ascending:true})
      .limit(3)
    if(browserReadError)console.error('BROWSER_BACKGROUND_QUEUE_READ_FAILED:',browserReadError.message)
    for(const run of pausedBrowsers||[]){
      const meta:any=run.metadata_json||{}
      const mode=String(meta.mode||'read')
      if(mode==='execute'){browserPaused++;continue}
      const claimTag=`background_resume_claimed:${new Date().toISOString()}`
      const {data:claimed,error:claimError}=await supabaseAdmin.from('agent_runs')
        .update({error:claimTag,updated_at:new Date().toISOString()})
        .eq('id',run.id)
        .eq('telegram_id',String(run.telegram_id))
        .eq('status','paused')
        .eq('error','whatsapp_browser_response_timeout')
        .select('id')
        .maybeSingle()
      if(claimError){browserFailed++;console.error('BROWSER_BACKGROUND_CLAIM_FAILED:',run.id,claimError.message);continue}
      if(!claimed?.id)continue
      browserClaimed++
      const actor=await actorFor(String(run.telegram_id))
      if(!actor){browserFailed++;continue}
      try{
        const result=await resumePausedBrowserRun({actor,runId:String(run.id)})
        if(result.status==='completed')browserDone++;else browserPaused++
        if(actor.whatsappId&&result?.text){
          await sendWhatsApp(actor.whatsappId,
            result.status==='completed'
              ? `✅ Background Gogo finished the browser task\n\n${result.text}`
              : result.text
          )
        }
        results.push({runId:String(run.id),status:result.status,browser:true})
      }catch(err:any){
        browserFailed++
        console.error('BROWSER_BACKGROUND_RESUME_FAILED:',run.id,err?.message||err)
        const at=new Date().toISOString()
        await supabaseAdmin.from('agent_runs').update({
          status:'failed',error:String(err?.message||'background_browser_resume_failed').slice(0,500),
          summary:'Gogo could not finish the background browser task.',completed_at:at,updated_at:at,
        }).eq('id',run.id).eq('telegram_id',String(run.telegram_id)).eq('status','paused')
      }
    }

    // ---- train_research: background execution ----
    // The WhatsApp webhook only ENQUEUES train runs (42s budget, function killed after
    // reply). This worker claims them with an optimistic lock, runs the browser with the
    // 300s budget, and pushes the outcome back over WhatsApp. Reuses the claim pattern
    // from booking-change-worker.ts.
    let trainClaimed=0,trainDone=0,trainFailed=0,trainRequeued=0
    const staleBefore=new Date(Date.now()-10*60_000).toISOString()
    const dayAgo=new Date(Date.now()-24*3600_000).toISOString()
    // Stale sweep: 'running' with no progress for 10 min means the function died.
    // Requeue once (persistent sandbox keeps the bootstrap, so the retry is fast); then fail.
    const {data:stale}=await supabaseAdmin.from('agent_runs').select('id,metadata_json,started_at').eq('type','train_research').eq('status','running').lte('updated_at',staleBefore).limit(10)
    for(const r of (stale||[]) as any[]){
      const meta:any=r.metadata_json||{};const at=new Date().toISOString()
      if(!meta.requeued&&String(r.started_at||at)>dayAgo){
        await supabaseAdmin.from('agent_runs').update({status:'queued',updated_at:at,metadata_json:{...meta,requeued:true,requeued_at:at}}).eq('id',r.id).eq('status','running')
        trainRequeued++
      }else{
        await supabaseAdmin.from('agent_runs').update({status:'failed',error:'stale_run_recovered',summary:'Gogo could not complete the train task.',completed_at:at,updated_at:at}).eq('id',r.id).eq('status','running')
        trainFailed++
      }
    }
    // One run per tick: a first-run bootstrap can use most of the 300s budget.
    const {data:queuedRuns,error:qErr}=await supabaseAdmin.from('agent_runs').select('id,telegram_id,metadata_json').eq('type','train_research').eq('status','queued').order('updated_at',{ascending:true}).limit(1)
    if(qErr)console.error('TRAIN_QUEUE_READ_FAILED:',qErr.message)
    for(const run of (queuedRuns||[]) as any[]){
      const {data:claimed}=await supabaseAdmin.from('agent_runs').update({status:'running',updated_at:new Date().toISOString()}).eq('id',run.id).eq('status','queued').select('id').maybeSingle()
      if(!claimed?.id)continue
      trainClaimed++
      const actor=await actorFor(String(run.telegram_id))
      if(!actor){trainFailed++;continue}
      try{
        const result=await runQueuedTrainResearch({actor,runId:String(run.id)})
        if(actor.whatsappId&&result?.text)await sendWhatsApp(actor.whatsappId,result.text)
        if(result.status==='failed')trainFailed++;else trainDone++
        results.push({runId:String(run.id),status:result.status,train:true})
      }catch(err:any){
        trainFailed++
        console.error('TRAIN_WORKER_RUN_FAILED:',run.id,err?.message||err)
        const failedAt=new Date().toISOString()
        await supabaseAdmin.from('agent_runs').update({status:'failed',error:String(err?.message||'train_worker_failed').slice(0,500),summary:'Gogo could not complete the train task.',completed_at:failedAt,updated_at:failedAt}).eq('id',run.id).eq('status','running')
        try{if(actor.whatsappId)await sendWhatsApp(actor.whatsappId,'I could not complete the train search. I did not invent timings or availability. Try again shortly, or check IRCTC directly.')}catch{}
      }
    }
    return NextResponse.json({ok:true,checked,resumed,completed,failed,skipped,browserClaimed,browserDone,browserPaused,browserFailed,trainClaimed,trainDone,trainFailed,trainRequeued,results})
  }catch(err:any){
    console.error('AUTONOMOUS_CRON_FAILED:',err?.message||err)
    return NextResponse.json({ok:false,error:'autonomous_worker_failed'},{status:500})
  }
}
