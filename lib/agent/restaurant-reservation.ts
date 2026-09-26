import { createHash } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { searchWebResults, type WebSearchResult } from '@/lib/web-search'
import { normalizeTimezone, parseLocalDateTime } from '@/lib/timezone'
import { runSecureBrowser } from './secure-computer'
import { buildApprovalBinding, assertApprovalBinding } from './approval-binding'
import type { AgentActor } from './actor'
import type { AgentSurface } from './orchestrator'

function safe(value: unknown, max = 1200) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function firstUrl(text:string){
  const match=String(text||'').match(/https?:\/\/[^\s<>]+/i)
  return match ? match[0].replace(/[),.;!?]+$/,'') : ''
}

function normalizeClock(hour:number,minute:number,meridiem:string){
  if(hour<1||hour>12||minute<0||minute>59)return''
  let h=hour
  const m=String(meridiem||'').toLowerCase()
  if(m==='pm'&&h<12)h+=12
  if(m==='am'&&h===12)h=0
  return `${String(h).padStart(2,'0')}:${String(minute).padStart(2,'0')}`
}

function explicitClock(raw:string){
  const text=String(raw||'')
  const full=text.match(/\b(\d{1,2}):(\d{2})\s*(am|pm)\b/i)
  if(full)return normalizeClock(Number(full[1]),Number(full[2]),full[3])
  const simple=text.match(/\b(\d{1,2})\s*(am|pm)\b/i)
  return simple?normalizeClock(Number(simple[1]),0,simple[2]):''
}

function restaurantName(text:string){
  const raw=String(text||'').replace(/https?:\/\/\S+/gi,' ').replace(/\s+/g,' ').trim()
  const direct=raw.match(/\b(?:book|reserve)\s+(.+?)(?=\s+(?:for\s+\d{1,2}|for\s+(?:a\s+)?party\s+of\s+\d{1,2}|between\s+\d|at\s+\d|on\s+\d|next\s+available|today|tomorrow)\b|[,.!?]|$)/i)?.[1]
  if(direct)return safe(direct.replace(/^(?:a|an)\s+(?:table\s+at\s+)?/i,'').replace(/^table\s+at\s+/i,''),160)
  const at=raw.match(/\b(?:table|reservation)\s+(?:at|for)\s+(.+?)(?=\s+(?:for\s+\d{1,2}|between\s+\d|at\s+\d|on\s+\d|next\s+available)\b|[,.!?]|$)/i)?.[1]
  return safe(at||'',160)
}

function partySize(text:string){
  const raw=String(text||'')
  const match=raw.match(/\bparty\s+of\s+(\d{1,2})\b/i)
    ||raw.match(/\bfor\s+(\d{1,2})\s+(?:people|persons?|guests?|pax)\b/i)
    ||raw.match(/\bfor\s+(\d{1,2})\b/i)
  const n=Number(match?.[1])
  return Number.isInteger(n)&&n>=1&&n<=20?n:null
}

function preferredWindow(text:string){
  const raw=String(text||'')
  const m=raw.match(/\bbetween\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm))\s+(?:and|to|-)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm))\b/i)
    ||raw.match(/\b(\d{1,2}(?::\d{2})?\s*(?:am|pm))\s*(?:-|to)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm))\b/i)
  if(!m)return{start:'',end:''}
  return{start:explicitClock(m[1]),end:explicitClock(m[2])}
}

const MONTHS:Record<string,number>={jan:1,january:1,feb:2,february:2,mar:3,march:3,apr:4,april:4,may:5,jun:6,june:6,jul:7,july:7,aug:8,august:8,sep:9,sept:9,september:9,oct:10,october:10,nov:11,november:11,dec:12,december:12}
const WEEKDAYS:Record<string,number>={sunday:0,monday:1,tuesday:2,wednesday:3,thursday:4,friday:5,saturday:6}

function ymd(year:number,month:number,day:number){
  return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`
}

function explicitDate(text:string,now=new Date()){
  const raw=String(text||'')
  const iso=raw.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/)
  if(iso)return ymd(Number(iso[1]),Number(iso[2]),Number(iso[3]))
  const dm=raw.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:[ ,]+(20\d{2}))?\b/i)
  if(!dm)return''
  const month=MONTHS[String(dm[2]).toLowerCase()]
  const day=Number(dm[1])
  let year=Number(dm[3]||now.getUTCFullYear())
  if(!dm[3]){
    const candidate=Date.UTC(year,month-1,day)
    if(candidate<now.getTime()-24*3600_000)year++
  }
  return ymd(year,month,day)
}

export type RestaurantReservationIntent={
  restaurant:string
  partySize:number|null
  preferredStart:string
  preferredEnd:string
  requestedDate:string
  nextAvailable:boolean
  sourceUrl:string
}

export function isRestaurantReservationRequest(raw:string){
  const text=String(raw||'').trim().toLowerCase()
  if(!text)return false
  const booking=/\b(book|booking|reserve|reservation|table)\b/.test(text)
  const restaurant=/\b(restaurant|cafe|café|bistro|bar|noodle|dinner|lunch|brunch|table|party\s+of)\b/.test(text)
    ||/\b(?:book|reserve)\s+[a-z0-9&.' -]{2,80}\s+for\s+\d{1,2}\b/i.test(text)
  const exclusions=/\b(doctor|dentist|clinic|hospital|salon|spa|flight|hotel|train|bus|movie|concert|ticket)\b/.test(text)
  return booking&&restaurant&&!exclusions
}

export function parseRestaurantReservationIntent(raw:string):RestaurantReservationIntent|null{
  if(!isRestaurantReservationRequest(raw))return null
  const window=preferredWindow(raw)
  return{
    restaurant:restaurantName(raw),
    partySize:partySize(raw),
    preferredStart:window.start,
    preferredEnd:window.end,
    requestedDate:explicitDate(raw),
    nextAvailable:/\bnext\s+available\b|\bearliest\s+available\b|\bfirst\s+available\b/i.test(raw),
    sourceUrl:firstUrl(raw),
  }
}

function host(url:string){try{return new URL(url).hostname.replace(/^www\./,'')}catch{return''}}

function candidateScore(result:WebSearchResult,restaurant:string){
  const title=String(result.title||'').toLowerCase()
  const snippet=String(result.snippet||'').toLowerCase()
  const url=String(result.url||'').toLowerCase()
  const tokens=restaurant.toLowerCase().split(/[^a-z0-9]+/).filter(x=>x.length>2)
  let score=tokens.filter(t=>title.includes(t)||snippet.includes(t)||url.includes(t)).length*3
  if(/book|booking|reserv|table|order/.test(url))score+=8
  if(/book|booking|reserv|table/.test(title+' '+snippet))score+=5
  if(/instagram|facebook|zomato|swiggy|tripadvisor/.test(url))score-=4
  return score
}

async function discoverProvider(intent:RestaurantReservationIntent){
  if(intent.sourceUrl)return{url:intent.sourceUrl,title:intent.restaurant||host(intent.sourceUrl),source:'explicit_url'}
  if(!intent.restaurant)return null
  const query=`${intent.restaurant} reservation booking official`
  const results=await searchWebResults(query)
  const ranked=(results||[])
    .filter(r=>/^https?:\/\//i.test(String(r.url||'')))
    .map(r=>({r,score:candidateScore(r,intent.restaurant)}))
    .sort((a,b)=>b.score-a.score)
  const top=ranked[0]
  return top?.score>0?{url:String(top.r.url),title:safe(top.r.title||intent.restaurant,220),source:'web_search'}:null
}

export type ReservationRelease={
  soldOut:boolean
  releaseAt:string|null
  releaseDate:string|null
  releaseTime:string|null
  releaseRule:string|null
  openNow:boolean
}

export function extractReservationRelease(pageText:string,timezone='Asia/Kolkata',now=new Date()):ReservationRelease{
  const text=String(pageText||'').replace(/\s+/g,' ').trim()
  const soldOut=/\b(sold\s*out|fully\s+booked|no\s+available\s+dates?|no\s+availability)\b/i.test(text)
  const openNow=!soldOut&&/\b(select\s+(?:a\s+)?(?:date|time)|available\s+(?:dates?|times?|slots?)|book\s+now|reserve\s+now)\b/i.test(text)
  const dateMatch=text.match(/\bnext\s+opens?\s+(?:on\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:[ ,]+(20\d{2}))?\b/i)
    ||text.match(/\bbookings?\s+(?:re)?open\s+(?:on\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:[ ,]+(20\d{2}))?\b/i)
  let releaseDate:string|null=null
  if(dateMatch){
    const month=MONTHS[String(dateMatch[2]).toLowerCase()]
    const day=Number(dateMatch[1])
    let year=Number(dateMatch[3]||now.getUTCFullYear())
    if(!dateMatch[3]&&Date.UTC(year,month-1,day)<now.getTime()-24*3600_000)year++
    releaseDate=ymd(year,month,day)
  }
  const weekly=text.match(/\breservations?\s+open\s+every\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i)
    ||text.match(/\bbookings?\s+open\s+every\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i)
  const releaseTime=weekly?normalizeClock(Number(weekly[2]),Number(weekly[3]||0),weekly[4]):null
  if(!releaseDate&&weekly&&releaseTime){
    const wanted=WEEKDAYS[String(weekly[1]).toLowerCase()]
    const cursor=new Date(now)
    for(let i=0;i<8;i++){
      if(cursor.getUTCDay()===wanted){
        const candidate=ymd(cursor.getUTCFullYear(),cursor.getUTCMonth()+1,cursor.getUTCDate())
        const parsed=parseLocalDateTime({date:candidate,time:releaseTime,timezone:normalizeTimezone(timezone)})
        if(parsed.dueAtUtc.getTime()>now.getTime()){releaseDate=candidate;break}
      }
      cursor.setUTCDate(cursor.getUTCDate()+1)
    }
  }
  let releaseAt:string|null=null
  if(releaseDate&&releaseTime){
    const parsed=parseLocalDateTime({date:releaseDate,time:releaseTime,timezone:normalizeTimezone(timezone)})
    if(parsed.dueAtUtc.getTime()>now.getTime()-60_000)releaseAt=parsed.dueAtUtc.toISOString()
  }
  const ruleParts:string[]=[]
  if(releaseDate)ruleParts.push(`next booking release ${releaseDate}`)
  if(weekly&&releaseTime)ruleParts.push(`every ${weekly[1]} at ${releaseTime}`)
  return{soldOut,releaseAt,releaseDate,releaseTime,releaseRule:ruleParts.length?ruleParts.join(' · '):null,openNow}
}

async function actorTimezone(actor:AgentActor){
  const{data}=await supabaseAdmin.from('users').select('timezone').eq('telegram_id',actor.legacyTelegramId).maybeSingle()
  return normalizeTimezone(String(data?.timezone||'Asia/Kolkata'))
}

function dedupeKey(actor:AgentActor,intent:RestaurantReservationIntent,url:string){
  const stable=[actor.legacyTelegramId,intent.restaurant,url,intent.partySize,intent.preferredStart,intent.preferredEnd,intent.requestedDate||'next'].join('|').toLowerCase()
  return createHash('sha256').update(stable).digest('hex').slice(0,40)
}

export function restaurantReservationApprovalInput(params:{runId:string;lifeEventId:string;actionId:string;restaurant:string;providerUrl:string;partySize:number|null;preferredStart:string;preferredEnd:string;requestedDate:string;releaseAt:string|null}){
  return{
    missionId:params.runId,
    stepId:params.actionId,
    capability:'browser',
    actionType:'booking',
    target:params.providerUrl,
    payload:{
      lifeEventId:params.lifeEventId,
      restaurant:params.restaurant,
      partySize:params.partySize,
      preferredStart:params.preferredStart,
      preferredEnd:params.preferredEnd,
      requestedDate:params.requestedDate||null,
      releaseAt:params.releaseAt,
      maxBookingFeePaise:0,
      paymentBoundary:'stop_before_fee_or_deposit',
    },
  }
}

async function existingMission(tg:number,key:string){
  const{data}=await supabaseAdmin.from('life_events').select('id,metadata_json,next_action_at,lifecycle_state').eq('telegram_id',String(tg)).eq('dedupe_key',key).maybeSingle()
  if(!data?.id)return null
  const{data:run}=await supabaseAdmin.from('agent_runs').select('id,status,metadata_json').eq('telegram_id',String(tg)).eq('metadata_json->>plan_type','restaurant_reservation_release').eq('metadata_json->>life_event_id',String(data.id)).in('status',['waiting_approval','queued','running','paused','outcome_unknown']).order('started_at',{ascending:false}).limit(1).maybeSingle()
  const{data:approval}=run?.id?await supabaseAdmin.from('agent_approvals').select('id,status').eq('run_id',String(run.id)).eq('telegram_id',String(tg)).eq('action_type','booking').order('requested_at',{ascending:false}).limit(1).maybeSingle():{data:null}
  return{event:data,run:run||null,approval:approval||null}
}

export async function tryRunRestaurantReservation(params:{actor:AgentActor;surface:AgentSurface;text:string}){
  const intent=parseRestaurantReservationIntent(params.text)
  if(!intent)return null
  if(!intent.restaurant){
    return{runId:'',status:'paused' as const,capability:'browser' as const,risk:'low' as const,handledBy:'restaurant-reservation' as const,text:'Which restaurant should I reserve? Give me the restaurant name (and location if there are multiple branches).'}
  }
  if(!intent.partySize){
    return{runId:'',status:'paused' as const,capability:'browser' as const,risk:'low' as const,handledBy:'restaurant-reservation' as const,text:`How many people should I book at ${intent.restaurant} for?`}
  }
  const provider=await discoverProvider(intent)
  if(!provider){
    return{runId:'',status:'paused' as const,capability:'browser' as const,risk:'low' as const,handledBy:'restaurant-reservation' as const,text:`I could not verify an official reservation page for ${intent.restaurant}. Send me the booking link and I will keep the reservation objective intact.`}
  }
  const timezone=await actorTimezone(params.actor)
  const inspected=await runSecureBrowser({
    userId:params.actor.userId,
    url:provider.url,
    mode:'read',
    objective:`Read only the live reservation state and booking-release rules for ${intent.restaurant}. Determine whether bookings are open, sold out, or scheduled to open later. Capture any explicit next-open date and recurring release weekday/time. Do not sign in, fill personal details, reserve, submit, pay, or change anything.`,
  })
  if(inspected.status==='blocked'){
    return{runId:'',status:'paused' as const,capability:'browser' as const,risk:'low' as const,handledBy:'restaurant-reservation' as const,text:`I found ${intent.restaurant}'s reservation page, but the provider blocked read-only inspection before I could verify the release rules. I did not invent a booking time or create a reminder. Provider: ${provider.url}`}
  }
  const release=extractReservationRelease(inspected.pageText,timezone)
  if(!release.openNow&&!release.releaseAt){
    const evidence=safe(inspected.pageText,700)
    return{runId:'',status:'paused' as const,capability:'browser' as const,risk:'low' as const,handledBy:'restaurant-reservation' as const,text:`I checked the provider page for ${intent.restaurant}, but I could not verify an exact future booking-release time. I will not turn this into an arbitrary reminder.\n\nProvider: ${provider.url}\nObserved: ${evidence||'No reliable release rule was exposed.'}`}
  }

  const releaseAt=release.openNow?new Date().toISOString():release.releaseAt!
  const key=dedupeKey(params.actor,intent,provider.url)
  const existing=await existingMission(params.actor.legacyTelegramId,key)
  if(existing?.run?.id){
    const status=String(existing.run.status)
    const approvalStatus=String(existing.approval?.status||'')
    const line=approvalStatus==='pending'?'Reply APPROVE to arm it, or REJECT to stop.':approvalStatus==='approved'?'It is already approved and armed.':'The mission is already active.'
    return{runId:String(existing.run.id),status:status as any,capability:'browser' as const,risk:'high' as const,handledBy:'restaurant-reservation' as const,approvalId:existing.approval?.id||undefined,approvalRequired:approvalStatus==='pending',text:`I already have this ${intent.restaurant} reservation mission. ${line}`}
  }

  const now=new Date().toISOString()
  const{data:event,error:eventError}=await supabaseAdmin.from('life_events').upsert({
    telegram_id:String(params.actor.legacyTelegramId),
    event_type:'reservation',
    subtype:'restaurant_booking_release',
    source:'restaurant_reservation_request',
    title:`Reserve ${intent.restaurant}`.slice(0,240),
    provider:host(provider.url)||provider.title,
    start_at:null,
    end_at:null,
    timezone,
    location:null,
    lifecycle_state:'planned',
    participants:[],
    preferences_json:{partySize:intent.partySize,preferredStart:intent.preferredStart||null,preferredEnd:intent.preferredEnd||null,requestedDate:intent.requestedDate||null,nextAvailable:intent.nextAvailable,maxBookingFeePaise:0},
    metadata_json:{restaurant:intent.restaurant,reservationUrl:provider.url,providerDiscovery:provider.source,releaseAt,releaseRule:release.releaseRule,releaseEvidence:safe(inspected.pageText,1800),readOnlyInspection:true},
    source_refs:[{source:'provider',kind:'restaurant_reservation_page',url:provider.url}],
    dedupe_key:key,
    next_action_at:releaseAt,
    updated_at:now,
  },{onConflict:'telegram_id,dedupe_key'}).select('id').single()
  if(eventError||!event?.id)throw new Error(`restaurant_reservation_event_failed:${eventError?.message||'unknown'}`)
  const lifeEventId=String(event.id)
  const{data:action,error:actionError}=await supabaseAdmin.from('life_event_actions').upsert({
    life_event_id:lifeEventId,
    telegram_id:String(params.actor.legacyTelegramId),
    action_key:'restaurant-reservation-release',
    action_type:'browser_execute',
    capability:'browser',
    title:`Attempt ${intent.restaurant} reservation at release`.slice(0,220),
    due_at:releaseAt,
    requires_approval:true,
    irreversible:true,
    status:'waiting_approval',
    payload_json:{reservationUrl:provider.url,restaurant:intent.restaurant,partySize:intent.partySize,preferredStart:intent.preferredStart||null,preferredEnd:intent.preferredEnd||null,requestedDate:intent.requestedDate||null,nextAvailable:intent.nextAvailable,maxBookingFeePaise:0,releaseAt,releaseRule:release.releaseRule},
    updated_at:now,
  },{onConflict:'life_event_id,action_key'}).select('id').single()
  if(actionError||!action?.id)throw new Error(`restaurant_reservation_action_failed:${actionError?.message||'unknown'}`)
  const actionId=String(action.id)
  const{data:run,error:runError}=await supabaseAdmin.from('agent_runs').insert({
    telegram_id:String(params.actor.legacyTelegramId),type:'restaurant_reservation',capability:'browser',status:'waiting_approval',
    title:`Reserve ${intent.restaurant}`.slice(0,180),
    summary:'Provider release time verified. Waiting for bounded approval before the scheduled reservation attempt.',
    progress:35,why:'Gogo inspected the provider page read-only and will only attempt the reservation inside the approved restaurant/party/time/fee bounds.',
    source:params.surface,started_at:now,updated_at:now,
    metadata_json:{plan_type:'restaurant_reservation_release',life_event_id:lifeEventId,life_event_action_id:actionId,restaurant:intent.restaurant,reservation_url:provider.url,release_at:releaseAt,constraints:{partySize:intent.partySize,preferredStart:intent.preferredStart||null,preferredEnd:intent.preferredEnd||null,requestedDate:intent.requestedDate||null,nextAvailable:intent.nextAvailable,maxBookingFeePaise:0}},
  }).select('id').single()
  if(runError||!run?.id)throw new Error(`restaurant_reservation_run_failed:${runError?.message||'unknown'}`)
  const runId=String(run.id)
  const binding=buildApprovalBinding(restaurantReservationApprovalInput({runId,lifeEventId,actionId,restaurant:intent.restaurant,providerUrl:provider.url,partySize:intent.partySize,preferredStart:intent.preferredStart,preferredEnd:intent.preferredEnd,requestedDate:intent.requestedDate,releaseAt}))
  const{data:approval,error:approvalError}=await supabaseAdmin.from('agent_approvals').insert({
    telegram_id:String(params.actor.legacyTelegramId),run_id:runId,action_type:'booking',
    title:`Approve timed reservation attempt · ${intent.restaurant}`.slice(0,220),
    description:'This approval is bounded to this restaurant, party size, preferred time window and zero booking fee/deposit. If the provider requires a fee, payment or protected authentication, Gogo must stop and ask you.',
    payload_preview:[
      {label:'Restaurant',value:intent.restaurant},
      {label:'Party',value:String(intent.partySize)},
      {label:'Preferred time',value:intent.preferredStart&&intent.preferredEnd?`${intent.preferredStart}–${intent.preferredEnd}`:'Next available'},
      {label:'Booking release',value:releaseAt},
      {label:'Fee/deposit',value:'₹0 approved; ask before any charge'},
    ],
    execution_payload:{plan_type:'restaurant_reservation_release',lifeEventId,lifeEventActionId:actionId,action:'arm_scheduled_restaurant_reservation'},
    risk_level:'high',status:'pending',...binding,
  }).select('id').single()
  if(approvalError||!approval?.id)throw new Error(`restaurant_reservation_approval_failed:${approvalError?.message||'unknown'}`)
  await supabaseAdmin.from('agent_activity').insert({
    telegram_id:String(params.actor.legacyTelegramId),run_id:runId,event_type:'restaurant_reservation_prepared',
    message:`Provider release verified for ${intent.restaurant}; bounded reservation approval requested.`,
    metadata_json:{life_event_id:lifeEventId,action_id:actionId,approval_id:approval.id,provider_url:provider.url,release_at:releaseAt},
  }).then(()=>{})

  const when=new Intl.DateTimeFormat('en-IN',{timeZone:timezone,dateStyle:'medium',timeStyle:'short'}).format(new Date(releaseAt))
  const evidence=release.releaseRule?`Provider rule: ${release.releaseRule}.`:(release.openNow?'The provider page currently exposes booking controls.':'Provider release time verified.')
  const window=intent.preferredStart&&intent.preferredEnd?`${intent.preferredStart}–${intent.preferredEnd}`:'next available'
  return{
    runId,status:'waiting_approval' as const,capability:'browser' as const,risk:'high' as const,handledBy:'restaurant-reservation' as const,
    approvalId:String(approval.id),approvalRequired:true,
    text:`I checked ${intent.restaurant}'s provider page first. ${evidence}\n\nI created a persistent reservation mission for ${when} (${timezone}).\n• Party: ${intent.partySize}\n• Preferred slot: ${window}${intent.requestedDate?`\n• Requested date: ${intent.requestedDate}`:''}\n• Fee/deposit authority: ₹0 — I must stop and ask before any charge.\n\nReply APPROVE to arm this exact bounded reservation attempt, or REJECT to stop it.`,
  }
}

export async function armApprovedRestaurantReservation(params:{actor:AgentActor;runId:string}){
  const tg=String(params.actor.legacyTelegramId)
  const{data:run,error}=await supabaseAdmin.from('agent_runs').select('id,status,metadata_json').eq('id',params.runId).eq('telegram_id',tg).maybeSingle()
  if(error||!run)throw new Error('restaurant_reservation_run_not_found')
  const meta:any=run.metadata_json||{}
  if(meta.plan_type!=='restaurant_reservation_release')throw new Error('not_restaurant_reservation_plan')
  const{data:action}=await supabaseAdmin.from('life_event_actions').select('id,payload_json,due_at').eq('id',String(meta.life_event_action_id)).eq('telegram_id',tg).maybeSingle()
  const{data:approval}=await supabaseAdmin.from('agent_approvals').select('id,status,action_hash,policy_version').eq('run_id',params.runId).eq('telegram_id',tg).eq('action_type','booking').eq('status','approved').order('resolved_at',{ascending:false}).limit(1).maybeSingle()
  if(!action||!approval)throw new Error('approval_required')
  const p:any=action.payload_json||{}
  assertApprovalBinding(restaurantReservationApprovalInput({runId:params.runId,lifeEventId:String(meta.life_event_id),actionId:String(action.id),restaurant:String(p.restaurant||meta.restaurant||''),providerUrl:String(p.reservationUrl||meta.reservation_url||''),partySize:Number(p.partySize)||null,preferredStart:String(p.preferredStart||''),preferredEnd:String(p.preferredEnd||''),requestedDate:String(p.requestedDate||''),releaseAt:String(p.releaseAt||meta.release_at||'')||null}),approval)
  const now=new Date().toISOString()
  await Promise.all([
    supabaseAdmin.from('agent_runs').update({status:'queued',summary:'Reservation mission armed and waiting for the verified provider release time.',progress:55,updated_at:now}).eq('id',params.runId).eq('telegram_id',tg),
    supabaseAdmin.from('life_event_actions').update({status:'ready',updated_at:now,payload_json:{...p,armedAt:now,approvalId:String(approval.id)}}).eq('id',String(action.id)).eq('telegram_id',tg),
    supabaseAdmin.from('life_events').update({lifecycle_state:'planned',next_action_at:action.due_at,updated_at:now}).eq('id',String(meta.life_event_id)).eq('telegram_id',tg),
  ])
  return{runId:params.runId,status:'queued' as const,capability:'browser' as const,risk:'high' as const,handledBy:'restaurant-reservation' as const,text:'Approved and armed. Gogo will attempt only this reservation at the verified release time, inside the approved party/time bounds. If a fee, deposit, login challenge, OTP, CAPTCHA, passkey or payment step appears, I will stop and ask you.'}
}
