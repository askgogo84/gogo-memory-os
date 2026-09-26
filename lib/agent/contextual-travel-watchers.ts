import { createHash } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getCostBudget } from '@/lib/services/cost-guard'

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
}

type ContextMeta={
  contextual:true
  contextualKind:'travel'
  contextKey:string
  contextRoot:string
  contextClass:'flight_status'|'connection_ground'|'destination_weather'|'travel_email'
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
function dateLabel(value:string){
  return new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',day:'numeric',month:'long',year:'numeric'}).format(new Date(value))
}
function sourceRefs(rows:TravelRow[]){
  return rows.slice(0,8).map(row=>({type:'travel_ticket' as const,id:String(row.id)}))
}
function flightLabel(rows:TravelRow[]){
  return rows.map(row=>clean(row.flight_no,30)).filter(Boolean).join(' + ')
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
function desiredWebConditions(rows:TravelRow[],root:string,expiresAt:string){
  const first=rows[0],last=rows[rows.length-1]
  const flights=flightLabel(rows)
  const route=routeLabel(rows)
  const destination=clean(last?.to_city,100)||'destination'
  const connection=rows.length>1?clean(rows[0]?.to_city,100):''
  const departDate=dateLabel(first.depart_at)
  const arrivalDate=dateLabel(last.arrive_at||last.depart_at)
  const refs=sourceRefs(rows)
  const base=(contextClass:ContextMeta['contextClass'],reason:string):ContextMeta=>({
    contextual:true,contextualKind:'travel',contextKey:`${root}:${contextClass}`,contextRoot:root,
    contextClass,reason,expiresAt,sourceRefs:refs,
  })
  return [
    {
      type:'web_search',
      condition:{
        title:`Trip flight status · ${flights||route}`,
        query:`${flights} flight status ${departDate} ${route}`.replace(/\s+/g,' ').trim(),
        triggerKeywords:['delay','delayed','cancelled','cancellation','gate change','schedule change','diverted'],
        delivery:'both',cadenceMinutes:180,burstUntil:null,
        ...base('flight_status','Watch only for material changes to the saved flight legs before and during departure.'),
      },
    },
    {
      type:'web_search',
      condition:{
        title:`Trip connection & ground transit · ${connection||destination}`,
        query:connection
          ? `${connection} airport connection disruption ${destination} airport ground transit disruption ${departDate} ${arrivalDate}`
          : `${destination} airport ground transit disruption ${arrivalDate}`,
        triggerKeywords:['airport closure','terminal change','security disruption','strike','service suspended','major delay','ground transport disruption'],
        delivery:'both',cadenceMinutes:360,burstUntil:null,
        ...base('connection_ground','Watch for high-signal airport/connection or arrival ground-transit disruption tied to this itinerary.'),
      },
    },
    {
      type:'web_search',
      condition:{
        title:`Trip weather · ${destination}`,
        query:`${destination} weather travel conditions ${arrivalDate}`,
        triggerKeywords:['weather warning','storm','heavy rain','snow','flood','extreme heat','severe weather','travel advisory'],
        delivery:'both',cadenceMinutes:360,burstUntil:null,
        ...base('destination_weather','Watch destination weather only for conditions likely to affect this saved trip.'),
      },
    },
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
    .select('id,telegram_id,booking_group,leg_index,from_city,to_city,depart_at,arrive_at,airline,flight_no')
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
