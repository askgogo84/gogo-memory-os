import { supabaseAdmin } from '@/lib/supabase-admin'
import { capabilityPermissionLevel } from './adaptive-autonomy'
import { buildApprovalBinding, assertApprovalBinding } from './approval-binding'
import { evaluateAgentExecutionPolicy } from './policy'
import { evaluateAgentSentinel } from './sentinel'
import { recordDecisionLearning } from './decision-learning'
import { rememberTypedObjects } from './typed-object-context'
import type { AgentActor } from './actor'

type ReminderUpdate={reminderId:string;title:string;oldTime:string;newTime:string;timezone:string}
const binding=(runId:string,draft:ReminderUpdate)=>({missionId:runId,stepId:'update',capability:'reminders',actionType:'reminder_change',target:`reminder:${draft.reminderId}`,payload:draft})
const reply=(text:string,status:string,runId='')=>({text,status,runId,capability:'reminders' as const,risk:'low' as const,handledBy:'reminder-update'})
export async function pendingReminderUpdate(actor:AgentActor,reminderId:string){
  const {data,error}=await supabaseAdmin.from('agent_runs').select('id,status').eq('telegram_id',String(actor.legacyTelegramId)).eq('type','reminder_update').in('status',['waiting_approval','queued','running','outcome_unknown']).eq('metadata_json->draft->>reminderId',reminderId).order('started_at',{ascending:false}).limit(1).maybeSingle()
  if(error)throw new Error('reminder_update_history_unavailable')
  return data?reply('This reminder has a pending or unresolved update. Review that action first; an unknown outcome will not be retried.',data.status,data.id):null
}
export async function stageReminderUpdate(actor:AgentActor,draft:ReminderUpdate,text:string,surface:string){
  const level=await capabilityPermissionLevel(actor.legacyTelegramId,'reminders')
  if(level!=='ask'&&level!=='auto')throw new Error('permission_insufficient')
  const sentinel=evaluateAgentSentinel({capability:'reminders',mode:'execute',risk:'low',irreversible:false,approved:false,instruction:text,actionCount:1})
  if(!sentinel.allowed)throw new Error(`sentinel_${sentinel.reason}`)
  const prior=await pendingReminderUpdate(actor,draft.reminderId);if(prior)return prior
  const tg=String(actor.legacyTelegramId),now=new Date().toISOString()
  const {data:run,error}=await supabaseAdmin.from('agent_runs').insert({telegram_id:tg,type:'reminder_update',capability:'reminders',status:'waiting_approval',title:`Move reminder: ${draft.title}`.slice(0,160),summary:'Waiting for approval before moving the reminder.',progress:25,source:surface,started_at:now,updated_at:now,metadata_json:{plan_type:'reminder_update',draft,learning_text:text}}).select('id').single()
  if(error||!run?.id)throw new Error('reminder_update_stage_failed')
  const when=new Intl.DateTimeFormat('en-IN',{timeZone:draft.timezone,dateStyle:'medium',timeStyle:'short'}).format(new Date(draft.newTime))
  const {data:approval,error:ae}=await supabaseAdmin.from('agent_approvals').insert({telegram_id:tg,run_id:run.id,action_type:'reminder_change',title:`Move reminder: ${draft.title}`.slice(0,160),description:'Move the exact reminder after approval.',payload_preview:[{label:'Reminder',value:draft.title},{label:'New time',value:when},{label:'Timezone',value:draft.timezone}],execution_payload:{plan_type:'reminder_update'},risk_level:'low',status:'pending',...buildApprovalBinding(binding(run.id,draft))}).select('id').single()
  if(ae||!approval?.id){await supabaseAdmin.from('agent_runs').update({status:'paused'}).eq('id',run.id).eq('telegram_id',tg);throw new Error('reminder_approval_stage_failed')}
  await recordDecisionLearning({actor,text,domain:'reminders',handler:'reminder-update',decisionId:run.id,outcome:'blocked',objectKind:'reminder',objectRef:draft.reminderId}).catch(()=>{})
  return {...reply(`Ready to move reminder “${draft.title}” to ${when} (${draft.timezone}). Nothing has changed. Reply APPROVE or REJECT.`,'waiting_approval',run.id),approvalId:approval.id,approvalRequired:true}
}
export async function executeApprovedReminderUpdate({actor,runId}:{actor:AgentActor;runId:string}){
  const tg=String(actor.legacyTelegramId)
  const [{data:run,error},{data:approval,error:ae}]=await Promise.all([
    supabaseAdmin.from('agent_runs').select('id,status,metadata_json').eq('telegram_id',tg).eq('id',runId).maybeSingle(),
    supabaseAdmin.from('agent_approvals').select('id,status,action_hash,policy_version').eq('telegram_id',tg).eq('run_id',runId).order('requested_at',{ascending:false}).limit(1).maybeSingle(),
  ])
  if(error||ae||!run||approval?.status!=='approved')throw new Error('approval_required')
  if(!['waiting_approval','queued'].includes(run.status))throw new Error('agent_run_already_claimed')
  const draft:ReminderUpdate=run.metadata_json?.draft
  if(run.metadata_json?.plan_type!=='reminder_update'||!draft?.reminderId)throw new Error('reminder_update_payload_invalid')
  assertApprovalBinding(binding(runId,draft),approval)
  const level=await capabilityPermissionLevel(actor.legacyTelegramId,'reminders')
  const policy=evaluateAgentExecutionPolicy({capability:'reminders',permissionLevel:level,mode:'execute',risk:'low',irreversible:false,approvalStatus:'approved'})
  const sentinel=evaluateAgentSentinel({capability:'reminders',mode:'execute',risk:'low',irreversible:false,approved:true,instruction:run.metadata_json.learning_text,actionCount:1})
  if(!policy.allowed||!sentinel.allowed)throw new Error('reminder_update_policy_blocked')
  const {data:claim,error:ce}=await supabaseAdmin.from('agent_runs').update({status:'running',updated_at:new Date().toISOString()}).eq('id',runId).eq('telegram_id',tg).in('status',['waiting_approval','queued']).select('id').maybeSingle()
  if(ce||!claim)throw new Error('agent_run_already_claimed')
  let verified=false,unchanged=false
  try{
    const {data,error:ue}=await supabaseAdmin.from('reminders').update({remind_at:draft.newTime}).eq('telegram_id',actor.legacyTelegramId).eq('id',draft.reminderId).eq('remind_at',draft.oldTime).eq('sent',false).select('id,remind_at').maybeSingle()
    verified=!ue&&data?.id===draft.reminderId&&Date.parse(data.remind_at)===Date.parse(draft.newTime)
    unchanged=!ue&&!data
  }catch{}
  const status=verified?'completed':unchanged?'failed':'outcome_unknown',now=new Date().toISOString()
  await supabaseAdmin.from('agent_runs').update({status,updated_at:now,completed_at:verified||unchanged?now:null}).eq('id',runId).eq('telegram_id',tg)
  await supabaseAdmin.from('agent_approvals').update({status:unchanged?'failed':'executed',executed_at:now}).eq('id',approval.id).eq('telegram_id',tg)
  await recordDecisionLearning({actor,text:run.metadata_json.learning_text,domain:'reminders',handler:'reminder-update',decisionId:runId,outcome:verified?'verified_success':unchanged?'failed':'unknown',verified,objectKind:'reminder',objectRef:draft.reminderId}).catch(()=>{})
  if(unchanged)return reply('The reminder changed after the preview. Nothing was updated. Ask again to review and approve its current time.','failed',runId)
  if(!verified)return reply('I could not verify the reminder update. Its outcome is unknown and it will not be retried automatically.','outcome_unknown',runId)
  await rememberTypedObjects(actor.legacyTelegramId,'reminders',[{id:draft.reminderId,title:draft.title}]).catch(()=>{})
  return reply(`Reminder updated: ${draft.title}. New time: ${new Intl.DateTimeFormat('en-IN',{timeZone:draft.timezone,dateStyle:'medium',timeStyle:'short'}).format(new Date(draft.newTime))}.`,'completed',runId)
}
