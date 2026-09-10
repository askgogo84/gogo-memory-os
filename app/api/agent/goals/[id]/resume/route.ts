import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { isAgentSession, requireAgentMutationOrigin, requireAgentSession } from '@/lib/agent/session'

export const dynamic='force-dynamic'

function clean(value:unknown,max=500){return String(value??'').replace(/\s+/g,' ').trim().slice(0,max)}

export async function POST(request:Request,context:{params:Promise<{id:string}>}){
  const blocked=requireAgentMutationOrigin(request);if(blocked)return blocked
  const session=await requireAgentSession(request);if(!isAgentSession(session))return session
  const {id}=await context.params
  if(!/^[0-9a-f-]{36}$/i.test(id))return NextResponse.json({error:'invalid_goal'},{status:400})

  const body=await request.json().catch(()=>({})) as any
  const note=clean(body?.note||'Reviewed by user; continue with the remaining safe steps.',600)

  const {data:goal,error}=await supabaseAdmin.from('agent_goals')
    .select('id,title,status,plan_json').eq('id',id).eq('telegram_id',session.telegramId).maybeSingle()
  if(error)return NextResponse.json({error:'read_failed'},{status:500})
  if(!goal)return NextResponse.json({error:'not_found'},{status:404})
  if(['completed','cancelled'].includes(String(goal.status)))return NextResponse.json({error:'goal_not_resumable'},{status:409})

  const plan:any=goal.plan_json&&Array.isArray((goal.plan_json as any).steps)?structuredClone(goal.plan_json):null
  if(!plan)return NextResponse.json({error:'goal_plan_missing'},{status:409})
  const blockedStep=plan.steps.find((step:any)=>step?.status==='blocked')
  if(!blockedStep)return NextResponse.json({error:'no_blocked_step'},{status:409})

  blockedStep.status='completed'
  blockedStep.result={...(blockedStep.result||{}),humanReviewed:true,humanReviewNote:note,humanReviewedAt:new Date().toISOString()}
  const completed=plan.steps.filter((step:any)=>step.status==='completed').length
  const progress=Math.round((completed/Math.max(1,plan.steps.length))*100)
  const next=plan.steps.find((step:any)=>step.status==='pending')
  const now=new Date().toISOString()

  const {error:updateError}=await supabaseAdmin.from('agent_goals').update({
    plan_json:plan,status:progress===100?'completed':'active',progress,
    next_action:next?.title||null,blockers:[],updated_at:now,
  }).eq('id',id).eq('telegram_id',session.telegramId)
  if(updateError)return NextResponse.json({error:'update_failed'},{status:500})

  if(progress<100){
    const {data:watcher}=await supabaseAdmin.from('agent_watchers').select('id').eq('goal_id',id).eq('telegram_id',session.telegramId).eq('type','goal_review').limit(1).maybeSingle()
    if(watcher?.id){
      await supabaseAdmin.from('agent_watchers').update({active:true,next_check_at:now,updated_at:now}).eq('id',watcher.id)
    }else{
      await supabaseAdmin.from('agent_watchers').insert({telegram_id:session.telegramId,goal_id:id,type:'goal_review',condition_json:{title:goal.title,delivery:'both'},cadence_minutes:60,active:true,last_state_json:{resumedAt:now},next_check_at:now})
    }
  }

  await supabaseAdmin.from('agent_activity').insert({
    telegram_id:session.telegramId,event_type:'goal_resumed',message:`Goal resumed after review: ${goal.title}`.slice(0,900),
    metadata_json:{goal_id:id,surface:session.surface,resolved_step:blockedStep.id,next_action:next?.title||null},
  }).then(({error})=>{if(error)console.error('GOAL_RESUME_ACTIVITY_FAILED:',error.message)})

  return NextResponse.json({ok:true,goalId:id,status:progress===100?'completed':'active',progress,nextAction:next?.title||null})
}
