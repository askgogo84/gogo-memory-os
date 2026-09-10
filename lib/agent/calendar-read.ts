import { supabaseAdmin } from '@/lib/supabase-admin'
import { fetchPrimaryCalendarEvents, refreshAccessToken } from '@/lib/google-calendar'
import { normalizeTimezone, parseLocalDateTime } from '@/lib/timezone'
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
  if(/\btomorrow\b/i.test(text)){const d=addDays(today,1);return {startDate:d,endDate:d,label:'tomorrow'}}
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
    if(Number.isFinite(start)&&Number.isFinite(end))return {start,end,allDay:false}
  }
  if(event?.start?.date&&event?.end?.date){
    const start=parseLocalDateTime({date:String(event.start.date),time:'00:00',timezone:tz}).dueAtUtc.getTime()
    const end=parseLocalDateTime({date:String(event.end.date),time:'00:00',timezone:tz}).dueAtUtc.getTime()
    return {start,end,allDay:true}
  }
  return null
}

function dayOfWeek(iso:string){return new Date(`${iso}T00:00:00Z`).getUTCDay()}
function overlaps(start:number,end:number,events:any[],tz:string){
  return events.some(event=>{const span=eventInterval(event,tz);return span?start<span.end&&end>span.start:false})
}
function clock(minutes:number){return `${pad(Math.floor(minutes/60))}:${pad(minutes%60)}`}

function slotLabel(startIso:string,endIso:string,tz:string){
  const fmt=new Intl.DateTimeFormat('en-IN',{timeZone:tz,weekday:'short',day:'numeric',month:'short',hour:'numeric',minute:'2-digit',hour12:true})
  const endFmt=new Intl.DateTimeFormat('en-IN',{timeZone:tz,hour:'numeric',minute:'2-digit',hour12:true})
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

export async function executeReadOnlyCalendarStep(params:{actor:AgentActor;instruction:string;missionText:string}){
  const {accessToken,timezone}=await calendarAccess(params.actor)
  const text=`${params.instruction} ${params.missionText}`
  const window=calendarReadWindow(text,new Date(),timezone)
  const start=parseLocalDateTime({date:window.startDate,time:'00:00',timezone}).dueAtUtc
  const end=parseLocalDateTime({date:addDays(window.endDate,1),time:'00:00',timezone}).dueAtUtc
  const events=(await fetchPrimaryCalendarEvents(accessToken,start.toISOString(),end.toISOString(),'AGENT_CALENDAR_READ_FAILED')).slice(0,MAX_EVENTS)

  const wantsAvailability=/\b(free|available|availability|slot|open time|gap)\b/i.test(text)
  if(!wantsAvailability){
    const items=events.slice(0,12).map((event:any)=>({
      id:safe(event?.id||'',160),summary:safe(event?.summary||'Busy',220),start:String(event?.start?.dateTime||event?.start?.date||''),end:String(event?.end?.dateTime||event?.end?.date||''),
    }))
    const display=items.length?items.map((e:any,i:number)=>`${i+1}. ${e.summary} — ${e.start}`).join('\n'):`No calendar events found for ${window.label}.`
    return {text:display,output:{mode:'read',window,timezone,events:items,verifiedStore:'google-calendar',mutated:false}}
  }

  const duration=requestedDurationMinutes(text)
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
  return {text:display,output:{mode:'availability',durationMinutes:duration,window,timezone,availableSlots:slots,verifiedStore:'google-calendar',mutated:false}}
}
