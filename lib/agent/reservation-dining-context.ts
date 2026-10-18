import {calendarInterval} from '../calendar-intervals'
import {isValidTimezone} from '../timezone'
import {isSecretShapedMemory,redactSecretShapedText} from '../bot/memory-redaction'

type TravelFact = {
  source?: string; kind?: string; startAt?: string | null; endAt?: string | null;
  location?: string | null; participants?: string[]; confidence?: number; inferred?: boolean;
  sourceRefs?: Array<Record<string,unknown>>;
}
export type ReservationTravelInventory = {
  ownerId: string; coveredFrom: string; coveredUntil: string; incomplete: boolean; facts: TravelFact[];
}
export type ReservationCalendarInventory = {
  ownerId: string; coveredFrom: string; coveredUntil: string;
  connected: boolean; incomplete: boolean;
  windows: Array<{startAt: string; endAt: string; sourceRefs: Array<{type: string; id: string}>}>;
}
export type ReservationPreferenceInventory = {
  ownerId:string; incomplete:boolean; rules:Array<{id:string;text:string}>;
}
export type ReservationTravelWindow = {
  startAt: string; endAt: string; location: string | null; source: string;
  applicability: 'owner' | 'unknown'; inferred: boolean; confidence: number;
  sourceRefs: Array<{type: string; id: string}>;
}
export type ReservationDiningContext = {
  version: 3; ownerId:string; from: string; until: string; timezone: string; checkedAt: string;
  incomplete: boolean; reasons: string[]; windows: ReservationTravelWindow[];
  calendar: {connected: boolean; windows: ReservationCalendarInventory['windows']};
  preferences:ReservationPreferenceInventory['rules'];
}
type Actor = {legacyTelegramId: number; userId?: string; name?: string}
const DAY=86400_000
function instant(value: unknown) {
  if(typeof value!=='string'||!Number.isFinite(Date.parse(value)))return NaN
  const n=Date.parse(value)
  return calendarInterval({start:{dateTime:value},end:{dateTime:new Date(n+1).toISOString()}},'UTC')?n:NaN
}
function name(value: string) {return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim()}

export function reservationRequestedDateCoverage(requestedDate:string,timezone:string,now=new Date()){
  if(!requestedDate)return undefined
  const date=new Date(requestedDate+'T00:00:00Z')
  if(!isValidTimezone(timezone)||!/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)||!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==requestedDate)return null
  const next=new Date(date.getTime()+DAY).toISOString().slice(0,10)
  const span=calendarInterval({start:{date:requestedDate},end:{date:next}},timezone)
  if(!span||span.end<=now.getTime())return null
  return{from:new Date(Math.max(span.start,now.getTime())).toISOString(),until:new Date(span.end).toISOString()}
}

/** Minimal owner-scoped restrictions, taken before the conversational fact budget. */
export function buildReservationDiningContext(params: {
  actor: Actor; timezone: string; requestedDate: string; releaseAt: string; now?: Date;
  coverage?: {from: string; until: string};
  pack: {facts?: unknown[]; reservationTravel?: ReservationTravelInventory; reservationCalendar?: ReservationCalendarInventory; reservationPreferences?:ReservationPreferenceInventory} | null;
}): ReservationDiningContext {
  const now=params.now||new Date(), nowMs=now.getTime()
  const result: ReservationDiningContext={version:3,ownerId:String(params.actor.legacyTelegramId),from:'',until:'',timezone:params.timezone,checkedAt:now.toISOString(),incomplete:false,reasons:[],windows:[],calendar:{connected:false,windows:[]},preferences:[]}
  const fail=(reason: string)=>{result.incomplete=true;if(!result.reasons.includes(reason))result.reasons.push(reason)}
  if(!isValidTimezone(params.timezone)){fail('timezone_unverified');return result}
  const inventory=params.pack?.reservationTravel
  const calendar=params.pack?.reservationCalendar
  const preferences=params.pack?.reservationPreferences
  if(!preferences||preferences.ownerId!==result.ownerId||preferences.incomplete!==false||!Array.isArray(preferences.rules))fail('owner_preferences_unverified')
  else{
    if(preferences.rules.length>20)fail('preferences_truncated')
    const seen=new Set<string>()
    for(const rule of preferences.rules.slice(0,20)){
      if(!rule||typeof rule.id!=='string'||!rule.id||rule.id.length>160||seen.has(rule.id)||typeof rule.text!=='string'||!rule.text.trim()||rule.text.length>700||isSecretShapedMemory(rule.text)||redactSecretShapedText(rule.text)!==rule.text){fail('preference_evidence_unverified');continue}
      seen.add(rule.id);result.preferences.push({id:rule.id,text:rule.text})
    }
    result.preferences.sort((a,b)=>a.id.localeCompare(b.id))
  }
  let from=nowMs, until=Math.min(nowMs+60*DAY,Number.isFinite(instant(inventory?.coveredUntil))?instant(inventory?.coveredUntil):nowMs+60*DAY,Number.isFinite(instant(calendar?.coveredUntil))?instant(calendar?.coveredUntil):nowMs+60*DAY)
  if(params.coverage){from=instant(params.coverage.from);until=instant(params.coverage.until)}
  else if(params.requestedDate){
    const span=reservationRequestedDateCoverage(params.requestedDate,params.timezone,now)
    if(!span){fail('dining_date_unverified');return result}
    from=instant(span.from);until=instant(span.until)
  }
  if(!Number.isFinite(from)||!Number.isFinite(until)||until<=Math.max(from,nowMs)||until-from>60*DAY){fail('dining_coverage_unverified');return result}
  result.from=new Date(from).toISOString();result.until=new Date(until).toISOString()
  const release=instant(params.releaseAt)
  if(!Number.isFinite(release)||release>=until)fail('release_outside_dining_coverage')
  if(!inventory||inventory.ownerId!==String(params.actor.legacyTelegramId)){fail('owner_travel_inventory_unverified');return result}
  if(inventory.incomplete)fail('travel_retrieval_incomplete')
  if(instant(inventory.coveredFrom)>Math.max(from,nowMs)||!Number.isFinite(instant(inventory.coveredFrom))||instant(inventory.coveredUntil)<until||!Number.isFinite(instant(inventory.coveredUntil)))fail('travel_coverage_incomplete')
  const actorName=name(params.actor.name||'')
  const ownerIdentifiers=new Set([String(params.actor.legacyTelegramId),params.actor.userId||''].filter(Boolean))
  if(!Array.isArray(inventory.facts)){fail('travel_inventory_malformed');return result}
  const deduped=new Map<string,ReservationTravelWindow>()
  for(const fact of inventory.facts){
    if(!['travel_presence','travel_ticket','travel_mission'].includes(fact.source||'')&&!(fact.source==='life_event'&&['flight','hotel'].includes(fact.kind||'')))continue
    const rawParticipants=Array.isArray(fact.participants)?fact.participants.filter(p=>typeof p==='string'):[]
    const participants=rawParticipants.map(name).filter(Boolean)
    const owner=rawParticipants.some(p=>ownerIdentifiers.has(p.trim())||actorName.split(' ').length>=2&&name(p)===actorName)
    // Partial names/initials can be aliases; do not silently treat them as a
    // different person. Distinct complete names are other travellers.
    if(participants.length&&!owner&&actorName.split(' ').length>=2&&participants.every(p=>p.split(' ').length>=2&&p.split(' ')[0]!==actorName.split(' ')[0]))continue
    const start=instant(fact.startAt), end=instant(fact.endAt)
    if(Number.isFinite(start)&&start>=until)continue
    if(Number.isFinite(end)&&end<=Math.max(from,nowMs))continue
    if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start){fail('travel_timing_unverified');continue}
    const window: ReservationTravelWindow={startAt:new Date(Math.max(start,from)).toISOString(),endAt:new Date(Math.min(end,until)).toISOString(),
      location:typeof fact.location==='string'?fact.location.replace(/\s+/g,' ').trim().slice(0,180)||null:null,source:fact.source!,
      applicability:owner?'owner':'unknown',inferred:fact.inferred===true,confidence:Number.isFinite(fact.confidence)?Math.max(0,Math.min(1,fact.confidence!)):0,
      sourceRefs:(Array.isArray(fact.sourceRefs)?fact.sourceRefs:[]).flatMap(ref=>typeof ref.type==='string'&&typeof ref.id==='string'&&['travel_ticket','life_event','inference','agent_run'].includes(ref.type)?[{type:ref.type.slice(0,80),id:ref.id.slice(0,160)}]:[]).slice(0,8)}
    const key=JSON.stringify({...window,sourceRefs:undefined})
    if(!deduped.has(key))deduped.set(key,window)
  }
  result.windows=[...deduped.values()].sort((a,b)=>a.startAt.localeCompare(b.startAt)||a.endAt.localeCompare(b.endAt)||String(a.location).localeCompare(String(b.location)))
  if(result.windows.length>40){fail('travel_windows_truncated');result.windows=result.windows.slice(0,40)}
  if(!calendar||calendar.ownerId!==String(params.actor.legacyTelegramId)){fail('owner_calendar_inventory_unverified');return result}
  if(typeof calendar.connected!=='boolean'||calendar.incomplete!==false)fail('calendar_retrieval_incomplete')
  result.calendar.connected=calendar.connected===true
  if(!Number.isFinite(instant(calendar.coveredFrom))||instant(calendar.coveredFrom)>Math.max(from,nowMs)||!Number.isFinite(instant(calendar.coveredUntil))||instant(calendar.coveredUntil)<until)fail('calendar_coverage_incomplete')
  if(!Array.isArray(calendar.windows)){fail('calendar_inventory_malformed');return result}
  if(!calendar.connected&&calendar.windows.length)fail('calendar_connection_inconsistent')
  const busy=new Map<string,ReservationCalendarInventory['windows'][number]>()
  for(const item of calendar.windows){
    const start=instant(item?.startAt),end=instant(item?.endAt)
    if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start){fail('calendar_timing_unverified');continue}
    if(end<=Math.max(from,nowMs)||start>=until)continue
    const sourceRefs=(Array.isArray(item.sourceRefs)?item.sourceRefs:[]).filter(ref=>ref?.type==='calendar_event'&&typeof ref.id==='string'&&ref.id.length>0).map(ref=>({type:'calendar_event',id:ref.id.slice(0,160)})).slice(0,8)
    if(!sourceRefs.length){fail('calendar_provenance_unverified');continue}
    const window={startAt:new Date(Math.max(start,from)).toISOString(),endAt:new Date(Math.min(end,until)).toISOString(),sourceRefs}
    busy.set(JSON.stringify(window),window)
  }
  result.calendar.windows=[...busy.values()].sort((a,b)=>a.startAt.localeCompare(b.startAt)||a.endAt.localeCompare(b.endAt)||JSON.stringify(a.sourceRefs).localeCompare(JSON.stringify(b.sourceRefs)))
  if(result.calendar.windows.length>100){fail('calendar_windows_truncated');result.calendar.windows=result.calendar.windows.slice(0,100)}
  return result
}

/** Fresh reads may not loosen or change any still-relevant approved restriction. */
export function usableReservationDiningContext(value: unknown): value is ReservationDiningContext {
  if(!value||typeof value!=='object')return false
  const s=value as ReservationDiningContext
  const from=instant(s.from),until=instant(s.until)
  return s.version===3&&typeof s.ownerId==='string'&&/^-?\d+$/.test(s.ownerId)&&s.incomplete===false&&isValidTimezone(s.timezone)&&Number.isFinite(instant(s.checkedAt))&&
    Array.isArray(s.preferences)&&s.preferences.length<=20&&new Set(s.preferences.map(r=>r?.id)).size===s.preferences.length&&s.preferences.every(r=>r&&typeof r.id==='string'&&r.id.length>0&&r.id.length<=160&&typeof r.text==='string'&&r.text.trim().length>0&&r.text.length<=700&&!isSecretShapedMemory(r.text)&&redactSecretShapedText(r.text)===r.text)&&
    Number.isFinite(from)&&Number.isFinite(until)&&until>from&&until-from<=60*DAY&&
    Array.isArray(s.reasons)&&s.reasons.length===0&&!!s.calendar&&typeof s.calendar.connected==='boolean'&&Array.isArray(s.calendar.windows)&&s.calendar.windows.length<=100&&
    (s.calendar.connected||s.calendar.windows.length===0)&&s.calendar.windows.every(w=>w&&Number.isFinite(instant(w.startAt))&&Number.isFinite(instant(w.endAt))&&instant(w.startAt)>=from&&instant(w.endAt)<=until&&instant(w.endAt)>instant(w.startAt)&&Array.isArray(w.sourceRefs)&&w.sourceRefs.length>0&&w.sourceRefs.length<=8&&w.sourceRefs.every(ref=>ref?.type==='calendar_event'&&typeof ref.id==='string'&&ref.id.length>0&&ref.id.length<=160))&&
    Array.isArray(s.windows)&&s.windows.length<=40&&s.windows.every(w=>
      w&&['owner','unknown'].includes(w.applicability)&&typeof w.inferred==='boolean'&&
      Number.isFinite(w.confidence)&&w.confidence>=0&&w.confidence<=1&&
      Number.isFinite(instant(w.startAt))&&Number.isFinite(instant(w.endAt))&&instant(w.startAt)>=from&&instant(w.endAt)<=until&&instant(w.endAt)>instant(w.startAt))
}

export function sameReservationRestrictions(approved: ReservationDiningContext, fresh: ReservationDiningContext, now=new Date()) {
  if(!usableReservationDiningContext(approved)||!usableReservationDiningContext(fresh))return false
  const key=(value: ReservationDiningContext)=>JSON.stringify({ownerId:value.ownerId,from:value.from,until:value.until,timezone:value.timezone,preferences:value.preferences,
    windows:value.windows.filter(w=>Date.parse(w.endAt)>now.getTime()),calendar:{connected:value.calendar.connected,windows:value.calendar.windows.filter(w=>Date.parse(w.endAt)>now.getTime())}})
  return key(approved)===key(fresh)
}
