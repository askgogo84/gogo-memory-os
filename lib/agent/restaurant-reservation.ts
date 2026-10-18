import { createHash } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { resolveIndiaPlace, resultInPlace } from './india-locality'
import { searchWebResults, type WebSearchResult } from '@/lib/web-search'
import { normalizeTimezone, parseLocalDateTime } from '@/lib/timezone'
import { runSecureBrowser } from './secure-computer'
import { buildApprovalBinding, assertApprovalBinding } from './approval-binding'
import type { AgentActor } from './actor'
import type { AgentSurface } from './orchestrator'
import { buildContextPack, type ContextPack } from './context-brain'
import {buildReservationDiningContext, usableReservationDiningContext, reservationRequestedDateCoverage, type ReservationDiningContext} from './reservation-dining-context'

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

// Words that end a restaurant name: party size, time, date and day words.
const NAME_STOP='(?=\\s+(?:for\\s+(?:a\\s+)?(?:party\\s+of\\s+)?\\d{1,2}|between\\s+\\d|at\\s+\\d|on\\s+|this\\s+|next\\s+|coming\\s+|today|tomorrow|tonight|(?:mon|tues|wednes|thurs|fri|satur|sun)day)\\b|[,.!?]|$)'
const GENERIC_NAME=/^(?:a\s+|an\s+|the\s+)?(?:table|reservation|booking|seat|seats|dinner|lunch|brunch)$/i

function restaurantName(text:string){
  const raw=String(text||'').replace(/https?:\/\/\S+/gi,' ').replace(/\s+/g,' ').trim()
  // "Book a table for 4 at Toit Indiranagar this Friday" -> "Toit Indiranagar" (live run 10 Oct read "table").
  const atName=raw.match(new RegExp('\\b(?:table|reservation|booking|seats?)\\b(?:\\s+for\\s+(?:a\\s+party\\s+of\\s+)?\\d{1,2}(?:\\s+(?:people|persons?|guests?|pax))?)?\\s+(?:at|in)\\s+(.+?)'+NAME_STOP,'i'))?.[1]
  if(atName&&!GENERIC_NAME.test(atName.trim()))return safe(atName,160)
  const direct=raw.match(new RegExp('\\b(?:book|reserve)\\s+(.+?)'+NAME_STOP,'i'))?.[1]
  const cleaned=direct?direct.replace(/^(?:a|an)\s+(?:table\s+at\s+)?/i,'').replace(/^table\s+at\s+/i,'').trim():''
  if(cleaned&&!GENERIC_NAME.test(cleaned))return safe(cleaned,160)
  return ''
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
  if(/^(?:please\s+)?(?:what\s+(?:did|have)\s+(?:i|we)\s+(?:decide|say|agree|choose|discuss)|remind\s+me\s+what\b|what\s+was\s+(?:my|our)\s+decision\b)/i.test(text))return false
  const booking=/\b(book|booking|reserve|reservation|table)\b/.test(text)
  const restaurant=/\b(restaurant|cafe|café|bistro|bar|noodle|dinner|lunch|brunch|table|party\s+of)\b/.test(text)
    ||/\b(?:book|reserve)\s+[a-z0-9&.' -]{2,80}\s+for\s+\d{1,2}\b/i.test(text)
  const exclusions=/\b(doctor|dentist|clinic|hospital|salon|spa|flight|hotel|train|bus|movie|concert|ticket)\b/.test(text)
  const reminderOnly=/\bremind\s+me\b|\bset\s+(?:a\s+)?reminder\b/.test(text)
  return booking&&restaurant&&!exclusions&&!reminderOnly
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

const GENERIC_RESTAURANT_TOKENS=new Set(['restaurant','restaurants','cafe','café','bistro','bar','noodle','noodles','kitchen','eatery','the','table','indiranagar','koramangala','bengaluru','bangalore'])
// India-first: District (Dineout), EazyDiner, Zomato and the restaurant's own site are where tables
// are booked. A result must name the restaurant; a page that only says "table" is not a match
// (live run 10 Oct ranked a Lithuanian software company first).
const INDIA_BOOKING_HOSTS=/(?:^|\.)(?:district\.in|eazydiner\.com|zomato\.com|dineout\.co\.in|swiggy\.com|magicpin\.in)$/
function candidateScore(result:WebSearchResult,restaurant:string){
  const title=String(result.title||'').toLowerCase()
  const snippet=String(result.snippet||'').toLowerCase()
  const url=String(result.url||'').toLowerCase()
  const tokens=restaurant.toLowerCase().split(/[^a-z0-9]+/).filter(x=>x.length>2&&!GENERIC_RESTAURANT_TOKENS.has(x))
  const hits=tokens.filter(t=>title.includes(t)||snippet.includes(t)||url.includes(t)).length
  if(!tokens.length||hits===0)return -100
  if(!resultInPlace(`${title} ${snippet} ${url}`,resolveIndiaPlace(restaurant)))return -100
  let score=hits*4
  if(INDIA_BOOKING_HOSTS.test(host(url)))score+=10
  if(/book|booking|reserv|table/.test(url))score+=6
  if(/book a table|reserv|table booking/.test(title+' '+snippet))score+=5
  if(/instagram|facebook|tripadvisor|rocketreach|linkedin|crunchbase/.test(url))score-=20
  return score
}


function firstPartyRuleScore(result:WebSearchResult,restaurant:string){
  const url=String(result.url||'')
  const h=host(url).toLowerCase()
  if(!h||/instagram|facebook|reddit|tripadvisor|zomato|swiggy|youtube|linkedin|x\.com|twitter/.test(h))return-100
  const title=String(result.title||'').toLowerCase()
  const snippet=String(result.snippet||'').toLowerCase()
  const path=(()=>{try{return new URL(url).pathname.toLowerCase()}catch{return''}})()
  const tokens=restaurant.toLowerCase().split(/[^a-z0-9]+/).filter(x=>x.length>2&&!GENERIC_RESTAURANT_TOKENS.has(x))
  const identity=tokens.length?tokens:restaurant.toLowerCase().split(/[^a-z0-9]+/).filter(x=>x.length>2)
  const compactHost=h.replace(/[^a-z0-9]/g,'')
  const hostHits=identity.filter(t=>compactHost.includes(t)).length
  if(hostHits===0)return-100
  let score=hostHits*12
  score+=identity.filter(t=>title.includes(t)||snippet.includes(t)).length*3
  if(/reserv|book|menu|visit/.test(path))score+=7
  if(/reserv|bookings?|seats?|slots?/.test(title+' '+snippet))score+=8
  if(/every\s+(?:sun|mon|tue|wed|thu|fri|sat)|open\s+every|booking.*open/.test(snippet))score+=10
  return score
}

async function discoverFirstPartyRulePage(intent:RestaurantReservationIntent,providerUrl:string){
  if(!intent.restaurant)return null
  const results=await searchWebResults(`${intent.restaurant} official reservation booking rules opening time`)
  const ranked=(results||[])
    .filter(r=>/^https?:\/\//i.test(String(r.url||'')))
    .filter(r=>host(String(r.url||''))!==host(providerUrl))
    .map(r=>({r,score:firstPartyRuleScore(r,intent.restaurant)}))
    .sort((a,b)=>b.score-a.score)
  const top=ranked[0]
  return top&&top.score>=12?{url:String(top.r.url),title:safe(top.r.title||intent.restaurant,220),snippet:safe(top.r.snippet,2200),score:top.score}:null
}

const KNOWN_RESERVATION_PROVIDERS:Record<string,{url:string;location?:string}>={
  'naru noodle bar':{url:'https://bookings.airmenus.in/eatnaru/order',location:'Bengaluru'},
  'naru':{url:'https://bookings.airmenus.in/eatnaru/order',location:'Bengaluru'},
}

async function discoverProvider(intent:RestaurantReservationIntent){
  if(intent.sourceUrl)return{url:intent.sourceUrl,title:intent.restaurant||host(intent.sourceUrl),source:'explicit_url'}
  if(!intent.restaurant)return null
  const known=KNOWN_RESERVATION_PROVIDERS[intent.restaurant.toLowerCase().replace(/\s+/g,' ').trim()]
  if(known)return{url:known.url,title:intent.restaurant,source:'known_provider_page',location:known.location||null}
  const place=resolveIndiaPlace(intent.restaurant)
  const query=`${intent.restaurant} ${place.city&&!intent.restaurant.toLowerCase().includes(place.city.toLowerCase())?place.city+' ':''}India book a table District EazyDiner`
  const results=await searchWebResults(query)
  const ranked=(results||[])
    .filter(r=>/^https?:\/\//i.test(String(r.url||'')))
    .map(r=>({r,score:candidateScore(r,intent.restaurant)}))
    .sort((a,b)=>b.score-a.score)
  const top=ranked[0]
  // A listing's reviews/menu/photos page is not where a table is booked (10 Oct retest opened
  // eazydiner.com/.../toit-indiranagar-330151/reviews). Use the restaurant's main listing page.
  const bookingUrl=(url:string)=>{try{const u=new URL(url);if(INDIA_BOOKING_HOSTS.test(u.hostname.replace(/^www\./,''))){u.pathname=u.pathname.replace(/\/(?:reviews?|menu|photos?|gallery|info|order-online|overview)\/?$/i,'');u.search=''}return u.toString()}catch{return url}}
  return top?.score>0?{url:bookingUrl(String(top.r.url)),title:safe(top.r.title||intent.restaurant,220),source:'web_search',location:null}:null
}

export type ReservationRelease={
  soldOut:boolean
  releaseAt:string|null
  releaseDate:string|null
  releaseTime:string|null
  releaseRule:string|null
  openNow:boolean
}

function normalizeReservationEvidenceText(value:string){
  return String(value||'')
    .replace(/\b(\d{1,2})\s*[:.]\s*[oO0]{2}\s*(am|pm)\b/gi,'$1:00$2')
    .replace(/\s+/g,' ')
    .trim()
}

export function extractReservationRelease(pageText:string,timezone='Asia/Kolkata',now=new Date()):ReservationRelease{
  const text=normalizeReservationEvidenceText(pageText)
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

export function restaurantReservationApprovalInput(params:{runId:string;lifeEventId:string;actionId:string;restaurant:string;providerUrl:string;partySize:number|null;preferredStart:string;preferredEnd:string;requestedDate:string;releaseAt:string|null;contextWindows?:Array<{startAt:string;endAt:string|null;location:string|null;source:string;confidence:number}>;diningContext?:ReservationDiningContext;reservationLocation?:string|null}){
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
      contextWindows:params.contextWindows||[],
      ...(params.diningContext?{diningContext:params.diningContext,reservationLocation:params.reservationLocation||null}:{}),
    },
  }
}

async function existingMission(tg:number,key:string){
  const{data}=await supabaseAdmin.from('life_events').select('id,metadata_json,next_action_at,lifecycle_state').eq('telegram_id',String(tg)).eq('dedupe_key',key).maybeSingle()
  if(!data?.id)return null
  const{data:run}=await supabaseAdmin.from('agent_runs').select('id,status,error,updated_at,metadata_json').eq('telegram_id',String(tg)).eq('metadata_json->>plan_type','restaurant_reservation_release').eq('metadata_json->>life_event_id',String(data.id)).in('status',['waiting_approval','queued','running','paused','outcome_unknown','completed']).order('started_at',{ascending:false}).limit(1).maybeSingle()
  const{data:approval}=run?.id?await supabaseAdmin.from('agent_approvals').select('id,status').eq('run_id',String(run.id)).eq('telegram_id',String(tg)).eq('action_type','booking').order('requested_at',{ascending:false}).limit(1).maybeSingle():{data:null}
  return{event:data,run:run||null,approval:approval||null}
}

function reservationResearchHash(actor:AgentActor,text:string){
  return createHash('sha256')
    .update([actor.legacyTelegramId,safe(text,1800).toLowerCase()].join('|'))
    .digest('hex')
    .slice(0,40)
}

export async function queueRestaurantReservationResearch(params:{
  actor:AgentActor
  text:string
  messageId?:string|number|null
}){
  const intent=parseRestaurantReservationIntent(params.text)
  if(!intent)return null
  if(!intent.restaurant){
    return{runId:'',status:'paused' as const,capability:'browser' as const,risk:'low' as const,handledBy:'restaurant-reservation' as const,text:'Which restaurant should I reserve? Give me the restaurant name (and location if there are multiple branches).'}
  }
  if(!intent.partySize){
    return{runId:'',status:'paused' as const,capability:'browser' as const,risk:'low' as const,handledBy:'restaurant-reservation' as const,text:`How many people should I book at ${intent.restaurant} for?`}
  }

  const tg=String(params.actor.legacyTelegramId)
  const requestHash=reservationResearchHash(params.actor,params.text)
  const{data:existing,error:existingError}=await supabaseAdmin.from('agent_runs')
    .select('id,status')
    .eq('telegram_id',tg)
    .eq('type','restaurant_reservation_research')
    .eq('metadata_json->>request_hash',requestHash)
    .in('status',['queued','running'])
    .order('started_at',{ascending:false})
    .limit(1)
    .maybeSingle()
  if(existingError)throw new Error(`restaurant_research_dedupe_failed:${existingError.message}`)
  if(existing?.id){
    return{
      runId:String(existing.id),status:String(existing.status||'queued') as any,
      capability:'browser' as const,risk:'low' as const,handledBy:'restaurant-reservation-background' as const,
      text:`Still looking up ${intent.restaurant}'s booking page. I'll message you here with what I find. Nothing will be booked or paid until you approve.`,
    }
  }

  const now=new Date().toISOString()
  const{data:run,error}=await supabaseAdmin.from('agent_runs').insert({
    telegram_id:tg,
    type:'restaurant_reservation_research',
    capability:'browser',
    status:'queued',
    title:`Research reservation · ${intent.restaurant}`.slice(0,180),
    summary:'Queued provider-first restaurant reservation research for Background Gogo.',
    progress:5,
    why:'WhatsApp should return quickly while Background Gogo gets enough time to verify the live provider and first-party release rules.',
    source:'whatsapp',
    started_at:now,
    updated_at:now,
    metadata_json:{
      plan_type:'restaurant_reservation_research',
      request_hash:requestHash,
      request_text:safe(params.text,1800),
      message_id:params.messageId?String(params.messageId):null,
      restaurant:intent.restaurant,
      party_size:intent.partySize,
      preferred_start:intent.preferredStart||null,
      preferred_end:intent.preferredEnd||null,
      requested_date:intent.requestedDate||null,
      next_available:intent.nextAvailable,
      max_booking_fee_paise:0,
    },
  }).select('id').single()
  if(error||!run?.id)throw new Error(`restaurant_research_queue_failed:${error?.message||'unknown'}`)

  await supabaseAdmin.from('agent_activity').insert({
    telegram_id:tg,
    run_id:String(run.id),
    event_type:'restaurant_reservation_research_queued',
    message:`Background reservation research queued for ${intent.restaurant}.`.slice(0,900),
    metadata_json:{request_hash:requestHash,surface:'whatsapp'},
  }).then(({error})=>{if(error)console.error('RESTAURANT_RESEARCH_ACTIVITY_FAILED:',error.message)})

  return{
    runId:String(run.id),status:'queued' as const,capability:'browser' as const,risk:'low' as const,
    handledBy:'restaurant-reservation-background' as const,
    text:`Looking up ${intent.restaurant}'s booking page now. I'll message you here with the options. Nothing will be booked or paid until you approve.`,
  }
}

export async function runQueuedRestaurantReservationResearch(params:{actor:AgentActor;runId:string}){
  const tg=String(params.actor.legacyTelegramId)
  const{data:run,error}=await supabaseAdmin.from('agent_runs')
    .select('id,status,metadata_json')
    .eq('id',params.runId)
    .eq('telegram_id',tg)
    .eq('type','restaurant_reservation_research')
    .maybeSingle()
  if(error)throw new Error(`restaurant_research_run_read_failed:${error.message}`)
  if(!run?.id)throw new Error('restaurant_research_run_not_found')
  const meta:any=run.metadata_json||{}
  if(meta.plan_type!=='restaurant_reservation_research')throw new Error('not_restaurant_research_plan')
  const text=String(meta.request_text||'').trim()
  if(!text)throw new Error('restaurant_research_request_missing')

  try{
    const result=await tryRunRestaurantReservation({actor:params.actor,surface:'whatsapp',text})
    if(!result)throw new Error('restaurant_research_not_handled')
    const at=new Date().toISOString()
    await supabaseAdmin.from('agent_runs').update({
      status:'completed',
      summary:`Background restaurant research finished with status ${String(result.status||'completed')}.`,
      progress:100,
      error:null,
      completed_at:at,
      updated_at:at,
      metadata_json:{...meta,outcome_status:result.status||null,child_run_id:result.runId||null,finished_at:at},
    }).eq('id',params.runId).eq('telegram_id',tg)
    return result
  }catch(err:any){
    const at=new Date().toISOString()
    await Promise.resolve(supabaseAdmin.from('agent_runs').update({
      status:'failed',
      summary:'Background Gogo could not complete reservation research.',
      progress:100,
      error:safe(err?.message||'restaurant_research_failed',500),
      completed_at:at,
      updated_at:at,
    }).eq('id',params.runId).eq('telegram_id',tg)).catch(()=>{})
    throw err
  }
}

type DiningFact=NonNullable<ContextPack['reservationTravel']>['facts'][number]
function planningPlace(value:string){
  const place=value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim()
  return ['bangalore','blr'].includes(place)?'bengaluru':['nyc','jfk'].includes(place)?'new york':place
}
function planningSpan(date:string,start:string,end:string,timezone:string){
  if(!/^\d{2}:\d{2}$/.test(start)||!/^\d{2}:\d{2}$/.test(end)||end<=start)return null
  try{
    const from=parseLocalDateTime({date,time:start,timezone}).dueAtUtc.getTime(),until=parseLocalDateTime({date,time:end,timezone}).dueAtUtc.getTime()
    return Number.isFinite(from)&&Number.isFinite(until)&&until>from?{from,until}:null
  }catch{return null}
}
function overlapsPlanning(start:string,end:string,span:{from:number;until:number}){return Date.parse(start)<span.until&&Date.parse(end)>span.from}
function localPlanningDay(at:number,timezone:string){return new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at))}
function planningWindowBlocks(window:ReservationDiningContext['windows'][number],target:string){
  return !(['travel_presence','life_event'].includes(window.source)&&window.location&&planningPlace(window.location)===target)
}
async function reservationConflictReview(params:{actor:AgentActor;text:string;intent:RestaurantReservationIntent;location:string|null;timezone:string;releaseAt:string;pack:ContextPack;snapshot:ReservationDiningContext}):Promise<string|null>{
  const {intent,snapshot,timezone}=params,target=planningPlace(params.location||'')
  const release=Date.parse(params.releaseAt)
  const requested=intent.requestedDate?planningSpan(intent.requestedDate,intent.preferredStart,intent.preferredEnd,timezone):null
  const requestedSpan=requested||(intent.requestedDate?{from:Date.parse(snapshot.from),until:Date.parse(snapshot.until)}:null)
  const travel=requestedSpan?snapshot.windows.filter(w=>overlapsPlanning(w.startAt,w.endAt,requestedSpan)&&planningWindowBlocks(w,target)):[]
  const busy=requestedSpan?snapshot.calendar.windows.filter(w=>overlapsPlanning(w.startAt,w.endAt,requestedSpan)):[]
  const atRelease=snapshot.windows.filter(w=>Date.parse(w.startAt)<=release&&release<Date.parse(w.endAt)&&planningWindowBlocks(w,target))
  // An online release while away does not invalidate an explicitly chosen later day.
  if(intent.requestedDate?!travel.length&&!busy.length:!atRelease.length)return null
  const relevant=intent.requestedDate?travel:atRelease
  const locations=[...new Set(relevant.map(w=>safe(w.location||'location unverified',120)))].join(', ')
  const explanation=intent.requestedDate
    ?`The requested dining start-time window overlaps ${travel.length?`saved travel context (${locations})`:''}${travel.length&&busy.length?' and ':''}${busy.length?'a recorded Calendar busy interval':''}.`
    :`The booking release overlaps saved travel context (${locations}).`
  const prefix=`${explanation} The provider release is ${params.releaseAt}; the release is not the dining date.${relevant.length?' Saved travel is itinerary/plan evidence, not verified current presence or an actual return.':''} No new reservation mission or approval was created.`
  const bounds=`Keep ${intent.partySize} people, ${intent.restaurant}${params.location?` in ${params.location}`:''}, ${intent.preferredStart&&intent.preferredEnd?`${intent.preferredStart}–${intent.preferredEnd} (${timezone})`:'your preferred time window'}, and the ₹0 fee/deposit ceiling.`
  if(!intent.preferredStart||!intent.preferredEnd)return `${prefix}\n\n${bounds} Please specify a preferred time window and dining date so I can check it without inventing hours.`
  if(!relevant.length)return `${prefix}\n\n${bounds} Please choose a different dining date or time window for a fresh Calendar and provider check.`
  if(!target||!relevant.some(w=>w.applicability==='owner'))return `${prefix}\n\n${bounds} Please clarify the traveller, restaurant location and return date; an owner return is not verified from this context.`
  const ownerName=planningPlace(params.actor.name||''),ownerIdentifiers=new Set([String(params.actor.legacyTelegramId),params.actor.userId||''].filter(Boolean))
  const owned=(fact:DiningFact)=>Array.isArray(fact.participants)&&fact.participants.some(p=>typeof p==='string'&&(ownerIdentifiers.has(p.trim())||ownerName.split(' ').length>=2&&planningPlace(p)===ownerName))
  const after=requestedSpan?.until||release
  const returns=(params.pack.reservationTravel?.facts||[]).filter(fact=>{
    const route=String(fact.location||'').split(/\s*(?:→|->)\s*/)
    const arrival=Date.parse(fact.endAt||''),depart=Date.parse(fact.startAt||'')
    return fact.source==='travel_ticket'&&fact.kind==='flight'&&fact.inferred===false&&(fact.confidence||0)>=.9&&owned(fact)&&route.length===2&&planningPlace(route[1])===target&&Number.isFinite(depart)&&arrival>depart&&arrival>after&&
      relevant.some(w=>w.applicability==='owner'&&(planningPlace(w.location||'')===planningPlace(route[0])||w.source==='travel_ticket'&&w.sourceRefs.some(r=>fact.sourceRefs?.some(ref=>ref.type==='travel_ticket'&&ref.id===r.id))))&&
      fact.sourceRefs?.some(ref=>ref.type==='travel_ticket'&&typeof ref.id==='string'&&ref.id.length>0)
  }).sort((a,b)=>Date.parse(a.endAt!)-Date.parse(b.endAt!))
  const returning=returns[0]
  if(!returning)return `${prefix}\n\n${bounds} Please clarify the scheduled owner return and preferred dining date. A hotel checkout, research date or inferred stay end is not a verified return.`
  const arrival=Date.parse(returning.endAt!),base=localPlanningDay(arrival,timezone)
  const noProposal=`${prefix}\n\n${bounds} The initial saved itinerary listed an arrival at ${returning.endAt}; fresh return/context evidence could not be verified. I could not verify a compatible planning window. Please choose a date for a fresh context check; provider availability and full meal duration are not verified.`
  for(let offset=0;offset<3;offset++){
    const date=new Date(Date.parse(base+'T00:00:00Z')+offset*86400_000).toISOString().slice(0,10)
    const span=planningSpan(date,intent.preferredStart,intent.preferredEnd,timezone)
    if(!span||span.from<=Math.max(arrival,release,Date.now()))continue
    const coverage=reservationRequestedDateCoverage(date,timezone,new Date())
    if(!coverage)return noProposal
    const fresh=await buildContextPack({actor:params.actor,text:params.text,options:{includeSemantic:false,includeReservationTravel:true,includeReservationCalendar:true,reservationCalendarCoverage:coverage,maxFacts:14,horizonDays:60}}).catch(()=>null)
    const checked=buildReservationDiningContext({actor:params.actor,timezone,requestedDate:date,releaseAt:params.releaseAt,pack:fresh,now:new Date()})
    if(!usableReservationDiningContext(checked)||!checked.calendar.connected||JSON.stringify(checked.preferences)!==JSON.stringify(snapshot.preferences))return noProposal
    const retainedReturn=fresh?.reservationTravel?.facts.some(f=>owned(f)&&f.source==='travel_ticket'&&f.kind==='flight'&&f.inferred===false&&(f.confidence||0)>=.9&&f.startAt===returning.startAt&&f.endAt===returning.endAt&&f.location===returning.location&&f.sourceRefs?.some(ref=>ref.type==='travel_ticket'&&returning.sourceRefs?.some(old=>old.type==='travel_ticket'&&old.id===ref.id)))
    if(!retainedReturn||checked.windows.some(w=>overlapsPlanning(w.startAt,w.endAt,span)&&planningWindowBlocks(w,target)))return noProposal
    if(checked.calendar.windows.some(w=>overlapsPlanning(w.startAt,w.endAt,span)))continue
    return `${prefix}\n\nProvisional planning window: ${date} ${intent.preferredStart}–${intent.preferredEnd} (${timezone}) for ${intent.partySize} people at ${intent.restaurant} in ${params.location}. The saved itinerary schedules arrival at ${returning.endAt}; actual return is not verified. A fresh linked Calendar and saved-context read found no conflicting recorded interval within this start-time window. Provider availability, full meal duration and preference compatibility are not verified; this is not a booking or a fully checked dining interval. ${bounds}\n\nChoose a dining date before I prepare a new bounded approval; actual provider slot/rules and the complete meal interval still need verification.`
  }
  return noProposal
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
  let inspected:Awaited<ReturnType<typeof runSecureBrowser>>
  try{
    inspected=await runSecureBrowser({
      userId:params.actor.userId,
      url:provider.url,
      mode:'read',
      objective:`Read only the live reservation state and booking-release rules for ${intent.restaurant}. Determine whether bookings are open, sold out, or scheduled to open later. Capture any explicit next-open date and recurring release weekday/time. Do not sign in, fill personal details, reserve, submit, pay, or change anything.`,
    })
  }catch(error:any){
    if(error?.message==='browser_handoff_in_use')return{runId:'',status:'paused' as const,capability:'browser' as const,risk:'low' as const,handledBy:'restaurant-reservation' as const,text:await (await import('./browser-auth-notice')).browserHandoffInUseReply(params.actor.legacyTelegramId)}
    return{runId:'',status:'paused' as const,capability:'browser' as const,risk:'low' as const,handledBy:'restaurant-reservation' as const,text:`I found ${intent.restaurant} here: ${provider.url}\n\nI couldn't open its booking page to check tables right now, so nothing was booked. You can book there directly, or reply *try again* in a few minutes.`}
  }
  if(inspected.status==='blocked'){
    return{runId:'',status:'paused' as const,capability:'browser' as const,risk:'low' as const,handledBy:'restaurant-reservation' as const,text:`I found ${intent.restaurant} here: ${provider.url}\n\nI couldn't open its booking page to check tables right now, so nothing was booked. You can book there directly, or reply *try again* in a few minutes.`}
  }
  let release=extractReservationRelease(inspected.pageText,timezone)
  let ruleEvidenceUrl:string|null=null
  let ruleEvidenceText=''
  let ruleEvidenceTitle=''
  if(!release.openNow&&!release.releaseAt){
    const rulePage=await discoverFirstPartyRulePage(intent,provider.url)
    if(rulePage){
      ruleEvidenceUrl=rulePage.url
      ruleEvidenceTitle=rulePage.title
      const evidenceParts=[rulePage.snippet]
      try{
        const firstPartyInspection=await runSecureBrowser({
          userId:params.actor.userId,
          url:rulePage.url,
          mode:'read',
          objective:`Read only the restaurant's published reservation policy for ${intent.restaurant}. Capture recurring booking release weekday/time, seating slots, booking restrictions, cancellation/refund language, and any fee/deposit policy that is explicitly stated. Do not reserve, submit, authenticate, pay, or change anything.`,
        })
        if(firstPartyInspection.status==='completed'&&firstPartyInspection.pageText)evidenceParts.unshift(firstPartyInspection.pageText)
      }catch(error:any){
        console.error('RESTAURANT_FIRST_PARTY_RULE_INSPECTION_FAILED:',safe(error?.message||error,220))
      }
      ruleEvidenceText=evidenceParts.filter(Boolean).join('\n')
      const firstPartyRelease=extractReservationRelease(ruleEvidenceText,timezone)
      if(firstPartyRelease.openNow||firstPartyRelease.releaseAt){
        release={
          ...firstPartyRelease,
          soldOut:release.soldOut||firstPartyRelease.soldOut,
          openNow:release.openNow||firstPartyRelease.openNow,
        }
      }
    }
  }
  if(!release.openNow&&!release.releaseAt){
    const evidence=safe(inspected.pageText,700)
    const ruleNote=ruleEvidenceUrl?`\nFirst-party policy checked: ${ruleEvidenceUrl}`:''
    return{runId:'',status:'paused' as const,capability:'browser' as const,risk:'low' as const,handledBy:'restaurant-reservation' as const,text:`I checked the live booking provider for ${intent.restaurant}, but I could not verify an exact future booking-release time from reliable provider/first-party evidence. I will not turn this into an arbitrary reminder.\n\nProvider: ${provider.url}${ruleNote}\nObserved: ${evidence||'No reliable release rule was exposed.'}`}
  }

  const releaseAt=release.openNow?new Date().toISOString():release.releaseAt!
  const combinedReleaseEvidence=[inspected.pageText,ruleEvidenceText].filter(Boolean).join('\n')
  const releaseSourceRefs=[
    {source:'provider',kind:'restaurant_reservation_page',url:provider.url},
    ...(ruleEvidenceUrl?[{source:'provider',kind:'restaurant_first_party_reservation_rules',url:ruleEvidenceUrl,title:ruleEvidenceTitle}]:[]),
  ]
  const calendarCoverage=reservationRequestedDateCoverage(intent.requestedDate,timezone,new Date())
  if(calendarCoverage===null)return{runId:'',status:'paused' as const,capability:'browser' as const,risk:'low' as const,handledBy:'restaurant-reservation' as const,text:'The requested dining date could not be verified as a future local date. No mission was armed or booking attempted.'}
  const contextPack=await buildContextPack({
    actor:params.actor,
    text:params.text,
    options:{includeSemantic:false,includeReservationTravel:true,includeReservationCalendar:true,reservationCalendarCoverage:calendarCoverage,maxFacts:14,horizonDays:60},
  }).catch(()=>null)
  const diningContext=buildReservationDiningContext({actor:params.actor,timezone,requestedDate:intent.requestedDate,releaseAt,pack:contextPack,now:new Date()})
  if(diningContext.incomplete)return{runId:'',status:'paused' as const,capability:'browser' as const,risk:'low' as const,handledBy:'restaurant-reservation' as const,
    text:'I verified the reservation release, but could not verify bounded travel and Calendar context for the possible dining dates. No reservation mission was armed or booking attempted. Retry the context check, or specify a dining date to narrow the Calendar read, before approving an attempt.'}
  const conflictReview=contextPack?await reservationConflictReview({actor:params.actor,text:params.text,intent,location:provider.location||null,timezone,releaseAt,pack:contextPack,snapshot:diningContext}):null
  if(conflictReview)return{runId:'',status:'paused' as const,capability:'browser' as const,risk:'low' as const,handledBy:'restaurant-reservation' as const,text:conflictReview}
  const contextWindows=diningContext.windows
  const contextRefs=[...contextWindows.flatMap(window=>window.sourceRefs),...diningContext.calendar.windows.flatMap(window=>window.sourceRefs)].slice(0,30)
  const key=dedupeKey(params.actor,intent,provider.url)
  const existing=await existingMission(params.actor.legacyTelegramId,key)
  if(existing?.event?.metadata_json?.reservationConfirmed===true||existing?.run?.metadata_json?.providerConfirmationVerified===true)return{runId:String(existing?.run?.id||''),status:'paused' as const,capability:'browser' as const,risk:'low' as const,handledBy:'restaurant-reservation' as const,text:'A provider confirmation is already recorded for this reservation. Do not book it again. Review that same task; specify a different dining date if you intend a separate reservation.'}
  const refreshInProgress=String(existing?.run?.error||'').startsWith('restaurant_context_refresh:')
  const refreshUpdated=Date.parse(String(existing?.run?.updated_at||''))
  const abandonedRefresh=refreshInProgress&&(!Number.isFinite(refreshUpdated)||refreshUpdated<=Date.now()-5*60_000)
  const refreshing=Boolean(existing?.run?.id&&((existing.run.status==='paused'&&existing.run.error==='restaurant_context_review_required')||abandonedRefresh))
  if(refreshInProgress&&!abandonedRefresh)return{runId:String(existing!.run!.id),status:'paused' as const,capability:'browser' as const,risk:'low' as const,handledBy:'restaurant-reservation' as const,text:'This reservation context is being refreshed. No new booking attempt was made. Retry in five minutes if the refresh is interrupted.'}
  if(existing?.run?.id&&!refreshing){
    const status=String(existing.run.status)
    const approvalStatus=String(existing.approval?.status||'')
    const line=approvalStatus==='pending'?'Reply APPROVE to arm it, or REJECT to stop.':approvalStatus==='approved'?'It is already approved and armed.':'The mission is already active.'
    return{runId:String(existing.run.id),status:status as any,capability:'browser' as const,risk:'high' as const,handledBy:'restaurant-reservation' as const,approvalId:existing.approval?.id||undefined,approvalRequired:approvalStatus==='pending',text:`I already have this ${intent.restaurant} reservation mission. ${line}`}
  }
  const refreshToken=refreshing?`restaurant_context_refresh:${createHash('sha256').update(`${key}|${Date.now()}|${Math.random()}`).digest('hex')}`:null
  if(refreshing){
    let claim=supabaseAdmin.from('agent_runs').update({status:'running',error:refreshToken,summary:'Refreshing dining context for a new bounded approval.',updated_at:new Date().toISOString()})
      .eq('id',existing!.run!.id).eq('telegram_id',String(params.actor.legacyTelegramId)).eq('status',existing!.run!.status).eq('error',existing!.run!.error)
    if(existing!.run!.updated_at)claim=claim.eq('updated_at',existing!.run!.updated_at)
    const {data:claimed,error}=await claim.select('id').maybeSingle()
    if(error)throw new Error('restaurant_context_refresh_claim_failed')
    if(!claimed)return{runId:String(existing!.run!.id),status:'paused' as const,capability:'browser' as const,risk:'low' as const,handledBy:'restaurant-reservation' as const,text:'This reservation context is already being refreshed. No new booking attempt was made.'}
  }
  try{
  if(refreshing){
    // A failed expiry or an interrupted refresh may leave old pending authority.
    // Retire it before changing context; the new snapshot needs a new approval.
    const {error}=await supabaseAdmin.from('agent_approvals').update({status:'expired',resolved_at:new Date().toISOString(),resolution_note:'restaurant_context_review_required'})
      .eq('run_id',existing!.run!.id).eq('telegram_id',String(params.actor.legacyTelegramId)).eq('action_type','booking').in('status',['pending','approved'])
    if(error)throw new Error('restaurant_context_refresh_expiry_failed')
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
    location:provider.location||null,
    lifecycle_state:'planned',
    participants:[],
    preferences_json:{partySize:intent.partySize,preferredStart:intent.preferredStart||null,preferredEnd:intent.preferredEnd||null,requestedDate:intent.requestedDate||null,nextAvailable:intent.nextAvailable,maxBookingFeePaise:0},
    metadata_json:{restaurant:intent.restaurant,reservationUrl:provider.url,reservationLocation:provider.location||null,providerDiscovery:provider.source,releaseAt,releaseRule:release.releaseRule,releaseEvidence:safe(combinedReleaseEvidence,2600),releaseEvidenceUrl:ruleEvidenceUrl,readOnlyInspection:true,contextWindows,contextRefs,diningContext},
    source_refs:[...releaseSourceRefs,...contextRefs],
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
    action_type:'browser_prepare',
    capability:'browser',
    title:`Attempt ${intent.restaurant} reservation at release`.slice(0,220),
    due_at:releaseAt,
    requires_approval:true,
    irreversible:true,
    status:'waiting_approval',
    payload_json:{reservationUrl:provider.url,restaurant:intent.restaurant,reservationLocation:provider.location||null,partySize:intent.partySize,preferredStart:intent.preferredStart||null,preferredEnd:intent.preferredEnd||null,requestedDate:intent.requestedDate||null,nextAvailable:intent.nextAvailable,maxBookingFeePaise:0,releaseAt,releaseRule:release.releaseRule,contextWindows,contextRefs,diningContext},
    updated_at:now,
  },{onConflict:'life_event_id,action_key'}).select('id').single()
  if(actionError||!action?.id)throw new Error(`restaurant_reservation_action_failed:${actionError?.message||'unknown'}`)
  const actionId=String(action.id)
  const runValues={
    telegram_id:String(params.actor.legacyTelegramId),type:'restaurant_reservation',capability:'browser',status:'waiting_approval',
    title:`Reserve ${intent.restaurant}`.slice(0,180),
    summary:'Provider release time verified. Waiting for bounded approval before the scheduled reservation attempt.',
    progress:35,why:'Gogo inspected the provider page read-only and will only attempt the reservation inside the approved restaurant/party/time/fee bounds.',
    source:params.surface,started_at:now,updated_at:now,error:refreshToken,
    metadata_json:{plan_type:'restaurant_reservation_release',life_event_id:lifeEventId,life_event_action_id:actionId,restaurant:intent.restaurant,reservation_url:provider.url,release_at:releaseAt,context_windows:contextWindows,context_refs:contextRefs,dining_context:diningContext,constraints:{partySize:intent.partySize,preferredStart:intent.preferredStart||null,preferredEnd:intent.preferredEnd||null,requestedDate:intent.requestedDate||null,nextAvailable:intent.nextAvailable,maxBookingFeePaise:0}},
  }
  const runWrite=refreshing
    ? supabaseAdmin.from('agent_runs').update(runValues).eq('id',existing!.run!.id).eq('telegram_id',String(params.actor.legacyTelegramId)).eq('error',refreshToken)
    : supabaseAdmin.from('agent_runs').insert(runValues)
  const{data:run,error:runError}=await runWrite.select('id').single()
  if(runError||!run?.id)throw new Error(`restaurant_reservation_run_failed:${runError?.message||'unknown'}`)
  const runId=String(run.id)
  const binding=buildApprovalBinding(restaurantReservationApprovalInput({runId,lifeEventId,actionId,restaurant:intent.restaurant,providerUrl:provider.url,partySize:intent.partySize,preferredStart:intent.preferredStart,preferredEnd:intent.preferredEnd,requestedDate:intent.requestedDate,releaseAt,contextWindows,diningContext,reservationLocation:provider.location||null}))
  const{data:approval,error:approvalError}=await supabaseAdmin.from('agent_approvals').insert({
    telegram_id:String(params.actor.legacyTelegramId),run_id:runId,action_type:'booking',
    title:`Approve timed reservation attempt · ${intent.restaurant}`.slice(0,220),
    description:'This approval is bounded to this restaurant, party size, preferred time window and zero booking fee/deposit. If the provider requires a fee, payment or protected authentication, Gogo must stop and ask you.',
    payload_preview:[
      {label:'Restaurant',value:intent.restaurant},
      {label:'Party',value:String(intent.partySize)},
      {label:'Preferred time',value:intent.preferredStart&&intent.preferredEnd?`${intent.preferredStart}–${intent.preferredEnd}`:'Next available'},
      {label:'Booking release',value:releaseAt},
      {label:'Dining dates covered',value:`${diningContext.from} – ${diningContext.until} (${timezone})`},
      {label:'Calendar conflicts',value:diningContext.calendar.connected?`${diningContext.calendar.windows.length} busy intervals checked in the covered dates`:'Not connected; Calendar conflicts are not verified'},
      {label:'Standing dining preferences',value:diningContext.preferences.map(rule=>rule.text).join('; ')||'No explicit rules returned in the complete owner lookup'},
      {label:'Fee/deposit',value:'₹0 approved; ask before any charge'},
    ],
    execution_payload:{plan_type:'restaurant_reservation_release',lifeEventId,lifeEventActionId:actionId,action:'arm_scheduled_restaurant_reservation'},
    risk_level:'high',status:'pending',...binding,
  }).select('id').single()
  if(approvalError||!approval?.id)throw new Error(`restaurant_reservation_approval_failed:${approvalError?.message||'unknown'}`)
  if(refreshing){
    const {data:cleared,error}=await supabaseAdmin.from('agent_runs').update({error:null}).eq('id',runId).eq('telegram_id',String(params.actor.legacyTelegramId)).eq('error',refreshToken).select('id').maybeSingle()
    if(error||!cleared)throw new Error('restaurant_context_refresh_finalize_failed')
  }
  await supabaseAdmin.from('agent_activity').insert({
    telegram_id:String(params.actor.legacyTelegramId),run_id:runId,event_type:'restaurant_reservation_prepared',
    message:`Provider release verified for ${intent.restaurant}; bounded reservation approval requested.`,
    metadata_json:{life_event_id:lifeEventId,action_id:actionId,approval_id:approval.id,provider_url:provider.url,release_at:releaseAt},
  }).then(()=>{})

  const when=new Intl.DateTimeFormat('en-IN',{timeZone:timezone,dateStyle:'medium',timeStyle:'short'}).format(new Date(releaseAt))
  const evidence=release.releaseRule
    ? `${ruleEvidenceUrl?'First-party reservation rule':'Provider rule'}: ${release.releaseRule}.`
    :(release.openNow?'The provider page currently exposes booking controls.':'Provider release time verified.')
  const window=intent.preferredStart&&intent.preferredEnd?`${intent.preferredStart}–${intent.preferredEnd}`:'next available'
  const travelNote=contextWindows.length
    ? '\n\nRelevant saved travel windows are attached for the possible dining dates. An inferred or unattributed traveller window requires clarification if it overlaps the dining slot; it is not proof that you are away.'
    : ''
  const calendarNote=diningContext.calendar.connected?`\nCalendar: ${diningContext.calendar.windows.length} busy intervals attached for the covered dates. The full dining interval must avoid them.`:'\nCalendar is not connected, so Calendar conflicts have not been verified.'
  return{
    runId,status:'waiting_approval' as const,capability:'browser' as const,risk:'high' as const,handledBy:'restaurant-reservation' as const,
    approvalId:String(approval.id),approvalRequired:true,
    text:`I checked ${intent.restaurant}'s live booking provider first${ruleEvidenceUrl?' and verified the release rule against the restaurant\'s first-party reservation policy':''}. ${evidence}${travelNote}${calendarNote}\n\nI created a persistent reservation mission for ${when} (${timezone}).\n• Party: ${intent.partySize}\n• Preferred slot: ${window}${intent.requestedDate?`\n• Requested date: ${intent.requestedDate}`:''}\n• Fee/deposit authority: ₹0 — I must stop and ask before any charge.\n\nReply APPROVE to arm this exact bounded reservation attempt, or REJECT to stop it.`,
  }
  }catch(error){
    if(refreshing){
      const {error:rollbackError}=await supabaseAdmin.from('agent_runs').update({status:'paused',error:'restaurant_context_review_required',summary:'Context refresh did not finish. The reservation remains unarmed; retry the bounded context review.',updated_at:new Date().toISOString()})
      .eq('id',existing!.run!.id).eq('telegram_id',String(params.actor.legacyTelegramId)).eq('error',refreshToken)
      if(rollbackError)throw new Error('restaurant_context_refresh_rollback_failed')
    }
    throw error
  }
}

export async function armApprovedRestaurantReservation(params:{actor:AgentActor;runId:string}){
  const tg=String(params.actor.legacyTelegramId)
  const{data:run,error}=await supabaseAdmin.from('agent_runs').select('id,status,error,updated_at,metadata_json').eq('id',params.runId).eq('telegram_id',tg).maybeSingle()
  if(error||!run)throw new Error('restaurant_reservation_run_not_found')
  if(String(run.error||'').startsWith('restaurant_context_refresh:'))throw new Error('restaurant_context_refresh_in_progress')
  const meta:any=run.metadata_json||{}
  if(meta.plan_type!=='restaurant_reservation_release')throw new Error('not_restaurant_reservation_plan')
  const{data:action}=await supabaseAdmin.from('life_event_actions').select('id,status,updated_at,payload_json,due_at').eq('id',String(meta.life_event_action_id)).eq('telegram_id',tg).maybeSingle()
  if(meta.providerConfirmationVerified===true||action?.payload_json?.providerConfirmationVerified===true)throw new Error('restaurant_reservation_already_confirmed')
  // A failed receipt may leave no confirmation flag. Only pre-execution states
  // can arm authority; an attempted/blocked mission must be reconciled first.
  const initialApproval=action?.status==='waiting_approval'&&['waiting_approval','queued'].includes(run.status)
  const alreadyArmed=run.status==='queued'&&action?.status==='ready'
  if(run.error||(!initialApproval&&!alreadyArmed))throw new Error('restaurant_reservation_reconciliation_required')
  const{data:approval}=await supabaseAdmin.from('agent_approvals').select('id,status,action_hash,policy_version').eq('run_id',params.runId).eq('telegram_id',tg).eq('action_type','booking').eq('status','approved').order('resolved_at',{ascending:false}).limit(1).maybeSingle()
  if(!action||!approval)throw new Error('approval_required')
  const p:any=action.payload_json||{}
  assertApprovalBinding(restaurantReservationApprovalInput({runId:params.runId,lifeEventId:String(meta.life_event_id),actionId:String(action.id),restaurant:String(p.restaurant||meta.restaurant||''),providerUrl:String(p.reservationUrl||meta.reservation_url||''),partySize:Number(p.partySize)||null,preferredStart:String(p.preferredStart||''),preferredEnd:String(p.preferredEnd||''),requestedDate:String(p.requestedDate||''),releaseAt:String(p.releaseAt||meta.release_at||'')||null,contextWindows:Array.isArray(p.contextWindows)?p.contextWindows:[],diningContext:p.diningContext,reservationLocation:p.reservationLocation||null}),approval)
  // Refresh and arming compete for the same captured run version. A stale arm
  // must lose before it can restore an old payload or expire new authority.
  async function transitionRun(values:Record<string,unknown>){
    let write=supabaseAdmin.from('agent_runs').update(values).eq('id',params.runId).eq('telegram_id',tg).eq('status',run!.status)
    write=run!.error===null||run!.error===undefined?write.is('error',null):write.eq('error',run!.error)
    write=run!.updated_at?write.eq('updated_at',run!.updated_at):write.is('updated_at',null)
    const {data,error}=await write.select('id').maybeSingle()
    if(error||!data)throw new Error('restaurant_reservation_state_changed')
  }
  async function transitionAction(values:Record<string,unknown>){
    let write=supabaseAdmin.from('life_event_actions').update(values).eq('id',action!.id).eq('telegram_id',tg)
    write=action!.status?write.eq('status',action!.status):write.is('status',null)
    write=action!.updated_at?write.eq('updated_at',action!.updated_at):write.is('updated_at',null)
    const {data,error}=await write.select('id').maybeSingle()
    if(error||!data)throw new Error('restaurant_reservation_action_changed')
  }
  if(!usableReservationDiningContext(p.diningContext)||Date.parse(p.diningContext.until)<=Date.now()){
    const at=new Date().toISOString()
    await transitionRun({status:'paused',error:'restaurant_context_review_required',summary:'This approval lacks current verified dining-date coverage. Request a refreshed bounded approval; no reservation was armed.',updated_at:at})
    await transitionAction({status:'blocked',updated_at:at})
    const results=await Promise.all([
      supabaseAdmin.from('agent_approvals').update({status:'expired',resolved_at:at,resolution_note:'restaurant_context_review_required'}).eq('id',approval.id).eq('telegram_id',tg).eq('status','approved'),
    ])
    if(results.some(result=>result.error))throw new Error('restaurant_context_review_pause_failed')
    return{runId:params.runId,status:'paused' as const,capability:'browser' as const,risk:'low' as const,handledBy:'restaurant-reservation' as const,text:'This older reservation approval needs verified dining-date context. Nothing was armed. Request the reservation again to refresh this same mission and review a new bounded approval.'}
  }
  const now=new Date().toISOString()
  if(alreadyArmed)return{runId:params.runId,status:'queued' as const,capability:'browser' as const,risk:'high' as const,handledBy:'restaurant-reservation' as const,text:'This exact reservation is already armed. No new attempt or authority was created.'}
  await transitionRun({status:'queued',summary:'Reservation approval accepted; preparing the scheduled action.',progress:55,updated_at:now})
  await transitionAction({status:'ready',updated_at:now,payload_json:{...p,armedAt:now,approvalId:String(approval.id)}})
  const results=await Promise.all([
    supabaseAdmin.from('life_events').update({lifecycle_state:'planned',next_action_at:action.due_at,updated_at:now}).eq('id',String(meta.life_event_id)).eq('telegram_id',tg),
  ])
  if(results.some(result=>result.error))throw new Error('restaurant_reservation_arm_persistence_failed')
  return{runId:params.runId,status:'queued' as const,capability:'browser' as const,risk:'high' as const,handledBy:'restaurant-reservation' as const,text:'Approved and armed. Gogo will attempt only this reservation at the verified release time, inside the approved party/time bounds. If a fee, deposit, login challenge, OTP, CAPTCHA, passkey or payment step appears, I will stop and ask you.'}
}
