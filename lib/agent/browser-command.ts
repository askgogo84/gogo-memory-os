import { supabaseAdmin } from '@/lib/supabase-admin'
import { redactSecretShapedText } from '@/lib/bot/memory-redaction'
import { evaluateAgentExecutionPolicy, type AgentPermissionLevel } from './policy'
import { runSecureBrowser, type BrowserMode } from './secure-computer'
import type { AgentActor } from './actor'
import type { AgentSurface } from './orchestrator'

export type BrowserCommand = {
  url:string
  objective:string
  mode:BrowserMode
  risk:'low'|'medium'|'high'
  approvalAction?:'submit_form'|'booking'|'purchase'
}

function safe(value:unknown,max=1800){return redactSecretShapedText(String(value??'').trim().slice(0,max))}

function extractUrl(text:string){
  const m=String(text||'').match(/https?:\/\/[^\s<>)\]}]+/i)
  if(!m)return null
  try{const u=new URL(m[0]);if(!['http:','https:'].includes(u.protocol))return null;return u.toString()}catch{return null}
}

export function parseBrowserCommand(text:string):BrowserCommand|null{
  const raw=String(text||'').trim();const url=extractUrl(raw);if(!url)return null
  const t=raw.toLowerCase()
  const signal=/\b(open|browse|browser|website|site|page|form|fill|apply|submit|book|checkout|buy|purchase|reserve|navigate|go to|visit)\b/.test(t)
  if(!signal)return null
  const purchase=/\b(buy|purchase|checkout|pay|payment)\b/.test(t)
  const booking=/\b(book|booking|reserve|reservation)\b/.test(t)
  const submit=/\b(submit|send application|apply for|complete and send|confirm form)\b/.test(t)
  const fill=/\b(fill|complete form|prepare form|type into|enter my|draft application)\b/.test(t)
  const mode:BrowserMode=(purchase||booking||submit)?'execute':fill?'draft':'read'
  return {
    url,
    objective:safe(raw,1800),
    mode,
    risk:mode==='execute'?'high':mode==='draft'?'medium':'low',
    approvalAction:purchase?'purchase':booking?'booking':submit?'submit_form':undefined,
  }
}

async function permission(tg:number):Promise<AgentPermissionLevel>{
  const {data,error}=await supabaseAdmin.from('agent_permissions').select('level').eq('telegram_id',String(tg)).eq('capability','browser').maybeSingle()
  if(error)throw new Error(`browser_permission_failed:${error.message}`)
  // Browser defaults to ASK: read/draft work immediately, but every submit-like
  // operation still stops for a one-shot approval.
  return (data?.level as AgentPermissionLevel|undefined)||'ask'
}

async function activity(tg:number,runId:string,event:string,message:string,metadata:Record<string,unknown>={}){
  const {error}=await supabaseAdmin.from('agent_activity').insert({telegram_id:String(tg),run_id:runId,event_type:event,message:safe(message,900),metadata_json:metadata})
  if(error)console.error('BROWSER_AGENT_ACTIVITY_FAILED:',error.message)
}

async function makeRun(params:{actor:AgentActor;surface:AgentSurface;command:BrowserCommand}){
  const now=new Date().toISOString();const host=new URL(params.command.url).hostname
  const {data,error}=await supabaseAdmin.from('agent_runs').insert({
    telegram_id:String(params.actor.legacyTelegramId),type:'secure_browser',capability:'browser',status:'queued',
    title:`Browser · ${host}`,summary:'Gogo is preparing an isolated browser session.',progress:0,
    why:'This work is isolated from the AskGogo server in a per-user secure computer.',source:params.surface,
    metadata_json:{plan_type:'secure_browser',url:params.command.url,objective:params.command.objective,mode:params.command.mode,risk:params.command.risk,approval_action:params.command.approvalAction||null},
    started_at:now,updated_at:now,
  }).select('id').single()
  if(error||!data?.id)throw new Error(`browser_run_create_failed:${error?.message||'unknown'}`)
  const runId=String(data.id)
  const {data:step,error:stepError}=await supabaseAdmin.from('agent_steps').insert({
    telegram_id:String(params.actor.legacyTelegramId),run_id:runId,ordinal:1,tool_name:'secure_browser',
    title:params.command.mode==='read'?'Read website in secure browser':params.command.mode==='draft'?'Prepare browser flow without submitting':'Complete approved browser action',
    status:'queued',input_json:{url:params.command.url,mode:params.command.mode},output_json:{},
  }).select('id').single()
  if(stepError||!step?.id)throw new Error(`browser_step_create_failed:${stepError?.message||'unknown'}`)
  await activity(params.actor.legacyTelegramId,runId,'run_created',`Secure browser request created for ${host}.`,{mode:params.command.mode,host})
  return {runId,stepId:String(step.id)}
}

async function approval(params:{actor:AgentActor;runId:string;stepId:string;command:BrowserCommand}){
  if(!params.command.approvalAction)return null
  const host=new URL(params.command.url).hostname
  const {data,error}=await supabaseAdmin.from('agent_approvals').insert({
    telegram_id:String(params.actor.legacyTelegramId),run_id:params.runId,action_type:params.command.approvalAction,
    title:`Approve browser action on ${host}`,
    description:'Gogo can prepare and inspect the website safely, but this action may submit information, make a booking, or spend money.',
    payload_preview:[{label:'Website',value:host},{label:'Action',value:safe(params.command.objective,500)},{label:'Risk',value:'high'}],
    execution_payload:{plan_type:'secure_browser',stepId:params.stepId,url:params.command.url},risk_level:'high',status:'pending',
  }).select('id').single()
  if(error||!data?.id)throw new Error(`browser_approval_failed:${error?.message||'unknown'}`)
  await supabaseAdmin.from('agent_steps').update({status:'waiting_approval'}).eq('id',params.stepId)
  await supabaseAdmin.from('agent_runs').update({status:'waiting_approval',summary:'Waiting for approval before Gogo submits anything.',progress:25,updated_at:new Date().toISOString()}).eq('id',params.runId).eq('telegram_id',String(params.actor.legacyTelegramId))
  await activity(params.actor.legacyTelegramId,params.runId,'approval_requested',`Approval required for browser action on ${host}.`,{approval_id:data.id})
  return String(data.id)
}

async function executeBrowser(params:{actor:AgentActor;runId:string;stepId:string;command:BrowserCommand;mode:BrowserMode}){
  const tg=params.actor.legacyTelegramId
  await supabaseAdmin.from('agent_runs').update({status:'running',summary:'Gogo is working in an isolated secure browser.',progress:45,updated_at:new Date().toISOString()}).eq('id',params.runId).eq('telegram_id',String(tg))
  await supabaseAdmin.from('agent_steps').update({status:'running',started_at:new Date().toISOString()}).eq('id',params.stepId)
  await activity(tg,params.runId,'run_started','Gogo started the isolated browser session.',{mode:params.mode})
  try{
    const result=await runSecureBrowser({userId:params.actor.userId,url:params.command.url,objective:params.command.objective,mode:params.mode})
    const completedAt=new Date().toISOString()
    // Never persist full page text or form values in Activity. Keep a compact,
    // redacted result in the step; browser profile/cookies remain inside the
    // user-specific secure computer rather than in agent logs.
    const compact={url:result.url,title:result.title,summary:result.summary,formCount:result.forms.length,actions:result.actions}
    await supabaseAdmin.from('agent_steps').update({status:'completed',output_json:compact,completed_at:completedAt}).eq('id',params.stepId)
    await supabaseAdmin.from('agent_runs').update({status:'completed',summary:safe(`${result.summary} ${result.title}`,1600),progress:100,completed_at:completedAt,updated_at:completedAt}).eq('id',params.runId).eq('telegram_id',String(tg))
    await activity(tg,params.runId,'run_completed',result.summary,{host:new URL(result.url).hostname,action_count:result.actions.length})
    return {runId:params.runId,status:'completed' as const,capability:'browser' as const,risk:params.command.risk,text:`${result.summary}\n\n${result.title}\n${safe(result.pageText,1800)}`,handledBy:'secure-browser' as const}
  }catch(err:any){
    const message=String(err?.message||'secure_browser_failed');const at=new Date().toISOString()
    await supabaseAdmin.from('agent_steps').update({status:'failed',error:safe(message,500),completed_at:at}).eq('id',params.stepId).catch(()=>{})
    await supabaseAdmin.from('agent_runs').update({status:'failed',summary:'Gogo could not complete the secure browser session.',error:safe(message,500),completed_at:at,updated_at:at}).eq('id',params.runId).eq('telegram_id',String(tg)).catch(()=>{})
    await activity(tg,params.runId,'run_failed','Secure browser session failed.',{error:safe(message,250)})
    throw err
  }
}

export async function tryRunBrowserCommand(params:{actor:AgentActor;surface:AgentSurface;text:string}){
  const command=parseBrowserCommand(params.text);if(!command)return null
  const tg=params.actor.legacyTelegramId;const {runId,stepId}=await makeRun({actor:params.actor,surface:params.surface,command})
  const level=await permission(tg)
  const policy=evaluateAgentExecutionPolicy({capability:'browser',permissionLevel:level,mode:command.mode,risk:command.risk,irreversible:command.mode==='execute',approvalStatus:null})
  if(!policy.allowed){
    if(command.mode==='execute' && command.approvalAction && (policy.reason==='approval_required'||policy.reason==='auto_not_allowed_for_consequential_action')){
      const approvalId=await approval({actor:params.actor,runId,stepId,command})
      return {runId,status:'waiting_approval' as const,capability:'browser' as const,risk:'high' as const,text:'I can do this in the secure browser, but I need your approval before the final submit/booking/purchase.',approvalId,approvalRequired:true,handledBy:'secure-browser' as const}
    }
    await supabaseAdmin.from('agent_runs').update({status:'paused',summary:`Browser blocked by Gogo Safe Mode: ${policy.reason}`,updated_at:new Date().toISOString()}).eq('id',runId).eq('telegram_id',String(tg))
    return {runId,status:'paused' as const,capability:'browser' as const,risk:command.risk,text:`Gogo Safe Mode blocked the browser action: ${policy.reason}`,handledBy:'secure-browser' as const}
  }
  return executeBrowser({actor:params.actor,runId,stepId,command,mode:command.mode})
}

export async function executeApprovedBrowserCommand(params:{actor:AgentActor;runId:string}){
  const tg=params.actor.legacyTelegramId
  const {data:run,error}=await supabaseAdmin.from('agent_runs').select('metadata_json').eq('id',params.runId).eq('telegram_id',String(tg)).maybeSingle()
  if(error)throw new Error(`agent_run_read_failed:${error.message}`);if(!run)throw new Error('agent_run_not_found')
  const meta:any=run.metadata_json||{};if(meta.plan_type!=='secure_browser')throw new Error('not_secure_browser_run')
  const command:BrowserCommand={url:String(meta.url||''),objective:safe(meta.objective,1800),mode:'execute',risk:'high',approvalAction:meta.approval_action||'submit_form'}
  const {data:approved}=await supabaseAdmin.from('agent_approvals').select('id,status').eq('run_id',params.runId).eq('telegram_id',String(tg)).eq('status','approved').order('resolved_at',{ascending:false}).limit(1).maybeSingle()
  if(!approved)throw new Error('approval_required')
  const level=await permission(tg)
  const policy=evaluateAgentExecutionPolicy({capability:'browser',permissionLevel:level,mode:'execute',risk:'high',irreversible:true,approvalStatus:'approved'})
  if(!policy.allowed)throw new Error(policy.reason)
  const {data:step}=await supabaseAdmin.from('agent_steps').select('id').eq('run_id',params.runId).eq('telegram_id',String(tg)).eq('tool_name','secure_browser').limit(1).maybeSingle()
  if(!step?.id)throw new Error('browser_step_missing')
  const result=await executeBrowser({actor:params.actor,runId:params.runId,stepId:String(step.id),command,mode:'execute'})
  await supabaseAdmin.from('agent_approvals').update({status:'executed',executed_at:new Date().toISOString()}).eq('id',approved.id).eq('telegram_id',String(tg))
  return result
}
