import { supabaseAdmin } from '@/lib/supabase-admin'
import { normalizeTimezone, parseLocalDateTime } from '@/lib/timezone'
import { refreshAccessToken } from '@/lib/google-calendar'
import { addToListDetailed, getAllLists, getList } from '@/lib/data/lists'
import { searchWebResults, type WebSearchResult } from '@/lib/web-search'
import { redactSecretShapedText } from '@/lib/bot/memory-redaction'
import { dispatchThroughSameBrain } from './same-brain'
import { buildTravelResearchContext, curateTravelResults, isPublicTravelResearchRequest } from './travel-research'
import type { AgentActor } from './actor'

type MissionStep = { tool:string; title:string; instruction:string }

const MONTHS:Record<string,number>={
  jan:1,january:1,feb:2,february:2,mar:3,march:3,apr:4,april:4,may:5,jun:6,june:6,
  jul:7,july:7,aug:8,august:8,sep:9,sept:9,september:9,oct:10,october:10,nov:11,november:11,dec:12,december:12,
}

const DEFAULT_BUSINESS_PACKING=['Laptop','Charger','Phone charger','Power bank','ID proof','Work clothes','Undergarments','Toiletries','Notebook and pen']

function safe(value:unknown,max=1200){return redactSecretShapedText(String(value??'').replace(/\s+/g,' ').trim().slice(0,max))}
function pad(n:number){return String(n).padStart(2,'0')}

function explicitDates(text:string, defaultYear=new Date().getUTCFullYear()){
  const out:string[]=[]
  const add=(year:number,month:number,day:number)=>{
    const d=new Date(Date.UTC(year,month-1,day))
    if(d.getUTCFullYear()!==year||d.getUTCMonth()!==month-1||d.getUTCDate()!==day)return
    const iso=`${year}-${pad(month)}-${pad(day)}`
    if(!out.includes(iso))out.push(iso)
  }
  let m:RegExpExecArray|null
  const dayMonth=/\b(\d{1,2})\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:[,\s]+(20\d{2}))?/gi
  while((m=dayMonth.exec(text))){const month=MONTHS[m[2].toLowerCase()];if(month)add(Number(m[3]||defaultYear),month,Number(m[1]))}
  const monthDay=/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:[,\s]+(20\d{2}))?/gi
  while((m=monthDay.exec(text))){const month=MONTHS[m[1].toLowerCase()];if(month)add(Number(m[3]||defaultYear),month,Number(m[2]))}
  const iso=/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/g
  while((m=iso.exec(text)))add(Number(m[1]),Number(m[2]),Number(m[3]))
  const numeric=/\b(\d{1,2})[\/-](\d{1,2})[\/-](20\d{2})\b/g
  while((m=numeric.exec(text)))add(Number(m[3]),Number(m[2]),Number(m[1]))
  return out
}

function explicitDate(text:string){return explicitDates(text)[0]||null}

function to24Hour(hour:number,minute:number,ap:string){
  let h=hour
  const marker=ap.toLowerCase()
  if(marker==='pm'&&h<12)h+=12
  if(marker==='am'&&h===12)h=0
  if(h<0||h>23||minute<0||minute>59)return null
  return `${pad(h)}:${pad(minute)}`
}

export function explicitMissionClock(text:string){
  const withMinutes=text.match(/\b(\d{1,2}):(\d{2})\s*(am|pm)\b/i)
  if(withMinutes)return to24Hour(Number(withMinutes[1]),Number(withMinutes[2]),withMinutes[3])
  const hourOnly=text.match(/\b(\d{1,2})\s*(am|pm)\b/i)
  if(hourOnly)return to24Hour(Number(hourOnly[1]),0,hourOnly[2])
  return null
}

function routeText(raw:string){
  const text=String(raw||'').replace(/\s+/g,' ').trim()
  const stop='(?=\\s+(?:on|for|next|this|tomorrow|depart(?:ing|ure)?|flights?|work\\s+trip|business\\s+trip|trip|travel|only|around|at|with)\\b|[.,;]|$)'
  let m=text.match(new RegExp(`\\bfrom\\s+([A-Za-z]{3}|[A-Za-z][A-Za-z .'-]{2,28}?)\\s+to\\s+([A-Za-z]{3}|[A-Za-z][A-Za-z .'-]{2,28}?)${stop}`,'i'))
  if(!m)m=text.match(new RegExp(`\\b([A-Za-z]{3}|[A-Za-z][A-Za-z .'-]{2,28}?)\\s+to\\s+([A-Za-z]{3}|[A-Za-z][A-Za-z .'-]{2,28}?)${stop}`,'i'))
  if(!m?.[1]||!m?.[2])return text
  const origin=m[1].replace(/^(?:research|search|find|compare|check|plan)\s+/i,'').trim()
  const destination=m[2].replace(/\s+(?:work|business)\s+trip$/i,'').trim()
  const date=explicitDate(text)
  return `Search flights from ${origin} to ${destination}${date?` on ${date}`:''}`
}

function travelContext(raw:string){
  const normalized=routeText(raw)
  const context=buildTravelResearchContext(normalized)
  if(!context.startDate){
    const date=explicitDate(raw)
    if(date){context.startDate=date;context.endDate=date;context.whenLabel=date;context.searchWhen=date}
  }
  return {context,normalized}
}

function plannedDeparture(missionText:string){
  if(!/\bplanned\s+departure(?:\s+time)?\b|\bdeparture\s+time\b/i.test(missionText))return null
  const date=explicitDate(missionText)
  const time=explicitMissionClock(missionText)
  if(!date||!time)return null
  const timezone=/\bIST\b/i.test(missionText)?'Asia/Kolkata':null
  return {date,time,timezone}
}

function beforeOffset(step:MissionStep){
  const text=`${step.title} ${step.instruction}`
  let m=text.match(/\b(\d{1,3})\s*(?:-|\s)?hours?\s+(?:before|pre[- ]?departure)\b/i)
  if(m)return Number(m[1])*3600_000
  m=text.match(/\b(\d{1,3})\s*(?:-|\s)?days?\s+(?:before|pre[- ]?departure)\b/i)
  if(m)return Number(m[1])*24*3600_000
  return null
}

async function actorTimezone(actor:AgentActor){
  const {data}=await supabaseAdmin.from('users').select('timezone').eq('telegram_id',actor.legacyTelegramId).maybeSingle()
  return normalizeTimezone(String(data?.timezone||'Asia/Kolkata'))
}

function destinationLabel(missionText:string){return travelContext(missionText).context.destination?.label||'trip'}

function reminderMessage(step:MissionStep,missionText:string,hours?:number){
  const quoted=step.instruction.match(/(?:message|saying|text)\s*:?[\s]*['“\"]([^'”\"]+)['”\"]/i)?.[1]
  if(quoted)return safe(quoted,500)
  const destination=destinationLabel(missionText)
  return hours ? `${destination} trip departure in ${hours} hours — confirm packing and check-in status.` : safe(step.title,500)
}

async function persistMissionReminder(params:{actor:AgentActor;date:string;time:string;timezone:string;message:string}){
  const parsed=parseLocalDateTime({date:params.date,time:params.time,timezone:params.timezone})
  if(parsed.dueAtUtc.getTime()<=Date.now())throw new Error('mission_reminder_time_in_past')
  const dueIso=parsed.dueAtUtc.toISOString()
  const {data:candidates,error:readError}=await supabaseAdmin.from('reminders')
    .select('id,message,remind_at,timezone').eq('telegram_id',params.actor.legacyTelegramId).eq('remind_at',dueIso).eq('sent',false).limit(10)
  if(readError)throw new Error(`mission_reminder_verify_failed:${readError.message}`)
  const destination=destinationLabel(params.message).toLowerCase()
  const existing=(candidates||[]).find((r:any)=>destination==='trip'||String(r.message||'').toLowerCase().includes(destination)) || (candidates||[])[0]
  if(existing?.id)return {text:`Reminder already set for ${params.date} at ${params.time} (${params.timezone}).`,output:{reminderId:String(existing.id),message:String(existing.message||params.message),remindAt:String(existing.remind_at||dueIso),timezone:String(existing.timezone||params.timezone),reused:true,verifiedStore:'reminders'}}
  const {data,error}=await supabaseAdmin.from('reminders').insert({
    telegram_id:params.actor.legacyTelegramId,chat_id:params.actor.legacyTelegramId,whatsapp_to:params.actor.whatsappId,
    message:params.message,remind_at:dueIso,sent:false,timezone:params.timezone,
  }).select('id,message,remind_at,timezone').single()
  if(error||!data?.id||!data.remind_at)throw new Error(`mission_reminder_create_failed:${error?.message||'missing_due_time'}`)
  return {text:`Created reminder for ${params.date} at ${params.time} (${params.timezone}).`,output:{reminderId:String(data.id),message:String(data.message||params.message),remindAt:String(data.remind_at),timezone:String(data.timezone||params.timezone),reused:false,verifiedStore:'reminders'}}
}

export async function executeVerifiedMissionReminder(params:{actor:AgentActor;step:MissionStep;missionText:string;messageId?:string|number|null}){
  const {actor,step,missionText}=params
  const exactDate=explicitDate(step.instruction)
  const exactTime=explicitMissionClock(step.instruction)
  if(exactDate&&exactTime){
    const timezone=normalizeTimezone(/\bIST\b/i.test(step.instruction)?'Asia/Kolkata':await actorTimezone(actor))
    return persistMissionReminder({actor,date:exactDate,time:exactTime,timezone,message:reminderMessage(step,missionText)})
  }

  const departure=plannedDeparture(missionText)
  const offset=beforeOffset(step)
  if(departure&&offset){
    const timezone=normalizeTimezone(departure.timezone||await actorTimezone(actor))
    const parsed=parseLocalDateTime({date:departure.date,time:departure.time,timezone})
    const due=new Date(parsed.dueAtUtc.getTime()-offset)
    if(due.getTime()<=Date.now())throw new Error('mission_reminder_time_in_past')
    const hours=Math.round(offset/3600_000)
    const localDue=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(due)
    const values:Record<string,string>={};for(const p of localDue)if(p.type!=='literal')values[p.type]=p.value
    return persistMissionReminder({actor,date:`${values.year}-${values.month}-${values.day}`,time:`${values.hour}:${values.minute}`,timezone,message:reminderMessage(step,missionText,hours)})
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

function listWords(value:string){
  const stop=new Set(['create','review','update','use','or','my','existing','list','business','trip','work','the','a','an','for','and','with','without','items','existing','retrieve','find','add','missing','ensure','included'])
  return value.toLowerCase().replace(/[^a-z0-9]+/g,' ').split(/\s+/).filter(w=>w.length>2&&!stop.has(w))
}

function requestedListName(step:MissionStep,missionText:string){
  const quoted=step.instruction.match(/(?:list\s+)?(?:titled|called)\s+['“\"]([^'”\"]+)['”\"]/i)?.[1]
  if(quoted)return safe(quoted,180)
  const destination=destinationLabel(missionText)
  if(/\bpacking\b/i.test(`${step.title} ${step.instruction}`))return `${destination} work trip packing`
  return safe(step.title.replace(/^(?:create|review|update|use|retrieve|find)\s+/i,'').replace(/\blist\b/i,'').trim()||'mission list',180)
}

function itemsToEnsure(step:MissionStep,creating:boolean){
  const text=`${step.title} ${step.instruction}`
  const items:string[]=[]
  const add=(v:string)=>{if(!items.some(x=>x.toLowerCase()===v.toLowerCase()))items.push(v)}
  if(/\blaptop\b/i.test(text))add('Laptop')
  if(/\bcharger\b/i.test(text))add('Charger')
  if(/\bphone charger\b/i.test(text))add('Phone charger')
  if(/\bpower bank\b/i.test(text))add('Power bank')
  const itemClause=step.instruction.match(/\bitems?\s*:\s*([^.;]+)/i)?.[1]
  if(itemClause)itemClause.split(/,|\band\b/i).map(x=>x.trim()).filter(Boolean).forEach(add)
  if(creating&&/\bpacking\b/i.test(text)&&items.length<4)DEFAULT_BUSINESS_PACKING.forEach(add)
  return items
}

export async function executeVerifiedMissionList(params:{actor:AgentActor;step:MissionStep;missionText:string}){
  const all=await getAllLists(params.actor.legacyTelegramId)
  const text=`${params.step.title} ${params.step.instruction}`
  const words=listWords(text)
  const destination=destinationLabel(params.missionText).toLowerCase()
  const ranked=(all||[]).map((row:any)=>{
    const name=String(row.list_name||'').toLowerCase()
    let score=words.reduce((n,w)=>n+(name.includes(w)?1:0),0)
    if(/\bpacking\b/i.test(text)&&name.includes('packing'))score+=5
    if(destination!=='trip'&&name.includes(destination))score+=5
    return {row,score}
  }).filter((x:any)=>x.score>0).sort((a:any,b:any)=>b.score-a.score)
  const chosen=ranked[0]?.row||null
  const listName=chosen?.list_name||requestedListName(params.step,params.missionText)
  const ensure=itemsToEnsure(params.step,!chosen)
  if(ensure.length)await addToListDetailed(params.actor.legacyTelegramId,listName,ensure)
  const verified=await getList(params.actor.legacyTelegramId,listName)
  if(!verified?.id)throw new Error('mission_list_write_unverified')
  const items=Array.isArray(verified.items)?verified.items:[]
  return {text:`Using ${verified.list_name} with ${items.length} items.`,output:{listId:String(verified.id),listName:String(verified.list_name),itemCount:items.length,items:items.slice(0,80),reused:Boolean(chosen),verifiedStore:'lists'}}
}

function resultDatesAreInsideWindow(result:WebSearchResult,startDate?:string,endDate?:string){
  if(!startDate||!endDate)return true
  const defaultYear=Number(startDate.slice(0,4))
  const dates=explicitDates(`${result.title} ${result.snippet}`,defaultYear)
  if(!dates.length)return true
  return dates.every(date=>date>=startDate&&date<=endDate)
}

export async function executeVerifiedMissionWebSearch(step:MissionStep){
  if(!isPublicTravelResearchRequest(step.instruction)){
    const results=await searchWebResults(step.instruction)
    return {text:results.length?`Found ${results.length} public web results.`:'No useful public web results found.',output:{results:results.slice(0,5).map(r=>({title:r.title,url:r.url,snippet:r.snippet.slice(0,500)}))}}
  }
  const {context,normalized}=travelContext(step.instruction)
  const raw=await searchWebResults(normalized)
  const dateSafe=raw.filter(result=>resultDatesAreInsideWindow(result,context.startDate,context.endDate))
  const curatedBase=curateTravelResults(dateSafe,context)
  const exactDateQuery=Boolean(context.startDate&&context.endDate&&context.startDate===context.endDate)
  const curated=exactDateQuery?curatedBase.filter((r:any)=>r.dateRelevance==='matched'):curatedBase
  return {
    text:curated.length?`Found ${curated.length} direction/date-curated travel sources for ${context.routeLabel}.`:`No reliable direction/date-matched travel source was found for ${context.routeLabel}.`,
    output:{context,results:curated,verifiedCuration:'travel-research',mixedDateResultsRejected:raw.length-dateSafe.length,exactDateRequired:exactDateQuery},
  }
}

function includesAny(hay:string,values:string[]){const lower=hay.toLowerCase();return values.some(v=>v&&lower.includes(v.toLowerCase()))}

export async function executeVerifiedMissionMemory(params:{actor:AgentActor;step:MissionStep;missionText:string;messageId?:string|number|null}){
  const {context}=travelContext(params.missionText)
  const missionDate=explicitDate(params.missionText)
  if(missionDate&&!context.startDate){context.startDate=missionDate;context.endDate=missionDate}
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

function calendarTitle(step:MissionStep){
  const quoted=step.instruction.match(/(?:titled|called)\s+['“\"]([^'”\"]+)['”\"]/i)?.[1]
  if(quoted)return safe(quoted,180)
  const fromTitle=step.title.replace(/^(?:prepare|create|add|schedule)(?:\s+calendar)?\s+event(?:\s+for)?\s*/i,'').replace(/\s*\(approval required\)\s*$/i,'').trim()
  return safe(fromTitle||'AskGogo event',180)
}

function addDaysIso(iso:string,days:number){
  const d=new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate()+days)
  return d.toISOString().slice(0,10)
}

export async function executeVerifiedMissionCalendar(params:{actor:AgentActor;step:MissionStep;missionText:string;runId:string}){
  const year=Number(explicitDate(params.missionText)?.slice(0,4)||new Date().getUTCFullYear())
  let dates=explicitDates(params.step.instruction,year)
  if(dates.length<2){
    const missionDates=explicitDates(params.missionText,year)
    for(const date of missionDates)if(!dates.includes(date))dates.push(date)
  }
  const startDate=dates[0]
  const endInclusive=dates[1]||dates[0]
  if(!startDate||!endInclusive)throw new Error('mission_calendar_dates_missing')
  const endExclusive=addDaysIso(endInclusive,1)
  const title=calendarTitle(params.step)
  const location=destinationLabel(params.missionText)

  const {data:user,error:userError}=await supabaseAdmin.from('users')
    .select('google_calendar_connected,google_refresh_token').eq('telegram_id',params.actor.legacyTelegramId).maybeSingle()
  if(userError)throw new Error(`mission_calendar_user_read_failed:${userError.message}`)
  if(!user?.google_calendar_connected||!user?.google_refresh_token)throw new Error('calendar_not_connected')
  const accessToken=await refreshAccessToken(user.google_refresh_token)
  if(!accessToken)throw new Error('calendar_token_refresh_failed')

  const {data:priorSteps}=await supabaseAdmin.from('agent_steps')
    .select('tool_name,title,output_json').eq('run_id',params.runId).eq('telegram_id',String(params.actor.legacyTelegramId)).order('ordinal',{ascending:true})
  const travel=(priorSteps||[]).find((s:any)=>s.tool_name==='web_search') as any
  const travelResults=Array.isArray(travel?.output_json?.results)?travel.output_json.results.slice(0,3):[]
  const {data:artifact}=await supabaseAdmin.from('agent_artifacts')
    .select('id,title').eq('telegram_id',String(params.actor.legacyTelegramId))
    .contains('source_refs',[{type:'agent_run',id:params.runId}]).order('created_at',{ascending:false}).limit(1).maybeSingle()

  const description=[
    'Prepared by AskGogo.',
    artifact?.title?`Trip Brief: ${artifact.title} (AskGogo artifact ${artifact.id})`:null,
    travelResults.length?`Flight research: ${travelResults.map((r:any)=>safe(`${r.source||''} ${r.title||''}`,140)).join(' | ')}`:null,
    'No flight booking or payment was performed by this calendar action.',
  ].filter(Boolean).join('\n')

  const lookupParams=new URLSearchParams({
    timeMin:`${startDate}T00:00:00Z`,timeMax:`${addDaysIso(endExclusive,1)}T00:00:00Z`,singleEvents:'true',
    privateExtendedProperty:`askgogoRunId=${params.runId}`,
  })
  const lookup=await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${lookupParams}`,{headers:{Authorization:`Bearer ${accessToken}`},cache:'no-store'})
  if(lookup.ok){
    const found=await lookup.json().catch(()=>({}))
    const existing=Array.isArray(found?.items)?found.items[0]:null
    if(existing?.id)return {text:`Calendar event already exists: ${title}.`,output:{eventId:String(existing.id),title,startDate,endDate:endInclusive,location,reused:true,verifiedStore:'google-calendar'}}
  }

  const response=await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events',{
    method:'POST',headers:{Authorization:`Bearer ${accessToken}`,'Content-Type':'application/json'},
    body:JSON.stringify({
      summary:title,description,location,
      start:{date:startDate},end:{date:endExclusive},
      extendedProperties:{private:{askgogoRunId:params.runId,source:'askgogo-agent'}},
    }),
  })
  const data=await response.json().catch(()=>({}))
  if(!response.ok||!data?.id)throw new Error(`mission_calendar_create_failed:${data?.error?.message||response.status}`)
  return {text:`Added ${title} to Google Calendar for ${startDate} through ${endInclusive}.`,output:{eventId:String(data.id),htmlLink:String(data.htmlLink||''),title,startDate,endDate:endInclusive,location,reused:false,verifiedStore:'google-calendar'}}
}
