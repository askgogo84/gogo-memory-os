import { createHash } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getLocalParts, normalizeTimezone, parseLocalDateTime, formatInTimezone } from '@/lib/timezone'
import { saveLinkVaultItem } from '@/lib/services/link-vault'
import { capabilityPermissionLevel } from './adaptive-autonomy'
import type { AgentActor } from './actor'

const KIND='meeting_reminder_offer'
const reply=(text:string,status:'paused'|'completed'='paused')=>({text,handledBy:'meeting-share-followup',capability:'reminders',status,runId:''})
type Meeting={title:string;url:string;startAt:string;endAt:string;remindAt:string;timezone:string}

// 3 Oct live reproduction: a Google Meet invitation was filed as a generic link.
// Parse the explicit invitation, not arbitrary web content or an inferred calendar event.
export function parseSharedMeeting(text:string, timezone:string, now=new Date()):Meeting|null {
  const links=text.match(/https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}\b/gi)||[]
  if(links.length!==1)return null
  const date=text.match(/\b(?:(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+)?(\d{1,2})\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)(?:\s+(20\d{2}))?\s*[·,]\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*[-–—]\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i)
  if(!date)return null
  const title=text.slice(0,date.index).trim()
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
  if(Date.parse(endAt)<=Date.parse(startAt)||Date.parse(startAt)<=now.getTime())return null
  return {title,url:links[0],startAt,endAt,remindAt:new Date(Date.parse(startAt)-600000).toISOString(),timezone:zone}
}

function reminderId(tg:number,m:Meeting){
  const h=createHash('sha256').update(`${tg}|${m.url}|${m.title}|${m.startAt}|${m.remindAt}`).digest('hex')
  return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`
}

export async function tryMeetingShareFollowup(p:{actor:AgentActor;text:string;surface:'web'|'whatsapp'}){
  const text=p.text.trim(),tg=p.actor.legacyTelegramId
  const answer=/^(yes(?: please)?|no(?: thanks)?)[.!]*$/i.exec(text)
  // Avoid reads on unrelated turns. The current conversation owns short replies.
  if(!answer&&!/https:\/\/meet\.google\.com\//i.test(text))return null
  if(!answer){
    const {data:user,error}=await supabaseAdmin.from('users').select('timezone').eq('telegram_id',tg).maybeSingle()
    if(error)throw new Error('meeting_timezone_read_failed')
    const meeting=parseSharedMeeting(text,user?.timezone||'Asia/Kolkata')
    if(!meeting)return null
    const saved=await saveLinkVaultItem({telegramId:tg,text,url:meeting.url,visibleTitle:meeting.title,sourceSurface:p.surface})
    if(Date.parse(meeting.remindAt)<=Date.now())return reply(`Saved ${meeting.title} and its Meet link. The meeting starts too soon for a 10-minute reminder.`)
    const question=`${meeting.title} starts ${formatInTimezone(meeting.startAt,meeting.timezone)}. Remind you 10 minutes before, at ${formatInTimezone(meeting.remindAt,meeting.timezone)}?`
    const content=JSON.stringify({type:'followup_state',kind:KIND,payload:{meeting,question,status:'pending',linkId:saved.row.id,reminderId:reminderId(tg,meeting),surface:p.surface},created_at:new Date().toISOString()})
    const {error:saveError}=await supabaseAdmin.from('memories').insert({telegram_id:tg,content})
    if(saveError)throw new Error('meeting_offer_save_failed')
    return reply(question)
  }

  const [{data:rows,error:memoryError},{data:turns,error:historyError}]=await Promise.all([
    supabaseAdmin.from('memories').select('id,content,created_at').eq('telegram_id',tg).order('created_at',{ascending:false}).limit(40),
    supabaseAdmin.from('conversations').select('role,content,created_at').eq('telegram_id',tg).order('created_at',{ascending:false}).limit(1),
  ])
  if(memoryError||historyError)throw new Error('meeting_followup_read_failed')
  const candidate=(rows||[]).map(row=>{try{return {row,state:JSON.parse(row.content)}}catch{return null}}).find(x=>x?.state?.type==='followup_state'&&x.state.kind===KIND)
  if(!candidate)return null
  const {row,state}=candidate,offer=state.payload,m:Meeting=offer?.meeting
  const previous=turns?.[0]
  if(!m||previous?.role!=='assistant'||![offer.question,offer.confirmation].filter(Boolean).includes(previous.content))return null
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
  const message=`${m.title} — starts ${formatInTimezone(m.startAt,m.timezone)}\n${m.url}`
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
