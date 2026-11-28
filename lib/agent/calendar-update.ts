import { supabaseAdmin } from '@/lib/supabase-admin'
import { refreshAccessToken, updateCalendarEvent, fetchPrimaryCalendarAccount, fetchPrimaryCalendarEventResponse } from '@/lib/google-calendar'
import { buildApprovalBinding, assertApprovalBinding } from './approval-binding'
import { capabilityPermissionLevel } from './adaptive-autonomy'
import { recordDecisionLearning } from './decision-learning'
import { rememberTypedObjects } from './typed-object-context'
import { evaluateAgentExecutionPolicy } from './policy'
import { evaluateAgentSentinel } from './sentinel'
import type { AgentActor } from './actor'
import {createHash} from 'node:crypto'
import {decryptGoogleToken} from '@/lib/security/google-token-crypto'
import {exactSessionOwnerId} from '@/lib/dashboard/owner-identity'
import {bindGovernedForegroundOwner, currentGovernedForeground, currentGovernedRun, withGovernedForeground} from './governed-run-context'

export type CalendarUpdate={eventId:string;title:string;oldStart:string;oldEnd:string;startIso:string;endIso:string;etag:string;timezone:string;calendarAccount?:string;governanceVersion?:'calendar-move-v1'}
const reply=(text:string,status:string,runId='')=>({text,status,runId,handledBy:'calendar-update',capability:'calendar' as const,risk:'medium' as const})
const binding=(runId:string,draft:CalendarUpdate)=>({missionId:runId,stepId:'update',capability:'calendar',actionType:'calendar_change',target:`google_calendar:primary:${draft.eventId}`,payload:draft})
function governedCalendarSelected(actor:AgentActor){const env=(globalThis as any).process?.env||{};return env.GOGO_HACHI_ENFORCEMENT==='1'&&String(env.GOGO_HACHI_PERSONAL_OWNERS||'').split(',').map((v:string)=>v.trim()).includes(String(actor.legacyTelegramId))}
export async function calendarAccessForUpdate(actor:AgentActor,readOnly=false){
  const level=await capabilityPermissionLevel(actor.legacyTelegramId,'calendar')
  if(level==='off'||(!readOnly&&(level==='read'||level==='draft')))throw new Error('permission_insufficient')
  const governed=governedCalendarSelected(actor)
  const owner=actor.legacyTelegramId
  const ownerId=governed?exactSessionOwnerId(owner):null
  if(governed&&(!actor.userId||!ownerId))throw new Error('calendar_owner_unverified')
  if(governed&&ownerId&&currentGovernedForeground())bindGovernedForegroundOwner(ownerId,true)
  const query=supabaseAdmin.from('users')
  const {data,error}=await (governed&&ownerId
    ? query.select('id,telegram_id::text,access_status,google_calendar_connected,google_refresh_token,timezone')
      .eq('telegram_id',ownerId).eq('id',actor.userId).maybeSingle()
    : query.select('google_calendar_connected,google_refresh_token,timezone').eq('telegram_id',owner).maybeSingle())
  if(error)throw new Error('calendar_account_read_failed')
  if(governed&&(!data||!('id' in data)||data.id!==actor.userId||
    !('telegram_id' in data)||typeof data.telegram_id!=='string'||exactSessionOwnerId(data.telegram_id)!==ownerId||
    !('access_status' in data)||data.access_status!=='active')){
    throw new Error('calendar_owner_unverified')
  }
  if(!data?.google_calendar_connected||!data.google_refresh_token)throw new Error('calendar_not_connected')
  const credential=governed?decryptGoogleToken(data.google_refresh_token):null
  if(governed&&!credential)throw Error('calendar_token_unavailable')
  const credentialKey=credential?createHash('sha256').update(credential).digest('hex'):null
  const token=await refreshAccessToken(data.google_refresh_token)
  if(!token)throw new Error('calendar_token_unavailable')
  return {token,timezone:String(data.timezone||'Asia/Kolkata'),level,credentialKey}
}
export async function readExactCalendarEvent(token:string,eventId:string){
  const r=await fetchPrimaryCalendarEventResponse(token,eventId)
  if(!r.ok)throw new Error('calendar_event_unavailable')
  const event=await r.json()
  if(event.id!==eventId||event.status==='cancelled')throw new Error('calendar_event_identity_mismatch')
  return event
}
export async function stageCalendarUpdate(actor:AgentActor,draft:CalendarUpdate,text:string,surface:string){
  const sentinel=evaluateAgentSentinel({capability:'calendar',mode:'execute',risk:'medium',irreversible:true,approved:false,instruction:text,actionCount:1})
  if(!sentinel.allowed&&sentinel.reason!=='approval_missing')throw new Error(`sentinel_${sentinel.reason}`)
  const access=await calendarAccessForUpdate(actor)
  if(governedCalendarSelected(actor)){
    const account=await fetchPrimaryCalendarAccount(access.token)
    const current=await readExactCalendarEvent(access.token,draft.eventId)
    if(!account||!access.credentialKey||current.etag!==draft.etag||current.summary!==draft.title||current.start?.dateTime!==draft.oldStart||current.end?.dateTime!==draft.oldEnd)throw Error('calendar_approval_source_unverified')
    draft={...draft,calendarAccount:account.trim().toLowerCase(),governanceVersion:'calendar-move-v1'}
  }
  const {data:prior,error:priorError}=await supabaseAdmin.from('agent_runs').select('id,status,metadata_json').eq('telegram_id',String(actor.legacyTelegramId)).eq('type','calendar_update').in('status',['running','outcome_unknown','waiting_approval','queued']).eq('metadata_json->draft->>eventId',draft.eventId).order('started_at',{ascending:false}).limit(1).maybeSingle()
  if(priorError)throw new Error('calendar_update_history_unavailable')
  if(prior)return reply('This event already has a pending or unresolved Calendar update. Review that action before requesting another; I will not retry an unknown outcome.',prior.status,prior.id)
  const now=new Date().toISOString()
  const {data:run,error}=await supabaseAdmin.from('agent_runs').insert({telegram_id:String(actor.legacyTelegramId),type:'calendar_update',capability:'calendar',status:'waiting_approval',title:`Move ${draft.title}`.slice(0,160),summary:'Waiting for approval before updating Google Calendar.',progress:25,source:surface,started_at:now,updated_at:now,metadata_json:{plan_type:'calendar_update',draft,learning_text:text}}).select('id').single()
  if(error||!run?.id)throw new Error('calendar_update_stage_failed')
  const when=new Intl.DateTimeFormat('en-IN',{timeZone:draft.timezone,dateStyle:'medium',timeStyle:'short'}).format(new Date(draft.startIso))
  const {data:approval,error:ae}=await supabaseAdmin.from('agent_approvals').insert({telegram_id:String(actor.legacyTelegramId),run_id:run.id,action_type:'calendar_change',title:`Move ${draft.title}`.slice(0,160),description:'Update the exact selected Calendar event after approval.',payload_preview:[...(draft.calendarAccount?[{label:'Calendar',value:draft.calendarAccount},{label:'Previous start',value:draft.oldStart},{label:'Previous end',value:draft.oldEnd},{label:'New end',value:draft.endIso}]:[]),{label:'Event',value:draft.title},{label:'New time',value:when},{label:'Timezone',value:draft.timezone}],execution_payload:{plan_type:'calendar_update'},risk_level:'medium',status:'pending',...buildApprovalBinding(binding(run.id,draft))}).select('id').single()
  if(ae||!approval?.id){
    await supabaseAdmin.from('agent_runs').update({status:'paused',summary:'Approval could not be staged; no provider mutation attempted.'}).eq('id',run.id).eq('telegram_id',String(actor.legacyTelegramId))
    throw new Error('calendar_update_approval_stage_failed')
  }
  await recordDecisionLearning({actor,text,domain:'calendar',handler:'calendar-update',decisionId:run.id,outcome:'blocked',verified:false,objectKind:'calendar_event',objectRef:draft.eventId}).catch(()=>{})
  return {...reply(`Ready to move “${draft.title}” to ${when} (${draft.timezone}).${draft.calendarAccount?`\nCalendar: ${draft.calendarAccount}\nOld: ${draft.oldStart} – ${draft.oldEnd}\nNew: ${draft.startIso} – ${draft.endIso}`:''}\nNothing has changed. Reply APPROVE to move it or REJECT to leave it unchanged.`,'waiting_approval',run.id),approvalId:approval.id,approvalRequired:true}
}
export async function executeApprovedCalendarUpdate({actor,runId}:{actor:AgentActor;runId:string}){
  const tg=String(actor.legacyTelegramId),governed=governedCalendarSelected(actor)
  if(governed){
    if(currentGovernedForeground())bindGovernedForegroundOwner(tg,true)
    else if(!currentGovernedRun())return withGovernedForeground(async()=>{bindGovernedForegroundOwner(tg,true);return executeApprovedCalendarUpdate({actor,runId})})
  }
  const [{data:run,error},{data:approval,error:ae}]=await Promise.all([
    supabaseAdmin.from('agent_runs').select('id,status,metadata_json').eq('telegram_id',tg).eq('id',runId).maybeSingle(),
    supabaseAdmin.from('agent_approvals').select('id,status,action_hash,policy_version').eq('telegram_id',tg).eq('run_id',runId).order('requested_at',{ascending:false}).limit(1).maybeSingle(),
  ])
  if(error||ae||!run||!approval||approval.status!=='approved')throw new Error('approval_required')
  if(!['queued','waiting_approval'].includes(run.status))throw new Error('agent_run_already_claimed')
  const draft:CalendarUpdate=run.metadata_json?.draft
  if(run.metadata_json?.plan_type!=='calendar_update'||!draft?.eventId||!draft.etag)throw new Error('calendar_update_payload_invalid')
  if(governed!==(draft.governanceVersion==='calendar-move-v1')||governed&&!draft.calendarAccount||
    !governed&&(currentGovernedRun()||currentGovernedForeground()?.governanceRequired))throw Error('calendar_fresh_exact_approval_required')
  assertApprovalBinding(binding(runId,draft),approval)
  const {token,level,credentialKey}=await calendarAccessForUpdate(actor)
  if(governed&&(!credentialKey||(await fetchPrimaryCalendarAccount(token))?.trim().toLowerCase()!==draft.calendarAccount))throw Error('calendar_approved_account_changed')
  const policy=evaluateAgentExecutionPolicy({capability:'calendar',permissionLevel:level,mode:'execute',risk:'medium',irreversible:true,approvalStatus:'approved'})
  if(!policy.allowed)throw new Error(`policy_${policy.reason}`)
  const sentinel=evaluateAgentSentinel({capability:'calendar',mode:'execute',risk:'medium',irreversible:true,approved:true,instruction:String(run.metadata_json.learning_text||''),actionCount:1})
  if(!sentinel.allowed)throw new Error(`sentinel_${sentinel.reason}`)
  const current=await readExactCalendarEvent(token,draft.eventId)
  if(current.etag!==draft.etag||current.start?.dateTime!==draft.oldStart||current.end?.dateTime!==draft.oldEnd){
    await supabaseAdmin.from('agent_runs').update({status:'paused',summary:'Event changed after preview; new approval required.'}).eq('id',runId).eq('telegram_id',tg)
    await supabaseAdmin.from('agent_approvals').update({status:'expired'}).eq('id',approval.id).eq('telegram_id',tg)
    return reply('The Calendar event changed after the preview. Nothing was moved; ask again to review and approve its current details.','paused',runId)
  }
  const {data:claim,error:ce}=await supabaseAdmin.from('agent_runs').update({status:'running',updated_at:new Date().toISOString()}).eq('id',runId).eq('telegram_id',tg).in('status',['queued','waiting_approval']).select('id').maybeSingle()
  if(ce||!claim)throw new Error('agent_run_already_claimed')
  let verified=false,rejected=false,denied=false,patchAccepted=false
  try{
    let approvedFetch:typeof fetch|undefined
    if(governed){
      const {governedApprovedCalendarMoveFetch}=await import('./governed-google-read')
      const {isApprovalExpired}=await import('./approval-ttl')
      const expectedUrl='https://www.googleapis.com/calendar/v3/calendars/primary/events/'+encodeURIComponent(draft.eventId)
      const expectedBody=JSON.stringify({start:{dateTime:draft.startIso,timeZone:draft.timezone},end:{dateTime:draft.endIso,timeZone:draft.timezone}})
      const authorize=async()=>{
        const [fresh,grant]=await Promise.all([
          supabaseAdmin.from('agent_runs').select('id,status,error,metadata_json').eq('id',runId).eq('telegram_id',tg).maybeSingle(),
          supabaseAdmin.from('agent_approvals').select('id,status,action_hash,policy_version,requested_at,execution_payload').eq('id',approval.id).eq('telegram_id',tg).eq('run_id',runId).maybeSingle()
        ])
        if(fresh.error||grant.error||fresh.data?.status!=='running'||fresh.data.error==='user_cancelled'||fresh.data.metadata_json?.plan_type!=='calendar_update'||grant.data?.status!=='approved'||grant.data.action_hash!==approval.action_hash||isApprovalExpired(grant.data))return false
        try{
          assertApprovalBinding(binding(runId,fresh.data.metadata_json.draft),grant.data)
          const nowLevel=await capabilityPermissionLevel(actor.legacyTelegramId,'calendar')
          return governedCalendarSelected(actor)&&['ask','auto'].includes(nowLevel)
        }catch{return false}
      }
      approvedFetch=(async(input,init)=>{
        if(typeof input!=='string'||!init||!credentialKey)throw Error('calendar_move_shape_invalid')
        const receipt=await governedApprovedCalendarMoveFetch(input,init,tg,{actorId:actor.userId,credentialKey,expectedUrl,expectedBody,expectedEtag:draft.etag,authorize})
        patchAccepted=receipt.ok
        return receipt
      }) as typeof fetch
    }
    const result=await updateCalendarEvent(token,draft.eventId,{startTime:draft.startIso,endTime:draft.endIso,ifMatch:draft.etag,timezone:draft.timezone},approvedFetch)
    verified=result.ok&&result.verification==='verified';rejected=result.verification==='rejected'
  }catch(e){
    denied=governed&&!patchAccepted&&/^governed_model_(?:not_authorized|authorization_revoked|authorization_unavailable|reservation_unavailable|unavailable|breach|deadline|duplicate|steps|cost|tokens|unresolved|policy_unavailable|price_unavailable|connector_scope_mismatch|connector_identity_mismatch|exact_calendar_approval_required|unreviewed_connector_shape)$/.test(String((e as Error)?.message||''))
    rejected=denied
  }
  const now=new Date().toISOString(),status=verified?'completed':rejected?'failed':'outcome_unknown'
  // A claimed request stays non-retriable even if these bookkeeping writes fail.
  await supabaseAdmin.from('agent_runs').update({status,completed_at:verified||rejected?now:null,updated_at:now,summary:verified?'Calendar update verified by exact provider read-back.':rejected?'Google rejected the update; a new request requires a fresh approval.':'Calendar update outcome unknown; do not retry.'}).eq('id',runId).eq('telegram_id',tg)
  await supabaseAdmin.from('agent_approvals').update({status:rejected?'failed':'executed',executed_at:now}).eq('id',approval.id).eq('telegram_id',tg)
  await recordDecisionLearning({actor,text:String(run.metadata_json.learning_text||''),domain:'calendar',handler:'calendar-update',decisionId:runId,objectKind:'calendar_event',objectRef:draft.eventId,outcome:verified?'verified_success':rejected?'failed':'unknown',verified,executionEvidence:{source:'google_calendar',kind:'provider_readback',objectRef:draft.eventId,providerRef:draft.eventId,verified}}).catch(()=>{})
  if(denied)return reply('The Calendar approval, account, permission or execution budget could not be verified before dispatch. Nothing was moved.','failed',runId)
  if(rejected)return reply('Google rejected this Calendar update. It was not applied and will not be retried automatically. Ask again to review the current event and give a fresh approval.','failed',runId)
  if(!verified)return reply('The Calendar update was attempted, but I could not verify the exact event and time from Google. Its outcome is unknown. I will not retry automatically. Check Google Calendar before any further change.','outcome_unknown',runId)
  await rememberTypedObjects(actor.legacyTelegramId,'calendar',[{id:draft.eventId,title:draft.title}]).catch(()=>{})
  return reply(`Moved “${draft.title}” and verified the exact event and time with Google Calendar. New time: ${new Intl.DateTimeFormat('en-IN',{timeZone:draft.timezone,dateStyle:'medium',timeStyle:'short'}).format(new Date(draft.startIso))} (${draft.timezone}).`,'completed',runId)
}
