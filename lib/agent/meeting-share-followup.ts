import { createHash } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getLocalParts, normalizeTimezone, parseLocalDateTime, formatInTimezone } from '@/lib/timezone'
import { saveLinkVaultItem } from '@/lib/services/link-vault'
import { capabilityPermissionLevel } from './adaptive-autonomy'
import type { AgentActor } from './actor'

const KIND='meeting_reminder_offer'
const reply=(text:string,status:'paused'|'completed'='paused')=>({text,handledBy:'meeting-share-followup',capability:'reminders',status,runId:''})
type Meeting={title:string;url:string;startAt:string;endAt:string;remindAt:string;timezone:string}

/** Read the invitation text supplied by the owner; never fetch an opaque share link. */
function meetingLinks(text:string):string[]{
  return [...new Set((text.match(/https:\/\/[^\s<>]+/gi)||[]).filter(raw=>{
    try{
      const u=new URL(raw)
      if(u.username||u.password||u.port)return false
      return (u.hostname==='meet.google.com'&&/^\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(u.pathname))
        ||(u.hostname==='calendar.app.google'&&/^\/[A-Za-z0-9_-]{6,100}$/.test(u.pathname))
        ||(u.hostname==='calendar.google.com'&&/^\/calendar\/(?:event|u\/\d+\/r\/eventedit)(?:\/|$)/.test(u.pathname)&&!!u.searchParams.get('eid'))
    }catch{return false}
  }))]
}

const OWN_ZONE_WORDS:Record<string,RegExp>={'Asia/Kolkata':/\b(?:India|IST|Kolkata|Calcutta|Asia\/Kolkata|(?:GMT|UTC)\s*\+\s*0?5:?30)\b/i}
const esc=(v:string)=>v.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')
/** True when the invitation names a time zone other than the owner's ("(Pacific Time - Los Angeles)", "EST"). */
export function foreignZoneLabel(text:string,ownerZone:string):boolean{
  const labels=[...text.matchAll(/\(([^()\n]{2,60}\bTime\b[^()\n]{0,40})\)|\bTime\s*zone\s*:\s*([^\n]{2,60})|\b((?:GMT|UTC)\s*[+\-−]\s*\d{1,2}(?::?\d{2})?)|\b(PST|PDT|EST|EDT|CST|CDT|MST|MDT|BST|CET|CEST|GST|SGT|AEST|AEDT|JST)\b/gi)].map(m=>m[1]||m[2]||m[3]||m[4]||'')
  if(!labels.length)return false
  const zone=normalizeTimezone(ownerZone),city=(zone.split('/').pop()||zone)
  const own=OWN_ZONE_WORDS[zone]||new RegExp(`(?:${esc(zone)}|\\b${esc(city).replace(/_/g,'[ _]')}\\b)`,'i')
  return labels.some(l=>!own.test(l))
}

// 3 Oct live reproduction: a Google Meet invitation was filed as a generic link.
// Parse the explicit invitation, not arbitrary web content or an inferred calendar event.
export function parseSharedMeeting(raw:string, timezone:string, now=new Date()):Meeting|null {
  // 22 Nov live: Google Calendar's "copy event details" separates date and time with "⋅" (U+22C5), and en-US
  // phones write "Monday, November 23". Both were refused ("couldn't reliably read a single meeting").
  const MONTH='Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?'
  // Review (PR #1570): only a separator right before a time is rewritten, and only a date followed by a time is
  // reordered, so titles ("Team • Sync", "Sunday, May 3 retro prep") stay as written.
  const text=raw.replace(/\s*[⋅•∙]\s*(?=\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s*[-–—])/gi,' · ')
    .replace(new RegExp(String.raw`\b((?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day,?\s+)(${MONTH})\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s+(20\d{2}))?(?=\s*[·,]?\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s*[-–—])`,'gi'),(_m,wd,mo,d,y)=>`${wd}${d} ${mo}${y?` ${y}`:''}`)
  // Review (PR #1570): an invitation that names another time zone ("(Pacific Time - Los Angeles)", "Time zone:
  // America/New_York") must not be read as the owner's local time. Refused here; the caller asks for the details.
  if(foreignZoneLabel(raw,timezone))return null
  const links=meetingLinks(text)
  const calendarLinks=links.filter(link=>new URL(link).hostname!=='meet.google.com')
  // One Calendar event and its joining link can describe the same invitation.
  // Multiple event cards or multiple meeting rooms still require clarification.
  if(links.length!==1&&!(links.length===2&&calendarLinks.length===1))return null
  const eventUrl=calendarLinks[0]||links[0]
  const dateExpression=(/\b(?:(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+)?(\d{1,2})\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)(?:\s+(20\d{2}))?\s*[·,]\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*[-–—]\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i)
  const date=text.match(dateExpression)
  if(!date)return null
  // Forwarding our own saved-link reply repeats the invitation and sometimes its URL.
  // Identical copies describe one meeting; conflicting schedules need clarification.
  const dates=[...text.matchAll(new RegExp(dateExpression.source,'gi'))]
  if(dates.some(other=>other.slice(1).join('|').toLowerCase()!==date.slice(1).join('|').toLowerCase()))return null
  const title=text.slice(0,date.index).trim()
    .replace(/^(?:Forwarded\s+)?(?:🔗\s*)?Saved to Link Vault:\s*/i,'')
    .replace(/^\*+|\*+$/g,'').trim()
  if(!title||title.length>180||title.includes('https://'))return null
  const zone=normalizeTimezone(timezone)
  const year=Number(date[4]||getLocalParts(now,zone).year)
  const month=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(date[3].slice(0,3).toLowerCase())+1
  const day=Number(date[2]),check=new Date(Date.UTC(year,month-1,day))
  if(check.getUTCMonth()!==month-1||check.getUTCDate()!==day)return null
  if(date[1]&&new Intl.DateTimeFormat('en-US',{weekday:'long',timeZone:'UTC'}).format(check).toLowerCase()!==date[1].toLowerCase())return null
  const toClock=(hour:string,minute:string|undefined,period:string)=>{
    const h=Number(hour),m=Number(minute||0)
    if(h<1||h>12||m>59)return null
    return `${String(h%12+(period.toLowerCase()==='pm'?12:0)).padStart(2,'0')}:${String(m).padStart(2,'0')}`
  }
  const start=toClock(date[5],date[6],date[7]||date[10]),end=toClock(date[8],date[9],date[10])
  if(!start||!end)return null
  const key=`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`
  const startAt=parseLocalDateTime({date:key,time:start,timezone:zone}).dueAtUtcISO
  const endAt=parseLocalDateTime({date:key,time:end,timezone:zone}).dueAtUtcISO
  if(Date.parse(endAt)<=Date.parse(startAt))return null
  return {title,url:eventUrl,startAt,endAt,remindAt:new Date(Date.parse(startAt)-600000).toISOString(),timezone:zone}
}

function meetingTimeStatus(meeting:Meeting,now=Date.now()){
  const start=formatInTimezone(meeting.startAt,meeting.timezone)
  const end=formatInTimezone(meeting.endAt,meeting.timezone)
  if(now>=Date.parse(meeting.endAt))return `${meeting.title} was scheduled to end ${end} (${meeting.timezone}). That time has already passed. I haven’t set a new reminder or moved the meeting to another date.`
  if(now>=Date.parse(meeting.startAt))return `${meeting.title} is scheduled to be in progress, from ${start} to ${end} (${meeting.timezone}). It’s too late for a reminder before the start.\nJoin: ${meeting.url}`
  return null
}

/** Plain-text meeting shares should receive the same human-readable, timezone-accurate offer as image shares. */
function textMeetingOffer(meeting:Meeting,now=Date.now()):string{
  // Compare local *calendar* days, not 24-hour durations: DST can make a local day 23 or 25 hours.
  const localDay=(at:number)=>{
    const p=getLocalParts(new Date(at),meeting.timezone)
    return Math.floor(Date.UTC(p.year,p.month-1,p.day)/86400000)
  }
  const today=localDay(now),reminderDay=localDay(Date.parse(meeting.remindAt))
  const humanDay=reminderDay===today?'today':reminderDay===today+1?'tomorrow':
    new Intl.DateTimeFormat('en-GB',{timeZone:meeting.timezone,weekday:'long',day:'numeric',month:'short',year:'numeric'}).format(new Date(meeting.remindAt))
  const clock=(at:string)=>new Intl.DateTimeFormat('en-US',{timeZone:meeting.timezone,hour:'numeric',minute:'2-digit',hour12:true}).format(new Date(at)).toLowerCase()
  const zone=meeting.timezone==='Asia/Kolkata'?'IST':meeting.timezone
  const meetingDay=localDay(Date.parse(meeting.startAt))
  const startDay=meetingDay===reminderDay?'':meetingDay===today+1?' tomorrow':meetingDay===today?' today':
    ' on '+new Intl.DateTimeFormat('en-GB',{timeZone:meeting.timezone,weekday:'short',day:'numeric',month:'short'}).format(new Date(meeting.startAt))
  return `Want a reminder ${humanDay} at ${clock(meeting.remindAt)} ${zone} for ${meeting.title}? It starts${startDay} at ${clock(meeting.startAt)}. Reply Yes to set it or No to skip.`
}

function reminderId(tg:number,m:Meeting){
  const h=createHash('sha256').update(`${tg}|${m.url}|${m.title}|${m.startAt}|${m.remindAt}`).digest('hex')
  return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`
}

type ReminderTarget={id:string;message:string;remind_at:string;timezone:string;sent:boolean}
const meetingMessage=(m:Meeting)=>`${m.title} — starts ${formatInTimezone(m.startAt,m.timezone)}\n${m.url}`

async function matchingMeetingReminder(tg:number,m:Meeting):Promise<ReminderTarget|'ambiguous'|null>{
  const {data,error}=await supabaseAdmin.from('reminders')
    .select('id,message,remind_at,timezone,sent,is_recurring,recurring_pattern')
    .eq('telegram_id',tg).eq('sent',false).order('remind_at',{ascending:true}).limit(101)
  if(error)throw new Error('meeting_reminder_context_read_failed')
  // A truncated inventory cannot establish a unique target.
  if((data||[]).length>100)return 'ambiguous'
  const title=(s:string)=>s.replace(/\s+/g,' ').trim().toLowerCase()
  const day=(at:string)=>{const p=getLocalParts(new Date(at),m.timezone);return `${p.year}-${p.month}-${p.day}`}
  const matches=(data||[]).filter(r=>{
    if(r.is_recurring||r.recurring_pattern||!Number.isFinite(Date.parse(r.remind_at))||Date.parse(r.remind_at)<=Date.now())return false
    const lines=String(r.message||'').split('\n')
    const name=lines[0].split(' — starts ')[0]
    if(title(name)!==title(m.title))return false
    if(day(r.remind_at)!==day(m.startAt))return false
    const links=meetingLinks(r.message)
    // A recorded event link is authoritative. Title-only reminders additionally
    // need the same local day; repeated meetings cannot silently move dates.
    if(!links.length)return true
    if(links.length!==1)return false
    if(links[0]===m.url)return true
    // A revised Calendar card can replace a prior Meet invitation. A unique
    // exact title on the same local day supplies that cross-format context.
    // Distinct Calendar event IDs (or distinct Meet rooms) stay distinct.
    return (new URL(links[0]).hostname==='meet.google.com')!==(new URL(m.url).hostname==='meet.google.com')
  })
  return matches.length>1?'ambiguous':matches[0]||null
}

async function moveMeetingReminder(tg:number,m:Meeting,target:ReminderTarget){
  const message=meetingMessage(m)
  if(target.message!==message||Date.parse(target.remind_at)!==Date.parse(m.remindAt)){
    // Compare-and-set the exact owner, unsent reminder and old snapshot. A
    // concurrent editor or delivery worker owns any changed record.
    const {data,error}=await supabaseAdmin.from('reminders').update({message,remind_at:m.remindAt,timezone:m.timezone})
      .eq('id',target.id).eq('telegram_id',tg).eq('sent',false)
      .eq('message',target.message).eq('remind_at',target.remind_at).select('id').maybeSingle()
    if(error||!data)return reply('I couldn’t verify the reminder update. Please check your reminders; I haven’t retried the change.')
  }
  const {data:stored,error}=await supabaseAdmin.from('reminders').select('id,message,remind_at,timezone,sent')
    .eq('id',target.id).eq('telegram_id',tg).maybeSingle()
  if(error||!stored||stored.sent||stored.message!==message||Date.parse(stored.remind_at)!==Date.parse(m.remindAt))
    return reply('I couldn’t verify the reminder update. Please check your reminders; I haven’t retried the change.')
  return reply(`Your reminder for ${m.title} is now set for ${formatInTimezone(stored.remind_at,stored.timezone)} — ten minutes before the meeting.\n${m.url}`,'completed')
}

type MeetingShareInput={actor:AgentActor;text:string;surface:'web'|'whatsapp'}

// OCR is evidence, never an instruction or consent. Only invitation fields enter
// the offer flow; guests, dial-in details and suggested actions do not.
export async function tryImageMeetingShareFollowup(p:{actor:AgentActor;readerText:string;caption:string}){
  if(/\b(?:do not|don't|don’t|no)\s+(?:(?:set|offer|create)\s+)?(?:a\s+)?remind|\b(?:just|only)\s+(?:save|read|extract|transcribe)|\b(?:save|read|extract|transcribe)\b.*\bonly\b/i.test(p.caption))return null
  const extracted=p.readerText.replace(/\*/g,'').match(/(?:^|\n)Extracted text\s*\n([\s\S]*?)(?=\n(?:Next actions|Summary|Patient|Clinic|Doctor|Medicines)\b|$)/i)?.[1]?.trim()
  if(!extracted||!/^\s*(?:[•-]\s*)?Join with Google Meet\s*$/im.test(extracted)||!/^\s*Meeting link\s*$/im.test(extracted)||!/^\s*When\s*$/im.test(extracted))return null
  const clarify=()=>reply('I can see a Google Meet invitation, but couldn’t reliably read its date, start/end time, time zone and one meeting link. Please confirm those details before I offer a reminder.')
  const links=[...new Set((extracted.match(/(?:https:\/\/)?meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}\b/gi)||[]).map(link=>link.replace(/^https:\/\//i,'').toLowerCase()))]
  const when=extracted.split(/^\s*When\s*$/im)[1]?.split(/^\s*(?:Guests|View all guest info|More joining options|Description)\s*$/im)[0]?.trim()
  if(links.length!==1||!when||!/^\s*Meeting link\s*\n\s*(?:https:\/\/)?meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}\s*$/im.test(extracted)||extracted.split(/^\s*When\s*$/im).length!==2)return clarify()
  // Explicit year, AM/PM and a recognized time zone are required. Do not silently
  // reinterpret an image's unknown zone using the owner's saved preference.
  const date=when.match(/^\s*((?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+\d{1,2}\s+[A-Za-z]+\s+20\d{2}\s*[·,]\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)\s*[-–—]\s*\d{1,2}(?::\d{2})?\s*(?:am|pm))\s*\n?\s*\((India Standard Time\s*[-–—]\s*Kolkata|Asia\/Kolkata|UTC)\)\s*$/i)
  if(!date)return clarify()
  const timezone=/^UTC$/i.test(date[2])?'UTC':'Asia/Kolkata'
  const text=`Google Meet meeting\n${date[1].replace(/\s+/g,' ')}\nhttps://${links[0]}`
  if(!parseSharedMeeting(text,timezone))return clarify()
  return handleMeetingShare({actor:p.actor,text,surface:'whatsapp'},{timezone})
}

export async function tryMeetingShareFollowup(p:MeetingShareInput){
  return handleMeetingShare(p)
}

async function handleMeetingShare(p:MeetingShareInput,image?:{timezone:string}){
  const text=p.text.trim(),tg=p.actor.legacyTelegramId
  if(!Number.isSafeInteger(tg)||tg===0)return null
  const answer=/^(yes(?: please)?|no(?: thanks)?)[.!]*$/i.exec(text)
  // Avoid reads on unrelated turns. The current conversation owns short replies.
  if(!answer&&!meetingLinks(text).length)return null
  if(!answer&&/\b(?:do not|don't|don’t|no)\s+(?:(?:set|offer|create)\s+)?remind|\b(?:just|only)\s+(?:save|read|extract|transcribe)\b/i.test(text))return null
  if(!answer){
    const {data:user,error}=await supabaseAdmin.from('users').select('timezone').eq('telegram_id',tg).maybeSingle()
    if(error)throw new Error('meeting_timezone_read_failed')
    const meeting=parseSharedMeeting(text,image?.timezone||user?.timezone||'Asia/Kolkata')
    if(!meeting){
      // A dated invitation must not reach generic reminder inference, which can roll
      // an old weekday into next week. A bare Meet bookmark still uses Link Vault.
      if(/\b(?:joining info|video call link)\b|\b\d{1,2}(?:st|nd|rd|th)?\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?\b/i.test(text))return reply('Please confirm the meeting date, start/end time and one joining link. I couldn’t reliably read a single meeting from this message, so I haven’t set a reminder.')
      return null
    }
    const saved=await saveLinkVaultItem({telegramId:tg,text,url:meeting.url,visibleTitle:meeting.title,sourceSurface:p.surface})
    const timeStatus=meetingTimeStatus(meeting)
    if(timeStatus)return reply(timeStatus,'completed')
    if(Date.parse(meeting.remindAt)<=Date.now())return reply(`Saved ${meeting.title} and its Meet link. The meeting starts ${formatInTimezone(meeting.startAt,meeting.timezone)} — too soon for a 10-minute reminder.\nJoin: ${meeting.url}`,'completed')
    // OCR invitations use a generic title; they cannot identify an existing event.
    const target=image?null:await matchingMeetingReminder(tg,meeting)
    if(target==='ambiguous')return reply(`I found more than one possible reminder for ${meeting.title}. Which reminder should move? I haven’t changed any of them.`)
    if(target){
      const level=await capabilityPermissionLevel(tg,'reminders')
      if(!['ask','auto'].includes(level))return reply('Your reminder permission does not allow updating this reminder. The meeting details and link remain saved.')
      if(level==='auto')return moveMeetingReminder(tg,meeting,target)
    }
    let question=textMeetingOffer(meeting)
    if(target)question=`Move your existing reminder for ${meeting.title} to ${formatInTimezone(meeting.remindAt,meeting.timezone)}, ten minutes before the revised start? Reply Yes or No.`
    if(image){
      const day=(at:number)=>new Intl.DateTimeFormat('en-CA',{timeZone:meeting.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(at)
      const tomorrow=day(Date.now()+86400000)===day(Date.parse(meeting.startAt))?'tomorrow, ':''
      const date=new Intl.DateTimeFormat('en-GB',{timeZone:meeting.timezone,weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(new Date(meeting.startAt))
      const time=(at:string)=>new Intl.DateTimeFormat('en-US',{timeZone:meeting.timezone,hour:'numeric',minute:'2-digit',hour12:true}).format(new Date(at)).toLowerCase()
      const zone=meeting.timezone==='Asia/Kolkata'?'IST':meeting.timezone
      question=`This meeting is ${tomorrow}${date}, ${time(meeting.startAt)}–${time(meeting.endAt)} ${zone}. Want a reminder at ${time(meeting.remindAt)}?`
    }
    const content=JSON.stringify({type:'followup_state',kind:KIND,payload:{meeting,question,status:'pending',linkId:saved.row.id,reminderId:target?.id||reminderId(tg,meeting),replace:target||undefined,surface:p.surface},created_at:new Date().toISOString()})
    const {error:saveError}=await supabaseAdmin.from('memories').insert({telegram_id:tg,content})
    if(saveError)throw new Error('meeting_offer_save_failed')
    return reply(question)
  }

  // Dashboard inserts each user/assistant pair together: timestamps can tie.
  // Within that pair the assistant is the latest turn; a genuinely newer user still wins.
  const [{data:rows,error:memoryError},{data:turns,error:historyError}]=await Promise.all([
    supabaseAdmin.from('memories').select('id,content,created_at').eq('telegram_id',tg).order('created_at',{ascending:false}).limit(40),
    supabaseAdmin.from('conversations').select('role,content,created_at').eq('telegram_id',tg).order('created_at',{ascending:false}).order('role',{ascending:true}).limit(1),
  ])
  if(memoryError||historyError)throw new Error('meeting_followup_read_failed')
  const candidate=(rows||[]).map(row=>{try{return {row,state:JSON.parse(row.content)}}catch{return null}}).find(x=>x?.state?.type==='followup_state'&&x.state.kind===KIND)
  if(!candidate)return null
  const {row,state}=candidate,offer=state.payload,m:Meeting=offer?.meeting
  const previous=turns?.[0]
  if(!m||previous?.role!=='assistant'||![offer.question,offer.confirmation].filter(Boolean).includes(previous.content))return null
  const timeStatus=meetingTimeStatus(m)
  if(timeStatus)return reply(timeStatus,'completed')
  if(!Number.isFinite(Date.parse(state.created_at))||Date.now()-Date.parse(state.created_at)>86400000||Date.parse(m.remindAt)<=Date.now())return reply('That reminder offer has expired. Please share the current meeting details again.')
  if(!['pending','executing','completed'].includes(offer.status))return null
  const update=async(payload:any)=>{
    const {error}=await supabaseAdmin.from('memories').update({content:JSON.stringify({...state,payload})}).eq('id',row.id).eq('telegram_id',tg)
    if(error)throw new Error('meeting_offer_update_failed')
  }
  if(/^no/i.test(answer[1])){
    if(offer.status!=='pending')return reply('The reminder was already processed. Use your reminder controls if you want to cancel it.')
    const {data:declined,error}=await supabaseAdmin.from('memories').update({content:JSON.stringify({...state,payload:{...offer,status:'declined'}})}).eq('id',row.id).eq('telegram_id',tg).eq('content',row.content).select('id').maybeSingle()
    if(error)throw new Error('meeting_offer_decline_failed')
    if(!declined)return reply('That offer was already handled. Please check your reminders for its current state.')
    return reply('Okay — I kept the meeting details and link, without adding a reminder.','completed')
  }
  const level=await capabilityPermissionLevel(tg,'reminders')
  if(!['ask','auto'].includes(level))return reply('Your reminder permission does not allow creating this reminder. The meeting details and link remain saved.')
  if(offer.replace){
    if(offer.status==='pending'){
      const {data:claimed,error}=await supabaseAdmin.from('memories').update({content:JSON.stringify({...state,payload:{...offer,status:'executing'}})})
        .eq('id',row.id).eq('telegram_id',tg).eq('content',row.content).select('id').maybeSingle()
      if(error)throw new Error('meeting_offer_claim_failed')
      if(!claimed)return reply('That reminder update was already handled. Please check its current state.')
      const result=await moveMeetingReminder(tg,m,offer.replace)
      if(result.status==='completed')await update({...offer,status:'completed',confirmation:result.text})
      return result
    }
    return reply(offer.confirmation||'I could not verify the earlier update. Please check your reminders; I haven’t repeated it.',offer.confirmation?'completed':'paused')
  }
  const message=meetingMessage(m)
  if(offer.status==='pending'){
    const {data:claimed,error}=await supabaseAdmin.from('memories').update({content:JSON.stringify({...state,payload:{...offer,status:'executing'}})}).eq('id',row.id).eq('telegram_id',tg).eq('content',row.content).select('id').maybeSingle()
    if(error)throw new Error('meeting_offer_claim_failed')
    if(!claimed)return reply('I’m already handling that reminder confirmation. I have not created another reminder.')
    // Stable primary key makes a retried transport unable to create a second reminder.
    // Do not replay a write after an uncertain result: read the exact record instead.
    await supabaseAdmin.from('reminders').insert({id:offer.reminderId,telegram_id:tg,chat_id:tg,message,remind_at:m.remindAt,timezone:m.timezone,whatsapp_to:p.actor.whatsappId,sent:false}).then(()=>{},()=>{})
  }
  const {data:stored,error:readError}=await supabaseAdmin.from('reminders').select('id,message,remind_at,timezone,sent').eq('id',offer.reminderId).eq('telegram_id',tg).maybeSingle()
  if(readError||!stored||stored.sent||stored.message!==message||Date.parse(stored.remind_at)!==Date.parse(m.remindAt)){
    return reply('I could not verify that the reminder was saved. I have not retried the write or claimed it is set. Please check your reminders before trying again.')
  }
  const confirmation=`Reminder set for ${formatInTimezone(stored.remind_at,stored.timezone)}.\n${stored.message}`
  await update({...offer,status:'completed',confirmation})
  return reply(confirmation,'completed')
}
