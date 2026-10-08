import { rememberTypedObjects } from '@/lib/agent/typed-object-context'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { fetchPrimaryCalendarEventsPage, refreshAccessToken } from '@/lib/google-calendar'
import { isValidTimezone, normalizeTimezone, parseLocalDateTime } from '@/lib/timezone'
import { redactSecretShapedText } from '@/lib/bot/memory-redaction'
import type { AgentActor } from './actor'

const MAX_EVENTS = 40
const MAX_SLOTS = 6

function pad(n:number){return String(n).padStart(2,'0')}
function safe(v:unknown,max=300){return redactSecretShapedText(String(v??'').replace(/\s+/g,' ').trim().slice(0,max))}
function addDays(iso:string,days:number){const d=new Date(`${iso}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10)}

function localYmd(now:Date,tz:string){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now)
  const map:Record<string,string>={};for(const p of parts)if(p.type!=='literal')map[p.type]=p.value
  return `${map.year}-${map.month}-${map.day}`
}

function explicitIsoDates(text:string){
  const out:string[]=[]
  const push=(iso:string)=>{if(/^20\d{2}-\d{2}-\d{2}$/.test(iso)&&!out.includes(iso))out.push(iso)}
  for(const m of String(text||'').matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/g))push(`${m[1]}-${m[2]}-${m[3]}`)
  return out
}

export function calendarReadWindow(text:string,now:Date,tz:string){
  const explicit=explicitIsoDates(text)
  if(explicit.length)return {startDate:explicit[0],endDate:explicit[1]||explicit[0],label:explicit.length>1?'requested dates':'requested date'}
  const today=localYmd(now,tz)
  const anchor=new Date(`${today}T00:00:00Z`)
  const day=anchor.getUTCDay()
  if(/\bnext week\b/i.test(text)){
    const daysToMonday=((8-day)%7)||7
    const start=addDays(today,daysToMonday)
    return {startDate:start,endDate:addDays(start,6),label:'next week'}
  }
  if(/\bthis week\b/i.test(text)){
    const daysToSunday=(7-day)%7
    return {startDate:today,endDate:addDays(today,daysToSunday),label:'this week'}
  }
  if(/\btoday\b/i.test(text)&&/\btomorrow\b/i.test(text))return {startDate:today,endDate:addDays(today,1),label:'today and tomorrow'}
  if(/\btomorrow\b/i.test(text)){const d=addDays(today,1);return {startDate:d,endDate:d,label:'tomorrow'}}
  if(/\btoday\b/i.test(text))return {startDate:today,endDate:today,label:'today'}
  return {startDate:today,endDate:addDays(today,6),label:'next 7 days'}
}

function requestedDurationMinutes(text:string){
  const mins=String(text||'').match(/\b(\d{1,3})\s*(?:min|mins|minute|minutes)\b/i)
  if(mins)return Math.max(15,Math.min(180,Number(mins[1])))
  const hours=String(text||'').match(/\b(\d(?:\.5)?)\s*(?:hour|hours|hr|hrs)\b/i)
  if(hours)return Math.max(30,Math.min(180,Math.round(Number(hours[1])*60)))
  return 30
}

function eventInterval(event:any,tz:string){
  if(event?.start?.dateTime&&event?.end?.dateTime){
    const start=new Date(event.start.dateTime).getTime(),end=new Date(event.end.dateTime).getTime()
    if(Number.isFinite(start)&&Number.isFinite(end)&&end>start)return {start,end,allDay:false}
  }
  if(event?.start?.date&&event?.end?.date){
    try{
      const start=parseLocalDateTime({date:String(event.start.date),time:'00:00',timezone:tz}).dueAtUtc.getTime()
      const end=parseLocalDateTime({date:String(event.end.date),time:'00:00',timezone:tz}).dueAtUtc.getTime()
      if(end>start)return {start,end,allDay:true}
    }catch{}
  }
  return null
}

function dayOfWeek(iso:string){return new Date(`${iso}T00:00:00Z`).getUTCDay()}
function overlaps(start:number,end:number,events:any[],tz:string){
    return events.some(event=>{if(event.transparency==='transparent')return false;const span=eventInterval(event,tz);return span?start<span.end&&end>span.start:false})
}
function clock(minutes:number){return `${pad(Math.floor(minutes/60))}:${pad(minutes%60)}`}

function slotLabel(startIso:string,endIso:string,tz:string){
  const fmt=new Intl.DateTimeFormat('en-IN',{timeZone:tz,weekday:'short',day:'numeric',month:'short',hour:'numeric',minute:'2-digit',hour12:true})
  const differentDay=localYmd(new Date(startIso),tz)!==localYmd(new Date(endIso),tz)
  const endFmt=new Intl.DateTimeFormat('en-IN',{timeZone:tz,...(differentDay?{weekday:'short' as const,day:'numeric' as const,month:'short' as const}:{}),hour:'numeric',minute:'2-digit',hour12:true})
  return `${fmt.format(new Date(startIso))} – ${endFmt.format(new Date(endIso))}`
}

async function calendarAccess(actor:AgentActor){
  const {data,error}=await supabaseAdmin.from('users').select('google_calendar_connected,google_refresh_token,timezone').eq('telegram_id',actor.legacyTelegramId).maybeSingle()
  if(error)throw new Error(`calendar_read_user_failed:${error.message}`)
  if(!data?.google_calendar_connected||!data?.google_refresh_token)throw new Error('calendar_not_connected')
  const timezone=normalizeTimezone(String(data.timezone||'Asia/Kolkata'))
  const accessToken=await refreshAccessToken(String(data.google_refresh_token))
  if(!accessToken)throw new Error('calendar_token_refresh_failed')
  return {accessToken,timezone}
}

export async function executeReadOnlyCalendarStep(params:{actor:AgentActor;instruction:string;missionText:string;rememberSelection?:boolean}){
  const text=`${params.instruction} ${params.missionText}`
  // Read complete identifiers. Valid slashless aliases (CET, EST5EDT, etc.)
  // are validated as candidates rather than silently replaced by account time.
  const cleanZone=(value:string)=>value.replace(/\.+$/,'')
  const labeledZone=text.match(/\b(?:time\s*zone|timezone)(?:\s*[:=]\s*|\s+(?:is\s+)?)([A-Za-z_][A-Za-z0-9_+.-]*(?:\/[A-Za-z0-9_+.-]+){0,2})/i)?.[1]
  const localZone=[...text.matchAll(/\b(?:in|using)\s+([A-Za-z_][A-Za-z0-9_+.-]*(?:\/[A-Za-z0-9_+.-]+){0,2})/gi)]
    .map(match=>cleanZone(match[1])).find(value=>value.includes('/')||isValidTimezone(value))
  const parenthesizedZone=[...text.matchAll(/\(([A-Za-z_][A-Za-z0-9_+.-]*(?:\/[A-Za-z0-9_+.-]+){0,2})\)/g)]
    .map(match=>cleanZone(match[1])).find(isValidTimezone)
  const requestedZone=cleanZone(labeledZone||localZone||parenthesizedZone||'')||undefined
  if(requestedZone&&!isValidTimezone(requestedZone))throw new Error('calendar_timezone_invalid')
  const access=await calendarAccess(params.actor)
  const timezone=requestedZone?normalizeTimezone(requestedZone):access.timezone
  const window=calendarReadWindow(text,new Date(),timezone)
  const start=parseLocalDateTime({date:window.startDate,time:'00:00',timezone}).dueAtUtc
  const end=parseLocalDateTime({date:addDays(window.endDate,1),time:'00:00',timezone}).dueAtUtc
  const page=await fetchPrimaryCalendarEventsPage(access.accessToken,start.toISOString(),end.toISOString(),'AGENT_CALENDAR_READ_FAILED',MAX_EVENTS)
  const events=page.events.filter((event:any)=>event.status!=='cancelled')
  const complete=!page.hasMore
  const busyEvents=events.filter((event:any)=>event.transparency!=='transparent')
  const unknownIntervals=busyEvents.filter((event:any)=>!eventInterval(event,timezone)).length

  const availabilityCommand=/\b(?:find|show|list|check|suggest|pick|choose|get|review|look\s+for|search\s+for)\s+(?:(?:me|the|a|an|some|any|my|calendar|free|available|open|\d+[- ]minutes?)\s+)*(?:slots?|time|gaps?|availability)\b/i
  const availabilityQuestion=/\b(?:when\s+)?(?:am\s+i|are\s+we|is\s+my\s+calendar)\s+(?:free|available)\b|\bwhat(?:'s|\s+is)\s+my\s+availability\b|\b(?:is|are)\s+there\s+(?:(?:any|a|an|some)\s+)?(?:free|available|open)\s+(?:time|slots?|gaps?)\b|\b(?:i|we)\s+have\s+(?:(?:any|a|an|some)\s+)?(?:free|available|open)\s+(?:time|slots?|gaps?)\b/i
  const wantsAvailability=availabilityCommand.test(text)||availabilityQuestion.test(text)
  if(!wantsAvailability){
    const items=events.slice(0,12).map((event:any)=>({
      id:safe(event?.id||'',160),summary:safe(event?.summary||'Busy',220),start:String(event?.start?.dateTime||event?.start?.date||''),end:String(event?.end?.dateTime||event?.end?.date||''),
      label:eventInterval(event,timezone)?.allDay?`All day · ${event.start.date} (end ${event.end.date} exclusive)`:
        eventInterval(event,timezone)?slotLabel(event.start.dateTime,event.end.dateTime,timezone):`${event.start?.dateTime||event.start?.date||'Start not verified'} · end time not verified`,
    }))
    if(params.rememberSelection)await rememberTypedObjects(params.actor.legacyTelegramId,'calendar',items.map(e=>({id:e.id,title:e.summary}))).catch(()=>{})
    const lines=[`Calendar ${window.label} (${timezone}):`,items.length?items.map((e:any,i:number)=>`${i+1}. ${e.summary} — ${e.label}`).join('\n'):
      complete?`No calendar events found for ${window.label}.`:'No events returned on this partial calendar page.']
    if(events.length>items.length)lines.push(`Showing ${items.length} of ${events.length} returned events.`)
    if(!complete)lines.push('Partial calendar page; more events are available. This is not the full schedule.')
    const conflicts:Array<{first:string;second:string}>=[]
    const wantsConflicts=/\b(overlap|overlapping|conflicts?|clash|double[- ]booked)\b/i.test(text)
    if(wantsConflicts){
      for(let i=0;i<busyEvents.length;i++)for(let j=i+1;j<busyEvents.length;j++){
        const a=eventInterval(busyEvents[i],timezone),b=eventInterval(busyEvents[j],timezone)
        if(a&&b&&a.start<b.end&&a.end>b.start)conflicts.push({first:safe(busyEvents[i].summary||'Busy',220),second:safe(busyEvents[j].summary||'Busy',220)})
      }
      for(const pair of conflicts.slice(0,6))lines.push(`Overlap: ${pair.first} ↔ ${pair.second}.`)
      if(conflicts.length>6)lines.push(`Showing 6 of ${conflicts.length} observed overlapping pairs.`)
      if(!complete||unknownIntervals)lines.push('Overlap review is incomplete: more events or unverified event end times remain.')
      else if(!conflicts.length)lines.push('No overlapping events found in this calendar window.')
    }
    return {text:lines.join('\n'),output:{mode:'read',window,timezone,events:items,complete,unknownIntervals,conflicts,...(wantsConflicts?{conflictsVerified:complete&&unknownIntervals===0}:{}),verifiedStore:'google-calendar',mutated:false}}
  }

  const duration=requestedDurationMinutes(text)
  if(!complete||unknownIntervals)throw Object.assign(new Error('calendar_availability_unverified'),{timezone,window})
  const slots:Array<{start:string;end:string;label:string}>=[]
  for(let date=window.startDate;date<=window.endDate&&slots.length<MAX_SLOTS;date=addDays(date,1)){
    const weekday=dayOfWeek(date)
    if(weekday===0||weekday===6)continue
    for(let minute=9*60;minute+duration<=18*60&&slots.length<MAX_SLOTS;minute+=30){
      const localStart=parseLocalDateTime({date,time:clock(minute),timezone}).dueAtUtc
      const localEnd=new Date(localStart.getTime()+duration*60_000)
      if(localStart.getTime()<Date.now()+15*60_000)continue
      if(overlaps(localStart.getTime(),localEnd.getTime(),events,timezone))continue
      slots.push({start:localStart.toISOString(),end:localEnd.toISOString(),label:slotLabel(localStart.toISOString(),localEnd.toISOString(),timezone)})
    }
  }

  const display=slots.length
    ? `I found these ${duration}-minute free slots in ${window.label}:\n${slots.map((s,i)=>`${i+1}. ${s.label}`).join('\n')}`
    : `I couldn't find a ${duration}-minute weekday slot between 9 AM and 6 PM in ${window.label}.`
  return {text:display,output:{mode:'availability',durationMinutes:duration,window,timezone,availableSlots:slots,complete,availabilityVerified:true,verifiedStore:'google-calendar',mutated:false}}
}
