import { createHash } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { refreshAccessToken } from '@/lib/google-calendar'
import type { AgentActor } from './actor'

const PLAN_TYPE = 'booking_event_calendar'
function safe(v: unknown, max = 600) { return String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max) }
function validIso(v: unknown) { const s=String(v||'').trim(); return s&&Number.isFinite(Date.parse(s))?s:'' }
function eventIdForLifeEvent(lifeEventId:string){return `gogo${createHash('sha256').update(`booking-life-event:${lifeEventId}`).digest('hex').slice(0,32)}`}

export type BookingCalendarInput={lifeEventId:string;title:string;startAt:string;endAt:string;timezone:string;location?:string|null;provider?:string|null;sourceUrl?:string|null;endEstimated?:boolean}

async function existingPending(actor:AgentActor,lifeEventId:string){
  const {data:runs}=await supabaseAdmin.from('agent_runs').select('id,status,metadata_json').eq('telegram_id',String(actor.legacyTelegramId)).eq('source','booking_closure').in('status',['waiting_approval','queued','running']).order('updated_at',{ascending:false}).limit(30)
  for(const r of runs||[]){const m:any=r.metadata_json||{};if(m.plan_type!==PLAN_TYPE||String(m.life_event_id||'')!==lifeEventId)continue;const{data:a}=await supabaseAdmin.from('agent_approvals').select('id,status').eq('run_id',r.id).eq('telegram_id',String(actor.legacyTelegramId)).in('status',['pending','approved']).limit(1).maybeSingle();if(a?.id)return{runId:String(r.id),approvalId:String(a.id)}}
  return null
}

export async function prepareBookingCalendarApproval(params:{actor:AgentActor;input:BookingCalendarInput}){
  const start=validIso(params.input.startAt),end=validIso(params.input.endAt);if(!start||!end||Date.parse(end)<=Date.parse(start))return null
  const existing=await existingPending(params.actor,params.input.lifeEventId);if(existing)return existing
  const tg=String(params.actor.legacyTelegramId),now=new Date().toISOString()
  const{data:run,error}=await supabaseAdmin.from('agent_runs').insert({telegram_id:tg,type:'life_event',capability:'calendar',status:'waiting_approval',title:`Add ${safe(params.input.title,140)} to calendar`,summary:'Booking details are resolved. Waiting for approval to block the calendar.',progress:90,why:'A confirmed booking should become a calendar commitment after user approval.',source:'booking_closure',metadata_json:{plan_type:PLAN_TYPE,life_event_id:params.input.lifeEventId,proposedEvent:params.input},started_at:now,updated_at:now}).select('id').single();if(error||!run?.id)throw new Error(`booking_calendar_run_create_failed:${error?.message||'unknown'}`)
  const{data:approval,error:ae}=await supabaseAdmin.from('agent_approvals').insert({telegram_id:tg,run_id:String(run.id),action_type:'calendar_change',title:'Block calendar for this booking',description:'Create the confirmed event on Google Calendar. No purchase, cancellation or provider change will be made.',payload_preview:[{label:'Event',value:safe(params.input.title,180)},{label:'Starts',value:start},{label:'Ends',value:`${end}${params.input.endEstimated?' (estimated)':''}`},{label:'Venue',value:safe(params.input.location||'Not provided',180)}],execution_payload:{plan_type:PLAN_TYPE,action:'create_booking_calendar_event',lifeEventId:params.input.lifeEventId},risk_level:'medium',status:'pending'}).select('id').single();if(ae||!approval?.id)throw new Error(`booking_calendar_approval_create_failed:${ae?.message||'unknown'}`)
  await supabaseAdmin.from('agent_activity').insert({telegram_id:tg,run_id:String(run.id),event_type:'approval_requested',message:'Approval required before blocking Google Calendar for the confirmed booking.',metadata_json:{approval_id:approval.id,life_event_id:params.input.lifeEventId,source:PLAN_TYPE}}).catch(()=>{})
  return{runId:String(run.id),approvalId:String(approval.id)}
}

async function calendarToken(actor:AgentActor){const{data,error}=await supabaseAdmin.from('users').select('google_calendar_connected,google_refresh_token').eq('telegram_id',actor.legacyTelegramId).maybeSingle();if(error)throw new Error(`booking_calendar_credentials_failed:${error.message}`);if(!data?.google_calendar_connected||!data.google_refresh_token)throw new Error('calendar_not_connected');const token=await refreshAccessToken(String(data.google_refresh_token));if(!token)throw new Error('calendar_reconnect_required');return token}

export async function executeApprovedBookingCalendar(params:{actor:AgentActor;runId:string}){
  const tg=String(params.actor.legacyTelegramId)
  const{data:run,error}=await supabaseAdmin.from('agent_runs').select('metadata_json,status').eq('id',params.runId).eq('telegram_id',tg).maybeSingle();if(error)throw new Error(`booking_calendar_run_read_failed:${error.message}`);if(!run)throw new Error('agent_run_not_found')
  const meta:any=run.metadata_json||{};if(String(meta.plan_type||'')!==PLAN_TYPE)throw new Error('not_booking_calendar_plan');const ev:BookingCalendarInput=meta.proposedEvent;if(!ev||!validIso(ev.startAt)||!validIso(ev.endAt))throw new Error('booking_calendar_event_invalid')
  const{data:approval,error:ae}=await supabaseAdmin.from('agent_approvals').select('id,status,execution_payload').eq('run_id',params.runId).eq('telegram_id',tg).eq('action_type','calendar_change').eq('status','approved').order('resolved_at',{ascending:false}).limit(1).maybeSingle();if(ae)throw new Error(`booking_calendar_approval_read_failed:${ae.message}`);if(!approval||(approval.execution_payload as any)?.action!=='create_booking_calendar_event')throw new Error('approval_required')
  const token=await calendarToken(params.actor),eventId=eventIdForLifeEvent(ev.lifeEventId)
  const endpoint='https://www.googleapis.com/calendar/v3/calendars/primary/events',body={id:eventId,summary:ev.title,location:ev.location||undefined,description:[ev.provider?`Provider: ${ev.provider}`:'',ev.sourceUrl?`Booking source: ${ev.sourceUrl}`:'',ev.endEstimated?'End time is estimated by AskGogo because the provider did not expose a duration.':'','Saved by AskGogo booking closure.'].filter(Boolean).join('\n'),start:{dateTime:ev.startAt,timeZone:ev.timezone||'Asia/Kolkata'},end:{dateTime:ev.endAt,timeZone:ev.timezone||'Asia/Kolkata'},extendedProperties:{private:{askgogo_run_id:params.runId,askgogo_life_event_id:ev.lifeEventId,askgogo_source:PLAN_TYPE}}}
  let response=await fetch(endpoint,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store'}),data:any=await response.json().catch(()=>({})),reused=false
  if(response.status===409){response=await fetch(`${endpoint}/${encodeURIComponent(eventId)}`,{headers:{Authorization:`Bearer ${token}`},cache:'no-store'});data=await response.json().catch(()=>({}));reused=response.ok}
  if(!response.ok){if(response.status===401||response.status===403)throw new Error('calendar_reconnect_required');throw new Error(`booking_calendar_create_failed:${response.status}`)}
  const now=new Date().toISOString(),{data:eventRow}=await supabaseAdmin.from('life_events').select('metadata_json').eq('id',ev.lifeEventId).eq('telegram_id',tg).maybeSingle(),nextMeta={...((eventRow?.metadata_json as any)||{}),calendar:{eventId:data.id||eventId,htmlLink:data.htmlLink||'',createdAt:now}}
  await Promise.all([supabaseAdmin.from('agent_runs').update({status:'completed',progress:100,summary:'Booking added to Google Calendar.',completed_at:now,updated_at:now,metadata_json:{...meta,calendarExecution:{eventId:data.id||eventId,htmlLink:data.htmlLink||'',reused,executedAt:now}}}).eq('id',params.runId).eq('telegram_id',tg),supabaseAdmin.from('agent_approvals').update({status:'executed',executed_at:now}).eq('id',approval.id).eq('status','approved'),supabaseAdmin.from('life_events').update({metadata_json:nextMeta,updated_at:now}).eq('id',ev.lifeEventId).eq('telegram_id',tg)])
  await supabaseAdmin.from('agent_activity').insert({telegram_id:tg,run_id:params.runId,event_type:'booking_calendar_created',message:'Confirmed booking added to Google Calendar.',metadata_json:{life_event_id:ev.lifeEventId,event_id:data.id||eventId,reused}}).catch(()=>{})
  return{runId:params.runId,status:'completed' as const,capability:'calendar' as const,risk:'medium' as const,handledBy:'booking-event-calendar' as const,text:`Done. I blocked your calendar for *${safe(ev.title,180)}*. Your saved ticket/QR stays attached to the same event.`,eventId:String(data.id||eventId),eventUrl:data.htmlLink||undefined}
}
