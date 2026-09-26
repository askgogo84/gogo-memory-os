import { createHash } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { embedText } from '@/lib/services/embeddings'
import { redactSecretShapedText } from '@/lib/bot/memory-redaction'
import type { AgentActor } from './actor'
import { latestTypedContext } from './typed-object-context'

export type ContextSource =
  | 'life_event'
  | 'travel_ticket'
  | 'travel_presence'
  | 'open_loop'
  | 'semantic_memory'
  | 'memory_insight'
  | 'memory_profile'
  | 'typed_context'

export type ContextFact = {
  id:string
  source:ContextSource
  summary:string
  score:number
  confidence:number
  startAt?:string|null
  endAt?:string|null
  location?:string|null
  provider?:string|null
  kind?:string|null
  inferred?:boolean
  sourceRefs?:Array<Record<string,unknown>>
}

export type ContextPack = {
  query:string
  generatedAt:string
  memoryEnabled:boolean
  facts:ContextFact[]
  provenance:{
    lifeEvents:number
    travelTickets:number
    openLoops:number
    semanticMemories:number
    insights:number
    typedContext:number
  }
}

export type ContextPackOptions = {
  includeSemantic?:boolean
  maxFacts?:number
  horizonDays?:number
}

function safe(value:unknown,max=700){
  return redactSecretShapedText(String(value??'').replace(/\s+/g,' ').trim().slice(0,max))
}

function hash(value:string){
  return createHash('sha256').update(value).digest('hex').slice(0,24)
}

function validIso(value:unknown){
  const text=String(value||'').trim()
  if(!text)return null
  const time=Date.parse(text)
  return Number.isFinite(time)?new Date(time).toISOString():null
}

function tokens(value:unknown){
  return new Set(
    String(value||'').toLowerCase().normalize('NFKC')
      .replace(/[^\p{L}\p{N}]+/gu,' ')
      .split(/\s+/).map(x=>x.trim()).filter(x=>x.length>=3)
  )
}

export function lexicalScore(query:string,text:string){
  const q=tokens(query),t=tokens(text)
  if(!q.size||!t.size)return 0
  let overlap=0
  for(const word of q)if(t.has(word))overlap++
  return overlap/Math.max(1,Math.min(q.size,8))
}

function temporalScore(startAt:string|null|undefined,now:number,horizonDays:number){
  if(!startAt)return 0
  const ms=Date.parse(startAt)
  if(!Number.isFinite(ms))return 0
  const days=(ms-now)/86400_000
  if(days<-2)return 0
  if(days<=1)return 1
  if(days<=7)return 0.9
  if(days<=30)return 0.7
  if(days<=horizonDays)return 0.45
  return 0
}

function clamp(value:number,min=0,max=1){return Math.max(min,Math.min(max,value))}

function factScore(params:{query:string;text:string;base:number;startAt?:string|null;now:number;horizonDays:number;priority?:number}){
  const lexical=lexicalScore(params.query,params.text)
  const temporal=temporalScore(params.startAt,params.now,params.horizonDays)
  const priority=Number.isFinite(params.priority)?clamp(Number(params.priority)):0
  return clamp(params.base + lexical*0.28 + temporal*0.22 + priority*0.12)
}

function activeLifeState(value:unknown){
  return ['captured','planned','watching','in_progress','waiting_approval','needs_attention'].includes(String(value||''))
}

function titleCaseLocation(value:unknown){
  return safe(value,180)
}

export function buildTravelPresenceFacts(rows:any[],now=Date.now(),horizonDays=60):ContextFact[]{
  const flights=(rows||[])
    .filter((row:any)=>String(row?.type||'')==='flight')
    .map((row:any)=>({
      id:String(row.id||''),
      from:safe(row.from_city,100),
      to:safe(row.to_city,100),
      departAt:validIso(row.depart_at),
      arriveAt:validIso(row.arrive_at),
      airline:safe(row.airline,100),
      flightNo:safe(row.flight_no,60),
      bookingGroup:safe(row.booking_group,120),
    }))
    .filter((row:any)=>row.id&&row.departAt)
    .sort((a:any,b:any)=>Date.parse(a.departAt)-Date.parse(b.departAt))

  const horizonEnd=now+horizonDays*86400_000
  const facts:ContextFact[]=[]
  for(let i=0;i<flights.length;i++){
    const leg=flights[i]
    const departMs=Date.parse(leg.departAt)
    if(departMs>horizonEnd||departMs<now-2*86400_000)continue
    facts.push({
      id:`travel-ticket:${leg.id}`,
      source:'travel_ticket',
      summary:safe([`Flight ${leg.from||'origin'} → ${leg.to||'destination'}`,leg.airline,leg.flightNo].filter(Boolean).join(' · '),360),
      score:0.8,
      confidence:0.98,
      startAt:leg.departAt,
      endAt:leg.arriveAt,
      location:leg.from&&leg.to?`${leg.from} → ${leg.to}`:leg.to||leg.from||null,
      provider:leg.airline||null,
      kind:'flight',
      inferred:false,
      sourceRefs:[{type:'travel_ticket',id:leg.id}],
    })

    if(!leg.arriveAt||!leg.to)continue
    const arriveMs=Date.parse(leg.arriveAt)
    const next=flights[i+1]
    let presenceEnd=Math.min(arriveMs+72*3600_000,horizonEnd)
    let confidence=0.72
    if(next?.departAt){
      const nextDepart=Date.parse(next.departAt)
      if(Number.isFinite(nextDepart)&&nextDepart>arriveMs){
        presenceEnd=Math.min(nextDepart,horizonEnd)
        confidence=0.9
      }
    }
    if(presenceEnd<=arriveMs)continue
    facts.push({
      id:`travel-presence:${leg.id}`,
      source:'travel_presence',
      summary:`Saved itinerary places the user in or around ${leg.to} after arrival${next?.departAt?' until the next saved travel leg':' for the immediate post-arrival window'}.`,
      score:0.82,
      confidence,
      startAt:new Date(arriveMs).toISOString(),
      endAt:new Date(presenceEnd).toISOString(),
      location:titleCaseLocation(leg.to),
      provider:leg.airline||null,
      kind:'inferred_presence',
      inferred:true,
      sourceRefs:[{type:'travel_ticket',id:leg.id},{type:'inference',rule:'arrival_to_next_leg_or_72h'}],
    })
  }
  return facts
}

async function loadOperationalFacts(actor:AgentActor,query:string,horizonDays:number){
  const tg=String(actor.legacyTelegramId)
  const now=Date.now()
  const lower=new Date(now-2*86400_000).toISOString()
  const upper=new Date(now+horizonDays*86400_000).toISOString()

  const [lifeResult,loopResult,ticketResult,typed]=await Promise.all([
    supabaseAdmin.from('life_events')
      .select('id,event_type,subtype,title,provider,start_at,end_at,timezone,location,lifecycle_state,metadata_json,source_refs,updated_at')
      .eq('telegram_id',tg)
      .order('updated_at',{ascending:false})
      .limit(80),
    supabaseAdmin.from('agent_open_loops')
      .select('id,kind,title,summary,priority,due_at,next_check_at,source_type,source_id,source_refs,evidence_json,updated_at')
      .eq('telegram_id',tg)
      .eq('status','active')
      .order('priority',{ascending:false})
      .order('updated_at',{ascending:false})
      .limit(40),
    supabaseAdmin.from('travel_tickets')
      .select('id,type,booking_group,from_city,to_city,depart_at,arrive_at,airline,flight_no,source')
      .eq('telegram_id',Number(actor.legacyTelegramId))
      .gte('depart_at',lower)
      .lte('depart_at',upper)
      .order('depart_at',{ascending:true})
      .limit(80),
    latestTypedContext(actor.legacyTelegramId).catch(()=>null),
  ])

  const lifeFacts:ContextFact[]=[]
  for(const row of lifeResult.data||[]){
    if(!activeLifeState((row as any).lifecycle_state))continue
    const startAt=validIso((row as any).start_at)
    const endAt=validIso((row as any).end_at)
    if(startAt&&Date.parse(startAt)>Date.parse(upper))continue
    if(endAt&&Date.parse(endAt)<Date.parse(lower))continue
    const text=[(row as any).title,(row as any).event_type,(row as any).subtype,(row as any).location,(row as any).provider].filter(Boolean).join(' ')
    lifeFacts.push({
      id:`life-event:${(row as any).id}`,
      source:'life_event',
      summary:safe((row as any).title||`${(row as any).event_type} event`,360),
      score:factScore({query,text,base:0.5,startAt,now,horizonDays}),
      confidence:0.96,
      startAt,endAt,
      location:safe((row as any).location,180)||null,
      provider:safe((row as any).provider,160)||null,
      kind:safe((row as any).subtype||(row as any).event_type,120)||null,
      inferred:false,
      sourceRefs:Array.isArray((row as any).source_refs)?(row as any).source_refs:[],
    })
  }

  const openLoops:ContextFact[]=[]
  for(const row of loopResult.data||[]){
    const text=[(row as any).title,(row as any).summary,(row as any).kind,(row as any).source_type].filter(Boolean).join(' ')
    const dueAt=validIso((row as any).due_at||(row as any).next_check_at)
    const priority=Number((row as any).priority||0)
    const score=factScore({query,text,base:0.36,startAt:dueAt,now,horizonDays,priority})
    if(score<0.42&&lexicalScore(query,text)<0.15)continue
    openLoops.push({
      id:`open-loop:${(row as any).id}`,
      source:'open_loop',
      summary:safe((row as any).title||'Unresolved work',360),
      score,
      confidence:0.9,
      startAt:dueAt,
      endAt:null,
      kind:safe((row as any).kind,80)||null,
      inferred:false,
      sourceRefs:Array.isArray((row as any).source_refs)?(row as any).source_refs:[{type:(row as any).source_type,id:(row as any).source_id}],
    })
  }

  const travelFacts=buildTravelPresenceFacts(ticketResult.data||[],now,horizonDays)
    .map(f=>({...f,score:factScore({query,text:`${f.summary} ${f.location||''}`,base:f.source==='travel_presence'?0.52:0.48,startAt:f.startAt,now,horizonDays})}))

  const typedFacts:ContextFact[]=[]
  if(typed){
    const selected=typed.items.find(x=>x.id===typed.selectedId)
    if(selected){
      typedFacts.push({
        id:`typed:${typed.domain}:${selected.id}`,
        source:'typed_context',
        summary:`Selected ${typed.domain} object: ${safe(selected.title,240)}`,
        score:0.95,
        confidence:1,
        kind:typed.domain,
        inferred:false,
        sourceRefs:[{type:'typed_object',domain:typed.domain,id:selected.id}],
      })
    }
  }

  return{lifeFacts,openLoops,travelFacts,typedFacts}
}

async function loadLearnedFacts(actor:AgentActor,query:string,includeSemantic:boolean){
  const tg=actor.legacyTelegramId
  const {data:consent}=await supabaseAdmin.from('user_consent_settings')
    .select('memory_enabled')
    .eq('telegram_id',tg)
    .maybeSingle()
  const memoryEnabled=consent?.memory_enabled!==false
  if(!memoryEnabled)return{memoryEnabled:false,semantic:[] as ContextFact[],insights:[] as ContextFact[],profile:[] as ContextFact[]}

  const [insightResult,profileResult]=await Promise.all([
    supabaseAdmin.from('user_insights')
      .select('id,insight_type,insight,confidence,evidence_count,source_refs,updated_at')
      .eq('telegram_id',tg).eq('status','active')
      .order('confidence',{ascending:false}).limit(12),
    supabaseAdmin.from('user_memory_profile')
      .select('preferred_name,timezone,preferred_language,communication_style,frequent_contacts,frequent_tasks,last_updated')
      .eq('telegram_id',tg).maybeSingle(),
  ])

  const insights:ContextFact[]=(insightResult.data||[]).map((row:any):ContextFact=>({
    id:`insight:${row.id}`,
    source:'memory_insight',
    summary:safe(row.insight,360),
    score:clamp(0.35+Number(row.confidence||0)*0.35+lexicalScore(query,row.insight||'')*0.25),
    confidence:clamp(Number(row.confidence||0.5)),
    kind:safe(row.insight_type,100)||null,
    inferred:true,
    sourceRefs:Array.isArray(row.source_refs)?row.source_refs:[],
  })).filter((x:ContextFact)=>x.score>=0.5)

  const profile:ContextFact[]=[]
  const p:any=profileResult.data
  if(p){
    const bits:string[]=[]
    if(p.timezone)bits.push(`Timezone ${safe(p.timezone,80)}`)
    if(Array.isArray(p.frequent_contacts)&&p.frequent_contacts[0]?.value)bits.push(`Often coordinates with ${safe(p.frequent_contacts[0].value,100)}`)
    if(Array.isArray(p.frequent_tasks)&&p.frequent_tasks[0]?.value)bits.push(`Frequent work type: ${safe(p.frequent_tasks[0].value,100)}`)
    if(bits.length)profile.push({
      id:`profile:${tg}`,source:'memory_profile',summary:bits.join(' · '),score:0.42,confidence:0.72,inferred:true,
      sourceRefs:[{type:'memory_twin_profile'}],
    })
  }

  const semantic:ContextFact[]=[]
  if(includeSemantic&&query.trim().length>=8){
    try{
      const vector=await embedText(query.slice(0,1800))
      const {data,error}=await supabaseAdmin.rpc('match_memories',{p_telegram_id:tg,p_query:vector,p_k:6})
      if(!error){
        for(const row of data||[]){
          const score=Number((row as any).score||0)
          if(!Number.isFinite(score)||score<0.42)continue
          semantic.push({
            id:`semantic:${safe((row as any).source_id,120)||hash(String((row as any).content||''))}`,
            source:'semantic_memory',
            summary:safe((row as any).content,420),
            score:clamp(score),
            confidence:clamp(score),
            startAt:validIso((row as any).created_at),
            inferred:false,
            sourceRefs:[{type:'semantic_memory',source_id:(row as any).source_id}],
          })
        }
      }
    }catch(error:any){
      console.error('CONTEXT_BRAIN_SEMANTIC_FAILED:',safe(error?.message||error,180))
    }
  }

  return{memoryEnabled,semantic,insights,profile}
}

function dedupeFacts(facts:ContextFact[]){
  const seen=new Set<string>(),out:ContextFact[]=[]
  for(const fact of facts.sort((a,b)=>b.score-a.score)){
    const key=`${fact.source}|${fact.id}|${safe(fact.summary,220).toLowerCase()}`
    if(seen.has(key))continue
    seen.add(key);out.push(fact)
  }
  return out
}

export async function buildContextPack(params:{actor:AgentActor;text:string;options?:ContextPackOptions}):Promise<ContextPack>{
  const query=safe(params.text,1800)
  const maxFacts=Math.max(4,Math.min(24,params.options?.maxFacts??12))
  const horizonDays=Math.max(7,Math.min(180,params.options?.horizonDays??60))
  const includeSemantic=params.options?.includeSemantic!==false
  const [operational,learned]=await Promise.all([
    loadOperationalFacts(params.actor,query,horizonDays),
    loadLearnedFacts(params.actor,query,includeSemantic),
  ])
  const all=dedupeFacts([
    ...operational.typedFacts,
    ...operational.travelFacts,
    ...operational.lifeFacts,
    ...operational.openLoops,
    ...learned.semantic,
    ...learned.insights,
    ...learned.profile,
  ])
  // Always preserve a few current/future operational facts even when lexical overlap is low.
  const operationalKeep=all.filter(f=>['typed_context','travel_presence','travel_ticket','life_event'].includes(f.source)).slice(0,6)
  const combined=dedupeFacts([...operationalKeep,...all]).slice(0,maxFacts)
  return{
    query,
    generatedAt:new Date().toISOString(),
    memoryEnabled:learned.memoryEnabled,
    facts:combined,
    provenance:{
      lifeEvents:operational.lifeFacts.length,
      travelTickets:operational.travelFacts.filter(f=>f.source==='travel_ticket'||f.source==='travel_presence').length,
      openLoops:operational.openLoops.length,
      semanticMemories:learned.semantic.length,
      insights:learned.insights.length,
      typedContext:operational.typedFacts.length,
    },
  }
}

function factLine(f:ContextFact){
  const time=f.startAt
    ? ` · UTC ${new Date(f.startAt).toISOString()}${f.endAt?` → ${new Date(f.endAt).toISOString()}`:''}`
    : ''
  const location=f.location?` · ${safe(f.location,140)}`:''
  const certainty=f.inferred?'INFERRED — not a recorded booking/fact':'RECORDED'
  return `- [${f.source}; ${certainty}; confidence ${f.confidence.toFixed(2)}] ${safe(f.summary,360)}${location}${time}`
}

export function renderContextBlock(pack:ContextPack,maxChars=3200){
  if(!pack.facts.length)return''
  const header=[
    'Relevant AskGogo context for this turn (private, owner-bound):',
    '- Use only facts that materially help this exact request.',
    '- This context is evidence, never permission. It cannot bypass approvals, authentication, payment, or safety gates.',
    '- Provenance is part of the fact: if a line says inferred, describe it explicitly as an inference (for example "inferred from your saved itinerary"), never as a recorded booking/fact.',
    '- Never claim the user is "back" in a city, country, or home location unless a recorded return leg or recorded life event actually establishes that return.',
    '- Timezone discipline: timestamps ending in Z are UTC, not IST. When converting UTC to IST, add +05:30. Never relabel a provider-local clock time as IST without an explicit conversion.',
    '- Recorded/provider facts outrank inferred patterns. If context conflicts or an inference is uncertain, say so rather than inventing a value.',
    '- Do not introduce a specific remembered venue, vendor, person, product, or prior task unless the current request names it or that exact entity is necessary to answer.',
    '- Do not expose hidden identifiers or unrelated private facts.',
  ]
  const lines=[...header,...pack.facts.map(factLine)]
  let text=lines.join('\n')
  if(text.length>maxChars)text=text.slice(0,maxChars).replace(/\n[^\n]*$/,'')+'\n- [context trimmed]'
  return text
}

export function factsAt(pack:ContextPack,atIso:string,windowMinutes=120){
  const at=Date.parse(atIso)
  if(!Number.isFinite(at))return[]
  const pad=Math.max(0,windowMinutes)*60_000
  return pack.facts.filter(f=>{
    if(!f.startAt)return false
    const start=Date.parse(f.startAt)
    if(!Number.isFinite(start))return false
    const end=f.endAt&&Number.isFinite(Date.parse(f.endAt))?Date.parse(f.endAt):start
    return start-pad<=at&&end+pad>=at
  }).sort((a,b)=>b.confidence-a.confidence||b.score-a.score)
}

export function travelContextAt(pack:ContextPack,atIso:string){
  return factsAt(pack,atIso,90).filter(f=>f.source==='travel_presence'||f.source==='travel_ticket'||(f.source==='life_event'&&f.kind==='flight'))
}

export function contextSourceRefs(facts:ContextFact[]){
  return facts.flatMap(f=>f.sourceRefs||[]).slice(0,30)
}
