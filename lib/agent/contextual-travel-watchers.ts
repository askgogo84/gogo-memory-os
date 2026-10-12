import { createHash } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getCostBudget } from '@/lib/services/cost-guard'
import { ticketTimezone } from '@/lib/services/travel-time'
import { isValidTimezone } from '@/lib/timezone'
import { normalizeFlightNo } from './flight-leg-tracker'

type TravelRow={
  id:string
  telegram_id:number|string
  booking_group?:string|null
  leg_index?:number|null
  from_city?:string|null
  to_city?:string|null
  depart_at:string
  arrive_at?:string|null
  airline?:string|null
  flight_no?:string|null
  raw?:any
}

type ContextMeta={
  contextual:true
  contextualKind:'travel'
  contextKey:string
  contextRoot:string
  contextClass:'flight_status'|'connection_ground'|'destination_weather'|'travel_email'|'airline_news'
  traveller?:string|null
  reason:string
  expiresAt:string
  sourceRefs:Array<{type:'travel_ticket';id:string}>
  userStoppedAt?:string|null
}

function clean(value:unknown,max=160){
  return String(value??'').replace(/\s+/g,' ').trim().slice(0,max)
}
function validIso(value:unknown){
  const ms=Date.parse(String(value||''))
  return Number.isFinite(ms)?new Date(ms).toISOString():null
}
function rootFor(rows:TravelRow[]){
  const ids=rows.map(row=>String(row.id)).sort().join('|')
  return 'travel:'+createHash('sha256').update(ids).digest('hex').slice(0,24)
}
// Format the calendar date the way the traveller experiences it: in the leg/destination's
// own timezone. A UTC-only label misdates an evening departure whose local date differs
// from the UTC date (e.g. 2026-09-27T22:35Z is 28 September locally), which then makes the
// verifier reject a correctly-dated status/weather result. Falls back to UTC when the zone
// can't be resolved, preserving prior behaviour for unknown cities.
function dateLabel(value:string,timezone?:string|null){
  const zone=timezone&&isValidTimezone(timezone)?timezone:'UTC'
  return new Intl.DateTimeFormat('en-GB',{timeZone:zone,day:'numeric',month:'long',year:'numeric'}).format(new Date(value))
}
function sourceRefs(rows:TravelRow[]){
  return rows.slice(0,8).map(row=>({type:'travel_ticket' as const,id:String(row.id)}))
}
function flightLabel(rows:TravelRow[]){
  return rows.map(row=>normalizeFlightNo(clean(row.flight_no,30))).filter(Boolean).join(' + ')
}
/** The name the user calls the traveller ("Divya"), when the ticket recorded one. */
function travellerOf(rows:TravelRow[]){
  for(const row of rows){const v=Object.values(row.raw?.travellerAliases||{})[0];if(v)return clean(v,40)}
  return null
}
function routeLabel(rows:TravelRow[]){
  const first=rows[0],last=rows[rows.length-1]
  return [clean(first?.from_city,80),clean(last?.to_city,80)].filter(Boolean).join(' → ')
}
function tripExpiry(rows:TravelRow[]){
  const times=rows.map(row=>Date.parse(String(row.arrive_at||row.depart_at||''))).filter(Number.isFinite)
  const end=times.length?Math.max(...times):Date.now()
  // Stay useful through the first 72h after final arrival; the next trip/return
  // ticket will create its own context. This is bounded and automatically expires.
  return new Date(end+72*3600_000).toISOString()
}
// The destination "stay" is the city with the longest gap between an arrival and the next
// departure from that same city. For a round trip that is the away city (bounded by the
// return departure); for a one-way it is the final arrival city (open-ended stay). This
// correctly handles chronologically-sorted round trips where the LAST leg returns home.
function awayStay(rows:TravelRow[]):{city:string;arriveMs:number;endMs:number}|null{
  // You don't "stay" at your origin, so a round trip's final arrival home is not a
  // destination candidate — otherwise its open-ended (no onward leg) gap would always win.
  const originCity=clean(rows[0]?.from_city,100)
  let best:{city:string;arriveMs:number;endMs:number;stayMs:number}|null=null
  for(let i=0;i<rows.length;i++){
    const city=clean(rows[i]?.to_city,100)
    const arriveMs=Date.parse(String(rows[i]?.arrive_at||rows[i]?.depart_at||''))
    if(!city||city===originCity||!Number.isFinite(arriveMs))continue
    const onward=rows.slice(i+1).find(row=>clean(row.from_city,100)===city&&Date.parse(String(row.depart_at||''))>arriveMs)
    const endMs=onward?Date.parse(String(onward.depart_at)):NaN
    const stayMs=Number.isFinite(endMs)?endMs-arriveMs:Number.POSITIVE_INFINITY // final destination = open-ended
    if(!best||stayMs>best.stayMs)best={city,arriveMs,endMs,stayMs}
  }
  return best?{city:best.city,arriveMs:best.arriveMs,endMs:best.endMs}:null
}
// Destination weather tracks the STAY, not the outbound leg. Bounded by the return
// departure when known; a one-way (open-ended) stay extends to a reasonable horizon
// instead of ending 72h after arrival.
function destinationStayExpiry(rows:TravelRow[],fallbackExpiresAt:string){
  const stay=awayStay(rows)
  if(!stay)return fallbackExpiresAt
  if(Number.isFinite(stay.endMs))return new Date(stay.endMs+24*3600_000).toISOString()
  const oneWayStay=new Date(stay.arriveMs+7*24*3600_000).toISOString()
  return Date.parse(oneWayStay)>Date.parse(fallbackExpiresAt)?oneWayStay:fallbackExpiresAt
}
function desiredWebConditions(rows:TravelRow[],root:string,expiresAt:string){
  const first=rows[0],last=rows[rows.length-1]
  const flights=flightLabel(rows)
  const route=routeLabel(rows)
  const stay=awayStay(rows)
  // The destination is the city the traveller actually stays in (longest gap between an
  // arrival and the next departure), NOT the final leg's arrival — which for a round trip
  // is home. Falls back to the last arrival city for a simple one-way.
  const destination=(stay?.city||clean(last?.to_city,100))||'destination'
  const connection=rows.length>1?clean(rows[0]?.to_city,100):''
  const departDate=dateLabel(first.depart_at,ticketTimezone(first.from_city))
  // The date the traveller is actually AT the destination: the away-stay arrival for a round
  // trip, the final arrival for a one-way — formatted in the destination's own timezone. Using
  // the last leg's arrival would be the return-home date on a round trip, which then rejects
  // correctly-dated destination weather/ground results as a date mismatch.
  const stayArriveIso=stay?new Date(stay.arriveMs).toISOString():String(last.arrive_at||last.depart_at||'')
  const destinationDate=dateLabel(stayArriveIso,ticketTimezone(destination))
  // Every leg's dates, so a disruption reported for a later/overnight leg with ITS own
  // date still verifies (the flight-status query previously carried only the first date).
  // Each leg's depart/arrive is labelled in that endpoint's own timezone.
  const legDates=Array.from(new Set(
    rows.flatMap(row=>[
      row.depart_at?dateLabel(String(row.depart_at),ticketTimezone(row.from_city)):'',
      row.arrive_at?dateLabel(String(row.arrive_at),ticketTimezone(row.to_city)):'',
    ]).filter(Boolean)
  )).join(' ')
  const refs=sourceRefs(rows)
  const airline=clean(rows.map(row=>row.airline).find(Boolean),60).replace(/\s+Royal Dutch Airlines$/i,'')
  const base=(contextClass:ContextMeta['contextClass'],reason:string):ContextMeta=>({
    contextual:true,contextualKind:'travel',contextKey:`${root}:${contextClass}`,contextRoot:root,
    contextClass,reason,expiresAt,sourceRefs:refs,traveller:travellerOf(rows),
  })
  return [
    {
      type:'web_search',
      condition:{
        title:`Trip flight status · ${flights||route}`,
        query:`${flights} flight status ${legDates||departDate} ${route}`.replace(/\s+/g,' ').trim(),
        triggerKeywords:['delay','delayed','cancelled','cancellation','gate change','schedule change','diverted'],
        delivery:'both',cadenceMinutes:180,burstUntil:null,
        // Per-leg "flightNo @ departure date" so a disruption is verified against the
        // date of the SPECIFIC leg whose flight number the result cites (not any leg date).
        flightLegs:rows.map(row=>`${normalizeFlightNo(clean(row.flight_no,30))} @ ${dateLabel(String(row.depart_at||row.arrive_at||''),ticketTimezone(row.from_city))}`).filter(s=>!s.startsWith(' @')),
        ...base('flight_status','Watch only for material changes to the saved flight legs before and during departure.'),
      },
    },
    {
      type:'web_search',
      condition:{
        title:`Trip connection & ground transit · ${connection||destination}`,
        query:connection
          ? `${connection} airport connection disruption ${destination} airport ground transit disruption ${departDate} ${destinationDate}`
          : `${destination} airport ground transit disruption ${destinationDate}`,
        triggerKeywords:['airport closure','terminal change','security disruption','strike','service suspended','major delay','ground transport disruption'],
        delivery:'both',cadenceMinutes:360,burstUntil:null,
        ...base('connection_ground','Watch for high-signal airport/connection or arrival ground-transit disruption tied to this itinerary.'),
      },
    },
    {
      type:'web_search',
      condition:{
        title:`Trip weather · ${destination}`,
        query:`${destination} weather travel conditions ${destinationDate}`,
        triggerKeywords:['weather warning','storm','heavy rain','snow','flood','extreme heat','severe weather','travel advisory'],
        delivery:'both',cadenceMinutes:360,burstUntil:null,
        // Weather follows the destination stay, not the outbound leg's completion.
        ...base('destination_weather','Watch destination weather only for conditions likely to affect this saved trip.'),
        expiresAt:destinationStayExpiry(rows,expiresAt),
      },
    },
    ...(airline?[{
      type:'web_search' as const,
      condition:{
        title:`Trip airline news · ${airline}`,
        query:`${airline} strike outage cancellations ${departDate}`,
        triggerKeywords:['strike','industrial action','outage','system outage','grounded','mass cancellations','walkout'],
        delivery:'both',cadenceMinutes:360,burstUntil:null,
        ...base('airline_news','Watch for airline-wide disruption (strikes, outages, groundings) that could affect this trip.'),
      },
    }]:[]),
  ]
}

async function upsertContextWatcher(params:{telegramId:string;type:'web_search'|'email_triage';condition:any}){
  const key=String(params.condition.contextKey)
  const {data:existing,error:readError}=await supabaseAdmin.from('agent_watchers')
    .select('id,active,condition_json,last_state_json')
    .eq('telegram_id',params.telegramId)
    .eq('condition_json->>contextKey',key)
    .order('created_at',{ascending:false})
    .limit(1)
    .maybeSingle()
  if(readError)throw new Error(`context_watch_read_failed:${readError.message}`)
  if(existing?.id){
    const old:any=existing.condition_json||{}
    if(old.userStoppedAt){
      return {id:String(existing.id),active:false,stopped:true,created:false}
    }
    const now=new Date().toISOString()
    const {error}=await supabaseAdmin.from('agent_watchers').update({
      type:params.type,condition_json:{...params.condition,userStoppedAt:null},
      cadence_minutes:Number(params.condition.cadenceMinutes||180),
      active:true,
      next_check_at:existing.active?undefined:now,
      updated_at:now,
    }).eq('id',existing.id).eq('telegram_id',params.telegramId)
    if(error)throw new Error(`context_watch_update_failed:${error.message}`)
    return {id:String(existing.id),active:true,stopped:false,created:false}
  }
  const now=new Date().toISOString()
  const {data,error}=await supabaseAdmin.from('agent_watchers').insert({
    telegram_id:params.telegramId,type:params.type,condition_json:params.condition,
    cadence_minutes:Number(params.condition.cadenceMinutes||180),active:true,
    last_state_json:params.type==='email_triage'?{seenMessageIds:[],lastActionCount:0}:{quietChecks:0,seenUrls:[],seenSignatures:[],alertTimes:[]},
    next_check_at:now,created_at:now,updated_at:now,
  }).select('id').single()
  if(error||!data?.id)throw new Error(`context_watch_create_failed:${error?.message||'unknown'}`)
  return {id:String(data.id),active:true,stopped:false,created:true}
}

async function compileForUser(telegramId:string,rows:TravelRow[]){
  const now=Date.now()
  const sorted=rows.slice().sort((a,b)=>Date.parse(a.depart_at)-Date.parse(b.depart_at))
  const first=sorted.find(row=>Date.parse(row.depart_at)>=now-6*3600_000)
  if(!first)return {created:0,reused:0,stopped:0,skipped:0}
  const group=first.booking_group
    ? sorted.filter(row=>String(row.booking_group||'')===String(first.booking_group))
    : [first]
  group.sort((a,b)=>(Number(a.leg_index||0)-Number(b.leg_index||0))||Date.parse(a.depart_at)-Date.parse(b.depart_at))
  const root=rootFor(group)
  const expiresAt=tripExpiry(group)
  const refs=sourceRefs(group)

  // Keep only the nearest active travel context. Older contextual monitors are
  // retired, but user-created/manual watchers are never touched.
  const {data:old,error:oldError}=await supabaseAdmin.from('agent_watchers')
    .select('id,condition_json')
    .eq('telegram_id',telegramId)
    .eq('active',true)
    .eq('condition_json->>contextualKind','travel')
    .limit(30)
  if(oldError)throw new Error(`context_watch_old_read_failed:${oldError.message}`)
  const retire=(old||[]).filter((row:any)=>String(row.condition_json?.contextRoot||'')!==root || Date.parse(String(row.condition_json?.expiresAt||''))<=now)
  if(retire.length){
    await supabaseAdmin.from('agent_watchers').update({
      active:false,next_check_at:null,updated_at:new Date().toISOString(),
    }).in('id',retire.map((row:any)=>row.id)).eq('telegram_id',telegramId)
  }

  const budget=await getCostBudget(telegramId)
  const {data:activeWeb,error:countError}=await supabaseAdmin.from('agent_watchers')
    .select('id,condition_json')
    .eq('telegram_id',telegramId).eq('active',true)
    .in('type',['web_search','web_page','product_stock'])
  if(countError)throw new Error(`context_watch_count_failed:${countError.message}`)
  const manualCount=(activeWeb||[]).filter((row:any)=>row.condition_json?.contextual!==true).length
  const existingContextKeys=new Set((activeWeb||[])
    .filter((row:any)=>row.condition_json?.contextRoot===root)
    .map((row:any)=>String(row.condition_json?.contextKey||'')))
  let slots=Math.max(0,Number(budget.activeWebWatchersMax||0)-manualCount)
  let created=0,reused=0,stopped=0,skipped=0

  for(const desired of desiredWebConditions(group,root,expiresAt)){
    const key=String(desired.condition.contextKey)
    if(!existingContextKeys.has(key)&&slots<=0){skipped++;continue}
    const result=await upsertContextWatcher({telegramId,type:'web_search',condition:desired.condition})
    if(result.stopped){stopped++;continue}
    if(result.created){created++;slots--}else reused++
  }

  const {data:user}=await supabaseAdmin.from('users').select('gmail_connected').eq('telegram_id',Number(telegramId)).maybeSingle()
  if(user?.gmail_connected){
    const last=group[group.length-1]
    const matchTerms=Array.from(new Set([
      ...group.map(row=>clean(row.flight_no,30)),
      ...group.map(row=>clean(row.airline,80)),
      ...group.map(row=>clean(row.from_city,80)),
      ...group.map(row=>clean(row.to_city,80)),
    ].filter(term=>term.length>=3))).slice(0,12)
    const emailCondition={
      title:`Trip email attention · ${clean(last?.to_city,100)||'upcoming trip'}`,
      delivery:'whatsapp',cadenceMinutes:60,matchTerms,
      contextual:true,contextualKind:'travel',contextKey:`${root}:travel_email`,contextRoot:root,
      contextClass:'travel_email',
      reason:'Watch connected Gmail only for new action-requiring messages that match this saved itinerary.',
      expiresAt,sourceRefs:refs,
    }
    const result=await upsertContextWatcher({telegramId,type:'email_triage',condition:emailCondition})
    if(result.stopped)stopped++;else if(result.created)created++;else reused++
  }

  await supabaseAdmin.from('agent_activity').insert({
    telegram_id:telegramId,event_type:'contextual_travel_watchers_compiled',
    message:`Gogo compiled bounded trip monitoring for ${routeLabel(group)||'the upcoming trip'}.`.slice(0,900),
    metadata_json:{context_root:root,expires_at:expiresAt,created,reused,user_stopped:stopped,skipped_for_plan_limit:skipped,source_refs:refs},
  }).then(({error})=>{if(error)console.error('CONTEXT_TRAVEL_ACTIVITY_FAILED:',error.message)})
  return {created,reused,stopped,skipped}
}

export async function compileUpcomingTravelWatchers(limit=200){
  const now=new Date()
  const lower=new Date(now.getTime()-6*3600_000).toISOString()
  const upper=new Date(now.getTime()+14*86400_000).toISOString()
  const {data,error}=await supabaseAdmin.from('travel_tickets')
    .select('id,telegram_id,booking_group,leg_index,from_city,to_city,depart_at,arrive_at,airline,flight_no,raw')
    .eq('type','flight').gte('depart_at',lower).lt('depart_at',upper)
    .order('depart_at',{ascending:true}).limit(Math.max(1,Math.min(500,limit)))
  if(error)throw new Error(`context_travel_read_failed:${error.message}`)
  const byUser=new Map<string,TravelRow[]>()
  for(const row of data||[]){
    const key=String((row as any).telegram_id)
    const bucket=byUser.get(key)||[];bucket.push(row as TravelRow);byUser.set(key,bucket)
  }
  let users=0,created=0,reused=0,stopped=0,skipped=0,failed=0
  for(const [telegramId,rows] of byUser){
    users++
    try{
      const r=await compileForUser(telegramId,rows)
      created+=r.created;reused+=r.reused;stopped+=r.stopped;skipped+=r.skipped
    }catch(err:any){
      failed++;console.error('CONTEXT_TRAVEL_COMPILE_FAILED:',telegramId,clean(err?.message||err,240))
    }
  }
  return {users,created,reused,stopped,skipped,failed}
}

/** Same as the cron pass, for one user, right after a ticket is saved so tracking starts now. */
export async function compileTravelWatchersForUser(telegramId:string|number){
  const now=Date.now()
  const {data,error}=await supabaseAdmin.from('travel_tickets')
    .select('id,telegram_id,booking_group,leg_index,from_city,to_city,depart_at,arrive_at,airline,flight_no,raw')
    .eq('telegram_id',telegramId).eq('type','flight')
    .gte('depart_at',new Date(now-6*3600_000).toISOString()).lt('depart_at',new Date(now+14*86400_000).toISOString())
    .order('depart_at',{ascending:true}).limit(20)
  if(error)throw new Error(`context_travel_read_failed:${error.message}`)
  if(!data?.length)return {created:0,reused:0,stopped:0,skipped:0,tracking:false,flights:[] as string[]}
  const r=await compileForUser(String(telegramId),data as TravelRow[])
  const sorted=(data as TravelRow[]).slice().sort((a,b)=>Date.parse(a.depart_at)-Date.parse(b.depart_at))
  const first=sorted[0]
  const group=first.booking_group?sorted.filter(row=>String(row.booking_group||'')===String(first.booking_group)):[first]
  // Report tracking only when the flight-status monitor is actually active (plan limits can skip it).
  const {data:active}=await supabaseAdmin.from('agent_watchers').select('id')
    .eq('telegram_id',telegramId).eq('active',true)
    .eq('condition_json->>contextualKind','travel').eq('condition_json->>contextClass','flight_status').limit(1)
  return {...r,tracking:Boolean(active?.length),flights:group.map(row=>normalizeFlightNo(clean(row.flight_no,20))).filter(Boolean)}
}

/** WhatsApp text for a trip monitor's finding: names the trip and person, never shopping copy. */
export function travelWatchAlertMessage(condition:any,result:{title:string;snippet?:string;url:string}){
  const cls=String(condition?.contextClass||'')
  const label=String(condition?.title||'').split('·').slice(1).join('·').trim()
  const who=condition?.traveller?`${clean(condition.traveller,40)}'s`:'your'
  const head=cls==='flight_status'?`⚠️ Flight update for ${who} trip (${label})`
    :cls==='destination_weather'?`🌦️ Weather alert for ${who} trip: ${label}`
    :cls==='connection_ground'?`🚧 Travel disruption that may affect ${who} trip (${label})`
    :cls==='airline_news'?`📰 ${label} news that may affect ${who} trip`
    :`Trip update (${label})`
  const snippet=clean(result.snippet,280)
  return `${head}\n\n${clean(result.title,160)}${snippet?`\n${snippet}`:''}\n\nSource: ${result.url}\n\nFrom a news or tracker page, not the airline. I'll keep watching and only message you again if something new comes up.`
}
