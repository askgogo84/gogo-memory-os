import { rememberTypedObjects } from '@/lib/agent/typed-object-context'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { fetchPrimaryCalendarEventsPage, refreshAccessToken } from '@/lib/google-calendar'
import { isValidTimezone, normalizeTimezone, parseLocalDateTime } from '@/lib/timezone'
import { redactSecretShapedText } from '@/lib/bot/memory-redaction'
import type { AgentActor } from './actor'

const MAX_EVENTS = 40
const MAX_SLOTS = 6
const WEEKDAYS = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday']
const WEEKDAY_PATTERN = /\b(?:(next|this)\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/gi

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
  const push=(iso:string)=>{
    const [year,month,day]=iso.split('-').map(Number)
    if(new Date(Date.UTC(year,month-1,day)).toISOString().slice(0,10)!==iso)throw new Error('calendar_date_unsupported')
    if(!out.includes(iso))out.push(iso)
  }
  for(const m of String(text||'').matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/g))push(`${m[1]}-${m[2]}-${m[3]}`)
  return out
}

function calendarActionText(text:string){
  // Email lookup dates, clocks, zones and durations belong to source context.
  let action=calendarAffirmativeText(text.replace(/\b([ap])\.m\./gi,'$1m'))
    .replace(/\b(?:read|review|find|search|check|show)\b[^.;\n]*?\b(?:email|gmail|mail|inbox)\b[^.;\n]*?(?=(?:\s+(?:and|then)\s+|[.;,]\s*|\n\s*)(?:please\s+)?(?:prepare|propose|schedule|arrange|draft)\b)/gi,'')
  action=action.replace(/\babout(?=\s+(?:\d{1,2}(?::\d{2})?\s*[ap]m|\d{1,2}:\d{2}|noon|midnight)\b)/gi,'around')
  // A launch time or outage duration in the meeting topic is not a scheduling
  // constraint. Preserve a following sentence containing explicit instructions.
  if(!/\b(?:meeting|appointment|slots?|availability)\b/i.test(action))return action
  return action.replace(/\b(?:to discuss|discussing|about|regarding|concerning|titled|named|called)\s+[^;!?\n]*?(?=\.(?:\s|$)|[;!?\n]|\b(?:but|then)\b|\b(?:(?:on\s+)?(?:today|tomorrow)|(?:next|this|on)\s+(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday|week|weekend|month|year)|on\s+20\d{2}-\d{2}-\d{2}|(?:at|before|after|around)\s+(?:\d{1,2}(?::\d{2})?(?:\s*[ap]m)?|noon|midnight)|(?:for|lasting)\s+(?:(?:\d+(?:\.\d+)?|an?|one|two|three|four|five|six|seven|eight|nine|ten|and|half|quarter)[\s-]+)+(?:hours?|hrs?|minutes?|mins?)|(?:in|using)\s+(?:[A-Za-z_]+\/[A-Za-z0-9_+.\/-]+|UTC|GMT|IST|CET|EET|WET|EST5EDT|CST6CDT|MST7MDT|PST8PDT)|time\s*zone)\b|$)/gi,'')
}

function calendarRangeText(text:string){
  text=calendarActionText(text)
  for(const filter of text.matchAll(/\b(?:for|about|titled|named|called|to discuss|discussing)\s+/gi)){
    const prefix=text.slice(0,filter.index)
    if(!/\b(?:today|tomorrow|(?:this|next) week|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i.test(prefix)&&!explicitIsoDates(prefix).length)continue
    const value=text.slice(filter.index!+filter[0].length)
    // "for tomorrow" and "for 2026-10-10" are range clauses, not titles.
    if(/^(?:today|tomorrow|(?:this|next) week|(?:(?:this|next)\s+)?(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)|20\d{2}-\d{2}-\d{2}|\d+(?:\.5)?[\s-]*(?:hours?|hrs?|minutes?|mins?))\b/i.test(value))continue
    return prefix
  }
  return text
}

export function calendarRequestsAvailability(text:string){
  const availabilityCommand=/\b(?:find|show|list|check|suggest|pick|choose|get|review|look\s+for|search\s+for)\s+(?:(?:for|me|the|a|an|some|any|my|calendar|free|available|open|(?:\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten)[- ](?:minutes?|mins?|hours?|hrs?))\s+)*(?:slots?|time|gaps?|availability)\b/i
  const availabilityQuestion=/\b(?:when\s+)?(?:am\s+i|are\s+we|is\s+my\s+calendar)\s+(?:free|available)\b|\bwhat(?:'s|\s+is)\s+my\s+availability\b|\b(?:is|are)\s+there\s+(?:(?:any|a|an|some)\s+)?(?:free|available|open)\s+(?:time|slots?|gaps?)\b|\b(?:i|we)\s+have\s+(?:(?:any|a|an|some)\s+)?(?:free|available|open)\s+(?:time|slots?|gaps?)\b/i
  return availabilityCommand.test(text)||availabilityQuestion.test(text)||/\b(?:if|whether)\s+(?:i\s+am|i'm|we\s+are|we're|my\s+calendar\s+is)\s+(?:free|available)\b/i.test(text)
}

export function calendarAffirmativeText(text:string){
  return text.replace(/’/g,"'")
    .replace(/\b(?:do not|don't|dont)\s+forget\s+to\s+/gi,'')
    .replace(/\b(?:do not|don't|dont|without)\s+[^.;!?\n]*?(?=[.;!?\n]|\b(?:but|then)\b|$)/gi,clause=>{
    const next=clause.match(/(?:,\s*(?:just|please|instead)\s+|,\s*(?=(?:show|list|check|review|find|read|tell|summari[sz]e|brief)\b)|,\s*and\s+(?:(?:instead|please)\s+)?|\band\s+(?:instead|please)\s+|\band\s+(?=(?:show|list|check|review|find|read|tell|summari[sz]e|brief|open|browse|navigate|go to|visit|inspect|monitor|watch|track|schedule|create|add|edit|delete|move|change|modify|prepare|invite|cancel|write|reply|respond|email|draft|call|submit|checkout|subscribe|unsubscribe|share|follow|unfollow|like|comment|confirm|place|order|reorder|empty|increase|decrease|apply|redeem|block|unblock|reserve|remind|put|set|forward|save|remember|compose|archive|post|publish|renew|reschedule|resched|postpone|push|shift|update|make|remove|clear|book|send|pay|buy|purchase)\b))/i)
    if(next?.index===undefined)return ''
    const prohibited=clause.slice(0,next.index).replace(/^(?:do not|don't|dont|without)\s+/i,'')
    // A coordinated bare verb list keeps the prohibition across an Oxford comma.
    if(/^\w+(?:\s*(?:,|and|or)\s*\w+)*\s*$/i.test(prohibited)&&! /\b(?:just|please|instead)\b/i.test(next[0]))return ''
    return clause.slice(next.index)
  })
}

export function requestedCalendarDays(text:string){
  // Corrective references exclude a day rather than expanding the read window.
  const range=calendarRangeText(text)
  const requested=range.replace(/\b(?:not|except|excluding|rather than|instead of)\s+(?:on\s+)?(?:today|tomorrow)(?:\s*(?:or|and)\s+(?:today|tomorrow))?/gi,'')
  return {today:/\btoday\b/i.test(requested),tomorrow:/\btomorrow\b/i.test(requested)}
}

export function calendarReadWindow(text:string,now:Date,tz:string){
  text=calendarRangeText(text)
  const explicit=explicitIsoDates(text)
  if(explicit.length>2||(explicit.length===2&&explicit[1]<explicit[0]))throw new Error('calendar_date_ambiguous')
  if(explicit.length)return {startDate:explicit[0],endDate:explicit[1]||explicit[0],label:explicit.length>1?'requested dates':'requested date'}
  const today=localYmd(now,tz)
  const anchor=new Date(`${today}T00:00:00Z`)
  const day=anchor.getUTCDay()
  // A date-like request we cannot resolve must not become an arbitrary slot
  // within the default week. The caller can ask for an exact calendar date.
  if(/\b(?:(?:next|this|last)\s+(?:weekend|month|year)|last\s+(?:week|sunday|monday|tuesday|wednesday|thursday|friday|saturday)|in\s+(?:\d+|an?|one|two|three|four|five|six|seven|eight|nine|ten|a few|a couple of|several)\s+(?:days?|weeks?|months?))\b|\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d|\b\d{1,2}(?:st|nd|rd|th)?\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i.test(text))throw new Error('calendar_date_unsupported')
  if(/\b(?:day after tomorrow|(?:\d+|an?|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:days?|weeks?|months?)\s+(?:from|after)\s+(?:now|today))\b/i.test(text))throw new Error('calendar_date_unsupported')
  const weekdayRequests=[...text.matchAll(WEEKDAY_PATTERN)]
  if(weekdayRequests.length){
    const namedDays=new Set(weekdayRequests.map(match=>match[2].toLowerCase()))
    const relative=requestedCalendarDays(text)
    if(namedDays.size!==1||relative.today||relative.tomorrow)throw new Error('calendar_date_ambiguous')
    const weekday=WEEKDAYS.indexOf(weekdayRequests[0][2].toLowerCase())
    const qualifiers=new Set(weekdayRequests.map(match=>(match[1]||'').toLowerCase()))
    if(qualifiers.size>1)throw new Error('calendar_date_ambiguous')
    let offset=(weekday-day+7)%7
    if(/\bnext week\b/i.test(text))offset=(((8-day)%7)||7)+(weekday+6)%7
    else if(qualifiers.has('this')||/\bthis week\b/i.test(text))offset=(weekday+6)%7-(day+6)%7
    else if(qualifiers.has('next')&&offset===0)offset=7
    const requested=addDays(today,offset)
    return {startDate:requested,endDate:requested,label:`${weekdayRequests[0][2]} ${requested}`}
  }
  if(/\bnext week\b/i.test(text)){
    const daysToMonday=((8-day)%7)||7
    const start=addDays(today,daysToMonday)
    return {startDate:start,endDate:addDays(start,6),label:'next week'}
  }
  if(/\bthis week\b/i.test(text)){
    const daysToSunday=(7-day)%7
    return {startDate:today,endDate:addDays(today,daysToSunday),label:'this week'}
  }
  const requestedDays=requestedCalendarDays(text)
  if(requestedDays.today&&requestedDays.tomorrow)return {startDate:today,endDate:addDays(today,1),label:'today and tomorrow'}
  if(requestedDays.tomorrow){const d=addDays(today,1);return {startDate:d,endDate:d,label:'tomorrow'}}
  if(requestedDays.today)return {startDate:today,endDate:today,label:'today'}
  return {startDate:today,endDate:addDays(today,6),label:'next 7 days'}
}

function requestedDurationMinutes(text:string){
  const durations=new Set<number>()
  const words:Record<string,number>={a:1,an:1,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,half:0.5,quarter:0.25}
  const amountPattern='(?:\\d+(?:\\.\\d+)?|an?|one|two|three|four|five|six|seven|eight|nine|ten)'
  const quantity=(amount:string)=>words[amount.toLowerCase()]??Number(amount)
  const beforeUnit=new RegExp(`\\b(${amountPattern})\\s+and\\s+(?:a\\s+)?(half|quarter)\\s+(hours?|hrs?|minutes?|mins?)\\b`,'gi')
  const afterUnit=new RegExp(`\\b(${amountPattern})[\\s-]+(hours?|hrs?|minutes?|mins?)\\s+and\\s+(?:a\\s+)?(half|quarter)\\b`,'gi')
  text=text.replace(beforeUnit,(_,amount,fraction,unit)=>`${quantity(amount)+words[fraction.toLowerCase()]} ${unit}`)
    .replace(afterUnit,(_,amount,unit,fraction)=>`${quantity(amount)+words[fraction.toLowerCase()]} ${unit}`)
  // Unrecognized fractional grammar must not become a shorter appointment.
  if(/\b(?:and\s+(?:an?\s+)?(?:half|quarter)|(?:half|quarter)\s+of)\b/i.test(text))throw new Error('calendar_duration_unsupported')
  for(const match of text.matchAll(/(?<![\w.-])(\d+(?:\.\d+)?|\.\d+|(?:half|quarter)(?:[ -]+an?)?|an?|one|two|three|four|five|six|seven|eight|nine|ten)[\s-]*(minutes?|mins?|hours?|hrs?)\b/gi)){
    const amount=match[1].toLowerCase().split(/[ -]/)[0]
    const minutes=(words[amount]??Number(amount))*(/^h/i.test(match[2])?60:1)
    if(!Number.isInteger(minutes)||minutes<15||minutes>180)throw new Error('calendar_duration_unsupported')
    durations.add(minutes)
  }
  if(durations.size>1||(!durations.size&&/\b(?:minutes?|mins?|hours?|hrs?)\b/i.test(text)))throw new Error('calendar_duration_unsupported')
  return durations.values().next().value??30
}

function requestedStartMinute(text:string):number|undefined{
  // Unsupported windows require clarification; never substitute the first
  // working-hours slot for a time the user actually specified.
  if(/\b(?:before|after|between|from|until|around|by)\s+(?:\d|noon|midnight)|\b(?:morning|afternoon|evening|tonight)\b/i.test(text))throw new Error('calendar_time_unsupported')
  const times=new Set<number>()
  const pattern=/\b(?:at\s+)?(noon|midnight|\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?))(?=\s|[.,;!?]|$)|\b(?:at\s+)?(\d{1,2}):(\d{2})\b|\bat\s+(\d{1,2})\b/gi
  for(const match of text.matchAll(pattern)){
    const value=(match[1]||'').toLowerCase().replace(/[.\s]/g,'')
    if(value==='noon'){times.add(720);continue}
    if(value==='midnight'){times.add(0);continue}
    if(value){
      const parts=value.match(/^(\d{1,2})(?::(\d{2}))?([ap])m$/)!
      const hour=Number(parts[1]),minute=Number(parts[2]||0)
      if(hour<1||hour>12||minute>59)throw new Error('calendar_time_unsupported')
      times.add((hour%12+(parts[3]==='p'?12:0))*60+minute)
    }else{
      if(match[4]!==undefined)throw new Error('calendar_time_unsupported')
      const hour=Number(match[2]),minute=Number(match[3]||0)
      if(match[3]===undefined||hour>23||minute>59)throw new Error('calendar_time_unsupported')
      times.add(hour*60+minute)
    }
  }
  if(times.size>1)throw new Error('calendar_time_unsupported')
  return times.values().next().value
}

function eventInterval(event:any,tz:string){
  if(event?.endTimeUnspecified===true)return null
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
function ambiguousLocalTime(instant:Date,date:string,time:string,timezone:string){
  const wallUtc=Date.parse(`${date}T${time}:00Z`)
  const clockFormat=new Intl.DateTimeFormat('en-GB',{timeZone:timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'})
  const candidates=new Set<number>()
  // Probe the offsets on either side of a transition, including non-hour
  // changes. Both matching instants are possible during a repeated wall time.
  for(const days of [-2,-1,0,1,2]){
    const probe=new Date(instant.getTime()+days*86_400_000)
    const probeWall=Date.parse(`${localYmd(probe,timezone)}T${clockFormat.format(probe)}:00Z`)
    const candidate=new Date(wallUtc-(probeWall-probe.getTime()))
    if(localYmd(candidate,timezone)===date&&clockFormat.format(candidate)===time)candidates.add(candidate.getTime())
  }
  return candidates.size>1
}
function blocksCalendarTime(event:any){
  return event.transparency!=='transparent'&&!(Array.isArray(event.attendees)&&event.attendees.some((attendee:any)=>attendee.self===true&&attendee.responseStatus==='declined'))
}
function overlaps(start:number,end:number,events:any[],tz:string){
    return events.some(event=>{if(!blocksCalendarTime(event))return false;const span=eventInterval(event,tz);return span?start<span.end&&end>span.start:false})
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

export function requestedCalendarTimezone(text:string){
  text=calendarActionText(text)
  // Read complete identifiers. Valid slashless aliases (CET, EST5EDT, etc.)
  // are validated as candidates rather than silently replaced by account time.
  const cleanZone=(value:string)=>value.replace(/\.+$/,'')
  const labeledZone=text.match(/\b(?:time\s*zone|timezone)(?:\s*[:=]\s*|\s+(?:is\s+)?)([A-Za-z_][A-Za-z0-9_+.-]*(?:\/[A-Za-z0-9_+.-]+){0,2})/i)?.[1]
  const clockZone=[...text.matchAll(/\b(?:\d{1,2}:\d{2}(?:\s*[ap]\.?m\.?)?|\d{1,2}\s*[ap]\.?m\.?|noon|midnight)\s+([A-Za-z_][A-Za-z0-9_+.-]*(?:\/[A-Za-z0-9_+.-]+){0,2})/gi)]
    .map(match=>cleanZone(match[1])).find(value=>value.includes('/')||isValidTimezone(value))
  const explicitSuffixZone=[...text.matchAll(/\b(?:in|using)\s+([A-Za-z_][A-Za-z0-9_+.-]*(?:\/[A-Za-z0-9_+.-]+){0,2})/gi)]
    .map(match=>cleanZone(match[1])).find(value=>value.includes('/')||/^(?:UTC|GMT|CET|EET|WET|EST5EDT|CST6CDT|MST7MDT|PST8PDT)$/.test(value))
  const zoneContext=calendarRangeText(text).split(/\b(?:for\s+the|about|titled|named|called)\s+/i)[0]
  const localZone=[...zoneContext.matchAll(/\b(?:in|using)\s+([A-Za-z_][A-Za-z0-9_+.-]*(?:\/[A-Za-z0-9_+.-]+){0,2})/gi)]
    .map(match=>cleanZone(match[1])).find(value=>value.includes('/')||isValidTimezone(value))
  const parenthesizedZone=[...text.matchAll(/\(([A-Za-z_][A-Za-z0-9_+.-]*(?:\/[A-Za-z0-9_+.-]+){0,2})\)/g)]
    .map(match=>cleanZone(match[1])).find(isValidTimezone)
  const requestedZone=cleanZone(labeledZone||clockZone||explicitSuffixZone||localZone||parenthesizedZone||'')||undefined
  if(requestedZone&&!isValidTimezone(requestedZone))throw new Error('calendar_timezone_invalid')
  return requestedZone
}

export async function executeReadOnlyCalendarStep(params:{actor:AgentActor;instruction:string;missionText:string;rememberSelection?:boolean}){
  const text=calendarActionText(`${params.instruction} ${params.missionText}`)
  const requestedZone=requestedCalendarTimezone(text)
  const access=await calendarAccess(params.actor)
  const timezone=requestedZone?normalizeTimezone(requestedZone):access.timezone
  const window=calendarReadWindow(text,new Date(),timezone)
  const wantsAvailability=calendarRequestsAvailability(text)
  const duration=wantsAvailability?requestedDurationMinutes(text):30
  const requestedMinute=wantsAvailability?requestedStartMinute(text):undefined
  if(requestedMinute!==undefined&&requestedMinute+duration>1440)throw new Error('calendar_time_unsupported')
  const start=parseLocalDateTime({date:window.startDate,time:'00:00',timezone}).dueAtUtc
  const end=parseLocalDateTime({date:addDays(window.endDate,1),time:'00:00',timezone}).dueAtUtc
  const page=await fetchPrimaryCalendarEventsPage(access.accessToken,start.toISOString(),end.toISOString(),'AGENT_CALENDAR_READ_FAILED',MAX_EVENTS)
  const events=page.events.filter((event:any)=>event.status!=='cancelled')
  const complete=!page.hasMore
  const busyEvents=events.filter(blocksCalendarTime)
  const unknownIntervals=busyEvents.filter((event:any)=>!eventInterval(event,timezone)).length

  if(!wantsAvailability){
    const items=events.slice(0,12).map((event:any)=>({
      id:safe(event?.id||'',160),summary:safe(event?.summary||'Busy',220),start:String(event?.start?.dateTime||event?.start?.date||''),end:event?.endTimeUnspecified===true?'':String(event?.end?.dateTime||event?.end?.date||''),
      label:eventInterval(event,timezone)?.allDay?`All day · ${event.start.date} (end ${event.end.date} exclusive)`:
        eventInterval(event,timezone)?slotLabel(event.start.dateTime,event.end.dateTime,timezone):`${event.start?.dateTime||event.start?.date||'Start not verified'} · end time not verified`,
    }))
    if(params.rememberSelection)await rememberTypedObjects(params.actor.legacyTelegramId,'calendar',items.map(e=>({id:e.id,title:e.summary}))).catch(()=>{})
    const lines=[`Calendar ${window.label} (${timezone}):`,items.length?items.map((e:any,i:number)=>`${i+1}. ${e.summary} — ${e.label}`).join('\n'):
      complete?`No calendar events found for ${window.label}.`:'No events returned on this partial calendar page.']
    if(events.length>items.length)lines.push(`Showing ${items.length} of ${events.length} returned events.`)
    if(!complete)lines.push('Partial calendar page; more events are available. This is not the full schedule.')
    const conflicts:Array<{first:string;second:string}>=[]
    const wantsConflicts=/\b(overlaps?|overlapping|conflicts?|clash(?:es)?|double[- ]booked)\b/i.test(text)
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
    return {text:lines.join('\n'),output:{mode:'read',window,timezone,events:items,returnedEventCount:events.length,complete,unknownIntervals,conflicts,...(wantsConflicts?{conflictsVerified:complete&&unknownIntervals===0}:{}),verifiedStore:'google-calendar',mutated:false}}
  }

  // Slots are not event objects. Clear the prior event list even when this
  // availability read is incomplete, so a later pronoun cannot target it.
  if(params.rememberSelection)await rememberTypedObjects(params.actor.legacyTelegramId,'calendar',[],null).catch(()=>{})
  if(!complete||unknownIntervals)throw Object.assign(new Error('calendar_availability_unverified'),{timezone,window})
  const slots:Array<{start:string;end:string;label:string}>=[]
  const explicitlyRequestedDays=!['next 7 days','this week','next week'].includes(window.label)
  const weekdaysOnly=!explicitlyRequestedDays||/\bweekdays?\b/i.test(text)
  for(let date=window.startDate;date<=window.endDate&&slots.length<MAX_SLOTS;date=addDays(date,1)){
    const weekday=dayOfWeek(date)
    if(requestedMinute===undefined&&(weekday===0||weekday===6)&&weekdaysOnly)continue
    const firstMinute=requestedMinute??9*60
    const lastMinute=requestedMinute??18*60-duration
    for(let minute=firstMinute;minute<=lastMinute&&slots.length<MAX_SLOTS;minute+=30){
      const localStart=parseLocalDateTime({date,time:clock(minute),timezone}).dueAtUtc
      const observedClock=new Intl.DateTimeFormat('en-GB',{timeZone:timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(localStart)
      if(localYmd(localStart,timezone)!==date||observedClock!==clock(minute)){
        if(requestedMinute!==undefined)throw new Error('calendar_time_unsupported')
        continue
      }
      if(requestedMinute!==undefined&&ambiguousLocalTime(localStart,date,clock(minute),timezone))throw new Error('calendar_time_ambiguous')
      const localEnd=new Date(localStart.getTime()+duration*60_000)
      if(localStart.getTime()<Date.now()+15*60_000)continue
      if(overlaps(localStart.getTime(),localEnd.getTime(),events,timezone))continue
      slots.push({start:localStart.toISOString(),end:localEnd.toISOString(),label:slotLabel(localStart.toISOString(),localEnd.toISOString(),timezone)})
    }
  }

  const display=slots.length
    ? `I found these ${duration}-minute free slots in ${window.label}:\n${slots.map((s,i)=>`${i+1}. ${s.label}`).join('\n')}`
    : requestedMinute!==undefined?`I couldn't verify an available ${duration}-minute slot at ${clock(requestedMinute)} (${timezone}) in ${window.label}.`
    : `I couldn't find a ${duration}-minute ${weekdaysOnly?'weekday ':''}slot between 9 AM and 6 PM in ${window.label}.`
  return {text:display,output:{mode:'availability',durationMinutes:duration,window,timezone,availableSlots:slots,complete,availabilityVerified:true,verifiedStore:'google-calendar',mutated:false}}
}
