import { supabaseAdmin } from '@/lib/supabase-admin'
import { startProviderBrowserHandoff, cancelProviderBrowserHandoff, cancelBrowserHandoffReservation } from './provider-browser-handoff'
import { releaseBrowserHandoff } from './browser-handoff'
import type { SecureBrowserResult } from './secure-computer'
import type { AgentActor } from './actor'
import { inspectPostAuthRun, markAuthOutcomeUnknown } from './post-auth-outcome'

export type AuthResumeKind='flight_prepare'|'flight_execute'|'restaurant'|'lifecycle_monitor'

export async function attachSecondaryAuthHandoff(params:{userId:string;telegramId:string;runId:string;kind:AuthResumeKind;result:SecureBrowserResult}){
  try{return await attachSecondaryAuthHandoffImpl(params)}catch(error){
    if(params.result.handoffReservation)await cancelBrowserHandoffReservation(params.userId,params.result.handoffReservation).catch(()=>{})
    throw error
  }
}

async function attachSecondaryAuthHandoffImpl(params:{userId:string;telegramId:string;runId:string;kind:AuthResumeKind;result:SecureBrowserResult}){
  if(params.result.blockReason!=='human_auth_required'||!params.result.authReason||params.result.authReason==='password')return null
  const {data:run,error}=await supabaseAdmin.from('agent_runs').select('status,metadata_json').eq('id',params.runId).eq('telegram_id',params.telegramId).maybeSingle()
  if(error||!run)throw new Error('auth_handoff_run_missing')
  if(['flight_prepare','lifecycle_monitor'].includes(params.kind)&&!['running','paused'].includes(run.status))throw new Error('flight_schedule_changed')
  const safeToRetry=!params.result.actions.some(action=>(action.kind==='submit'||action.consequential===true)&&action.status!=='skipped')
  const marker={kind:params.kind,reason:params.result.authReason,safeToRetry}
  const metadata={...run.metadata_json,browser_url:params.result.url,handoff:null,secondary_auth:marker,auth_resume:{kind:params.kind,safeToRetry},auth_action_log:params.result.actions,auth_original_url:params.result.originalUrl}
  let saveRun=supabaseAdmin.from('agent_runs').update({status:'paused',error:'human_auth_required',summary:params.result.summary,metadata_json:metadata,completed_at:null})
    .eq('id',params.runId).eq('telegram_id',params.telegramId)
  if(['flight_prepare','lifecycle_monitor'].includes(params.kind))saveRun=saveRun.in('status',['running','paused'])
  const {data:savedRun,error:saveError}=await saveRun.select('id').maybeSingle()
  if(saveError||!savedRun)throw new Error('auth_handoff_save_failed')
  let pauseAction=supabaseAdmin.from('life_event_actions').update({status:'blocked'})
    .eq('id',metadata.life_event_action_id).eq('telegram_id',params.telegramId).in('status',['running','blocked'])
  if(['flight_prepare','lifecycle_monitor'].includes(params.kind))pauseAction=metadata.scheduleRevision?pauseAction.eq('payload_json->>scheduleRevision',metadata.scheduleRevision):pauseAction.is('payload_json->>scheduleRevision',null)
  const {data:pausedAction,error:actionError}=await pauseAction.select('id').maybeSingle()
  if(actionError||['flight_prepare','lifecycle_monitor'].includes(params.kind)&&!pausedAction)throw new Error('auth_handoff_action_save_failed')
  // Provisioning is retryable; the run/action are already safely paused.
  let createdHandoff:Awaited<ReturnType<typeof startProviderBrowserHandoff>>|undefined
  try{
    createdHandoff=await startProviderBrowserHandoff({userId:params.userId,url:params.result.url,originalUrl:params.result.originalUrl,reservationToken:params.result.handoffReservation})
    const {data:saved,error}=await supabaseAdmin.from('agent_runs').update({metadata_json:{...metadata,handoff:createdHandoff}}).eq('id',params.runId).eq('telegram_id',params.telegramId).eq('status','paused').select('id').maybeSingle()
    if(error||!saved)throw new Error('auth_handoff_save_failed')
  }catch{
    if(createdHandoff)await cancelProviderBrowserHandoff(params.userId,createdHandoff).catch(()=>{})
    if(!safeToRetry)return await markAuthOutcomeUnknown(params.telegramId,params.runId,metadata)
    // The task page retains a retry control even when another takeover is active.
  }
  const base=String(process.env.NEXT_PUBLIC_APP_URL||process.env.APP_URL||'https://app.askgogo.in').replace(/\/$/,'')
  return `${base}/dashboard/activity/${encodeURIComponent(params.runId)}/browser`
}

export async function releaseRunAuthHandoff(telegramId:string,runId:string){
  const {data:run,error}=await supabaseAdmin.from('agent_runs').select('metadata_json').eq('id',runId).eq('telegram_id',telegramId).maybeSingle()
  if(error||!run)throw new Error('auth_handoff_run_missing')
  const meta:any=run.metadata_json||{}
  if(meta.handoff?.releaseUrl)await releaseBrowserHandoff(String(meta.handoff.releaseUrl),{allowExpired:true})
  const {handoff,secondary_auth,browser_waiting,...remaining}=meta
  const {error:saveError}=await supabaseAdmin.from('agent_runs').update({metadata_json:remaining}).eq('id',runId).eq('telegram_id',telegramId)
  if(saveError)throw new Error('auth_handoff_release_save_failed')
}

export async function resumeSecondaryAuthRun(params:{actor:AgentActor;runId:string}){
  const tg=String(params.actor.legacyTelegramId)
  const {data:run,error}=await supabaseAdmin.from('agent_runs').select('status,metadata_json').eq('id',params.runId).eq('telegram_id',tg).maybeSingle()
  if(error||!run)throw new Error('auth_handoff_run_missing')
  const meta:any=run.metadata_json||{},auth=meta.auth_resume||meta.secondary_auth
  if(!auth)return null
  if(run.status!=='paused')throw new Error('auth_resume_requires_provider_reconciliation')
  if(!['flight_prepare','flight_execute','restaurant','lifecycle_monitor'].includes(auth.kind))throw new Error('auth_resume_kind_invalid')
  let reconciledResult:SecureBrowserResult|undefined
  if(!auth.safeToRetry){
    if(!['flight_execute','restaurant'].includes(auth.kind))throw new Error('auth_resume_requires_provider_reconciliation')
    const inspected=await inspectPostAuthRun(tg,params.runId,meta)
    if(!inspected)return {runId:params.runId,status:'outcome_unknown',text:'The browser session is unavailable. Verify the outcome directly with the provider; Gogo will not repeat the action.'}
    reconciledResult=inspected
    if(reconciledResult.status==='blocked')return {runId:params.runId,status:'paused',text:reconciledResult.summary}
  }
  const [{data:event,error:eventError},{data:action,error:actionError}]=await Promise.all([
    supabaseAdmin.from('life_events').select('*').eq('id',meta.life_event_id).eq('telegram_id',tg).maybeSingle(),
    supabaseAdmin.from('life_event_actions').select('*').eq('id',meta.life_event_action_id).eq('telegram_id',tg).eq('status','blocked').maybeSingle(),
  ])
  if(eventError||actionError||!event||!action||String(action.life_event_id)!==String(event.id))throw new Error('auth_resume_context_missing')
  const preparation=auth.kind==='flight_prepare'||auth.kind==='lifecycle_monitor'
  const actionStatus=preparation?'running':auth.kind==='flight_execute'?'waiting_approval':'ready'
  const {data:claimed,error:claimError}=await supabaseAdmin.from('life_event_actions').update({status:actionStatus,updated_at:new Date().toISOString()})
    .eq('id',action.id).eq('telegram_id',tg).eq('status','blocked').select('id').maybeSingle()
  if(claimError||!claimed)throw new Error('auth_resume_already_claimed')
  try{
    const {error:runError}=await supabaseAdmin.from('agent_runs').update({status:preparation?'running':'queued',updated_at:new Date().toISOString()})
      .eq('id',params.runId).eq('telegram_id',tg).eq('status','paused')
    if(runError)throw new Error('auth_resume_run_update_failed')
    let result:any
    if(auth.kind==='flight_prepare'){
      const {prepareFlightCheckin}=await import('./life-event-worker')
      result=await prepareFlightCheckin({telegramId:tg,event,action,resumeRunId:params.runId})
    }else if(auth.kind==='lifecycle_monitor'){
      const {processLifecycleMonitor}=await import('./life-event-integration-worker')
      result=await processLifecycleMonitor(action,event,tg,params.runId)
    }else if(auth.kind==='flight_execute'){
      const {executeApprovedLifeEventCheckin}=await import('./life-event-execution')
      result=await executeApprovedLifeEventCheckin({...params,reconciledResult})
    }else{
      const {processOne}=await import('./restaurant-reservation-worker')
      result=await processOne({...action,status:'ready'},reconciledResult)
    }
    return {...result,runId:params.runId,text:result.text||'Gogo continued this same task using its saved constraints.'}
  }catch(error){
    if(preparation&&/(?:flight|life_event)_schedule_changed/.test(String((error as any)?.message||error)))throw error
    // Keep a denied/failed continuation available without discarding its context.
    let restoreRun=supabaseAdmin.from('agent_runs').update({status:'paused',updated_at:new Date().toISOString(),
      ...(preparation?{metadata_json:{...meta,handoff:null,secondary_auth:meta.secondary_auth||{...auth,reason:'device_approval'}}}:{}),
    }).eq('id',params.runId).eq('telegram_id',tg).in('status',preparation?['running','failed']:['queued'])
    if(preparation)restoreRun=restoreRun.or('error.is.null,error.neq.flight_schedule_changed')
    await restoreRun
    let restoreAction=supabaseAdmin.from('life_event_actions').update({status:'blocked',...(preparation?{payload_json:action.payload_json||{}}:{})}).eq('id',action.id).eq('telegram_id',tg).in('status',preparation?['running','blocked']:[actionStatus])
    if(preparation)restoreAction=action.payload_json?.scheduleRevision?restoreAction.eq('payload_json->>scheduleRevision',action.payload_json.scheduleRevision):restoreAction.is('payload_json->>scheduleRevision',null)
    await restoreAction
    throw error
  }
}
