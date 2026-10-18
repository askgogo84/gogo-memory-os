import Anthropic from '@anthropic-ai/sdk'
import { runSecureBrowser } from './secure-computer'
import { sanitizeBrowserReadDiagnostics } from './browser-read-diagnostics'
import type { AgentActor } from './actor'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

type BrowserFlightContext = {
  origin?: { code?: string; label: string }
  destination?: { code?: string; label: string }
  startDate?: string
  routeLabel: string
  whenLabel: string
  cabin?: string
  adults?: number
  nonStop?: boolean
  returnDate?: string
  roundTrip?: boolean
}

export type BrowserFlightOption = {
  airline: string
  departure: string
  arrival: string
  stops: number | null
  fareInr: number | null
  /** Round-trip fares are the airline total for both directions, as Google shows it. */
  roundTrip?: boolean
  layover?: string
  fareBasis?: 'party_total' | 'unverified'
  farePassengers?: number
  route: string
  evidence: string
}

/** The exact search the person can open themselves: same route, both dates, passengers, cabin, India pricing. */
export function roundTripQuery(context:BrowserFlightContext){
  return `Round trip ${context.nonStop ? 'non-stop ' : ''}flights from ${context.origin?.code} to ${context.destination?.code} departing ${context.startDate} returning ${context.returnDate} for ${context.adults || 1} adult${context.adults === 1 ? '' : 's'} in ${(context.cabin || 'economy').replace(/_/g, ' ')}`
}
export function roundTripSearchLink(context:BrowserFlightContext){
  return `https://www.google.com/travel/flights?hl=en&gl=in&curr=INR&q=${encodeURIComponent(roundTripQuery(context))}`
}

export function formatBrowserFlightResult(context:BrowserFlightContext,options:BrowserFlightOption[],sourceUrl:string){
  const url=new URL(sourceUrl)
  if(url.protocol!=='https:'||!['google.com','www.google.com'].includes(url.hostname)||!/^\/travel\/flights(?:\/|$)/.test(url.pathname))throw new Error('flight_result_source_unverified')
  const passengers=context.adults||1
  // 17 Oct: same shape as the round trip — cheapest first, one verdict, layovers, the exact search link.
  const sorted=oneWayDisplayOrder(options)
  const money=(n:number)=>`₹${n.toLocaleString('en-IN')}`
  const stops=(f:BrowserFlightOption)=>f.stops===null?'stops not verified':f.stops===0?'non-stop':`${f.stops} stop${f.stops===1?'':'s'}${f.layover?` (${f.layover})`:''}`
  const basis=(f:BrowserFlightOption)=>f.fareBasis==='party_total'&&f.farePassengers===passengers?(passengers>1?` total for ${passengers} adults`:''):passengers>1?' (party total not verified)':''
  const rows=sorted.map((f,i)=>`${i+1}. ${f.fareInr?money(f.fareInr):'fare not verified'}${f.fareInr?basis(f):''} · ${f.airline}\n   ${f.departure} → ${f.arrival} · ${stops(f)}`)
  // 18 Oct: Google listed 52 non-stops from ₹18,327 below five cheaper 1-stop fares; the cheapest non-stop
  // is always named and listed, even when it is not in the cheapest five.
  const best=sorted.find(f=>f.fareInr), nonstop=[...options].filter(f=>f.stops===0&&f.fareInr).sort((a,b)=>a.fareInr!-b.fareInr!)[0]

  const verdict=best?[`Cheapest: ${money(best.fareInr!)} on ${best.airline}, ${best.stops===0?'non-stop':`${best.stops} stop${best.stops===1?'':'s'}`}.`,
    ...(nonstop&&nonstop!==best?[`Cheapest non-stop: ${money(nonstop.fareInr!)} on ${nonstop.airline}.`]:[])]:[]
  return [`*${context.routeLabel}* · ${context.whenLabel}`,`${passengers} adult${passengers===1?'':'s'} · ${(context.cabin||'economy').replace(/_/g,' ')} · one-way`,'',...verdict,'',...rows,'',
    'Fares from Google Flights, read just now; they move, so open the link to confirm. Baggage and optional charges are extra. Say “book the cheapest” to book.',
    context.origin?.code&&context.destination?.code&&context.startDate?oneWaySearchLink(context):sourceUrl].join('\n')
}

/** The order the person sees for a one-way result: cheapest first, top five. "Book #2" refers to this list. */
export function oneWayDisplayOrder(options:BrowserFlightOption[]){
  return withCheapestNonstop([...options].sort((a,b)=>(a.fareInr??Infinity)-(b.fareInr??Infinity)),5)
}

/** Cheapest five, plus the cheapest non-stop as a sixth row when none of the five is non-stop. */
function withCheapestNonstop(sorted:BrowserFlightOption[],n:number){
  const top=sorted.slice(0,n)
  const nonstop=sorted.find(f=>f.stops===0&&f.fareInr)
  return nonstop&&!top.includes(nonstop)?[...top,nonstop]:top
}

export function browserFlightContextVisible(pageText: string, context: BrowserFlightContext) {
  const text = String(pageText || '').replace(/\s+/g, ' ').toLowerCase()
  const placeIndex = (place: BrowserFlightContext['origin']) => Math.min(...[place?.code,place?.label].filter(Boolean)
    .map(value => text.search(new RegExp(`\\b${String(value).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\b`,'i'))).filter(index=>index>=0))
  const origin = placeIndex(context.origin), destination = placeIndex(context.destination)
  if(!Number.isFinite(origin) || !Number.isFinite(destination) || origin>=destination || !context.startDate) return false
  const date = new Date(`${context.startDate}T00:00:00Z`)
  const day = date.getUTCDate(), year = date.getUTCFullYear()
  const month = new Intl.DateTimeFormat('en',{month:'long',timeZone:'UTC'}).format(date).toLowerCase()
  const dateShown = text.includes(context.startDate) || new RegExp(`\\b(?:${day} ${month}(?: ${year})|${month} ${day},? ${year}|${day} ${month.slice(0,3)} ${year}|${month.slice(0,3)} ${day},? ${year})\\b`).test(text)
  const cabin = (context.cabin || 'economy').replace(/_/g,' ')
  const passengers = new RegExp(`\\b${context.adults || 1}\\s+(?:adults?|passengers?|travellers?|travelers?)\\b`).test(text)
  const shownCabin = /\bfirst(?: class)?\b/.test(text) ? 'first' : /\bbusiness(?: class)?\b/.test(text) ? 'business'
    : /\bpremium economy\b/.test(text) ? 'premium economy' : /\beconomy\b/.test(text) ? 'economy' : ''
  return dateShown && shownCabin===cabin && passengers
}

function parseJsonArray(text: string) {
  const clean = String(text || '').replace(/```json|```/g, '').trim()
  try {
    const value = JSON.parse(clean)
    return Array.isArray(value) ? value : []
  } catch {}
  const match = clean.match(/\[[\s\S]*\]/)
  if (!match) return []
  try {
    const value = JSON.parse(match[0])
    return Array.isArray(value) ? value : []
  } catch { return [] }
}

export function normalizeBrowserFlightOption(value: any, pageText: string): BrowserFlightOption | null {
  const airline = String(value?.airline || '').trim().slice(0, 120)
  const departure = String(value?.departure || '').trim().slice(0, 120)
  const arrival = String(value?.arrival || '').trim().slice(0, 120)
  const route = String(value?.route || '').trim().slice(0, 180)
  const evidence = String(value?.evidence || '').replace(/\s+/g, ' ').trim().slice(0, 300)
  const visible = String(pageText || '').replace(/\s+/g, ' ').trim().toLowerCase()
  const quote = evidence.toLowerCase()
  if (!airline || !departure || !arrival || !evidence || !visible.includes(quote)) return null
  // A model-produced row is evidence only when its exact quote supports the row.
  if (![airline, departure, arrival].every(part => quote.includes(part.toLowerCase()))) return null
  const stopsRaw = value?.stops
  const claimedStops = stopsRaw == null || stopsRaw === '' ? null : Number(stopsRaw)
  const stopSignal = /\b(?:non[- ]?stop|direct)\b/i.test(evidence) ? 0 : Number(evidence.match(/\b([1-5])\s+stops?\b/i)?.[1] ?? NaN)
  const stops = Number.isInteger(claimedStops) && claimedStops === stopSignal ? claimedStops : null
  const fareRaw = Number(String(value?.fareInr ?? '').replace(/[^0-9.]/g, ''))
  const shownFares = [...evidence.matchAll(/(?:₹|\bINR|\bRs\.?)\s*([\d,]+(?:\.\d{1,2})?)/gi)]
    .map(match => Number(match[1].replace(/,/g, '')))
  const fareInr = Number.isFinite(fareRaw) && fareRaw > 0 && shownFares.includes(fareRaw) ? Math.round(fareRaw) : null
  return { airline, departure, arrival, stops, fareInr, route, evidence }
}

async function extractFlightOptions(pageText: string, context: BrowserFlightContext) {
  if(!browserFlightContextVisible(pageText,context)) return []
  const prompt = `Extract only flight options that are explicitly visible in this browser page text. Do not infer or invent anything. Requested route: ${context.routeLabel}. Requested date: ${context.whenLabel}. Return JSON array only. Each item: {"airline":"","departure":"","arrival":"","stops":0,"fareInr":0,"route":"","evidence":"short exact supporting fragment"}. If the page does not contain actual flight rows with airline + departure + arrival, return []. fareInr must be numeric INR only when clearly shown. Page text: ${JSON.stringify(String(pageText || '').slice(0,14000))}`
  try {
    const res = await anthropic.messages.create({
      model:'claude-haiku-4-5', max_tokens:2200, temperature:0,
      messages:[{role:'user',content:prompt}],
    },{timeout:10_000,maxRetries:0})
    const text = res.content[0]?.type === 'text' ? res.content[0].text : ''
    return parseJsonArray(text).filter(value => String(value?.route || '').replace(/\s+/g,' ').trim() === context.routeLabel)
      .map(value => normalizeBrowserFlightOption(value, pageText)).filter(Boolean) as BrowserFlightOption[]
  } catch (error:any) {
    console.error('TRAVEL_BROWSER_EXTRACT_FAILED:', error?.message || error)
    return []
  }
}

export function browserFlightControlsMatch(values:unknown,context:BrowserFlightContext){
  if(!Array.isArray(values))return false
  const labels=values.filter((value:any)=>typeof value==='string') as string[]
  const from=labels.find(label=>/^Where from\?/i.test(label))
  const to=labels.find(label=>/^Where to\?/i.test(label))
  if(!from||!to||!context.origin?.code||!context.destination?.code)return false
  if(!new RegExp(`\\b${context.origin.code}\\b`,'i').test(from)||!new RegExp(`\\b${context.destination.code}\\b`,'i').test(to))return false
  if(!labels.some(label=>/Change ticket type\. One way/i.test(label)))return false
  // 17 Oct: the departure day is verified on every row; the selected cabin must be visibly shown.
  const cabin=(context.cabin||'economy').replace(/_/g,' ')
  if(!labels.some(label=>new RegExp(`seating class\\.\\s*${cabin}\\b`,'i').test(label)))return false
  // The passenger count shown must be the one asked for, and a "Track prices … departing" label, when Google
  // shows one, must carry the requested date.
  const people=labels.find(label=>/^\d+ passengers?\b/i.test(label))
  if(people&&Number(people.match(/^(\d+)/)![1])!==(context.adults||1))return false
  const track=labels.find(label=>/^Track prices from .+ departing \d{4}-\d{2}-\d{2}/i.test(label))
  if(track&&!track.includes(`departing ${context.startDate}`))return false
  return true
}

// Google renders each result as an accessible link containing the complete
// observed row. These exact labels preserve fares/times that prose can reorder.
/**
 * 17 Oct (live, Chrome): Google Flights ignores a q= that STARTS with "One-way flights from …" and shows its
 * home page, so the cloud browser spent its whole budget toggling the trip type. "Flights from BLR to DEL on
 * 2026-11-06 one way for 1 adult in economy" opens the results directly (64 rows read in Chrome).
 */
// Google names the airport, not always the city ("Indira Gandhi International Airport" for Delhi).
const AIRPORT_NAMES:Record<string,RegExp>={DEL:/indira gandhi/i,BOM:/chhatrapati shivaji/i,BLR:/kempegowda/i,MAA:/chennai/i,HYD:/rajiv gandhi/i,
  CCU:/netaji subhash/i,GOI:/\bgoa\b|mopa|dabolim|manohar/i,GOX:/mopa|manohar/i,COK:/cochin/i,AMD:/sardar vallabhbhai/i,PNQ:/pune/i,JAI:/jaipur/i,
  LKO:/chaudhary charan singh|lucknow/i,TRV:/thiruvananthapuram|trivandrum/i,IXC:/chandigarh/i,SIN:/changi/i,DXB:/dubai/i,BKK:/suvarnabhumi/i,
  KUL:/kuala lumpur/i,LHR:/heathrow/i,JFK:/john f\.? kennedy/i}
export function airportMatches(text:string,place:BrowserFlightContext['origin']){
  const t=String(text||'').toLowerCase()
  if(!place)return false
  if(place.label&&t.includes(place.label.toLowerCase()))return true
  const known=place.code?AIRPORT_NAMES[place.code.toUpperCase()]:undefined
  return Boolean(known&&known.test(t))
}

export function oneWayQuery(context:BrowserFlightContext){
  return `Flights from ${context.origin!.code} to ${context.destination!.code} on ${context.startDate} one way${context.nonStop?' nonstop':''} for ${context.adults||1} adult${(context.adults||1)===1?'':'s'} in ${(context.cabin||'economy').replace(/_/g,' ')}`
}
export function oneWaySearchLink(context:BrowserFlightContext){
  return `https://www.google.com/travel/flights?hl=en&gl=in&curr=INR&q=${encodeURIComponent(oneWayQuery(context))}`
}

export function googleFlightOptionsFromEvidence(result:any,context:BrowserFlightContext):BrowserFlightOption[]{
  try{const url=new URL(result.url);if(url.protocol!=='https:'||!['google.com','www.google.com'].includes(url.hostname)||!/^\/travel\/flights(?:\/|$)/.test(url.pathname))return []}catch{return []}
  const evidence=result.flightEvidence
  if(!Array.isArray(evidence?.searchControls)||!Array.isArray(evidence?.resultLabels))return []
  if(!browserFlightControlsMatch(evidence.searchControls,context))return []
  const date=new Date(`${context.startDate}T00:00:00Z`)
  // The selected count alone does not say whether a price is per-person or
  // for the whole party. Require Google's visible, explicit fare-basis line.
  const basis=String(evidence.fareBasisLabel||result.pageText||'').match(/Prices include required taxes\s*\+\s*fees for (one|[1-9]) adults?\b/i)
  const farePassengers=basis?.[1]?.toLowerCase()==='one'?1:Number(basis?.[1])
  const partyTotal=Number.isInteger(farePassengers)&&farePassengers===(context.adults||1)
  const month=new Intl.DateTimeFormat('en',{month:'long',timeZone:'UTC'}).format(date)
  const departureDay=new RegExp(`\\bon \\w+, ${month} ${date.getUTCDate()}\\b`,'i')
  return evidence.resultLabels.flatMap((raw:any)=>{
    if(typeof raw!=='string')return []
    const label=raw.replace(/\s+/g,' ').trim()
    // 17 Oct: one-stop rows count too (cheapest is often 1 stop); the layover is kept for the reply.
    const match=label.match(/^From ([\d,]+) Indian rupees\. (Nonstop|[1-4] stops?) flight with (.+?)\. Leaves (.+?) at (\d{1,2}:\d{2} [AP]M) (on .+?) and arrives at (.+?) at (\d{1,2}:\d{2} [AP]M) (on .+?)\. Total duration .*?(?:Layover \(1 of \d\) is an? (.+?) layover at (.+?)(?: in ([^.]+?))?\.)?(?:\s*Select flight)?\s*$/i)
    if(!match||!departureDay.test(match[6])||!airportMatches(match[4],context.origin)||!airportMatches(match[7],context.destination))return []
    const fareInr=Number(match[1].replace(/,/g,''));if(!Number.isFinite(fareInr)||fareInr<=0)return []
    const stops=/^nonstop$/i.test(match[2])?0:Number(match[2][0])
    if(context.nonStop&&stops!==0)return []
    return [{airline:match[3],departure:match[5],arrival:`${match[8]}${match[6]!==match[9]?` ${match[9].replace(/^on \w+, /i,'')}`:''}`,stops,fareInr,
      ...(match[10]?{layover:`${match[10]} in ${match[12]||match[11].replace(/\s+(?:International )?Airport.*$/i,'')}`}:{}),
      fareBasis:partyTotal?'party_total' as const:'unverified' as const,...(partyTotal?{farePassengers}:{}),route:context.routeLabel,evidence:label}]
  })
}

export async function runLiveFlightBrowserTask(params: {
  actor: AgentActor
  context: BrowserFlightContext
  objective: string
  deadline?: number
}) {
  const { context } = params
  if (!context.origin?.code || !context.destination?.code || !context.startDate) return null

  const round = context.roundTrip === true && Boolean(context.returnDate)
  const query = round
    ? roundTripQuery(context)
    : oneWayQuery(context)
  const url = `https://www.google.com/travel/flights?hl=en&gl=in&curr=INR&q=${encodeURIComponent(query)}`
  let result: Awaited<ReturnType<typeof runSecureBrowser>>
  try { result = await runSecureBrowser({
    userId:params.actor.userId,
    url,
    objective:`Read actual flight rows for ${query}. Before Search, explicitly set ${context.adults||1} adult${context.adults===1?'':'s'}, ${round?'round trip with the exact departure and return dates':'one-way'} and ${(context.cabin||'economy').replace(/_/g,' ')} using the observed controls; query URL prose does not set them. User research criteria: ${params.objective}. Verify the selected route, departure date, passengers and cabin using visible search controls. For the party total, read the visible "Prices include required taxes + fees for ... adults" statement; do not multiply a per-person or unknown fare. Report airline, departure, arrival and INR fare evidence. Stay on the results list: never click a flight row, Select flight or a fare, because that moves to the return-flight page and hides the round-trip prices. Do not book, purchase, sign in or submit passenger/payment information.`,
    mode:'read',recoverFlightSearch:true,
    readDeadline:Number.isFinite(params.deadline)?params.deadline!-30_000:undefined,
  }) } catch (error: any) {
    // Browser verification/timeouts are expected provider failures. The travel
    // orchestrator must still deliver its clearly labelled public-source fallback.
    const browserReadDiagnostics = sanitizeBrowserReadDiagnostics(error?.browserReadDiagnostics)
    console.warn('TRAVEL_BROWSER_READ_FAILED:', String(error?.message || 'browser_read_failed').slice(0, 200))
    return {status: 'failed' as const, options: [] as BrowserFlightOption[], browser: null, source: 'google-flights-browser' as const, browserReadDiagnostics}
  }

  if (result.status === 'blocked') {
    return { status:'blocked' as const, options:[] as BrowserFlightOption[], browser:result, source:'google-flights-browser' as const }
  }
  const observedOptions=round?googleRoundTripOptionsFromEvidence(result,context):googleFlightOptionsFromEvidence(result,context)
  const options = (observedOptions.length||round?observedOptions:await extractFlightOptions(result.pageText, context)).filter(option => !context.nonStop || option.stops === 0)
  console.log('TRAVEL_BROWSER_EVIDENCE:',JSON.stringify({status:result.status,observedRows:result.flightEvidence?.resultLabels?.length||0,
    selectedControls:result.flightEvidence?.searchControls?.length||0,contextMatches:browserFlightControlsMatch(result.flightEvidence?.searchControls,context),
    orderedTextContextMatches:browserFlightContextVisible(result.flightEvidence?.searchControls?.join('\n')||result.pageText,context),
    dateMatches:result.flightEvidence?.searchControls?.some(label=>label.includes(context.startDate||'invalid-date'))===true,verifiedRows:options.length}))
  return { status:'completed' as const, options, browser:result, source:'google-flights-browser' as const }
}

/**
 * 17 Oct: a round trip is read as ONE Google Flights search for the exact dates. Each row is a link labelled
 * "From 28443 Indian rupees round trip total. 1 stop flight with Air India. Leaves ... at 7:00 PM on Wednesday,
 * October 28 and arrives at ... Total duration 11 hr 10 min. Layover (1 of 1) is a 3 hr 15 min layover at ...".
 * The price is the round-trip total; one-way labels and rows for another day are refused.
 */
export function googleRoundTripOptionsFromEvidence(result:any,context:BrowserFlightContext):BrowserFlightOption[]{
  try{const url=new URL(result.url);if(url.protocol!=='https:'||!['google.com','www.google.com'].includes(url.hostname)||!/^\/travel\/flights(?:\/|$)/.test(url.pathname))return []}catch{return []}
  const evidence=result.flightEvidence
  if(!context.roundTrip||!context.startDate||!context.returnDate||!context.origin?.code||!context.destination?.code)return []
  if(!Array.isArray(evidence?.searchControls)||!Array.isArray(evidence?.resultLabels))return []
  const labels=evidence.searchControls.filter((v:any)=>typeof v==='string') as string[]
  const from=labels.find(l=>/^Where from\?/i.test(l)),to=labels.find(l=>/^Where to\?/i.test(l))
  if(!from||!to||!new RegExp(`\\b${context.origin.code}\\b`,'i').test(from)||!new RegExp(`\\b${context.destination.code}\\b`,'i').test(to))return []
  if(!labels.some(l=>/Change ticket type\. Round trip/i.test(l)))return []
  // The dates are verified from Google's own label for this search, not from the URL we asked for.
  if(!labels.some(l=>l.includes(`departing ${context.startDate} and returning ${context.returnDate}`)))return []
  const date=new Date(`${context.startDate}T00:00:00Z`)
  const basis=String(evidence.fareBasisLabel||result.pageText||'').match(/Prices include required taxes\s*\+\s*fees for (one|[1-9]) adults?\b/i)
  const farePassengers=basis?.[1]?.toLowerCase()==='one'?1:Number(basis?.[1])
  const partyTotal=Number.isInteger(farePassengers)&&farePassengers===(context.adults||1)
  const month=new Intl.DateTimeFormat('en',{month:'long',timeZone:'UTC'}).format(date)
  const departureDay=new RegExp(`\\bon \\w+, ${month} ${date.getUTCDate()}$`,'i')
  return evidence.resultLabels.flatMap((raw:any)=>{
    if(typeof raw!=='string')return []
    const label=raw.replace(/\s+/g,' ').trim()
    const m=label.match(/^From ([\d,]+) Indian rupees round trip total\. (Nonstop|[1-4] stops?) flight with (.+?)\. Leaves (.+?) at (\d{1,2}:\d{2} [AP]M) (on .+?) and arrives at (.+?) at (\d{1,2}:\d{2} [AP]M) (on .+?)\. Total duration .*?(?:Layover \(1 of \d\) is an? (.+?) layover at (.+?)(?: in ([^.]+?))?\.)?(?: Select flight)?\s*$/i)
    if(!m||!departureDay.test(m[6])||!airportMatches(m[4],context.origin)||!airportMatches(m[7],context.destination))return []
    const fareInr=Number(m[1].replace(/,/g,''));if(!Number.isFinite(fareInr)||fareInr<=0)return []
    const stops=/^nonstop$/i.test(m[2])?0:Number(m[2][0])
    if(context.nonStop&&stops!==0)return []
    return [{airline:m[3],departure:m[5],arrival:`${m[8]}${m[6]!==m[9]?` ${m[9].replace(/^on \w+, /i,'')}`:''}`,stops,fareInr,roundTrip:true,
      ...(m[10]?{layover:`${m[10]} in ${m[12]||m[11].replace(/\s+(?:International )?Airport.*$/i,'')}`}:{}),
      fareBasis:partyTotal?'party_total' as const:'unverified' as const,...(partyTotal?{farePassengers}:{}),route:context.routeLabel,evidence:label}]
  })
}

/** The order the person sees: cheapest first, top five. "Book #2" refers to this list. */
export function roundTripDisplayOrder(options:BrowserFlightOption[]){
  return withCheapestNonstop([...options].filter(o=>o.fareInr).sort((a,b)=>a.fareInr!-b.fareInr!),5)
}

/** Cheapest first, one plain verdict. Prices are Google's round-trip totals and move between reads. */
export function formatRoundTripResult(context:BrowserFlightContext,options:BrowserFlightOption[],sourceUrl:string){
  const url=new URL(sourceUrl)
  if(url.protocol!=='https:'||!['google.com','www.google.com'].includes(url.hostname)||!/^\/travel\/flights(?:\/|$)/.test(url.pathname))throw new Error('flight_result_source_unverified')
  const passengers=context.adults||1
  const sorted=roundTripDisplayOrder(options)
  const money=(n:number)=>`₹${n.toLocaleString('en-IN')}`
  const basis=(o:BrowserFlightOption)=>o.fareBasis==='party_total'&&o.farePassengers===passengers?(passengers>1?` total for ${passengers} adults`:''):' (party total not verified)'
  const stops=(o:BrowserFlightOption)=>o.stops===null?'stops not verified':o.stops===0?'non-stop':`${o.stops} stop${o.stops===1?'':'s'}${o.layover?` (${o.layover})`:''}`
  const rows=sorted.map((o,i)=>`${i+1}. ${money(o.fareInr!)}${basis(o)} · ${o.airline}\n   Out ${o.departure} → ${o.arrival} · ${stops(o)}`)
  const best=sorted[0], nonstop=sorted.find(o=>o.stops===0)
  const verdict=best?[`Cheapest round trip: ${money(best.fareInr!)} on ${best.airline}, ${best.stops===0?'non-stop':`${best.stops} stop${best.stops===1?'':'s'}`}.`,
    ...(nonstop&&nonstop!==best?[`Cheapest non-stop: ${money(nonstop.fareInr!)} on ${nonstop.airline}.`]:[])]:[]
  const dayLabel=(iso:string)=>new Intl.DateTimeFormat('en-IN',{day:'numeric',month:'short',timeZone:'UTC'}).format(new Date(`${iso}T00:00:00Z`))
  return [`*${context.routeLabel}* · ${dayLabel(context.startDate!)} → back ${dayLabel(context.returnDate!)}`,
    `${passengers} adult${passengers===1?'':'s'} · ${(context.cabin||'economy').replace(/_/g,' ')} · round trip`,'',...verdict,'',...rows,'',
    'Round-trip totals from Google Flights, read just now; fares move, so open the link to confirm before you book. You pick the return flight on the next page. Baggage and optional charges are extra.',
    roundTripSearchLink(context)].join('\n')
}
