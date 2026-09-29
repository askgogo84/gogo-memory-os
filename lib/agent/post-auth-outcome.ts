import { readBrowserHandoffState } from './browser-handoff'
import { detectHumanAuthGate } from './browser-auth-gate'
import { redactBrowserSensitiveText } from './secure-browser-redaction'
import type { SecureBrowserResult } from './secure-computer'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function markAuthOutcomeUnknown(telegramId:string,runId:string,metadata:any){
  const {handoff,secondary_auth,auth_resume,browser_waiting,...remaining}=metadata
  const summary='The provider outcome could not be verified after a possible submission. Verify the outcome directly with the provider before taking any further action. Gogo will not repeat the action.'
  const {error}=await supabaseAdmin.from('agent_runs').update({status:'outcome_unknown',error:'auth_reconciliation_unavailable',summary,
    metadata_json:{...remaining,browser_safe_to_retry:false,auth_reconciliation_required:true},updated_at:new Date().toISOString()}).eq('id',runId).eq('telegram_id',telegramId)
  if(error)throw new Error('auth_reconciliation_state_save_failed')
  if(metadata.life_event_action_id){
    const {error}=await supabaseAdmin.from('life_event_actions').update({status:'blocked',updated_at:new Date().toISOString()}).eq('id',metadata.life_event_action_id).eq('telegram_id',telegramId)
    if(error)throw new Error('auth_reconciliation_action_save_failed')
  }
  if(metadata.life_event_id){
    const {error}=await supabaseAdmin.from('life_events').update({lifecycle_state:'needs_attention',updated_at:new Date().toISOString()}).eq('id',metadata.life_event_id).eq('telegram_id',telegramId).eq('lifecycle_state','in_progress')
    if(error)throw new Error('auth_reconciliation_event_save_failed')
  }
  return {runId,status:'outcome_unknown' as const,text:summary}
}

export async function inspectPostAuthRun(telegramId:string,runId:string,metadata:any){
  try{return await inspectPostAuthOutcome(metadata)}catch(error:any){
    if(error?.message!=='auth_reconciliation_session_unavailable')throw error
    await markAuthOutcomeUnknown(telegramId,runId,metadata)
    return null
  }
}

/** Read the retained page only: never navigate, plan, click, or repeat a submit. */
export async function inspectPostAuthOutcome(metadata:any):Promise<SecureBrowserResult>{
  if(!metadata.handoff?.stateUrl)throw new Error('auth_reconciliation_session_unavailable')
  let page:Awaited<ReturnType<typeof readBrowserHandoffState>>
  try{page=await readBrowserHandoffState(metadata.handoff.stateUrl)}catch(error:any){
    if(/browser_handoff_state_failed:(?:404|410|502|503|504)\b/.test(error?.message||'')||['TypeError','TimeoutError','AbortError'].includes(error?.name))throw new Error('auth_reconciliation_session_unavailable')
    throw error
  }
  const gate=detectHumanAuthGate(page)
  const actions=Array.isArray(metadata.auth_action_log)?metadata.auth_action_log:[]
  const base={url:page.url,originalUrl:metadata.auth_original_url||metadata.url,title:redactBrowserSensitiveText(page.title),forms:[],actions,sandboxName:String(metadata.handoff.sandboxName||'')}
  if(gate.required)return {...base,status:'blocked',blockReason:'human_auth_required',authReason:gate.reason,summary:gate.message||'Complete the human authentication step first.',pageText:''}
  const original=new URL(String(base.originalUrl||'')),current=new URL(page.url)
  if(current.hostname!==original.hostname&&!current.hostname.endsWith(`.${original.hostname}`))throw new Error('auth_reconciliation_provider_host_mismatch')
  const text=`${page.title} ${page.text}`
  const failed=/\b(declined|failed|unsuccessful|cancelled|canceled|rejected|unable to (?:complete|process)|not (?:confirmed|completed|successful))\b/i.test(text)
  const pending=/\b(pending|processing|please wait|awaiting|in progress)\b/i.test(text)
  const confirmed=/\b(?:reservation|booking|order|purchase|payment|submission|application|check[- ]?in)\s+(?:is\s+|was\s+)?(?:confirmed|successful|complete|completed)\b|\b(?:you are|you['’]re) checked in\b/i.test(text)
  const specialized=['flight_execute','restaurant'].includes(metadata.auth_resume?.kind)
  if(!specialized&&(failed||pending||!confirmed))return {...base,status:'blocked',blockReason:'provider_access_limited',
    summary:failed?'The provider reports an unsuccessful outcome. Gogo has not repeated the action. Inspect the provider result before deciding what to do next.':'The provider has not shown a confirmed outcome yet. Check again after the page finishes updating; Gogo will not repeat the action.',
    pageText:redactBrowserSensitiveText(page.text).slice(0,9000)}
  return {...base,status:'completed',summary:'Gogo inspected the provider result after authentication without repeating the action.',pageText:redactBrowserSensitiveText(page.text).slice(0,9000)}
}
