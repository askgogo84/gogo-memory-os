import { supabaseAdmin } from '@/lib/supabase-admin'
import { processGoalReviewWatcher } from './goal-engine'
import { sendAgentPush } from './push'

const GOAL_REVIEW_LEASE_MINUTES = 10

async function claimGoalWatcher(watcher:any, now:Date){
  const leaseUntil=new Date(now.getTime()+GOAL_REVIEW_LEASE_MINUTES*60_000).toISOString()
  let query=supabaseAdmin.from('agent_watchers')
    .update({next_check_at:leaseUntil,updated_at:now.toISOString()})
    .eq('id',watcher.id).eq('active',true)
  if(watcher.next_check_at)query=query.eq('next_check_at',watcher.next_check_at)
  else query=query.is('next_check_at',null)
  const {data,error}=await query.select('id').maybeSingle()
  if(error){console.error('GOAL_REVIEW_CLAIM_FAILED:',watcher.id,error.message);return false}
  return Boolean(data?.id)
}

async function goalSnapshot(telegramId:string, goalId:string){
  if(!goalId)return null
  const {data,error}=await supabaseAdmin.from('agent_goals')
    .select('id,title,status,progress,next_action,blockers,updated_at')
    .eq('telegram_id',telegramId).eq('id',goalId).maybeSingle()
  if(error){console.error('GOAL_REVIEW_SNAPSHOT_FAILED:',goalId,error.message);return null}
  return data as any|null
}

function goalSummary(goal:any, failed:boolean){
  const title=String(goal?.title||'Background Gogo goal').slice(0,160)
  const progress=Math.max(0,Math.min(100,Number(goal?.progress||0)))
  const blockers=Array.isArray(goal?.blockers)?goal.blockers.map((x:any)=>String(x)).filter(Boolean):[]
  const next=String(goal?.next_action||'').trim()
  if(failed)return `${title} needs attention. ${blockers[0]||next||'The background review could not continue safely.'}`.slice(0,600)
  if(String(goal?.status)==='completed'||progress>=100)return `${title} is complete.`
  if(blockers.length)return `${title} paused at ${progress}%. ${blockers[0]}`.slice(0,600)
  return `${title} is ${progress}% complete.${next?` Next: ${next}`:''}`.slice(0,600)
}

async function recordGoalReview(params:{telegramId:string;watcher:any;goal:any;triggered:boolean;failed:boolean;now:Date}){
  if(!params.triggered&&!params.failed)return null
  const {telegramId,watcher,goal,failed,now}=params
  const summary=goalSummary(goal,failed)
  const runStatus=failed?'failed':String(goal?.status)==='blocked'?'paused':'completed'
  const {data:run,error:runError}=await supabaseAdmin.from('agent_runs').insert({
    telegram_id:telegramId,
    goal_id:goal?.id||watcher.goal_id||null,
    type:'background_goal_review',
    capability:'tasks',
    status:runStatus,
    title:`Background Gogo · ${String(goal?.title||watcher?.condition_json?.title||'Goal').slice(0,140)}`,
    summary,
    progress:Number.isFinite(Number(goal?.progress))?Number(goal.progress):null,
    why:'Periodic background goal review while the client may be closed.',
    source:'background_goal',
    metadata_json:{
      watcherId:String(watcher.id||''),
      goalStatus:String(goal?.status||''),
      nextAction:goal?.next_action||null,
      blockers:Array.isArray(goal?.blockers)?goal.blockers:[],
      triggered:params.triggered,
    },
    started_at:now.toISOString(),
    updated_at:now.toISOString(),
    completed_at:now.toISOString(),
    error:failed?'background_goal_review_failed':null,
  }).select('id').single()
  if(runError||!run?.id){console.error('GOAL_ACTIVITY_RUN_FAILED:',runError?.message||'missing_run_id');return null}
  const {error:activityError}=await supabaseAdmin.from('agent_activity').insert({
    telegram_id:telegramId,
    run_id:run.id,
    event_type:failed?'goal_review_failed':'goal_review_progress',
    message:summary,
    metadata_json:{goalId:String(goal?.id||watcher.goal_id||''),watcherId:String(watcher.id||''),progress:goal?.progress??null,nextAction:goal?.next_action||null},
  })
  if(activityError)console.error('GOAL_ACTIVITY_EVENT_FAILED:',activityError.message)
  return {runId:String(run.id),summary}
}

export async function processDueGoalReviews(limit=20){
  const now=new Date()
  const {data,error}=await supabaseAdmin.from('agent_watchers')
    .select('id,telegram_id,goal_id,type,condition_json,cadence_minutes,last_state_json,next_check_at,active')
    .eq('active',true).eq('type','goal_review').lte('next_check_at',now.toISOString())
    .order('next_check_at',{ascending:true}).limit(limit)
  if(error)throw new Error(`goal_watchers_read_failed:${error.message}`)
  let checked=0,triggered=0,failed=0,claimed=0
  for(const watcher of (data||[]) as any[]){
    checked++
    if(!(await claimGoalWatcher(watcher,now)))continue
    claimed++
    const telegramId=String(watcher.telegram_id)
    try{
      const result=await processGoalReviewWatcher(watcher,now)
      if(result.triggered)triggered++
      if(result.failed)failed++
      const goal=await goalSnapshot(telegramId,String(watcher.goal_id||''))
      const activity=await recordGoalReview({telegramId,watcher,goal,triggered:result.triggered,failed:result.failed,now})
      if(result.triggered||result.failed){
        const title=result.failed?'Gogo needs your attention':String(goal?.status)==='completed'?'Gogo completed a goal':String(goal?.status)==='blocked'?'Gogo paused safely':'Gogo advanced a goal'
        const body=activity?.summary||goalSummary(goal,result.failed)
        await sendAgentPush(telegramId,{
          title,
          body,
          path:'/agent',
          data:{goalId:String(watcher.goal_id||''),watcherId:String(watcher.id||''),runId:activity?.runId||''},
        }).catch((err:any)=>console.error('GOAL_PUSH_FAILED:',err?.message||err))
      }
    }catch(err:any){
      failed++
      console.error('GOAL_REVIEW_FAILED:',watcher.id,err?.message||err)
      const goal=await goalSnapshot(telegramId,String(watcher.goal_id||''))
      const activity=await recordGoalReview({telegramId,watcher,goal,triggered:false,failed:true,now})
      await sendAgentPush(telegramId,{
        title:'Gogo needs your attention',
        body:activity?.summary||goalSummary(goal,true),
        path:'/agent',
        data:{goalId:String(watcher.goal_id||''),watcherId:String(watcher.id||''),runId:activity?.runId||''},
      }).catch((pushErr:any)=>console.error('GOAL_PUSH_FAILED:',pushErr?.message||pushErr))
    }
  }
  return {checked,claimed,triggered,failed}
}
