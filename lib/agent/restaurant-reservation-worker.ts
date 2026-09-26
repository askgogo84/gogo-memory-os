import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendWhatsAppMessage } from '@/lib/channels/whatsapp'
import { runSecureBrowser } from './secure-computer'
import { evaluateAgentExecutionPolicy, type AgentPermissionLevel } from './policy'
import { evaluateAgentSentinel } from './sentinel'
import { assertApprovalBinding } from './approval-binding'
import { restaurantReservationApprovalInput } from './restaurant-reservation'
import { prepareBookingCalendarApproval } from './booking-calendar-execution'
import type { AgentActor } from './actor'

const LEASE_MINUTES=8

function safe(value:unknown,max=800){return String(value??'').replace(/\s+/g,' ').trim().slice(0,max)}

async function actorFor(telegramId:string):Promise<AgentActor>{
  const{data,error}=await supabaseAdmin.from('users').select('id,telegram_id,whatsapp_id,name,timezone').eq('telegram_id',Number(telegramId)).maybeSingle()
  if(error||!data?.id||!data?.telegram_id)throw new Error('restaurant_reservation_actor_missing')
  return{userId:String(data.id),legacyTelegramId:Number(data.telegram_id),whatsappId:String(data.whatsapp_id||''),name:String(data.name||'Gogo')}
}

async function browserPermission(telegramId:string):Promise<AgentPermissionLevel>{
  const{data,error}=await supabaseAdmin.from('agent_permissions').select('level').eq('telegram_id',telegramId).eq('capability','browser').maybeSingle()
  if(error)throw new Error(`restaurant_reservation_permission_failed:${error.message}`)
  return(data?.level as AgentPermissionLevel|undefined)||'ask'
}

function hasSubmit(result:any){return Array.isArray(result?.actions)&&result.actions.some((a:any)=>a?.kind==='submit'&&a?.status==='done')}
function confirmedText(result:any){
  const text=`${result?.title||''} ${result?.pageText||''}`.toLowerCase()
  return /\b(reservation|booking|table)\b.{0,80}\b(confirmed|booked|successful|complete|reserved)\b|\b(confirmed|booked|successful|reserved)\b.{0,80}\b(reservation|booking|table)\b|\bconfirmation\s*(?:number|reference|code)\b/i.test(text)
}
function noAvailability(result:any){
  const text=`${result?.title||''} ${result?.pageText||''}`.toLowerCase()
  return /\b(sold\s*out|fully\s+booked|no\s+available\s+(?:dates?|times?|slots?)|no\s+availability)\b/i.test(text)
}

const MONTHS:Record<string,number>={jan:1,january:1,feb:2,february:2,mar:3,march:3,apr:4,april:4,may:5,jun:6,june:6,jul:7,july:7,aug:8,august:8,sep:9,sept:9,september:9,oct:10,october:10,nov:11,november:11,dec:12,december:12}
function normalizeClock(hour:number,minute:number,meridiem:string){let h=hour;if(/pm/i.test(meridiem)&&h<12)h+=12;if(/am/i.test(meridiem)&&h===12)h=0;return `${String(h).padStart(2,'0')}:${String(minute).padStart(2,'0')}`}
function extractConfirmedSlot(text:string,timezone:string){
  const raw=String(text||'').replace(/\s+/g,' ')
  const date=raw.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:[ ,]+(20\d{2}))?\b/i)
  const time=raw.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i)
  if(!date||!time)return null
  const month=MONTHS[String(date[2]).toLowerCase()],day=Number(date[1]),year=Number(date[3]||new Date().getUTCFullYear())
  const clock=normalizeClock(Number(time[1]),Number(time[2]||0),time[3])
  const local=`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}T${clock}:00`
  // Calendar API accepts the explicit offset in the generated Date; use Intl offset by
  // parsing through the same utility is unnecessary here because this is optional follow-up.
  const guess=new Date(local+(timezone==='Asia/Kolkata'?'+05:30':'Z'))
  return Number.isFinite(guess.getTime())?guess.toISOString():null
}

async function claim(action:any){
  const now=new Date(),leaseUntil=new Date(now.getTime()+LEASE_MINUTES*60_000).toISOString()
  const{data,error}=await supabaseAdmin.from('life_event_actions').update({status:'running',updated_at:now.toISOString(),payload_json:{...(action.payload_json||{}),leaseUntil}}).eq('id',action.id).eq('status','ready').select('id').maybeSingle()
  if(error)throw new Error(`restaurant_reservation_claim_failed:${error.message}`)
  return Boolean(data?.id)
}

async function activity(tg:string,runId:string,eventType:string,message:string,metadata:Record<string,unknown>={}){
  const{error}=await supabaseAdmin.from('agent_activity').insert({telegram_id:tg,run_id:runId,event_type:eventType,message:safe(message,900),metadata_json:metadata})
  if(error)console.error('RESTAURANT_RESERVATION_ACTIVITY_FAILED:',error.message)
}

async function notify(actor:AgentActor,message:string){
  if(!actor.whatsappId)return
  await sendWhatsAppMessage(actor.whatsappId,message).catch((err:any)=>console.error('RESTAURANT_RESERVATION_WHATSAPP_FAILED:',err?.message||err))
}

async function failSafe(params:{action:any;event:any;runId:string;approvalId:string;status:'failed'|'paused'|'outcome_unknown';summary:string;error:string;actionStatus?:'blocked'|'ready';expireApproval?:boolean;actor:AgentActor}){
  const now=new Date().toISOString(),tg=String(params.actor.legacyTelegramId)
  const actionStatus=params.actionStatus||'blocked'
  const updates:any[]=[
    supabaseAdmin.from('agent_runs').update({status:params.status,summary:params.summary,error:params.error,updated_at:now,completed_at:params.status==='failed'?now:null}).eq('id',params.runId).eq('telegram_id',tg),
    supabaseAdmin.from('life_event_actions').update({status:actionStatus,payload_json:{...(params.action.payload_json||{}),blockedReason:params.error,updatedAt:now},updated_at:now}).eq('id',params.action.id).eq('telegram_id',tg),
    supabaseAdmin.from('life_events').update({lifecycle_state:'needs_attention',updated_at:now}).eq('id',params.event.id).eq('telegram_id',tg),
  ]
  if(params.expireApproval)updates.push(supabaseAdmin.from('agent_approvals').update({status:'expired',resolved_at:now,resolution_note:params.error}).eq('id',params.approvalId).eq('telegram_id',tg).eq('status','approved'))
  await Promise.all(updates)
}

async function processOne(action:any){
  const tg=String(action.telegram_id)
  if(!(await claim(action)))return{status:'skipped' as const}
  const{data:event,error:eventError}=await supabaseAdmin.from('life_events').select('id,event_type,subtype,title,provider,timezone,lifecycle_state,preferences_json,metadata_json,source_refs').eq('id',action.life_event_id).eq('telegram_id',tg).maybeSingle()
  if(eventError||!event)throw new Error('restaurant_reservation_event_missing')
  const actor=await actorFor(tg)
  const payload:any=action.payload_json||{}
  const approvalId=String(payload.approvalId||'')
  const{data:approval,error:approvalError}=await supabaseAdmin.from('agent_approvals').select('id,run_id,status,action_hash,policy_version').eq('id',approvalId).eq('telegram_id',tg).eq('action_type','booking').maybeSingle()
  if(approvalError||!approval||approval.status!=='approved'){
    await supabaseAdmin.from('life_event_actions').update({status:'waiting_approval',updated_at:new Date().toISOString(),payload_json:{...payload,waitingForApproval:true}}).eq('id',action.id).eq('telegram_id',tg)
    return{status:'waiting_approval' as const}
  }
  const runId=String(approval.run_id||'')
  if(!runId)throw new Error('restaurant_reservation_run_missing')
  const input=restaurantReservationApprovalInput({runId,lifeEventId:String(event.id),actionId:String(action.id),restaurant:String(payload.restaurant||event.metadata_json?.restaurant||''),providerUrl:String(payload.reservationUrl||event.metadata_json?.reservationUrl||''),partySize:Number(payload.partySize)||null,preferredStart:String(payload.preferredStart||''),preferredEnd:String(payload.preferredEnd||''),requestedDate:String(payload.requestedDate||''),releaseAt:String(payload.releaseAt||'')||null})
  assertApprovalBinding(input,approval)

  const permission=await browserPermission(tg)
  const policy=evaluateAgentExecutionPolicy({capability:'browser',permissionLevel:permission,mode:'execute',risk:'high',irreversible:true,approvalStatus:'approved'})
  if(!policy.allowed)throw new Error(`policy_${policy.reason}`)
  const url=String(payload.reservationUrl||'')
  const instruction=`At the verified booking-release time, attempt exactly one restaurant reservation at ${safe(payload.restaurant||event.title,180)} for ${Number(payload.partySize)||1} people. ${payload.requestedDate?`Prefer only ${payload.requestedDate}. `:''}${payload.preferredStart&&payload.preferredEnd?`Choose a slot between ${payload.preferredStart} and ${payload.preferredEnd}; if no in-bounds slot exists, do not book. `:'Choose the earliest available slot.'} The approved booking fee/deposit ceiling is ₹0. If any fee, deposit, payment, paid add-on, new terms requiring separate consent, password, OTP, CAPTCHA, passkey, device approval or payment authentication appears, stop before it. Fill ordinary reservation fields from already available safe profile/browser context only. Use one final submit only when all approved constraints are satisfied. Never submit a second time if the result is uncertain.`
  const sentinel=evaluateAgentSentinel({capability:'browser',mode:'execute',risk:'high',irreversible:true,approved:true,instruction,url,actionCount:12})
  if(!sentinel.allowed)throw new Error(`sentinel_${sentinel.reason}`)

  await Promise.all([
    supabaseAdmin.from('agent_runs').update({status:'running',summary:'Booking window opened. Gogo is attempting the approved reservation now.',progress:75,updated_at:new Date().toISOString()}).eq('id',runId).eq('telegram_id',tg).in('status',['queued','waiting_approval','paused']),
    supabaseAdmin.from('life_events').update({lifecycle_state:'in_progress',updated_at:new Date().toISOString()}).eq('id',event.id).eq('telegram_id',tg),
  ])
  await activity(tg,runId,'restaurant_reservation_started','Verified release time reached; Gogo started the bounded reservation attempt.',{life_event_id:event.id,action_id:action.id})

  let result:any
  try{
    result=await runSecureBrowser({userId:actor.userId,url,mode:'execute',objective:instruction})
  }catch(error:any){
    const summary='Gogo lost reliable provider evidence during the reservation attempt. The outcome is unknown, so it will not retry automatically.'
    await failSafe({action,event,runId,approvalId,status:'outcome_unknown',summary,error:'restaurant_reservation_outcome_unknown',actor})
    await notify(actor,`⚠️ ${summary}\n\nPlease verify directly with ${safe(payload.restaurant||event.title,160)} before trying again.`)
    await activity(tg,runId,'restaurant_reservation_unknown',summary,{life_event_id:event.id,action_id:action.id})
    return{status:'outcome_unknown' as const,runId}
  }

  if(result.status==='blocked'){
    const summary=safe(result.summary||'The provider requires a human authentication or protected step.',900)
    await failSafe({action,event,runId,approvalId,status:'paused',summary,error:result.blockReason||'human_auth_required',actor})
    await notify(actor,`🔐 ${safe(payload.restaurant||event.title,160)} needs a secure human step before I can continue. I stopped before passwords, OTPs, CAPTCHAs, passkeys or payment authentication. Open AskGogo Agent / Take Control for this run; the original reservation constraints remain attached.`)
    await activity(tg,runId,'restaurant_reservation_human_step','Reservation paused at a protected provider step.',{life_event_id:event.id,action_id:action.id,auth_reason:result.authReason||null})
    return{status:'paused' as const,runId}
  }

  const submitted=hasSubmit(result)
  const verified=submitted&&confirmedText(result)
  if(!verified){
    if(submitted){
      const summary='The reservation submit may have reached the provider, but Gogo could not verify a final confirmation. Outcome unknown; no automatic retry.'
      await failSafe({action,event,runId,approvalId,status:'outcome_unknown',summary,error:'restaurant_reservation_confirmation_unknown',actor})
      await notify(actor,`⚠️ ${summary}`)
      await activity(tg,runId,'restaurant_reservation_unknown',summary,{life_event_id:event.id,action_id:action.id})
      return{status:'outcome_unknown' as const,runId}
    }
    const soldOut=noAvailability(result)
    const summary=soldOut?'No approved in-bounds table was available when the provider opened. Nothing was booked.':'Gogo could not find an approved in-bounds slot and made no booking.'
    await failSafe({action,event,runId,approvalId,status:'failed',summary,error:soldOut?'restaurant_reservation_no_availability':'restaurant_reservation_not_submitted',expireApproval:true,actor})
    await notify(actor,`🍜 ${summary}`)
    await activity(tg,runId,'restaurant_reservation_not_booked',summary,{life_event_id:event.id,action_id:action.id})
    return{status:'failed' as const,runId}
  }

  const now=new Date().toISOString()
  const meta={...(event.metadata_json||{}),reservationConfirmed:true,reservationConfirmedAt:now,confirmationUrl:result.url,confirmationEvidence:safe(result.pageText,2200)}
  await Promise.all([
    supabaseAdmin.from('agent_runs').update({status:'completed',summary:'Restaurant reservation submitted and verified from the provider confirmation page.',progress:100,completed_at:now,updated_at:now,metadata_json:{plan_type:'restaurant_reservation_release',life_event_id:String(event.id),life_event_action_id:String(action.id),providerConfirmationVerified:true,confirmationUrl:result.url}}).eq('id',runId).eq('telegram_id',tg),
    supabaseAdmin.from('life_event_actions').update({status:'completed',updated_at:now,payload_json:{...payload,completedAt:now,providerConfirmationVerified:true,confirmationUrl:result.url}}).eq('id',action.id).eq('telegram_id',tg),
    supabaseAdmin.from('life_events').update({lifecycle_state:'watching',metadata_json:meta,updated_at:now,next_action_at:null}).eq('id',event.id).eq('telegram_id',tg),
    supabaseAdmin.from('agent_approvals').update({status:'executed',executed_at:now}).eq('id',approvalId).eq('telegram_id',tg).eq('status','approved'),
  ])
  await activity(tg,runId,'restaurant_reservation_verified','Provider confirmation verified for the restaurant reservation.',{life_event_id:event.id,action_id:action.id,confirmation_url:result.url})

  let calendarNote=''
  const startAt=extractConfirmedSlot(result.pageText,String(event.timezone||'Asia/Kolkata'))
  if(startAt){
    const endAt=new Date(Date.parse(startAt)+90*60_000).toISOString()
    const calendar=await prepareBookingCalendarApproval({actor,input:{lifeEventId:String(event.id),title:safe(payload.restaurant||event.title,180),startAt,endAt,timezone:String(event.timezone||'Asia/Kolkata'),location:null,provider:String(event.provider||''),sourceUrl:url,endEstimated:true}}).catch(()=>null)
    if(calendar)calendarNote=' I also prepared a Calendar block; approve that separately in Gogo Agent if you want it added.'
  }
  await notify(actor,`✅ Reservation verified for ${safe(payload.restaurant||event.title,160)}. I verified the provider confirmation page before marking it complete.${calendarNote}`)
  return{status:'completed' as const,runId}
}

export async function processQueuedRestaurantReservations(limit=6){
  const now=new Date(),staleBefore=new Date(now.getTime()-LEASE_MINUTES*60_000).toISOString()
  const select='id,life_event_id,telegram_id,action_key,action_type,capability,title,due_at,status,payload_json,created_at,updated_at'
  const[due,stale]=await Promise.all([
    supabaseAdmin.from('life_event_actions').select(select).eq('action_key','restaurant-reservation-release').eq('status','ready').not('due_at','is',null).lte('due_at',now.toISOString()).order('due_at',{ascending:true}).limit(limit),
    supabaseAdmin.from('life_event_actions').select(select).eq('action_key','restaurant-reservation-release').eq('status','running').lte('updated_at',staleBefore).order('updated_at',{ascending:true}).limit(limit),
  ])
  if(due.error)throw new Error(`restaurant_reservation_due_read_failed:${due.error.message}`)
  if(stale.error)throw new Error(`restaurant_reservation_stale_read_failed:${stale.error.message}`)
  // Stale running reservation attempts are outcome-uncertain: never reclaim/retry them.
  for(const action of stale.data||[]){
    const tg=String(action.telegram_id)
    const approvalId=String((action.payload_json as any)?.approvalId||'')
    const{data:approval}=approvalId?await supabaseAdmin.from('agent_approvals').select('run_id').eq('id',approvalId).eq('telegram_id',tg).maybeSingle():{data:null}
    if(approval?.run_id){
      await Promise.all([
        supabaseAdmin.from('agent_runs').update({status:'outcome_unknown',summary:'A reservation attempt lost its execution lease. Gogo will not retry until provider state is checked.',error:'restaurant_reservation_stale_unknown',updated_at:new Date().toISOString()}).eq('id',String(approval.run_id)).eq('telegram_id',tg),
        supabaseAdmin.from('life_event_actions').update({status:'blocked',payload_json:{...(action.payload_json as any||{}),outcomeUnknown:true,reconciliationRequired:true},updated_at:new Date().toISOString()}).eq('id',String(action.id)).eq('telegram_id',tg),
      ])
    }
  }
  let checked=0,completed=0,failed=0,paused=0,unknown=0,waitingApproval=0
  for(const action of due.data||[]){
    checked++
    try{
      const r=await processOne(action)
      if(r.status==='completed')completed++
      else if(r.status==='failed')failed++
      else if(r.status==='paused')paused++
      else if(r.status==='outcome_unknown')unknown++
      else if(r.status==='waiting_approval')waitingApproval++
    }catch(error:any){
      failed++
      console.error('RESTAURANT_RESERVATION_WORKER_FAILED:',action.id,error?.message||error)
      await supabaseAdmin.from('life_event_actions').update({status:'blocked',payload_json:{...(action.payload_json as any||{}),blockedReason:safe(error?.message||'restaurant_reservation_worker_failed',300)},updated_at:new Date().toISOString()}).eq('id',String(action.id)).eq('telegram_id',String(action.telegram_id)).catch(()=>{})
    }
  }
  return{checked,completed,failed,paused,unknown,waitingApproval,staleUnknown:(stale.data||[]).length}
}
