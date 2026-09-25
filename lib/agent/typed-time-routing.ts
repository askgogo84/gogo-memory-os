import { randomUUID } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { fetchPrimaryCalendarEvents } from '@/lib/google-calendar'
import { normalizeTimezone, parseLocalDateTime } from '@/lib/timezone'
import { capabilityPermissionLevel } from './adaptive-autonomy'
import { latestTypedContext, rememberTypedObjects, normalizedObjectTitle, selectedTypedObject, typedOrdinal, typedMutationOwner } from './typed-object-context'
import { calendarAccessForUpdate, readExactCalendarEvent, stageCalendarUpdate, executeApprovedCalendarUpdate } from './calendar-update'
import { recordDecisionLearning } from './decision-learning'
import { captureExplicitRoutingCorrection } from './decision-feedback'
import { evaluateAgentSentinel } from './sentinel'
import type { AgentActor } from './actor'

export function parseTypedTimeRequest(raw:string){
  const text=raw.trim().replace(/^please\s+/i,'')
  const m=text.match(/^(?:move|reschedule|resched|postpone|push|shift|change|update|make)\s+(.+?)(?:\s+(?:to|for|at)\s+|\s+)(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)(?:\s+(?:instead|today|tomorrow))?[.!?]*$/i)
  if(!m)return null
  const target=m[1].replace(/^the\s+/i,'').replace(/\s+(?:time|to|for|at)$/i,'').trim()
  return {text,target,clock:m[2].trim(),day:/\btomorrow\b/i.test(text)?'tomorrow':/\btoday\b/i.test(text)?'today':null}
}
export function movedTime(clock:string,start:string,end:string|undefined,timezone:string,day:string|null){
  const time=clock.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i)
  if(!time||!Number.isFinite(Date.parse(start)))return null
  let h=Number(time[1]);const minute=Number(time[2]||0),ampm=time[3]?.toLowerCase()
  if(minute>59||h>23||(ampm&&(h<1||h>12)))return null
  const zone=normalizeTimezone(timezone),date=new Date(day?Date.now():start)
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(date)
  const part=(type:string)=>parts.find(p=>p.type===type)!.value
  let key=`${part('year')}-${part('month')}-${part('day')}`
  if(day==='tomorrow'){const d=new Date(key+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+1);key=d.toISOString().slice(0,10)}
  if(ampm)h=h%12+(ampm==='pm'?12:0)
  else if(h>=1&&h<=12){const oldHour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:zone,hour:'2-digit',hourCycle:'h23'}).format(new Date(start)));h=h%12+(oldHour>=12?12:0)}
  const startIso=parseLocalDateTime({date:key,time:`${String(h).padStart(2,'0')}:${String(minute).padStart(2,'0')}`,timezone:zone}).dueAtUtcISO
  const duration=end?Date.parse(end)-Date.parse(start):30*60000
  if(!Number.isFinite(duration)||duration<=0)return null
  return {startIso,endIso:new Date(Date.parse(startIso)+duration).toISOString()}
}
const response=(text:string,status='paused',domain='other')=>({text,status,handledBy:'typed-object-routing',capability:domain,runId:''})

async function approvalTurn(actor:AgentActor,text:string){
  if(!/^(?:approve|approved|yes|confirm|reject|no|cancel)$/i.test(text.trim()))return null
  const {data,error}=await supabaseAdmin.from('agent_approvals').select('id,run_id,status,execution_payload').eq('telegram_id',String(actor.legacyTelegramId)).eq('status','pending').order('requested_at',{ascending:false}).limit(2)
  if(error)throw new Error('approval_read_failed')
  const pending=data?.[0]
  if(pending?.execution_payload?.plan_type!=='calendar_update')return null
  if(data.length!==1)return response('More than one approval is pending. Open Gogo Agent and approve the exact Calendar update.')
  const reject=/^(reject|no|cancel)$/i.test(text.trim())
  const {data:claimed,error:ce}=await supabaseAdmin.from('agent_approvals').update({status:reject?'rejected':'approved',resolved_at:new Date().toISOString()}).eq('id',pending.id).eq('telegram_id',String(actor.legacyTelegramId)).eq('status','pending').select('id').maybeSingle()
  if(ce||!claimed)return response('That approval has already been handled. Nothing was retried.')
  if(reject){await supabaseAdmin.from('agent_runs').update({status:'paused'}).eq('id',pending.run_id).eq('telegram_id',String(actor.legacyTelegramId));return response('Calendar update rejected. The event is unchanged.','paused','calendar')}
  return executeApprovedCalendarUpdate({actor,runId:pending.run_id})
}

export async function tryTypedTimeRouting(p:{actor:AgentActor;text:string;surface:string;messageId?:string|null}){
  const original=p.text
  // A real explicit correction is bound to the previous identified production decision.
  const text=original.replace(/^no[,!]\s*(?:i meant\s+)?/i,'').trim()
  const request=parseTypedTimeRequest(text)
  const read=text.match(/^(?:what time is|when is|when does)\s+(.+?)(?:\s+(?:today|tomorrow))?[?.!]*$/i)
  const selection=/^(?:select|open|show)\s+(?:the\s+)?(?:first|second|third|fourth|fifth|\d+(?:st|nd|rd|th)?)\s+(?:one|event|meeting|reminder)[?.!]*$/i.test(text)
  const approval=/^(?:approve|approved|yes|confirm|reject|no|cancel)$/i.test(text)
  if(!request&&!read&&!selection&&!approval)return null
  try{
    if(approval)return await approvalTurn(p.actor,text)
    const sentinel=evaluateAgentSentinel({capability:'calendar',mode:'read',risk:'low',irreversible:false,approved:false,instruction:original,actionCount:1})
    if(!sentinel.allowed)return response(`Gogo Sentinel blocked this request: ${sentinel.reason}`)
    const correction=await captureExplicitRoutingCorrection(p.actor,original)
    const context=await latestTypedContext(p.actor.legacyTelegramId)
    if(selection){
      if(!context||!['calendar','reminders'].includes(context.domain))return null
      const selected=selectedTypedObject(context,text)
      if(!selected)return response('That result number is not in the current typed selection. Please show the list again.')
      await rememberTypedObjects(p.actor.legacyTelegramId,context.domain,context.items,selected.id)
      return response(`Selected ${context.domain==='calendar'?'Calendar event':'reminder'}: ${selected.title}.`,'completed',context.domain)
    }
    const target=request?.target||read![1],explicitCalendar=/\b(?:calendar|meeting|event|appointment)\b/i.test(target),explicitReminder=/\breminder\b/i.test(target)
    const referential=/^(?:(?:the|my)\s+)?(?:it|that|this|selected)(?:\s+(?:one|meeting|event|appointment|reminder))?$/i.test(target)||typedOrdinal(target)!==null
    const owner=referential?typedMutationOwner(context,target):null
    if(owner&&!['calendar','reminders'].includes(owner))return response(`The selected object belongs to ${owner}. I won't reinterpret it as a Calendar event or reminder. Please name the intended object or use its ${owner} action.`)
    if(owner&&((explicitCalendar&&owner!=='calendar')||(explicitReminder&&owner!=='reminders')))return response('The requested object type conflicts with the active selection. Please select or name the intended object.')
    const selected=referential?selectedTypedObject(context,target):null
    if(referential&&!selected)return response('Which Calendar event or reminder do you mean? Please name it or select it from a current list.')
    const title=normalizedObjectTitle(target.replace(/^(?:the|my)\s+/i,'').replace(/\s+(?:reminder|event|meeting)$/i,''))
    let calendar:any=null,reminder:any=null
    let access:Awaited<ReturnType<typeof calendarAccessForUpdate>>|null=null
    if(owner!=='reminders'&&!explicitReminder){
      // Reads used to resolve identity do not authorize a mutation. Permissions are
      // checked again before staging and immediately before provider execution.
      try{access=await calendarAccessForUpdate(p.actor,true)}catch(e:any){if(explicitCalendar||owner==='calendar'||e?.message!=='calendar_not_connected')throw e}
      if(access){
        const events=selected?[await readExactCalendarEvent(access.token,selected.id)]:await fetchPrimaryCalendarEvents(access.token,new Date(Date.now()-86400000).toISOString(),new Date(Date.now()+31*86400000).toISOString(),'TYPED_CALENDAR_READ_FAILED')
        const matches=selected?events:events.filter((e:any)=>normalizedObjectTitle(e.summary)===title)
        if(matches.length>1)return response('Multiple Calendar events have that exact title. Show your calendar and select the intended event.')
        calendar=matches[0]||null
      }
    }
    if(owner!=='calendar'&&!explicitCalendar){
      const {data,error}=await supabaseAdmin.from('reminders').select('id,message,remind_at,timezone,sent').eq('telegram_id',p.actor.legacyTelegramId).eq('sent',false).order('remind_at',{ascending:true}).limit(100)
      if(error)throw new Error('typed_reminders_read_failed')
      const matches=selected?(data||[]).filter(r=>String(r.id)===selected.id):(data||[]).filter(r=>normalizedObjectTitle(r.message)===title)
      if(matches.length>1)return response('Multiple reminders have that exact title. List your reminders and select the intended one.')
      reminder=matches[0]||null
    }
    if(calendar&&reminder){
      if(context?.selectedId===String(calendar.id)&&context.domain==='calendar')reminder=null
      else if(context?.selectedId===String(reminder.id)&&context.domain==='reminders')calendar=null
      else return response('Both a Calendar event and a reminder match that title. Do you mean the Calendar event or the reminder? Name it with the object type; nothing has changed.')
    }
    if(!calendar&&!reminder)return request?response('I could not resolve an exact Calendar event or reminder. Please name or select the intended object; nothing has changed.'):null
    const domain=calendar?'calendar':'reminders',object=calendar?{id:String(calendar.id),title:String(calendar.summary)}:{id:String(reminder.id),title:String(reminder.message)}
    await rememberTypedObjects(p.actor.legacyTelegramId,domain,[object])
    if(read){
      const start=calendar?.start?.dateTime||calendar?.start?.date||reminder.remind_at
      await recordDecisionLearning({actor:p.actor,text:original,domain,handler:calendar?'calendar-named-read':'reminder-query',decisionId:p.messageId||randomUUID(),outcome:'verified_success',verified:true,objectKind:calendar?'calendar_event':'reminder',objectRef:object.id}).catch(()=>{})
      return response(`${object.title}: ${start}`,'completed',domain)
    }
    const timezone=normalizeTimezone(calendar?access!.timezone:reminder.timezone)
    const times=movedTime(request!.clock,calendar?.start?.dateTime||reminder?.remind_at,calendar?.end?.dateTime,timezone,request!.day)
    if(!times)return response('Please give a valid time for the selected object. All-day events need an explicit date and duration.')
    let result:any
    if(calendar){
      if(!calendar.etag)return response('Google did not return the event version. I cannot safely stage this update.')
      result=await stageCalendarUpdate(p.actor,{eventId:object.id,title:object.title,oldStart:calendar.start.dateTime,oldEnd:calendar.end.dateTime,startIso:times.startIso,endIso:times.endIso,etag:calendar.etag,timezone},original,p.surface)
    }else{
      const level=await capabilityPermissionLevel(p.actor.legacyTelegramId,'reminders')
      if(level!=='auto')return response('Your reminder permission requires review before a change. No reminder was moved.','paused','reminders')
      const {data,error}=await supabaseAdmin.from('reminders').update({remind_at:times.startIso}).eq('telegram_id',p.actor.legacyTelegramId).eq('id',reminder.id).eq('remind_at',reminder.remind_at).eq('sent',false).select('id,remind_at').maybeSingle()
      if(error||!data||Date.parse(data.remind_at)!==Date.parse(times.startIso))return response('The reminder changed or its update could not be verified. Nothing will be retried automatically.')
      await recordDecisionLearning({actor:p.actor,text:original,domain:'reminders',handler:'reminder-update',decisionId:p.messageId||randomUUID(),outcome:'verified_success',verified:true,objectKind:'reminder',objectRef:object.id}).catch(()=>{})
      result=response(`Reminder updated: ${object.title}. New time: ${new Intl.DateTimeFormat('en-IN',{timeZone:timezone,dateStyle:'medium',timeStyle:'short'}).format(new Date(times.startIso))}.`,'completed','reminders')
    }
    if(correction&&['waiting_approval','completed'].includes(result.status)&&correction.handler!==(calendar?'calendar-update':'reminder-update')){
      await recordDecisionLearning({actor:p.actor,text:correction.text,domain:correction.domain,handler:correction.handler,decisionId:correction.decisionId,outcome:'corrected',firstRouteCorrect:false,correction:'explicit correction resolved by typed object'}).catch(()=>{})
      await recordDecisionLearning({actor:p.actor,text:correction.text,domain:correction.domain,handler:calendar?'calendar-update':'reminder-update',decisionId:correction.decisionId,outcome:'replacement',correction:'typed replacement selected; not provider completion'}).catch(()=>{})
    }
    return result
  }catch{return response('I could not safely resolve or verify that typed action. Nothing will be retried automatically. Please check the provider or select the object again.')}
}
