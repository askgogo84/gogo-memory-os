// Typed, read-only projection of owner-scoped travel evidence. No model code runs here.
// This does not prove current bookability, checkout totals or award availability.
export type TravelKind='flight'|'hotel'
export type TravelCard={
  id:string;kind:TravelKind;title:string;subtitle:string;amount:string|null;
  priceBasis:string;sourceLabel:string;sourceUrl:string|null;observedAt:string|null;
  details:string[];evidenceState:'provider_observed'|'partially_verified';
}
export type SavedTravelResult={
  id:string;kind:TravelKind;title:string;searchDate:string|null;status:'completed'|'partial';
  source:string;cards:TravelCard[];notice:string;
}

const str=(v:unknown,n=160)=>typeof v==='string'?v.replace(/\s+/g,' ').trim().slice(0,n):''
const number=(v:unknown):number|null=>typeof v==='number'&&Number.isFinite(v)&&v>0?v:null
const date=(v:unknown)=>typeof v==='string'&&Number.isFinite(Date.parse(v))?new Date(v).toISOString():null
export function validFlightSource(value:unknown):string|null {
  try{
    const url=new URL(String(value||''))
    return url.protocol==='https:'&&!url.username&&!url.password&&!url.hash&&
      (url.hostname==='google.com'||url.hostname==='www.google.com')&&
      /^\/travel\/flights(?:\/|$)/.test(url.pathname) ? url.origin+url.pathname : null
  }catch{return null}
}
function formatInr(n:number|null):string|null {
  return n===null?null:'₹'+Math.round(n).toLocaleString('en-IN')
}
function hotelAmount(h:any):{amount:string|null;basis:string}{
  // Source schemas differ. Never infer nightly price or fees from this amount.
  const candidate=h?.cashAmount??h?.price?.amount??(typeof h?.price==='number'?h.price:null)??h?.totalPrice??h?.amount
  const n=number(candidate)
  const currency=str(h?.price?.currency||h?.currency||'INR',8).toUpperCase()
  if(!n||!/^[A-Z]{3}$/.test(currency))return{amount:null,basis:'Cost not verified'}
  return{amount:currency==='INR'?formatInr(n):currency+' '+n.toLocaleString('en-IN',{maximumFractionDigits:2}),
    basis:'Provider-returned amount; nightly/total basis and taxes must be confirmed'}
}
function titleOf(h:any){return str(h?.hotelName||h?.name||h?.hotel?.name||h?.property?.name||'',130)}

export function projectTravelEvidence(run:any,step:any):SavedTravelResult|null {
  if(!run||!step||run.status!=='completed'||step.status!=='completed'||step.tool_name!=='travel'||String(step.run_id)!==String(run.id))return null
  const result=step.output_json
  if(!result||typeof result!=='object')return null
  const context=result.context||run.metadata_json?.context
  if(!context||!['flight','hotel'].includes(context.kind))return null
  if(context.kind==='flight'){
    if(result.inventoryType!=='browser-verified'||result.source!=='browser-live'||!Array.isArray(result.flights))return null
    const sourceUrl=validFlightSource(result.browser?.sourceUrl||result.browser?.url)
    if(!sourceUrl)return null
    const observedAt=date(step.completed_at)
    const adults=Number(context.adults||1)
    const cards=result.flights.slice(0,12).flatMap((f:any,i:number)=>{
      if(!f||!str(f.airline,90)||!str(f.departure,90)||!str(f.arrival,90)||!str(f.evidence,300))return []
      const n=number(f.fareInr)
      // A price from an old or undated browser read is never represented as a current fare.
      const priced=observedAt!==null&&n!==null
      const basis=priced?(adults>1&&!(f.fareBasis==='party_total'&&f.farePassengers===adults)
        ?'Fare observed; total for party not verified':'Observed Google Flights fare; reprice before booking'):'Fare not verified'
      const stops=Number.isInteger(f.stops)&&f.stops>=0
        ?f.stops===0?'Non-stop':f.stops+' stop'+(f.stops===1?'':'s')
        :'Stops not verified'
      return [{id:'flight-'+i,kind:'flight' as const,title:str(f.airline,90),
        subtitle:str(f.departure,90)+' → '+str(f.arrival,90),
        amount:priced?formatInr(n):null,priceBasis:basis,
        sourceLabel:'Google Flights · browser observed',sourceUrl,observedAt,
        details:[stops, str(f.route,90), f.roundTrip?'Round trip':'One way'].filter(Boolean),
        evidenceState:priced?'provider_observed' as const:'partially_verified' as const}]
    })
    if(!cards.length)return null
    return{id:String(run.id),kind:'flight',title:str(context.routeLabel||run.title,180)||'Flight search',
      searchDate:str(context.startDate,10)||null,status:'completed',source:'Google Flights',cards,
      notice:'These are historic browser observations, not real-time airline inventory. Fares, baggage, seats, taxes and booking eligibility require a new provider check; no booking has occurred.'}
  }
  if(result.source!=='creditiq'||result.inventoryType!=='live-provider'||result.liveInventory?.live!==true||!Array.isArray(result.liveInventory.hotels))return null
  const fetchedAt=date(result.liveInventory.fetchedAt)
  const source=str(result.liveInventory.source||'CreditIQ',70)
  const cards=result.liveInventory.hotels.slice(0,12).flatMap((h:any,i:number)=>{
    const name=titleOf(h);if(!name)return []
    const price=hotelAmount(h)
    const rating=number(h?.rating??h?.reviewScore??h?.score)
    return [{id:'hotel-'+i,kind:'hotel' as const,title:name,
      subtitle:str(h?.area||h?.address||h?.location||'',120),
      amount:fetchedAt?price.amount:null,
      priceBasis:fetchedAt?price.basis:'Observation time unavailable; amount not verified',
      sourceLabel:source+' · provider returned',sourceUrl:null,observedAt:fetchedAt,
      details:[rating!==null?'Provider rating '+rating:'Rating not verified','Availability and taxes require recheck'],
      evidenceState:fetchedAt&&price.amount?'provider_observed' as const:'partially_verified' as const}]
  })
  if(!cards.length)return null
  return{id:String(run.id),kind:'hotel',title:str(run.title,180)||'Hotel search',
    searchDate:str(context.startDate,10)||null,status:'completed',source,cards,
    notice:'These are CreditIQ-returned hotel search options. An amount is not an executable booking, award-night availability, total-stay guarantee or verified final checkout price. Recheck before any approved booking.'}
}
