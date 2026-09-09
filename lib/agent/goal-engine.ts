import Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { searchWebResults } from '@/lib/web-search'
import { sendWhatsAppMessage } from '@/lib/channels/whatsapp'
import { classifyAgentRequest } from './classifier'
import { dispatchThroughSameBrain } from './same-brain'
import { evaluateAgentExecutionPolicy, type AgentPermissionLevel } from './policy'
import { evaluateAgentSentinel } from './sentinel'
import type { AgentActor } from './actor'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
const MAX_GOAL_STEPS = 8

export type GoalStepKind = 'web_search'|'private_action'|'artifact'|'review'
export type GoalPlanStep = {
  id:string
  title:string
  kind:GoalStepKind
  instruction:string
  status:'pending'|'completed'|'blocked'
  result?:Record<string,unknown>
}
export type GoalPlan = { version:1; steps:GoalPlanStep[] }

const DEFAULT_LEVEL:Record<string,AgentPermissionLevel>={
  memory:'ask',files:'ask',reminders:'auto',lists:'auto',tasks:'auto',email:'draft',calendar:'ask',browser:'draft',contacts:'read',travel:'draft',payments:'ask',
}

function clean(value:unknown,max=1200){return String(value??'').replace(/\s+/g,' ').trim().slice(0,max)}
function parseJson(text:string){const s=String(text||'').replace(/```json|```/g,'').trim();try{return JSON.parse(s)}catch{};const m=s.match(/\{[\s\S]*\}/);if(!m)return null;try{return JSON.parse(m[0])}catch{return null}}

function normalizePlan(raw:any):GoalPlan|null{
  const allowed=new Set<GoalStepKind>(['web_search','private_action','artifact','review'])
  if(!Array.isArray(raw?.steps))return null
  const steps:GoalPlanStep[]=[]
  for(const item of raw.steps.slice(0,MAX_GOAL_STEPS)){
    const kind=String(item?.kind||'') as GoalStepKind
    const title=clean(item?.title,150),instruction=clean(item?.instruction,1000)
    if(!allowed.has(kind)||!title||!instruction)continue
    steps.push({id:`g${steps.length+1}`,title,kind,instruction,status:'pending'})
  }
  return steps.length?{version:1,steps}:null
}

export async function buildGoalPlan(outcome:string):Promise<GoalPlan>{
  const prompt=`You plan bounded background work for AskGogo. Turn this goal into at most ${MAX_GOAL_STEPS} sequential steps. Use ONLY kinds: web_search, private_action, artifact, review.\n\nSafety rules:\n- web_search: public web research only.\n- private_action: ONLY reversible private AskGogo actions such as reminders, lists, tasks, or saving non-sensitive notes. Never send email, modify calendar, submit forms, book, purchase, share externally, delete data, or reveal secrets.\n- artifact: create a private summary/tracker from prior step results.\n- review: use when human judgement/approval is needed.\n- Never put passwords, OTPs, payment data, document numbers or guessed secrets into instructions.\n- Return JSON only: {"steps":[{"kind":"web_search","title":"...","instruction":"..."}]}.\n\nGoal: ${JSON.stringify(clean(outcome,1800))}`
  try{
    const res=await anthropic.messages.create({model:'claude-haiku-4-5',max_tokens:1400,temperature:0,messages:[{role:'user',content:prompt}]})
    const text=res.content[0]?.type==='text'?res.content[0].text:''
    return normalizePlan(parseJson(text))||{version:1,steps:[{id:'g1',title:'Review goal',kind:'review',instruction:'Review this goal and choose the next action.',status:'pending'}]}
  }catch(err:any){console.error('GOAL_PLAN_FAILED:',err?.message||err);return {version:1,steps:[{id:'g1',title:'Review goal',kind:'review',instruction:'Review this goal and choose the next action.',status:'pending'}]}}
}

async function actorForTelegram(telegramId:string):Promise<AgentActor|null>{
  const n=Number(telegramId);if(!Number.isFinite(n))return null
  const {data,error}=await supabaseAdmin.from('users').select('id,telegram_id,whatsapp_id,name').eq('telegram_id',n).maybeSingle()
  if(error||!data)return null
  const whatsappId=String(data.whatsapp_id||'').trim();if(!whatsappId)return null
  return {userId:String(data.id),legacyTelegramId:Number(data.telegram_id),whatsappId,name:String(data.name||'Gogo')}
}

async function permission(tg:string,capability:string):Promise<AgentPermissionLevel>{
  const {data}=await supabaseAdmin.from('agent_permissions').select('level').eq('telegram_id',tg).eq('capability',capability).maybeSingle()
  return (data?.level as AgentPermissionLevel|undefined)||DEFAULT_LEVEL[capability]||'ask'
}

async function idea(tg:string,title:string,reason:string,goalId:string,action='Review goal'){
  await supabaseAdmin.from('agent_ideas').insert({telegram_id:tg,title:clean(title,180),reason:clean(reason,600),expected_value:'Keep the goal moving without allowing Gogo to make a consequential decision for you.',value_score:0.85,action_label:action,source_refs:[{type:'goal',id:goalId}],status:'new'}).then(({error})=>{if(error)console.error('GOAL_IDEA_FAILED:',error.message)})
}

async function notify(actor:AgentActor,message:string){
  if(!actor.whatsappId)return
  await sendWhatsAppMessage(actor.whatsappId,message).catch((e:any)=>console.error('GOAL_WHATSAPP_FAILED:',e?.message||e))
}

function progress(plan:GoalPlan){return Math.round((plan.steps.filter(s=>s.status==='completed').length/Math.max(1,plan.steps.length))*100)}

async function saveGoal(goalId:string,tg:string,plan:GoalPlan,patch:Record<string,unknown>={}){
  const next=plan.steps.find(s=>s.status==='pending')
  const blockers=plan.steps.filter(s=>s.status==='blocked').map(s=>s.title)
  const p=progress(plan)
  const status=p===100?'completed':blockers.length?'blocked':'active'
  const {error}=await supabaseAdmin.from('agent_goals').update({plan_json:plan,progress:p,status,next_action:next?.title||null,blockers,updated_at:new Date().toISOString(),...patch}).eq('id',goalId).eq('telegram_id',tg)
  if(error)throw new Error(`goal_update_failed:${error.message}`)
  return {progress:p,status,next,blockers}
}

async function createGoalArtifact(tg:string,goal:any,plan:GoalPlan){
  const existing=await supabaseAdmin.from('agent_artifacts').select('id').eq('telegram_id',tg).contains('source_refs',[{type:'goal',id:goal.id}]).limit(1).maybeSingle()
  if(existing.data?.id)return String(existing.data.id)
  const {data,error}=await supabaseAdmin.from('agent_artifacts').insert({telegram_id:tg,type:'goal_plan',title:clean(goal.title,180),subtitle:'Background Gogo goal tracker',schema_version:1,content_json:{outcome:goal.outcome,progress:100,steps:plan.steps},source_refs:[{type:'goal',id:goal.id}]}).select('id').single()
  if(error||!data?.id)throw new Error(`goal_artifact_failed:${error?.message||'unknown'}`)
  return String(data.id)
}

export async function initializeBackgroundGoal(params:{telegramId:string;goalId:string;title:string;outcome:string}){
  const plan=await buildGoalPlan(params.outcome)
  await supabaseAdmin.from('agent_goals').update({plan_json:plan,next_action:plan.steps[0]?.title||null,status:'active',updated_at:new Date().toISOString()}).eq('id',params.goalId).eq('telegram_id',params.telegramId)
  const now=new Date().toISOString()
  const {error}=await supabaseAdmin.from('agent_watchers').insert({telegram_id:params.telegramId,goal_id:params.goalId,type:'goal_review',condition_json:{title:params.title,delivery:'both'},cadence_minutes:60,active:true,last_state_json:{},next_check_at:now})
  if(error)throw new Error(`goal_watcher_create_failed:${error.message}`)
  return plan
}

export async function processGoalReviewWatcher(watcher:any,now:Date){
  const tg=String(watcher.telegram_id),goalId=String(watcher.goal_id||'')
  if(!goalId){await supabaseAdmin.from('agent_watchers').update({active:false,last_state_json:{error:'missing_goal'}}).eq('id',watcher.id);return {triggered:false,failed:true}}
  const {data:goal,error}=await supabaseAdmin.from('agent_goals').select('id,title,outcome,status,plan_json,progress').eq('id',goalId).eq('telegram_id',tg).maybeSingle()
  if(error||!goal){await supabaseAdmin.from('agent_watchers').update({active:false,last_state_json:{error:'goal_not_found'}}).eq('id',watcher.id);return {triggered:false,failed:true}}
  if(['completed','cancelled'].includes(String(goal.status))){await supabaseAdmin.from('agent_watchers').update({active:false,next_check_at:null,last_checked_at:now.toISOString()}).eq('id',watcher.id);return {triggered:false,failed:false}}

  let plan=(goal.plan_json&&Array.isArray((goal.plan_json as any).steps)?goal.plan_json:null) as GoalPlan|null
  if(!plan){plan=await buildGoalPlan(String(goal.outcome||goal.title));await saveGoal(goalId,tg,plan)}
  const step=plan.steps.find(s=>s.status==='pending')
  if(!step){await createGoalArtifact(tg,goal,plan);await saveGoal(goalId,tg,plan);await supabaseAdmin.from('agent_watchers').update({active:false,next_check_at:null,last_checked_at:now.toISOString(),last_state_json:{completedAt:now.toISOString()}}).eq('id',watcher.id);return {triggered:true,failed:false}}

  const actor=await actorForTelegram(tg)
  if(!actor){step.status='blocked';step.result={reason:'whatsapp_identity_required'};await saveGoal(goalId,tg,plan);return {triggered:false,failed:true}}

  let triggered=false
  try{
    if(step.kind==='web_search'){
      const results=await searchWebResults(step.instruction)
      step.status='completed';step.result={results:results.slice(0,5).map(r=>({title:r.title,url:r.url,snippet:r.snippet.slice(0,350)}))};triggered=results.length>0
    }else if(step.kind==='artifact'){
      const artifactId=await createGoalArtifact(tg,goal,plan);step.status='completed';step.result={artifactId};triggered=true
    }else if(step.kind==='review'){
      step.status='blocked';step.result={reason:'human_review_required'}
      await idea(tg,step.title,step.instruction,goalId,'Review')
      await notify(actor,`💡 Gogo needs your input on a goal\n\n${goal.title}\n${step.title}\n\nOpen AskGogo to review.`)
      triggered=true
    }else{
      const classified=classifyAgentRequest(step.instruction)
      const level=await permission(tg,classified.capability)
      const policy=evaluateAgentExecutionPolicy({capability:classified.capability,permissionLevel:level,mode:classified.mode,risk:classified.risk,irreversible:classified.irreversible,approvalStatus:null})
      const sentinel=evaluateAgentSentinel({capability:classified.capability,mode:classified.mode,risk:classified.risk,irreversible:classified.irreversible,approved:false,instruction:step.instruction})
      const safePrivate=policy.allowed&&sentinel.allowed&&['memory','reminders','lists','tasks'].includes(classified.capability)&&classified.risk==='low'&&!classified.irreversible
      if(!safePrivate){
        step.status='blocked';step.result={reason:!sentinel.allowed?`sentinel_${sentinel.reason}`:policy.reason,capability:classified.capability}
        await idea(tg,step.title,`Gogo prepared this goal step but needs you before it can continue: ${step.instruction}`,goalId,'Review action')
        await notify(actor,`🛡️ Gogo paused a goal before a consequential step\n\n${goal.title}\n${step.title}\n\nOpen AskGogo to review.`)
        triggered=true
      }else{
        const result=await dispatchThroughSameBrain({actor,text:step.instruction,messageId:`goal:${goalId}:${step.id}`})
        step.status='completed';step.result={reply:clean(result.text,2500),handledBy:result.handledBy};triggered=true
      }
    }
  }catch(err:any){
    step.status='blocked';step.result={reason:clean(err?.message||'goal_step_failed',400)}
    await idea(tg,step.title,'Background Gogo hit a blocker and needs review.',goalId,'Review blocker')
  }

  const state=await saveGoal(goalId,tg,plan)
  if(state.status==='completed'){
    const artifactId=await createGoalArtifact(tg,goal,plan)
    await notify(actor,`✅ Gogo completed a background goal\n\n${goal.title}\n\nI created a private goal artifact in the app.`)
    await supabaseAdmin.from('agent_watchers').update({active:false,next_check_at:null,last_checked_at:now.toISOString(),last_state_json:{completedAt:now.toISOString(),artifactId}}).eq('id',watcher.id)
    return {triggered:true,failed:false}
  }
  const nextAt=new Date(now.getTime()+Math.max(15,Number(watcher.cadence_minutes||60))*60_000).toISOString()
  await supabaseAdmin.from('agent_watchers').update({last_checked_at:now.toISOString(),next_check_at:nextAt,last_state_json:{progress:state.progress,lastStep:step.id},updated_at:now.toISOString()}).eq('id',watcher.id)
  return {triggered,failed:false}
}
