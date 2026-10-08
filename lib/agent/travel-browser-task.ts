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
}

export type BrowserFlightOption = {
  airline: string
  departure: string
  arrival: string
  stops: number | null
  fareInr: number | null
  fareBasis?: 'party_total' | 'unverified'
  farePassengers?: number
  route: string
  evidence: string
}

export function formatBrowserFlightResult(context:BrowserFlightContext,options:BrowserFlightOption[],sourceUrl:string){
  const url=new URL(sourceUrl)
  if(url.protocol!=='https:'||!['google.com','www.google.com'].includes(url.hostname)||!/^\/travel\/flights(?:\/|$)/.test(url.pathname))throw new Error('flight_result_source_unverified')
  const passengers=context.adults||1
  const rows=options.slice(0,8).map((f,i)=>`${i+1}. ${f.airline} · ${f.departure} → ${f.arrival} · ${f.stops===null?'stops not verified':f.stops===0?'non-stop':`${f.stops} stop${f.stops===1?'':'s'}`} · ${f.fareInr?`₹${f.fareInr.toLocaleString('en-IN')}${f.fareBasis==='party_total'&&f.farePassengers===passengers?` total for ${passengers} adult${passengers===1?'':'s'}`:passengers>1?' displayed fare; party total not verified':''}`:'fare not verified'}`)
  return `Flight check · ${context.routeLabel} · ${context.whenLabel}\n${context.adults||1} adult${context.adults===1?'':'s'} · ${(context.cabin||'economy').replace(/_/g,' ')}\nSource: Google Flights, read from the live browser page\n\n${rows.join('\n')}\n\nOpen source: ${sourceUrl}\nBaggage and optional charges need final verification. Nothing booked or paid.`
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
  // Controls are sorted for planner relevance. Their array order is not route
  // direction; use explicit observed field identities before prose validation.
  return browserFlightContextVisible([from,to,...labels.filter(label=>label!==from&&label!==to)].join('\n'),context)
}

// Google renders each result as an accessible link containing the complete
// observed row. These exact labels preserve fares/times that prose can reorder.
export function googleFlightOptionsFromEvidence(result:any,context:BrowserFlightContext):BrowserFlightOption[]{
  try{const url=new URL(result.url);if(url.protocol!=='https:'||!['google.com','www.google.com'].includes(url.hostname)||!/^\/travel\/flights(?:\/|$)/.test(url.pathname))return []}catch{return []}
  const evidence=result.flightEvidence
  if(!Array.isArray(evidence?.searchControls)||!Array.isArray(evidence?.resultLabels))return []
  if(!browserFlightControlsMatch(evidence.searchControls,context))return []
  const date=new Date(`${context.startDate}T00:00:00Z`)
  // The selected count alone does not say whether a price is per-person or
  // for the whole party. Require Google's visible, explicit fare-basis line.
  const basis=String(evidence.fareBasisLabel||result.pageText||'').match(/\bPrices include required taxes\s*\+\s*fees for (one|[1-9]) adults?\b/i)
  const farePassengers=basis?.[1]?.toLowerCase()==='one'?1:Number(basis?.[1])
  const partyTotal=Number.isInteger(farePassengers)&&farePassengers===(context.adults||1)
  const month=new Intl.DateTimeFormat('en',{month:'long',timeZone:'UTC'}).format(date)
  const departureDay=new RegExp(`\\bon \\w+, ${month} ${date.getUTCDate()}\\b`,'i')
  return evidence.resultLabels.flatMap((raw:any)=>{
    if(typeof raw!=='string')return []
    const label=raw.replace(/\s+/g,' ').trim()
    const match=label.match(/^From ([\d,]+) Indian rupees\. Nonstop flight with (.+?)\. Leaves (.+?) at (\d{1,2}:\d{2} [AP]M) (on .+?) and arrives at (.+?) at (\d{1,2}:\d{2} [AP]M) (on .+?)\. Total duration /i)
    if(!match||!departureDay.test(match[5])||!match[3].toLowerCase().includes(context.origin!.label.toLowerCase())||!match[6].toLowerCase().includes(context.destination!.label.toLowerCase()))return []
    const fareInr=Number(match[1].replace(/,/g,''));if(!Number.isFinite(fareInr)||fareInr<=0)return []
    return [{airline:match[2],departure:match[4],arrival:`${match[7]}${match[5]!==match[8]?` ${match[8]}`:''}`,stops:0,fareInr,
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

  const query = `One-way ${context.nonStop ? 'non-stop ' : ''}flights from ${context.origin.code} to ${context.destination.code} on ${context.startDate} for ${context.adults || 1} adult${context.adults === 1 ? '' : 's'} in ${(context.cabin || 'economy').replace(/_/g, ' ')}`
  const url = `https://www.google.com/travel/flights?hl=en&curr=INR&q=${encodeURIComponent(query)}`
  let result: Awaited<ReturnType<typeof runSecureBrowser>>
  try { result = await runSecureBrowser({
    userId:params.actor.userId,
    url,
    objective:`Read actual flight rows for ${query}. Before Search, explicitly set ${context.adults||1} adult${context.adults===1?'':'s'}, one-way and ${(context.cabin||'economy').replace(/_/g,' ')} using the observed controls; query URL prose does not set them. User research criteria: ${params.objective}. Verify the selected route, departure date, passengers and cabin using visible search controls. For the party total, read the visible "Prices include required taxes + fees for ... adults" statement; do not multiply a per-person or unknown fare. Report airline, departure, arrival and INR fare evidence. Do not book, purchase, sign in or submit passenger/payment information.`,
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
  const observedOptions=googleFlightOptionsFromEvidence(result,context)
  const options = (observedOptions.length?observedOptions:await extractFlightOptions(result.pageText, context)).filter(option => !context.nonStop || option.stops === 0)
  console.log('TRAVEL_BROWSER_EVIDENCE:',JSON.stringify({status:result.status,observedRows:result.flightEvidence?.resultLabels?.length||0,
    selectedControls:result.flightEvidence?.searchControls?.length||0,contextMatches:browserFlightControlsMatch(result.flightEvidence?.searchControls,context),
    orderedTextContextMatches:browserFlightContextVisible(result.flightEvidence?.searchControls?.join('\n')||result.pageText,context),
    dateMatches:result.flightEvidence?.searchControls?.some(label=>label.includes(context.startDate||'invalid-date'))===true,verifiedRows:options.length}))
  return { status:'completed' as const, options, browser:result, source:'google-flights-browser' as const }
}
