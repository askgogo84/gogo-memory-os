// Read-only, evidence-bound presentation for existing AskGogo reservation research.
// Never use saved slots as real-time availability or booking confirmation.
export type DiningRunType = 'restaurant_reservation_slot' | 'restaurant_reservation_research'
export type DiningRunRead = {
  id: string
  type: string
  status: string
  updated_at: string | null
  metadata_json: Record<string, unknown> | null
}
export type DiningObservation = {
  id: string
  restaurant: string
  partySize: number | null
  requestedDate: string | null
  requestedWindow: string | null
  status: 'checking'|'needs_review'|'historical_slots'|'unavailable'
  observedSlots: string[]
  observedAt: string | null
  sourceUrl: string | null
  sourceLabel: string | null
  note: string
  runType: DiningRunType
}

const PROVIDERS=['reservego.co','reservego.com','eazydiner.com','zomato.com','district.in','swiggy.com'] as const
const trim=(v:unknown,cap:number)=>typeof v==='string'?v.trim().slice(0,cap):''
export function safeDiningProviderUrl(value: unknown): string | null {
  if(typeof value!=='string'||value.length>1600)return null
  try {
    const url=new URL(value)
    if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash)return null
    const host=url.hostname.toLowerCase()
    if(!PROVIDERS.some(domain=>host===domain||host.endsWith('.'+domain)))return null
    // Strip unknown tracking/session/customer tokens, never reconstruct unsafe URLs.
    url.search=''
    return url.href
  }catch{return null}
}
function validYmd(value: unknown): string|null {
  if(typeof value!=='string'||!/^20\d{2}-\d{2}-\d{2}$/.test(value))return null
  const d=new Date(value+'T00:00:00Z')
  return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value?value:null
}
function clock(value:unknown) {
  return typeof value==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)?value:null
}
const KNOWN_STATUSES=new Set(['queued','running','paused','failed','completed','waiting_approval','outcome_unknown'])
/** A historical page observation never grants approval or authorizes booking. */
export function diningObservationFromRun(run: DiningRunRead, now=new Date()): DiningObservation | null {
  if(!run||!['restaurant_reservation_slot','restaurant_reservation_research'].includes(run.type))return null
  if(!KNOWN_STATUSES.has(run.status))return null
  const meta=run.metadata_json||{}
  const type=run.type as DiningRunType
  if(meta.plan_type!==type)return null
  const restaurant=trim(meta.restaurant,100)
  if(!restaurant||!/^[-a-z0-9]{36}$/i.test(run.id))return null
  const party=Number(meta.party_size)
  const partySize=Number.isSafeInteger(party)&&party>=1&&party<=20?party:null
  const requestedDate=validYmd(meta.requested_date)
  const start=clock(meta.preferred_start),end=clock(meta.preferred_end)
  const requestedWindow=start&&end?(start===end?start:`${start}–${end}`):null
  const observedAt=typeof run.updated_at==='string'&&Number.isFinite(Date.parse(run.updated_at))?
    new Date(run.updated_at).toISOString():null
  const provider=(meta.provider&&typeof meta.provider==='object')?meta.provider as Record<string,unknown>:null
  const sourceUrl=safeDiningProviderUrl(provider?.url)
  const sourceLabel=sourceUrl?new URL(sourceUrl).hostname:null

  let observedSlots:string[]=[]
  // Only first-party ReserveGo feed with explicit dining-date evidence yields historical
  // slot observations. Browser text and model suggestions must never create a slot.
  if(type==='restaurant_reservation_slot'&&sourceUrl&&/\.reservego\.co(?:m)?\//i.test(sourceUrl)
    &&requestedDate&&meta.provider&&provider?.firstParty===true
    &&typeof meta.evidence==='string'
    &&String(meta.evidence).startsWith('ReserveGo times for '+requestedDate+':')) {
    const saved=Array.isArray(meta.observed_slots)?meta.observed_slots:[]
    observedSlots=[...new Set(saved.map(clock).filter((s):s is string=>Boolean(s)))].slice(0,20).sort()
  }
  const observedAge=observedAt?now.getTime()-Date.parse(observedAt):Infinity
  // Even recently saved slots can disappear; never label them available now.
  const status=observedSlots.length?'historical_slots':
    run.status==='queued'||run.status==='running'?'checking':
    run.status==='failed'||run.status==='outcome_unknown'?'unavailable':'needs_review'
  const note=observedSlots.length
    ? observedAge>5*60_000?'Past slot observation. Availability may have changed; recheck the provider before booking.':
      'Recently recorded provider slots, not guaranteed available now. Recheck before booking.'
    :status==='checking'?'Research is still in progress. No verified table slot is shown.':
      status==='unavailable'?'The provider outcome is unverified; no reservation is confirmed.':
      'No current bookable slot is established by this saved record.'
  return {id:run.id,restaurant,partySize,requestedDate,requestedWindow,status,observedSlots,observedAt,sourceUrl,
    sourceLabel,note,runType:type}
}
