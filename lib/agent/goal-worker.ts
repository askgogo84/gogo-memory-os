import { supabaseAdmin } from '@/lib/supabase-admin'
import { processGoalReviewWatcher } from './goal-engine'
import { sendAgentPush } from './push'

export async function processDueGoalReviews(limit=20){
  const now=new Date()
  const {data,error}=await supabaseAdmin.from('agent_watchers')
    .select('id,telegram_id,goal_id,type,condition_json,cadence_minutes,last_state_json,next_check_at,active')
    .eq('active',true).eq('type','goal_review').lte('next_check_at',now.toISOString())
    .order('next_check_at',{ascending:true}).limit(limit)
  if(error)throw new Error(`goal_watchers_read_failed:${error.message}`)
  let checked=0,triggered=0,failed=0
  for(const watcher of (data||[]) as any[]){
    checked++
    try{
      const result=await processGoalReviewWatcher(watcher,now)
      if(result.triggered){
        triggered++
        const title=String(watcher?.condition_json?.title||'Background Gogo').slice(0,140)
        await sendAgentPush(String(watcher.telegram_id),{
          title:'Gogo has a goal update',
          body:title,
          path:'/agent',
          data:{goalId:String(watcher.goal_id||''),watcherId:String(watcher.id||'')},
        }).catch((err:any)=>console.error('GOAL_PUSH_FAILED:',err?.message||err))
      }
      if(result.failed)failed++
    }catch(err:any){failed++;console.error('GOAL_REVIEW_FAILED:',watcher.id,err?.message||err)}
  }
  return {checked,triggered,failed}
}
