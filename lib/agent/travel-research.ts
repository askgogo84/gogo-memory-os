import { supabaseAdmin } from '@/lib/supabase-admin'
import { rememberTypedObjects } from './typed-object-context'
import { searchWebResults, type WebSearchResult } from '@/lib/web-search'
import { searchCreditIQLiveFlights } from '@/lib/integrations/creditiq-travel'
import { redactSecretShapedText } from '@/lib/bot/memory-redaction'
import { formatBrowserFlightResult, runLiveFlightBrowserTask } from './travel-browser-task'
import { sanitizeBrowserReadDiagnostics, type BrowserReadDiagnostic } from './browser-read-diagnostics'
import {enqueueTravelResearch} from './travel-research-queue'
import type { CreditIQFlightResult } from '@/lib/integrations/creditiq-travel'
import type { AgentActor } from './actor'
import type { AgentSurface } from './orchestrator'

function safe(value: unknown, max = 1600) {
  return redactSecretShapedText(String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max))
}

type Place = { label: string; code?: string; aliases: string[] }
type TravelContext = {
  kind: 'flight' | 'hotel'
  origin?: Place
  destination?: Place
  whenLabel: string
  searchWhen: string
  routeLabel: string
  startDate?: string
  endDate?: string
  cabin?: 'economy' | 'premium_economy' | 'business' | 'first'
  adults?: number
  nonStop?: boolean
}
type DateRelevance = 'matched' | 'unknown' | 'mismatched'

const PLACES: Record<string, Place> = {
  bangalore: { label: 'Bengaluru', code: 'BLR', aliases: ['bangalore','bengaluru','blr'] },
  bengaluru: { label: 'Bengaluru', code: 'BLR', aliases: ['bangalore','bengaluru','blr'] },
  blr: { label: 'Bengaluru', code: 'BLR', aliases: ['bangalore','bengaluru','blr'] },
  mumbai: { label: 'Mumbai', code: 'BOM', aliases: ['mumbai','bombay','bom'] },
  bombay: { label: 'Mumbai', code: 'BOM', aliases: ['mumbai','bombay','bom'] },
  bom: { label: 'Mumbai', code: 'BOM', aliases: ['mumbai','bombay','bom'] },
  delhi: { label: 'Delhi', code: 'DEL', aliases: ['delhi','new delhi','del'] },
  'new delhi': { label: 'Delhi', code: 'DEL', aliases: ['delhi','new delhi','del'] },
  del: { label: 'Delhi', code: 'DEL', aliases: ['delhi','new delhi','del'] },
  hyderabad: { label: 'Hyderabad', code: 'HYD', aliases: ['hyderabad','hyd'] },
  hyd: { label: 'Hyderabad', code: 'HYD', aliases: ['hyderabad','hyd'] },
  chennai: { label: 'Chennai', code: 'MAA', aliases: ['chennai','madras','maa'] },
  maa: { label: 'Chennai', code: 'MAA', aliases: ['chennai','madras','maa'] },
  kolkata: { label: 'Kolkata', code: 'CCU', aliases: ['kolkata','calcutta','ccu'] },
  ccu: { label: 'Kolkata', code: 'CCU', aliases: ['kolkata','calcutta','ccu'] },
  pune: { label: 'Pune', code: 'PNQ', aliases: ['pune','pnq'] },
  pnq: { label: 'Pune', code: 'PNQ', aliases: ['pune','pnq'] },
  goa: { label: 'Goa', aliases: ['goa','goi','gox'] },
  dubai: { label: 'Dubai', code: 'DXB', aliases: ['dubai','dxb'] },
  dxb: { label: 'Dubai', code: 'DXB', aliases: ['dubai','dxb'] },
  'new york': { label: 'New York', code: 'NYC', aliases: ['new york','nyc','jfk','ewr','lga'] },
  nyc: { label: 'New York', code: 'NYC', aliases: ['new york','nyc','jfk','ewr','lga'] },
  jfk: { label: 'New York', code: 'JFK', aliases: ['new york','nyc','jfk'] },
}
const INDIA_CODES = new Set(['BLR','BOM','DEL','HYD','MAA','CCU','PNQ','GOI','GOX'])
const MONTHS: Record<string, number> = {
  jan:0, january:0, feb:1, february:1, mar:2, march:2, apr:3, april:3, may:4,
  jun:5, june:5, jul:6, july:6, aug:7, august:7, sep:8, sept:8, september:8,
  oct:9, october:9, nov:10, november:10, dec:11, december:11,
}
function esc(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }
function placeFrom(raw: string | undefined): Place | undefined { const cleaned=String(raw||'').trim().replace(/[,.!?]+$/g,'').toLowerCase(); if(!cleaned)return undefined; if(PLACES[cleaned])return PLACES[cleaned]; return {label:cleaned.replace(/\b\w/g,c=>c.toUpperCase()),aliases:[cleaned]} }
function extractSegment(text:string,marker:'from'|'to'|'in'){const stop=marker==='from'?'(?=\\s+(?:to|next|this|tomorrow|on|for|under|below|with|return|one-way|round-trip)\\b|$)':marker==='to'?'(?=\\s+(?:from|next|this|tomorrow|on|for|under|below|with|return|one-way|round-trip)\\b|$)':'(?=\\s+(?:next|this|tomorrow|on|for|under|below|with|from|to)\\b|$)';return text.match(new RegExp(`\\b${marker}\\s+([a-zA-Z][a-zA-Z .'-]{1,42}?)${stop}`,'i'))?.[1]?.trim()}
function fmtDate(date:Date){return new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(date)}
function isoDay(date:Date){return date.toISOString().slice(0,10)}
export function localTravelDate(now: Date, timezone = 'Asia/Kolkata') {
  const parts = new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now)
  const pick = (type: string) => parts.find(part=>part.type===type)?.value
  return new Date(`${pick('year')}-${pick('month')}-${pick('day')}T00:00:00Z`)
}

export function flightDateIssue(text: string, context: TravelContext, now = new Date(), timezone = 'Asia/Kolkata') {
  const months = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?'
  const dayMonth = text.match(new RegExp(`\\b(\\d{1,2})\\s+(${months})\\b(?:[,\\s]+(20\\d{2}))?`, 'i'))
  const monthDay = text.match(new RegExp(`\\b(${months})\\s+(\\d{1,2})\\b(?:[,\\s]+(20\\d{2}))?`, 'i'))
  if(dayMonth || monthDay) {
    const year = Number((dayMonth || monthDay)![3] || localTravelDate(now,timezone).getUTCFullYear())
    const month = MONTHS[(dayMonth ? dayMonth[2] : monthDay![1]).toLowerCase()]
    const day = Number(dayMonth ? dayMonth[1] : monthDay![2])
    const parsed = new Date(Date.UTC(year,month,day))
    if(parsed.getUTCFullYear()!==year || parsed.getUTCMonth()!==month || parsed.getUTCDate()!==day) return 'invalid'
  }
  const iso = text.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/)
  const numeric = text.match(/\b(\d{1,2})[\/-](\d{1,2})[\/-](20\d{2})\b/)
  if(iso || numeric) {
    const [year,month,day] = iso ? [Number(iso[1]),Number(iso[2]),Number(iso[3])] : [Number(numeric![3]),Number(numeric![2]),Number(numeric![1])]
    const parsed = new Date(Date.UTC(year,month-1,day))
    if(parsed.getUTCFullYear()!==year || parsed.getUTCMonth()!==month-1 || parsed.getUTCDate()!==day) return 'invalid'
  }
  if(context.startDate && context.startDate < isoDay(localTravelDate(now,timezone))) return 'past'
  return null
}
function nextWeekRange(now:Date){const base=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()));const day=base.getUTCDay()||7;const monday=new Date(base);monday.setUTCDate(base.getUTCDate()+(8-day));const sunday=new Date(monday);sunday.setUTCDate(monday.getUTCDate()+6);return{label:`${fmtDate(monday)} – ${fmtDate(sunday)}`,search:`${fmtDate(monday)} ${fmtDate(sunday)}`,startDate:isoDay(monday),endDate:isoDay(sunday)}}
function thisWeekRange(now:Date){const base=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()));const day=base.getUTCDay()||7;const sunday=new Date(base);sunday.setUTCDate(base.getUTCDate()+(7-day));return{label:`${fmtDate(base)} – ${fmtDate(sunday)}`,search:`${fmtDate(base)} ${fmtDate(sunday)}`,startDate:isoDay(base),endDate:isoDay(sunday)}}
function explicitDateFromText(text:string,now:Date) {
  const valid = (year:number,month:number,day:number) => {
    const date = new Date(Date.UTC(year,month,day))
    return date.getUTCFullYear()===year && date.getUTCMonth()===month && date.getUTCDate()===day ? isoDay(date) : null
  }
  const months = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?'
  const iso = text.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/)
  if(iso)return valid(Number(iso[1]),Number(iso[2])-1,Number(iso[3]))
  const dayMonth = text.match(new RegExp(String.raw`\b(\d{1,2})\s+(${months})\b(?:[,\s]+(20\d{2}))?`, 'i'))
  if(dayMonth)return valid(Number(dayMonth[3]||now.getUTCFullYear()),MONTHS[dayMonth[2].toLowerCase()],Number(dayMonth[1]))
  const monthDay = text.match(new RegExp(String.raw`\b(${months})\s+(\d{1,2})\b(?:[,\s]+(20\d{2}))?`, 'i'))
  if(monthDay)return valid(Number(monthDay[3]||now.getUTCFullYear()),MONTHS[monthDay[1].toLowerCase()],Number(monthDay[2]))
  const numeric = text.match(/\b(\d{1,2})[\/-](\d{1,2})[\/-](20\d{2})\b/)
  return numeric ? valid(Number(numeric[3]),Number(numeric[2])-1,Number(numeric[1])) : null
}
function normalizeWhen(text:string,now=new Date()):{label:string;search:string;startDate?:string;endDate?:string}{const t=text.toLowerCase();if(/\bnext week\b/.test(t))return nextWeekRange(now);if(/\bthis week\b/.test(t))return thisWeekRange(now);if(/\bnext month\b/.test(t)){const start=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+1,1));const end=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+2,0));return{label:new Intl.DateTimeFormat('en-GB',{month:'long',year:'numeric',timeZone:'UTC'}).format(start),search:`${fmtDate(start)} ${fmtDate(end)}`,startDate:isoDay(start),endDate:isoDay(end)}}if(/\btoday\b/.test(t)){const d=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()));return{label:fmtDate(d),search:fmtDate(d),startDate:isoDay(d),endDate:isoDay(d)}}if(/\btomorrow\b/.test(t)){const d=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()+1));return{label:fmtDate(d),search:fmtDate(d),startDate:isoDay(d),endDate:isoDay(d)}}const explicit=explicitDateFromText(text,now);if(explicit){const d=new Date(`${explicit}T00:00:00Z`);return{label:fmtDate(d),search:fmtDate(d),startDate:explicit,endDate:explicit}}return{label:'dates not specified',search:`${now.getUTCFullYear()}`}}
export function buildTravelResearchContext(rawText:string,now=new Date(),timezone='Asia/Kolkata'):TravelContext{const text=String(rawText||'').trim();const t=text.toLowerCase();const kind:'flight'|'hotel'=/\bhotel|hotels\b/.test(t)&&!/\bflight|flights|airfare\b/.test(t)?'hotel':'flight';let origin=placeFrom(extractSegment(text,'from'));let destination=placeFrom(extractSegment(text,'to'));if(kind==='flight'&&(!origin||!destination)){const pair=text.replace(/^(?:(?:please|find|search|compare|check|look|for|me|a|an|the|cheap|cheapest|available|actual|non-stop|direct|flight|flights|airfare|options)\s+)+/i,'').match(/\b([A-Za-z]{3}|[A-Za-z][A-Za-z .'-]{2,28})\s*(?:→|->| to )\s*([A-Za-z]{3}|[A-Za-z][A-Za-z .'-]{2,28}?)(?=\s+(?:next|this|tomorrow|on|for|under|below|with|one-way|round-trip)\b|$)/i);origin||=placeFrom(pair?.[1]);destination||=placeFrom(pair?.[2])}if(kind==='hotel'&&!destination)destination=placeFrom(extractSegment(text,'in'));const when=normalizeWhen(text,localTravelDate(now,timezone));const routeLabel=origin&&destination?`${origin.code||origin.label} → ${destination.code||destination.label}`:destination?destination.label:'Travel search';return{kind,origin,destination,whenLabel:when.label,searchWhen:when.search,routeLabel,startDate:when.startDate,endDate:when.endDate}}
export function isPublicTravelResearchRequest(rawText:string){const t=String(rawText||'').trim().toLowerCase();if(!/\b(flight|flights|airfare|fare|fares|hotel|hotels|travel|trip)\b/.test(t))return false;if(/\b(my\s+(flight|ticket|booking|reservation|pnr|boarding pass|itinerary)|saved\s+(flight|ticket|booking)|show\s+my\s+(flight|ticket)|find\s+my\s+(flight|ticket))\b/.test(t))return false;return/\b(cheap|cheapest|best\s+(fare|price|deal)|compare|comparison|price|prices|fare|fares|deal|deals|available|availability|options|search|research|look\s+for|find\s+(a|me\s+a)|next\s+week|this\s+week|next\s+month)\b/.test(t)}
function placeIndex(text:string,place:Place){const lower=text.toLowerCase();const indexes=place.aliases.map(a=>lower.search(new RegExp(`\\b${esc(a)}\\b`,'i'))).filter(i=>i>=0);return indexes.length?Math.min(...indexes):-1}
function directionScore(result:WebSearchResult,context:TravelContext){if(!context.origin||!context.destination||context.kind!=='flight')return 1;const title=String(result.title||'');const oi=placeIndex(title,context.origin);const di=placeIndex(title,context.destination);if(oi>=0&&di>=0)return oi<di?4:-5;const combined=`${result.title} ${result.snippet}`;const co=placeIndex(combined,context.origin);const cd=placeIndex(combined,context.destination);if(co>=0&&cd>=0)return co<cd?2:-2;return 0}
function sourceLabel(url:string){try{return new URL(url).hostname.replace(/^www\./,'').split('.')[0].replace(/[-_]/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}catch{return'Source'}}
function domesticIndia(context:TravelContext){return Boolean(context.origin?.code&&context.destination?.code&&INDIA_CODES.has(context.origin.code)&&INDIA_CODES.has(context.destination.code))}
function parseDateMentions(text:string,context:TravelContext){const out:Date[]=[];const defaultYear=Number(context.startDate?.slice(0,4)||new Date().getUTCFullYear());const add=(year:number,month:number,day:number)=>{if(year<2020||year>2100||month<0||month>11||day<1||day>31)return;const d=new Date(Date.UTC(year,month,day));if(d.getUTCFullYear()===year&&d.getUTCMonth()===month&&d.getUTCDate()===day)out.push(d)};let m:RegExpExecArray|null;const dayMonth=/\b(\d{1,2})\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:[,\s]+(20\d{2}))?/gi;while((m=dayMonth.exec(text)))add(Number(m[3]||defaultYear),MONTHS[m[2].toLowerCase()],Number(m[1]));const monthDay=/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:[,\s]+(20\d{2}))?/gi;while((m=monthDay.exec(text)))add(Number(m[3]||defaultYear),MONTHS[m[1].toLowerCase()],Number(m[2]));const numeric=/\b(\d{1,2})[\/-](\d{1,2})[\/-](20\d{2})\b/g;while((m=numeric.exec(text)))add(Number(m[3]),Number(m[2])-1,Number(m[1]));const seen=new Set<string>();return out.filter(d=>{const key=isoDay(d);if(seen.has(key))return false;seen.add(key);return true})}
function dateRelevance(result:WebSearchResult,context:TravelContext):{relevance:DateRelevance;signals:string[]}{if(!context.startDate||!context.endDate)return{relevance:'unknown',signals:[]};const dates=parseDateMentions(`${result.title} ${result.snippet}`,context);if(!dates.length)return{relevance:'unknown',signals:[]};const hits=dates.filter(d=>{const iso=isoDay(d);return iso>=context.startDate!&&iso<=context.endDate!});if(!hits.length)return{relevance:'mismatched',signals:dates.map(fmtDate).slice(0,4)};return{relevance:'matched',signals:hits.map(fmtDate).slice(0,4)}}
function extractInrFare(text:string){const m=String(text||'').match(/(?:₹|INR\s*|Rs\.?\s*)([\d,]+(?:\.\d{1,2})?)/i);return m?`₹${m[1]}`:undefined}
function hasForeignCurrency(text:string){return/(?:US\$|\$|USD\b|UAH\b|AED\b|EUR\b|€|GBP\b|£)\s*[\d,.]*/i.test(text)}
function stripForeignPrices(text:string){return text.replace(/(?:US\$|\$|USD\s*|UAH\s*|AED\s*|EUR\s*|€|GBP\s*|£)\s*[\d,.]+/gi,'').replace(/\s{2,}/g,' ').trim()}
function cleanTitle(value:string,context:TravelContext){const title=safe(value,150);return domesticIndia(context)?stripForeignPrices(title).replace(/\s*[–—-]\s*$/,'').trim():title}
function cleanSnippet(value:string,context:TravelContext){let snippet=safe(value,280).replace(/\b(?:book now|click here|promo code|checkout)\b.*$/i,'').replace(/\s*[|]{1,2}\s*/g,' · ').trim();if(domesticIndia(context))snippet=stripForeignPrices(snippet);return snippet}
export function curateTravelResults(results:WebSearchResult[],context:TravelContext){const seen=new Set<string>();const directional=Boolean(context.kind==='flight'&&context.origin&&context.destination);return results.map(result=>{const dates=dateRelevance(result,context);const score=directionScore(result,context)+(dates.relevance==='matched'?3:0);return{result,score,dates}}).filter(x=>(directional?x.score>0:x.score>=0)&&x.dates.relevance!=='mismatched').sort((a,b)=>b.score-a.score).filter(({result})=>{try{const u=new URL(result.url);const key=`${u.hostname}${u.pathname}`.replace(/\/$/,'');if(seen.has(key))return false;seen.add(key);return true}catch{return false}}).slice(0,4).map(({result,dates})=>{const combined=`${result.title} ${result.snippet}`;const inrFare=extractInrFare(combined);return{title:cleanTitle(result.title,context),source:sourceLabel(result.url),url:result.url,snippet:cleanSnippet(result.snippet,context),dateRelevance:dates.relevance,dateSignals:dates.signals,inrFare,foreignCurrencyOnly:domesticIndia(context)&&!inrFare&&hasForeignCurrency(combined)}})}
function humanDateFromIso(iso:string|undefined){return iso?fmtDate(new Date(`${iso}T00:00:00Z`)):''}
function buildQueries(context:TravelContext,original:string){if(context.kind==='flight'&&context.origin&&context.destination){const origin=`${context.origin.label}${context.origin.code?` ${context.origin.code}`:''}`;const dest=`${context.destination.label}${context.destination.code?` ${context.destination.code}`:''}`;const dates=[context.startDate,context.endDate].filter(Boolean).map(humanDateFromIso);return[`${origin} to ${dest} flights ${context.searchWhen} fare INR direct`,...dates.map(date=>`${origin} to ${dest} flight ${date} fare INR`)].slice(0,3)}if(context.kind==='hotel'&&context.destination)return[`hotels in ${context.destination.label} ${context.searchWhen} rates availability`,String(original).trim()];return[`${String(original).trim()} ${context.searchWhen} current fares options`]}
async function addActivity(tg:number,runId:string,eventType:string,message:string,metadata:Record<string,unknown>={}){const{error}=await supabaseAdmin.from('agent_activity').insert({telegram_id:String(tg),run_id:runId,event_type:eventType,message:safe(message,900),metadata_json:metadata});if(error)console.error('TRAVEL_RESEARCH_ACTIVITY_FAILED:',error.message)}
function formatRedemption(value:any){const summary=value?.redemption;if(!summary||typeof summary!=='object'||!summary.verdictLabel)return'';const best=summary.bestPath;const details:string[]=[`CreditIQ: ${safe(summary.verdictLabel,80)}`];if(best?.label)details.push(safe(best.label,160));if(Number.isFinite(Number(best?.bankPointsRequired))&&Number(best.bankPointsRequired)>0)details.push(`${Math.round(Number(best.bankPointsRequired)).toLocaleString('en-IN')} points`);if(best?.state&&best.state!=='EXECUTABLE')details.push('verification required');return`\n${details.join(' · ')}`}
export function flightSearchPreferences(text: string) {
  const cabin: NonNullable<TravelContext['cabin']> = /\bfirst(?:[- ]class)?\b/i.test(text) ? 'first'
    : /\bbusiness(?:[- ]class)?\b/i.test(text) ? 'business'
    : /\bpremium[- ]economy\b/i.test(text) ? 'premium_economy' : 'economy'
  const words: Record<string, number> = {one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9}
  const adultText = text.match(/\b(\d+|one|two|three|four|five|six|seven|eight|nine)\s+adults?\b/i)?.[1]?.toLowerCase()
  const adults = adultText ? words[adultText] ?? Number(adultText) : 1
  return {cabin, adults, nonStop: /\b(?:non[- ]?stop|direct flights?)\b/i.test(text)}
}

export function verifiedProviderFlights(rows: CreditIQFlightResult[], context: TravelContext) {
  return rows.filter(row => row.live && row.from === context.origin?.code && row.to === context.destination?.code
    && row.cabin === (context.cabin || 'economy') && /^20\d{2}-\d{2}-\d{2}[T ]/.test(row.departure)
    && row.departure.slice(0,10) >= (context.startDate || '') && row.departure.slice(0,10) <= (context.endDate || context.startDate || '')
    && (!context.nonStop || row.stops === 0)).map(row => ({...row,
      price: row.currency === 'INR' && row.cashFareVerifiedForCabin && row.price != null && row.price > 0 ? row.price : null,
      bookingLink: row.bookingLink && /^https:\/\//i.test(row.bookingLink) ? row.bookingLink : null,
    }))
}

function formatLiveFlight(value:CreditIQFlightResult,index:number){const price=value.price != null && Number.isFinite(value.price) && value.price > 0?`₹${Math.round(value.price).toLocaleString('en-IN')}`:'INR fare not verified';const stops=value.stops != null && Number.isInteger(value.stops)?(value.stops===0?'non-stop':`${value.stops} stop${value.stops===1?'':'s'}`):'stops not verified';const timing=[value.departure,value.arrival].filter(Boolean).join(' → ');const bits=[price,value.airline,timing,stops].filter(Boolean);return`${index+1}. ${bits.join(' · ')}${formatRedemption(value)}${value.bookingLink?`\nBooking/provider link: ${value.bookingLink}`:''}`}
async function tryCreditIQLive(context:TravelContext,actor:AgentActor){if(context.kind!=='flight'||!context.origin?.code||!context.destination?.code||!context.startDate)return null;const live=await searchCreditIQLiveFlights({from:context.origin.code,to:context.destination.code,date:context.startDate,dateTo:context.endDate||context.startDate,cabin:context.cabin||'economy',adults:context.adults||1,userLinkId: actor.creditiqUserId || null});return live ? {...live,flights:verifiedProviderFlights(live.flights,context)} : null}

export async function tryRunTravelResearch(params:{actor:AgentActor;surface:AgentSurface;text:string}) {
  return enqueueTravelResearch(params)
}

export async function executeTravelResearch(params:{actor:AgentActor;surface:AgentSurface;text:string;existingRunId?:string;context?:TravelContext;deadline?:number}){
  let effectiveText=params.text
  const continuation=/^(?:continue|resume|carry on|keep going)(?:\s+(?:that|the|my))?.*?(?:travel|hotel|flight|research|search|task)?(?:\s+from\s+where\s+you\s+left\s+off)?[.!?]*$/i.test(String(params.text||'').trim())
  if(continuation){
    const {data:prior,error:priorError}=await supabaseAdmin.from('agent_runs')
      .select('id,metadata_json,created_at').eq('telegram_id',String(params.actor.legacyTelegramId))
      .eq('type','travel_research').order('created_at',{ascending:false}).limit(1).maybeSingle()
    if(priorError)throw new Error(`travel_continuation_read_failed:${priorError.message}`)
    const priorInput=safe((prior?.metadata_json as any)?.input_text||'',1800)
    if(priorInput)effectiveText=priorInput
    else return null
  }
  if(!isPublicTravelResearchRequest(effectiveText))return null
  const context=params.context || {...buildTravelResearchContext(effectiveText),...flightSearchPreferences(effectiveText)};const queries=buildQueries(context,effectiveText);const tg=params.actor.legacyTelegramId;const now=new Date().toISOString()
  if(context.kind === 'flight') {
    const missing = [!context.origin && 'departure city', !context.destination && 'destination', !context.startDate && 'travel date'].filter(Boolean)
    const unsupported = /\b(?:children|child|infants?|round[- ]trip|return(?:ing)?(?:\s+on|\s+flight|\s+date)?)\b/i.test(effectiveText)
      || !Number.isInteger(context.adults) || context.adults! < 1 || context.adults! > 9
    if(missing.length || unsupported) return {runId: undefined, status:'waiting_user' as const, capability:'travel' as const, risk:'low' as const,
      handledBy:'travel-details' as const, text: missing.length
        ? `Please send the ${missing.join(', ')} together so I can compare the right flights.`
        : 'This flight search supports one-way journeys for 1–9 adults. Return journeys and child/infant fares need provider verification; please give a one-way adult search or use the provider for those fares.'}
  }
  const created = params.existingRunId ? {data:{id:params.existingRunId},error:null} : await supabaseAdmin.from('agent_runs').insert({telegram_id:String(tg),type:'travel_research',capability:'travel',status:'running',title:`Travel task · ${context.routeLabel}`,summary:'Gogo is working on this travel task.',progress:10,why:'This is a task to obtain usable current travel options.',source:params.surface,metadata_json:{plan_type:'travel_research',input_text:safe(effectiveText,1800),continuation_requested:continuation,queries,context,task_based:true},started_at:now,updated_at:now}).select('id').single()
  const {data:run,error:runError}=created;if(runError||!run?.id)throw new Error(`travel_research_run_create_failed:${runError?.message||'unknown'}`)
  const runId=String(run.id)
  let stepResult: {data:{id:string}|null;error:any}
  const priorStep=params.existingRunId ? await supabaseAdmin.from('agent_steps').select('id')
    .eq('run_id',runId).eq('telegram_id',String(tg)).eq('ordinal',1).eq('tool_name','travel').limit(1).maybeSingle() : null
  if(priorStep?.error)throw new Error('travel_research_step_read_failed')
  if(priorStep?.data?.id){stepResult=await supabaseAdmin.from('agent_steps').update({status:'running',error:null,completed_at:null,started_at:now,input_json:{queries,context}}).eq('id',priorStep.data.id).eq('telegram_id',String(tg)).select('id').single()}
  else stepResult=await supabaseAdmin.from('agent_steps').insert({telegram_id:String(tg),run_id:runId,ordinal:1,tool_name:'travel',title:'Obtain actual travel results',status:'running',input_json:{queries,context},output_json:{},started_at:now}).select('id').single()
  const{data:step,error:stepError}=stepResult;if(stepError||!step?.id)throw new Error(`travel_research_step_create_failed:${stepError?.message||'unknown'}`)
  await addActivity(tg,runId,'run_started',`Gogo started the travel task for ${context.routeLabel}.`,{queries,task_based:true})
  await rememberTypedObjects(tg,'travel',[{id:runId,title:context.routeLabel}]).catch(()=>{})
  let browserReadDiagnostics: BrowserReadDiagnostic[] = []
  try{
    await supabaseAdmin.from('agent_runs').update({summary:'Checking live provider inventory.',progress:25,updated_at:new Date().toISOString()}).eq('id',runId)
    const live=await tryCreditIQLive(context,params.actor)
    console.log('TRAVEL_INVENTORY_RESULT:',{runId,source:live?.source||'unavailable',live:live?.live===true,
      eligibleCount:live?.flights.length||0,requiresServiceAuth:live?.requiresServiceAuth===true})
    if(live?.live&&live.flights.length){const completedAt=new Date().toISOString();const top=live.flights.slice(0,8);const rewardsLine=live.identity?.pointsAware?`Rewards: linked CreditIQ wallet · ${live.identity.verifiedBalances} verified balance${live.identity.verifiedBalances===1?'':'s'}`:live.identity?.linked?'Rewards: CreditIQ is linked, but wallet balances were unavailable for this search':'Rewards: CreditIQ account not linked';const text=`Flight task completed · ${context.routeLabel} · ${context.whenLabel}\n${rewardsLine}\n\n${top.map(formatLiveFlight).join('\n\n')}`;await supabaseAdmin.from('agent_steps').update({status:'completed',output_json:{context,liveInventory:live,source:'creditiq',inventoryType:'live-provider'},completed_at:completedAt}).eq('id',String(step.id));await supabaseAdmin.from('agent_runs').update({status:params.existingRunId?'running':'completed',summary:safe(text,1800),progress:100,completed_at:completedAt,updated_at:completedAt}).eq('id',runId);await addActivity(tg,runId,'run_completed',`Task completed with ${top.length} live provider options.`,{travel_engine:'creditiq'});return{runId,status:'completed' as const,capability:'travel' as const,risk:'low' as const,text,handledBy:'creditiq-travel' as const}}
    if(context.kind==='flight'){
      await supabaseAdmin.from('agent_runs').update({summary:'Live inventory was unavailable. Gogo is now working through the browser.',progress:45,updated_at:new Date().toISOString()}).eq('id',runId)
      await supabaseAdmin.from('agent_steps').update({title:'Work through live flight search in secure browser'}).eq('id',String(step.id))
      await addActivity(tg,runId,'browser_research_started','Gogo opened a secure browser to complete the flight-search task.',{route:context.routeLabel})
      const browserTask=await runLiveFlightBrowserTask({actor:params.actor,context,objective:effectiveText,deadline:params.deadline})
      browserReadDiagnostics=sanitizeBrowserReadDiagnostics(browserTask && 'browserReadDiagnostics' in browserTask ? browserTask.browserReadDiagnostics : [])
      if(browserTask?.options?.length){const completedAt=new Date().toISOString();const top=browserTask.options.slice(0,8);const text=formatBrowserFlightResult(context,top,browserTask.browser?.sourceUrl||browserTask.browser?.url||'');await supabaseAdmin.from('agent_steps').update({status:'completed',output_json:{context,source:'browser-live',inventoryType:'browser-verified',browser:browserTask.browser,flights:top},completed_at:completedAt}).eq('id',String(step.id));await supabaseAdmin.from('agent_runs').update({status:params.existingRunId?'running':'completed',summary:safe(text,1800),progress:100,completed_at:completedAt,updated_at:completedAt}).eq('id',runId);await addActivity(tg,runId,'run_completed',`Task completed with ${top.length} browser-verified flight options.`,{travel_engine:'secure-browser',result_count:top.length});return{runId,status:'completed' as const,capability:'travel' as const,risk:'low' as const,text,handledBy:'browser-flight-task' as const}}
      console.warn('TRAVEL_BROWSER_DIAGNOSTICS:',JSON.stringify({runId,status:browserTask?.status||'no_result',browserReadDiagnostics}))
      await addActivity(tg,runId,'browser_research_incomplete','The browser could not produce verified flight rows; falling back to public sources.',{status:browserTask?.status||'no_result',browserReadDiagnostics})
    }
    // A projected redemption is never treated as executable until verified; browser research is read-only and cannot book or transfer points.
    await supabaseAdmin.from('agent_runs').update({summary:'Browser/provider inventory did not yield verifiable rows. Checking public sources as a last fallback.',progress:75,updated_at:new Date().toISOString()}).eq('id',runId)
    const batches=await Promise.all(queries.map(q=>searchWebResults(q,{timeoutMs:15_000})));const curated=curateTravelResults(batches.flat(),context);const completedAt=new Date().toISOString();const output={context,results:curated,source:'public-web-fallback',inventoryType:'research',browserReadDiagnostics};await supabaseAdmin.from('agent_steps').update({status:'completed',output_json:output,completed_at:completedAt}).eq('id',String(step.id));const intro=`Task could not obtain verified live rows · ${context.routeLabel} · ${context.whenLabel}`;const text=curated.length?`${intro}\n\n${curated.map((r,i)=>`${i+1}. ${r.source} — ${r.title}\n${r.inrFare?`Public snippet mentions ${r.inrFare}`:'Fare not verified'}\nOpen source: ${r.url}`).join('\n\n')}\n\nThese are fallback sources only, not completed live inventory.`:`${intro}\n\nGogo could not produce a verified result from the available providers.`;await supabaseAdmin.from('agent_runs').update({status:params.existingRunId?'running':'completed',summary:safe(text,1800),progress:100,completed_at:completedAt,updated_at:completedAt}).eq('id',runId);await addActivity(tg,runId,'run_completed','Task ended with fallback research rather than verified live inventory.',{travel_engine:'public-web-fallback',result_count:curated.length});return{runId,status:'completed' as const,capability:'travel' as const,risk:'low' as const,text,handledBy:'travel-research' as const}
  }catch(error:any){const message=safe(error?.message||'travel_research_failed',500);const completedAt=new Date().toISOString();await Promise.resolve(supabaseAdmin.from('agent_steps').update({status:'failed',error:message,completed_at:completedAt}).eq('id',String(step.id))).catch(()=>{});await Promise.resolve(supabaseAdmin.from('agent_runs').update({status:params.existingRunId?'running':'failed',summary:'Gogo could not complete the travel task.',error:message,completed_at:completedAt,updated_at:completedAt}).eq('id',runId)).catch(()=>{});await addActivity(tg,runId,'run_failed','Travel task failed.',{error:message});throw error}
}

