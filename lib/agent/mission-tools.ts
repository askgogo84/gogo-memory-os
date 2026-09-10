import { supabaseAdmin } from '@/lib/supabase-admin'
import { normalizeTimezone, parseLocalDateTime } from '@/lib/timezone'
import { searchWebResults } from '@/lib/web-search'
import { redactSecretShapedText } from '@/lib/bot/memory-redaction'
import { dispatchThroughSameBrain } from './same-brain'
import { buildTravelResearchContext, curateTravelResults, isPublicTravelResearchRequest } from './travel-research'
import type { AgentActor } from './actor'

type MissionStep = { tool:string; title:string; instruction:string }

const MONTHS:Record<string,number>={
  jan:1,january:1,feb:2,february:2,mar:3,march:3,apr:4,april:4,may:5,jun:6,june:6,
  jul:7,july:7,aug:8,august:8,sep:9,sept:9,september:9,oct:10,october:10,nov:11,november:11,dec:12,december:12,
}

function safe(value:unknown,max=1200){return redactSecretShapedText(String(value??'').replace(/\s+/g,' ').trim().slice(0,max))}
function pad(n:number){return String(n).padStart(2,'0')}

function explicitDate(text:string){
  let m=text.match(/\b(\d{1,2})\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(20\d{2})\b/i)
  if(m){const month=MONTHS[m[2].toLowerCase()];if(month)return `${m[3]}-${pad(month)}-${pad(Number(m[1]))}`}
  m=text.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/)
  if(m)return `${m[1]}-${pad(Number(m[2]))}-${pad(Number(m[3]))}`
  return null
}

function explicitClock(text:string){
  const m=text.match(/\b(\d{1,2})(?::(\d{2}))\s*(am|pm)\b/i) || text.match(/\b(\d{1,2})\s*(am|pm)\b/i)
  if(!m)return null
  if(m.length>=4)return `${m[1]}:${m[2]} ${m[3].toUpperCase()}`
  return `${m[1]}:00 ${m[2].toUpperCase()}`
}

function plannedDeparture(missionText:string){
  if(!/\bplanned\s+departure(?:\s+time)?\b|\bdeparture\s+time\b/i.test(missionText))return null
  const date=explicitDate(missionText)
  const time=explicitClock(missionText)
  if(!date||!time)return null
  const timezone=/\bIST\b/i.test(missionText)?'Asia/Kolkata':null
  return {date,time,timezone}
}

function beforeOffset(step:MissionStep){
  const text=`${step.title} ${step.instruction}`
  let m=text.match(/\b(\d{1,3})\s*hours?\s+before\b/i)
  if(m)return Number(m[1])*3600_000
  m=text.match(/\b(\d{1,3})\s*days?\s+before\b/i)
  if(m)return Number(m[1])*24*3600_000
  return null
}

async function actorTimezone(actor:AgentActor){
  const {data}=await supabaseAdmin.from('users').select('timezone').eq('telegram_id',actor.legacyTelegramId).maybeSingle()
  return normalizeTimezone(String(data?.timezone||'Asia/Kolkata'))
}

function destinationLabel(missionText:string){
  const c=buildTravelResearchContext(missionText)
  return c.destination?.label||'trip'
}

export async function executeVerifiedMissionReminder(params:{actor:AgentActor;step:MissionStep;missionText:string;messageId?:string|number|null}){
  const {actor,step,missionText}=params
  const departure=plannedDeparture(missionText)
  const offset=beforeOffset(step)
  if(departure&&offset){
    const timezone=normalizeTimezone(departure.timezone||await actorTimezone(actor))
    const parsed=parseLocalDateTime({date:departure.date,time:departure.time,timezone})
    const due=new Date(parsed.dueAtUtc.getTime()-offset)
    if(due.getTime()<=Date.now())throw new Error('mission_reminder_time_in_past')
    const hours=Math.round(offset/3600_000)
    const destination=destinationLabel(missionText)
    const message=`${destination} trip departure in ${hours} hours — confirm packing and check-in status.`
    const dueIso=due.toISOString()
    const {data:existing,error:readError}=await supabaseAdmin.from('reminders')
      .select('id,message,remind_at').eq('telegram_id',actor.legacyTelegramId).eq('message',message).eq('remind_at',dueIso).limit(1).maybeSingle()
    if(readError)throw new Error(`mission_reminder_verify_failed:${readError.message}`)
    if(existing?.id)return {text:`Reminder already set for ${departure.date} ${departure.time} minus ${hours} hours.`,output:{reminderId:String(existing.id),message,remindAt:dueIso,timezone,reused:true,verifiedStore:'reminders'}}
    const {data,error}=await supabaseAdmin.from('reminders').insert({
      telegram_id:actor.legacyTelegramId,chat_id:actor.legacyTelegramId,whatsapp_to:actor.whatsappId,
      message,remind_at:dueIso,sent:false,timezone,
    }).select('id,message,remind_at').single()
    if(error||!data?.id||!data.remind_at)throw new Error(`mission_reminder_create_failed:${error?.message||'missing_due_time'}`)
    return {text:`Created reminder for ${dueIso} (${timezone}).`,output:{reminderId:String(data.id),message:String(data.message||message),remindAt:String(data.remind_at),timezone,reused:false,verifiedStore:'reminders'}}
  }

  const startedAt=new Date().toISOString()
  const result=await dispatchThroughSameBrain({actor,text:step.instruction,messageId:params.messageId})
  const {data,error}=await supabaseAdmin.from('reminders').select('id,message,remind_at,timezone,created_at')
    .eq('telegram_id',actor.legacyTelegramId).gte('created_at',startedAt).order('created_at',{ascending:false}).limit(1).maybeSingle()
  if(error)throw new Error(`mission_reminder_verify_failed:${error.message}`)
  const due=data?.remind_at?new Date(data.remind_at):null
  if(!data?.id||!due||!Number.isFinite(due.getTime())||due.getTime()<=Date.now())throw new Error('mission_reminder_write_unverified')
  return {text:result.text,output:{reminderId:String(data.id),message:String(data.message||''),remindAt:String(data.remind_at),timezone:String(data.timezone||''),verifiedStore:'reminders',handledBy:result.handledBy}}
}

export async function executeVerifiedMissionWebSearch(step:MissionStep){
  const results=await searchWebResults(step.instruction)
  if(!isPublicTravelResearchRequest(step.instruction)){
    return {text:results.length?`Found ${results.length} public web results.`:'No useful public web results found.',output:{results:results.slice(0,5).map(r=>({title:r.title,url:r.url,snippet:r.snippet.slice(0,500)}))}}
  }
  const context=buildTravelResearchContext(step.instruction)
  if(!context.startDate){
    const date=explicitDate(step.instruction)
    if(date){context.startDate=date;context.endDate=date;context.whenLabel=date;context.searchWhen=date}
  }
  const curated=curateTravelResults(results,context)
  return {
    text:curated.length?`Found ${curated.length} direction/date-curated travel sources for ${context.routeLabel}.`:`No reliable direction/date-matched travel source was found for ${context.routeLabel}.`,
    output:{context,results:curated,verifiedCuration:'travel-research'},
  }
}

function includesAny(hay:string,values:string[]){const lower=hay.toLowerCase();return values.some(v=>v&&lower.includes(v.toLowerCase()))}

export async function executeVerifiedMissionMemory(params:{actor:AgentActor;step:MissionStep;missionText:string;messageId?:string|number|null}){
  const context=buildTravelResearchContext(params.missionText)
  const travelMission=context.kind==='flight'&&context.origin&&context.destination&&/\b(flight|trip|travel|mumbai|bengaluru|bangalore)\b/i.test(params.missionText)
  if(travelMission){
    const {data,error}=await supabaseAdmin.from('documents').select('id,title,summary,extracted,doc_date,created_at')
      .eq('telegram_id',params.actor.legacyTelegramId).eq('doc_type','ticket').order('created_at',{ascending:false}).limit(40)
    if(error)throw new Error(`mission_memory_read_failed:${error.message}`)
    const originTerms=[context.origin!.label,context.origin!.code||'',...context.origin!.aliases]
    const destTerms=[context.destination!.label,context.destination!.code||'',...context.destination!.aliases]
    for(const doc of data||[]){
      const flights=Array.isArray((doc as any)?.extracted?.flights)?(doc as any).extracted.flights:[]
      for(const leg of flights){
        const from=String(leg?.from||'');const to=String(leg?.to||'')
        if(!includesAny(from,originTerms)||!includesAny(to,destTerms))continue
        const date=explicitDate(String(leg?.date||doc.doc_date||''))
        if(context.startDate&&context.endDate&&date&&(date<context.startDate||date>context.endDate))continue
        return {text:'Found a saved travel item that matches this mission.',output:{found:true,documentId:String(doc.id),title:safe(doc.title||'Saved travel item',180),summary:safe(doc.summary||'',600),matchedRoute:context.routeLabel,verifiedRelevance:true}}
      }
    }
    return {text:'No saved flight matched this mission’s route/date. Continuing without an old ticket.',output:{found:false,matchedRoute:context.routeLabel,verifiedRelevance:true}}
  }
  const result=await dispatchThroughSameBrain({actor:params.actor,text:params.step.instruction,messageId:params.messageId})
  return {text:result.text,output:{reply:String(result.text||'').slice(0,3500),handledBy:result.handledBy}}
}
