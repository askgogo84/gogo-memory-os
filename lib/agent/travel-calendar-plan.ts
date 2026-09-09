import { supabaseAdmin } from '@/lib/supabase-admin'
import { createCalendarEventAtIso, getCalendarTokens } from '@/lib/bot/handlers/calendar-actions'
import { wallTimeToUtcIso } from '@/lib/dashboard/wall-time'
import type { AgentActor } from './actor'
import type { AgentSurface } from './orchestrator'

export type TravelCalendarPlan = { target: string }

type SavedTicket = {
  id: string | number
  title: string | null
  summary: string | null
  extracted: any
  doc_date: string | null
  created_at: string | null
}

type FlightLeg = {
  from: string
  to: string
  date: string
  departure: string
  arrival?: string
  airline: string
  flightNo: string
}

export function parseTravelCalendarPlan(text: string): TravelCalendarPlan | null {
  const clean = String(text || '').replace(/\s+/g, ' ').trim()
  if (!/\b(find|locate|get)\b/i.test(clean)) return null
  if (!/\b(calendar|calender|calandar)\b/i.test(clean)) return null
  if (!/\b(add|put|schedule|save)\b/i.test(clean)) return null
  const match = clean.match(/\b(?:find|locate|get)\s+(?:my\s+)?(.+?)\s+(?:and|then)\s+(?:add|put|schedule|save)\b/i)
  if (!match?.[1]) return null
  const target = match[1]
    .replace(/\b(ticket|details|info|information)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
  if (!target || !/\b(flight|air|trip|travel|dubai|blr|dxb|new york|london|singapore|jfk|ewr|lhr|sin)\b/i.test(target)) return null
  return { target }
}

function parseDateParts(raw: string | null | undefined): { y:number; mo:number; d:number } | null {
  const s = String(raw || '').trim()
  if (!s) return null
  let m:RegExpMatchArray|null
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) return { y:+m[1], mo:+m[2], d:+m[3] }
  const months:Record<string,number>={jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,sept:9,oct:10,nov:11,dec:12}
  if ((m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{4})$/))) {
    const mo=months[m[2].slice(0,4).toLowerCase()] || months[m[2].slice(0,3).toLowerCase()]
    if (mo) return { y:+m[3], mo, d:+m[1] }
  }
  if ((m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/))) {
    let y=+m[3]; if(y<100)y+=2000
    return { y, mo:+m[2], d:+m[1] }
  }
  return null
}

function parseClock(raw:string|null|undefined):{hh:number;mm:number}|null{
  const m=String(raw||'').trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i)
  if(!m)return null
  let hh=+m[1];const mm=+(m[2]||0);const ap=m[3]?.toLowerCase()
  if(ap==='pm'&&hh<12)hh+=12
  if(ap==='am'&&hh===12)hh=0
  if(hh<0||hh>23||mm<0||mm>59)return null
  return {hh,mm}
}

function departureTimezone(from:string,userTimezone:string){
  const s=String(from||'').toLowerCase()
  if(/\b(dxb|dubai)\b/.test(s))return 'Asia/Dubai'
  if(/\b(jfk|ewr|new york|nyc)\b/.test(s))return 'America/New_York'
  if(/\b(lhr|lgw|london)\b/.test(s))return 'Europe/London'
  if(/\b(sin|singapore)\b/.test(s))return 'Asia/Singapore'
  if(/\b(blr|bengaluru|bangalore|bom|mumbai|del|delhi|hyd|hyderabad|maa|chennai|ccu|kolkata|goi|goa|india)\b/.test(s))return 'Asia/Kolkata'
  return userTimezone || 'Asia/Kolkata'
}

function searchable(ticket:SavedTicket,leg:FlightLeg){
  return `${ticket.title||''} ${ticket.summary||''} ${leg.from||''} ${leg.to||''} ${leg.airline||''} ${leg.flightNo||''}`.toLowerCase()
}

function scoreLeg(ticket:SavedTicket,leg:FlightLeg,target:string){
  const hay=searchable(ticket,leg)
  const tokens=target.toLowerCase().split(/[^a-z0-9]+/).filter(x=>x.length>2)
  let score=0
  for(const token of tokens)if(hay.includes(token))score+=3
  if(/flight|air/.test(target.toLowerCase()))score+=2
  if(parseDateParts(leg.date||ticket.doc_date)&&parseClock(leg.departure))score+=5
  return score
}

async function findFlight(telegramId:number,target:string):Promise<{ticket:SavedTicket;leg:FlightLeg;date:{y:number;mo:number;d:number}}|null>{
  const {data,error}=await supabaseAdmin.from('documents')
    .select('id,title,summary,extracted,doc_date,created_at')
    .eq('telegram_id',telegramId)
    .eq('doc_type','ticket')
    .order('created_at',{ascending:false})
    .limit(80)
  if(error)throw new Error(`travel_calendar_memory_search_failed:${error.message}`)
  const candidates:Array<{ticket:SavedTicket;leg:FlightLeg;date:{y:number;mo:number;d:number};score:number;instant:number}>=[]
  for(const ticket of (data||[]) as SavedTicket[]){
    if(ticket.extracted?.type!=='flight'||!Array.isArray(ticket.extracted?.flights))continue
    for(const leg of ticket.extracted.flights as FlightLeg[]){
      const date=parseDateParts(leg.date)||parseDateParts(ticket.doc_date)
      const clock=parseClock(leg.departure)
      if(!date||!clock)continue
      const score=scoreLeg(ticket,leg,target)
      if(score<=0)continue
      candidates.push({ticket,leg,date,score,instant:Date.UTC(date.y,date.mo-1,date.d,clock.hh,clock.mm)})
    }
  }
  const now=Date.now()-24*3600_000
  candidates.sort((a,b)=>{
    const af=a.instant>=now?1:0,bf=b.instant>=now?1:0
    if(af!==bf)return bf-af
    if(a.score!==b.score)return b.score-a.score
    return af? a.instant-b.instant : b.instant-a.instant
  })
  const c=candidates[0]
  return c?{ticket:c.ticket,leg:c.leg,date:c.date}:null
}

async function userTimezone(telegramId:number){
  const {data}=await supabaseAdmin.from('users').select('timezone').eq('telegram_id',telegramId).maybeSingle()
  return String(data?.timezone||'Asia/Kolkata')
}

async function calendarEnabled(telegramId:number){
  const {data,error}=await supabaseAdmin.from('agent_permissions')
    .select('level')
    .eq('telegram_id',String(telegramId))
    .eq('capability','calendar')
    .maybeSingle()
  if(error)throw new Error(`agent_permission_unavailable:${error.message}`)
  return String(data?.level||'ask')!=='off'
}

async function addStep(telegramId:number,runId:string,ordinal:number,toolName:string,title:string,status='queued'){
  const {data,error}=await supabaseAdmin.from('agent_steps').insert({telegram_id:String(telegramId),run_id:runId,ordinal,tool_name:toolName,title,status}).select('id').single()
  if(error||!data?.id)throw new Error(`agent_step_create_failed:${error?.message||'unknown'}`)
  return String(data.id)
}
async function stepState(id:string,status:'running'|'completed'|'failed'|'waiting_approval',output:Record<string,unknown>={},error?:string){
  const now=new Date().toISOString();const patch:any={status}
  if(status==='running')patch.started_at=now
  if(status==='completed'||status==='failed')patch.completed_at=now
  if(Object.keys(output).length)patch.output_json=output
  if(error)patch.error=String(error).slice(0,500)
  const {error:e}=await supabaseAdmin.from('agent_steps').update(patch).eq('id',id)
  if(e)throw new Error(`agent_step_update_failed:${e.message}`)
}
async function activity(telegramId:number,runId:string,eventType:string,message:string,metadata:Record<string,unknown>={}){
  const {error}=await supabaseAdmin.from('agent_activity').insert({telegram_id:String(telegramId),run_id:runId,event_type:eventType,message:String(message).slice(0,900),metadata_json:metadata})
  if(error)console.error('TRAVEL_CALENDAR_ACTIVITY_FAILED:',error.message)
}

export async function tryPrepareTravelCalendarPlan(params:{actor:AgentActor;surface:AgentSurface;text:string}){
  const plan=parseTravelCalendarPlan(params.text)
  if(!plan)return null
  const tg=params.actor.legacyTelegramId
  const now=new Date().toISOString()

  if(!(await calendarEnabled(tg))){
    const {data:blocked,error}=await supabaseAdmin.from('agent_runs').insert({
      telegram_id:String(tg),type:'compound',capability:'calendar',status:'paused',
      title:`Find ${plan.target} and prepare Calendar event`,summary:'Blocked by Gogo Safe Mode: Calendar is off.',progress:0,
      why:'Calendar access is disabled in Gogo Safe Mode.',source:params.surface,
      metadata_json:{input_text:String(params.text).slice(0,2000),plan_type:'memory_ticket_to_calendar',target:plan.target},started_at:now,updated_at:now,
    }).select('id').single()
    if(error||!blocked?.id)throw new Error(`travel_calendar_run_create_failed:${error?.message||'unknown'}`)
    return {runId:String(blocked.id),status:'paused' as const,capability:'calendar' as const,risk:'medium' as const,text:'Calendar access is off in Gogo Safe Mode. Turn Calendar back on before I prepare or add an event.',blockedReason:'calendar_permission_off',handledBy:'compound-plan' as const}
  }

  const {data:run,error:runError}=await supabaseAdmin.from('agent_runs').insert({
    telegram_id:String(tg),type:'compound',capability:'calendar',status:'running',
    title:`Find ${plan.target} and prepare Calendar event`,summary:'Gogo is preparing a Memory → Calendar plan.',progress:5,
    why:'This request needs saved travel memory and Calendar to work together.',source:params.surface,
    metadata_json:{input_text:String(params.text).slice(0,2000),plan_type:'memory_ticket_to_calendar',target:plan.target},started_at:now,updated_at:now,
  }).select('id').single()
  if(runError||!run?.id)throw new Error(`travel_calendar_run_create_failed:${runError?.message||'unknown'}`)
  const runId=String(run.id)
  const steps=[
    await addStep(tg,runId,1,'memory.search',`Find ${plan.target}`),
    await addStep(tg,runId,2,'travel.read_schedule','Read the saved flight date and departure time'),
    await addStep(tg,runId,3,'calendar.prepare','Prepare a Calendar event'),
    await addStep(tg,runId,4,'calendar.create','Add the flight departure to Calendar'),
  ]
  try{
    await stepState(steps[0],'running')
    const found=await findFlight(tg,plan.target)
    if(!found){
      await stepState(steps[0],'failed',{},'matching_future_flight_not_found')
      await supabaseAdmin.from('agent_runs').update({status:'failed',summary:`I couldn't find a saved ${plan.target} with a usable flight schedule.`,progress:100,completed_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',runId).eq('telegram_id',String(tg))
      return {runId,status:'failed' as const,capability:'calendar' as const,risk:'medium' as const,text:`I couldn't find a saved ${plan.target} with a usable flight schedule.`,handledBy:'compound-plan' as const}
    }
    await stepState(steps[0],'completed',{documentId:String(found.ticket.id),matched:true})
    await stepState(steps[1],'running')
    const clock=parseClock(found.leg.departure)!
    const userTz=await userTimezone(tg)
    const timezone=departureTimezone(found.leg.from,userTz)
    const startIso=wallTimeToUtcIso(timezone,found.date.y,found.date.mo,found.date.d,clock.hh,clock.mm)
    const route=`${found.leg.from} → ${found.leg.to}`
    const eventTitle=`Flight departure${found.leg.flightNo?` · ${found.leg.flightNo}`:''} · ${route}`.slice(0,180)
    await stepState(steps[1],'completed',{route,departure:found.leg.departure,date:`${found.date.y}-${String(found.date.mo).padStart(2,'0')}-${String(found.date.d).padStart(2,'0')}`,timezone})
    const tokens=await getCalendarTokens(tg)
    if(!tokens.connected){
      await stepState(steps[2],'failed',{},'calendar_not_connected')
      await supabaseAdmin.from('agent_runs').update({status:'failed',summary:'Connect Google Calendar once, then I can add this saved flight.',progress:100,completed_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',runId).eq('telegram_id',String(tg))
      return {runId,status:'failed' as const,capability:'calendar' as const,risk:'medium' as const,text:'I found the flight, but Google Calendar is not connected. Type “connect calendar” in AskGogo once, then ask me again.',handledBy:'compound-plan' as const}
    }
    await stepState(steps[2],'running')
    await stepState(steps[2],'completed',{eventTitle,startIso})
    await stepState(steps[3],'waiting_approval')
    const preview=[
      {label:'Flight',value:found.leg.flightNo||found.leg.airline||'Saved flight'},
      {label:'Route',value:route},
      {label:'Departure',value:`${found.leg.date||found.ticket.doc_date||''} · ${found.leg.departure}`.trim()},
      {label:'Action',value:'Add flight departure to Google Calendar'},
    ]
    const {data:approval,error:approvalError}=await supabaseAdmin.from('agent_approvals').insert({
      telegram_id:String(tg),run_id:runId,action_type:'calendar_change',title:'Add saved flight to Calendar',
      description:'Gogo found the saved flight and prepared a departure event. Approve before anything is written to Google Calendar.',
      payload_preview:preview,execution_payload:{plan_type:'memory_ticket_to_calendar',eventTitle,startIso,stepId:steps[3]},risk_level:'medium',status:'pending',
    }).select('id').single()
    if(approvalError||!approval?.id)throw new Error(`travel_calendar_approval_failed:${approvalError?.message||'unknown'}`)
    await supabaseAdmin.from('agent_runs').update({
      status:'waiting_approval',summary:`Ready to add ${eventTitle} to Calendar. Waiting for your approval.`,progress:75,updated_at:new Date().toISOString(),
      metadata_json:{input_text:String(params.text).slice(0,2000),plan_type:'memory_ticket_to_calendar',target:plan.target,eventTitle,startIso,stepId:steps[3]},
    }).eq('id',runId).eq('telegram_id',String(tg))
    await activity(tg,runId,'approval_requested','Calendar approval required for the saved flight.',{approval_id:approval.id,route})
    return {runId,status:'waiting_approval' as const,capability:'calendar' as const,risk:'medium' as const,text:`I found ${route} and prepared the Calendar event. Review the flight/date/time and approve it before I add anything.`,approvalId:String(approval.id),approvalRequired:true,handledBy:'compound-plan' as const}
  }catch(err:any){
    try{
      await supabaseAdmin.from('agent_runs').update({status:'failed',summary:'Gogo could not prepare the Memory → Calendar plan.',error:String(err?.message||err).slice(0,500),completed_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',runId).eq('telegram_id',String(tg))
    }catch{}
    throw err
  }
}

export async function executeApprovedTravelCalendarPlan(params:{actor:AgentActor;runId:string}){
  const tg=params.actor.legacyTelegramId
  const {data:run,error}=await supabaseAdmin.from('agent_runs').select('id,status,metadata_json').eq('id',params.runId).eq('telegram_id',String(tg)).maybeSingle()
  if(error)throw new Error(`agent_run_read_failed:${error.message}`)
  if(!run)throw new Error('agent_run_not_found')
  const meta:any=run.metadata_json||{}
  if(meta.plan_type!=='memory_ticket_to_calendar')throw new Error('not_travel_calendar_plan')
  const {data:approval}=await supabaseAdmin.from('agent_approvals').select('id,status').eq('run_id',params.runId).eq('telegram_id',String(tg)).eq('action_type','calendar_change').order('requested_at',{ascending:false}).limit(1).maybeSingle()
  if(approval?.status!=='approved')throw new Error('approval_required')

  if(!(await calendarEnabled(tg))){
    await supabaseAdmin.from('agent_runs').update({status:'paused',summary:'Blocked by Gogo Safe Mode: Calendar is off.',updated_at:new Date().toISOString()}).eq('id',params.runId).eq('telegram_id',String(tg))
    await activity(tg,params.runId,'run_blocked','Approved Calendar action was blocked because Calendar access is off.',{reason:'calendar_permission_off'})
    return {runId:params.runId,status:'paused' as const,capability:'calendar' as const,risk:'medium' as const,text:'Calendar access is now off in Gogo Safe Mode, so I did not write the event.',blockedReason:'calendar_permission_off',handledBy:'compound-plan' as const}
  }

  const {data:claimed,error:claimError}=await supabaseAdmin.from('agent_runs').update({status:'running',progress:85,updated_at:new Date().toISOString()}).eq('id',params.runId).eq('telegram_id',String(tg)).eq('status','queued').select('id').maybeSingle()
  if(claimError)throw new Error(`agent_run_claim_failed:${claimError.message}`)
  if(!claimed)throw new Error('agent_run_already_claimed')
  if(meta.stepId)await stepState(String(meta.stepId),'running')
  try{
    const reply=await createCalendarEventAtIso(tg,String(meta.eventTitle||'Flight departure'),String(meta.startIso||''))
    if(!reply||/connect google calendar|calendar error|couldn.?t add/i.test(reply))throw new Error('calendar_create_failed')
    if(meta.stepId)await stepState(String(meta.stepId),'completed',{created:true})
    const completedAt=new Date().toISOString()
    await supabaseAdmin.from('agent_runs').update({status:'completed',summary:String(reply).slice(0,1800),progress:100,completed_at:completedAt,updated_at:completedAt}).eq('id',params.runId).eq('telegram_id',String(tg))
    await supabaseAdmin.from('agent_approvals').update({status:'executed',executed_at:completedAt}).eq('id',approval.id).eq('telegram_id',String(tg))
    await activity(tg,params.runId,'run_completed','Gogo added the approved saved flight departure to Calendar.',{handled_by:'memory_ticket_to_calendar'})
    return {runId:params.runId,status:'completed' as const,capability:'calendar' as const,risk:'medium' as const,text:reply,handledBy:'compound-plan' as const,approvalRequired:false}
  }catch(err:any){
    if(meta.stepId)try{await stepState(String(meta.stepId),'failed',{},String(err?.message||err))}catch{}
    const completedAt=new Date().toISOString()
    await supabaseAdmin.from('agent_runs').update({status:'failed',summary:'Gogo could not add the approved flight to Calendar.',error:String(err?.message||err).slice(0,500),completed_at:completedAt,updated_at:completedAt}).eq('id',params.runId).eq('telegram_id',String(tg))
    await supabaseAdmin.from('agent_approvals').update({status:'failed',resolved_at:completedAt}).eq('id',approval.id).eq('telegram_id',String(tg))
    throw err
  }
}
