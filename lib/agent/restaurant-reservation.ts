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
import { openPendingQuestion, type PendingDetail } from '@/lib/bot/pending-questions'
import {buildReservationDiningContext, usableReservationDiningContext, usableDisclosedGapDiningContext, onlyDisclosableContextGaps, reservationRequestedDateCoverage, type ReservationDiningContext} from './reservation-dining-context'
import { indianMobileFromWhatsApp } from './provider-booking'
import { guestNameFromReply } from './reservation-guest-name'

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
  // 20 Oct live: "Book a table for 2 Saturday 8pm at District 6 near Orion mall" asked "Which restaurant?":
  // the date and time sat between "table for 2" and "at <venue>". A reservation ask whose venue follows a
  // later "at <Name>" (not "at 8pm") keeps the name, without the "near …" landmark.
  if(/\b(?:table|reservation|reserve|book)\b/i.test(raw)){
    const later=raw.match(new RegExp('\\bat\\s+(?:the\\s+)?(?!\\d)(?!(?:around|about|noon|night|lunch|dinner)\\b)([A-Z0-9][^,.!?]*?)(?:\\s+near\\s+[^,.!?]+)?'+NAME_STOP))?.[1]
    if(later&&!GENERIC_NAME.test(later.trim()))return safe(later,160)
  }
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
  const raw=String(text||'').replace(/\b([ap])\s*\.\s*m\s*\.?/gi,'$1m')
  // These constraints cannot be represented by the local exact/window contract.
  // Ask before research rather than invert an exclusion or discard a zone/date shift.
  const excludedClock=raw.split(/[.!?;\n]/).some(clause=>/\b\d{1,2}(?::\d{1,2})?\s*(?:am|pm)\b|\b\d{1,2}:\d{1,2}\b/i.test(clause)
    &&/\b(?:no|not|never|don['’]?t|isn['’]?t|aren['’]?t|cannot|can['’]?t|except|excluding|excluded|avoid|forbidden|unacceptable|unsuitable|unwanted|skip|dislike|anything\s+but)\b/i.test(clause))
  if(excludedClock
    ||/\b(?:before|after)\s+\d{1,2}(?::\d{2})?/i.test(raw)
    ||/\b(?:UTC|GMT|IST|PST|PDT|EST|EDT|CST|CDT|MST|MDT|CET|CEST|BST|AEST|AEDT|JST)\b|\b(?:Asia|America|Europe|Australia|Africa|Pacific)\/[A-Za-z_]+(?:\/[A-Za-z_]+)?\b|\b(?:Eastern|Central|Mountain|Pacific|Indian\s+Standard)\s+(?:Standard\s+|Daylight\s+)?time\b/i.test(raw))return{start:'',end:'',clarify:true}
  const m=raw.match(/\bbetween\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm))\s+(?:and|to|-)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm))\b/i)
    ||raw.match(/\b(\d{1,2}(?::\d{2})?\s*(?:am|pm))\s*(?:-|to)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm))\b/i)
  const start=m?explicitClock(m[1]):'',end=m?explicitClock(m[2]):''
  if(m&&(!start||!end||end<=start)||(raw.match(/\bbetween\s+\d/gi)||[]).length>1)return{start:'',end:'',clarify:true}
  // Range-final "only" restricts the range, not its final endpoint.
  const remainder=m?raw.slice(0,m.index)+' '+raw.slice((m.index||0)+m[0].length):raw
  const clock='(?:\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)|(?:[01]\\d|2[0-3]):[0-5]\\d)'
  // Provider release clocks are research context, never competing dining choices.
  const rest=remainder.replace(new RegExp(`\\b(?:(?:bookings?|reservations?)\\s+(?:will\\s+)?open(?:s)?|release(?:\\s+time)?)\\s+(?:is\\s+)?at\\s*${clock}\\b`,'gi'),' ')
  const matches=[...rest.matchAll(new RegExp(`\\b(?:only(?:\\s+at)?\\s+(${clock})|(${clock})\\s+only)\\b`,'gi'))]
  const exacts=matches.map(value=>{const text=(value[1]||value[2]).trim();return /(?:am|pm)$/i.test(text)?explicitClock(text):text})
  const distinct=[...new Set(exacts)]
  const onlyClock=/\bonly\s+at\s+\d|\bonly\s+\d{1,2}:\d{2}|\bat\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s+only\b|\b\d{1,2}:\d{2}\s*(?:am|pm)?\s+only\b/i.test(rest)
  if(distinct.length>1||exacts.some(t=>!t)||onlyClock&&!distinct.length)return{start:'',end:'',clarify:true}
  if(distinct.length){
    const remaining=rest.replace(new RegExp(`\\b(?:only(?:\\s+at)?\\s+(${clock})|(${clock})\\s+only)\\b`,'gi'),' ')
    if(new RegExp(`\\b${clock}\\b`,'i').test(remaining)||/\b\d{1,2}:\d{1,2}\b|\bat\s+\d{1,2}(?::\d{2})?/i.test(remaining))return{start:'',end:'',clarify:true}
    const at=distinct[0];if(m&&(at<start||at>end))return{start:'',end:'',clarify:true};return{start:at,end:at,clarify:false}
  }
  const namedClocks=[...rest.matchAll(new RegExp(`\\b${clock}\\b`,'gi'))]
  if(namedClocks.length>1)return{start:'',end:'',clarify:true}
  if(namedClocks.length){
    const match=namedClocks[0],prefix=rest.slice(0,match.index),text=match[0].trim()
    // A user-stated release clock is provider-research input, not dining authority.
    if(/\b(?:(?:bookings?|reservations?)\s+(?:will\s+)?open(?:s)?|release(?:\s+time)?)\s+(?:is\s+)?at\s*$/i.test(prefix))return{start,end,clarify:false}
    const at=/(?:am|pm)$/i.test(text)?explicitClock(text):text
    // 19 Oct live (Instinct comparison): "for 2 at Toit Indiranagar this Saturday 8pm" was asked to
    // restate its time. A single explicit clock right after the dining day, date or party is the
    // dining time just as much as one after "at".
    const dayLead=/(?:\btoday|\btonight|\btomorrow|\btmrw|\bday\s+after\s+tomorrow|\b(?:mon|tues|wednes|thurs|fri|satur|sun)day|\bweekend|\b\d{1,2}(?:st|nd|rd|th)?\s+[a-z]{3,9}|\b[a-z]{3,9}\s+\d{1,2}(?:st|nd|rd|th)?|\bfor\s+\d{1,2}(?:\s+(?:people|persons|pax|guests|adults))?)\s*,?\s*$/i
    if(!at||!(/(?:\bat|\bdining|\bdinner|\bslot)(?:\s+(?:time|start))?\s*$/i.test(prefix)||dayLead.test(prefix))||m&&(at<start||at>end))return{start:'',end:'',clarify:true}
    return{start:at,end:at,clarify:false}
  }
  if(/\bat\s+\d{1,2}(?::\d{2})?/i.test(rest))return{start:'',end:'',clarify:true}
  return{start,end,clarify:false}
}

const MONTHS:Record<string,number>={jan:1,january:1,feb:2,february:2,mar:3,march:3,apr:4,april:4,may:5,jun:6,june:6,jul:7,july:7,aug:8,august:8,sep:9,sept:9,september:9,oct:10,october:10,nov:11,november:11,dec:12,december:12}
const WEEKDAYS:Record<string,number>={sunday:0,monday:1,tuesday:2,wednesday:3,thursday:4,friday:5,saturday:6}

function ymd(year:number,month:number,day:number){
  return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`
}

/** today / tonight / tomorrow / (this|next|coming) <weekday>, resolved in IST. */
function relativeDate(raw:string,now:Date){
  const local=new Date(now.toLocaleString('en-US',{timeZone:'Asia/Kolkata'}))
  const base=Date.UTC(local.getFullYear(),local.getMonth(),local.getDate())
  const at=(days:number)=>new Date(base+days*86400_000).toISOString().slice(0,10)
  const t=raw.toLowerCase()
  if(/\bday\s+after\s+tomorrow\b/.test(t))return at(2)
  if(/\b(?:tomorrow|tmrw|tmr)\b/.test(t))return at(1)
  if(/\b(?:today|tonight)\b/.test(t))return at(0)
  const wd=t.match(/\b(?:(this|next|coming)\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/)
  if(!wd)return''
  const target=WEEKDAYS[wd[2]],today=local.getDay()
  let ahead=(target-today+7)%7
  // "this Saturday" on a Saturday is today; a bare or "next/coming" weekday is the next one ahead.
  if(ahead===0&&wd[1]!=='this')ahead=7
  return at(ahead)
}

function explicitDate(text:string,now=new Date()){
  const raw=String(text||'')
  const iso=raw.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/)
  if(iso)return ymd(Number(iso[1]),Number(iso[2]),Number(iso[3]))
  const dm=raw.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:[ ,]+(20\d{2}))?\b/i)
  if(!dm)return relativeDate(raw,now)
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
  timeClarificationNeeded?:boolean
  requestedDate:string
  nextAvailable:boolean
  sourceUrl:string
}

export function isRestaurantReservationRequest(raw:string){
  const text=String(raw||'').trim().toLowerCase()
  if(!text)return false
  // Planning/recall must not create a reservation mission merely because its
  // safety instructions mention booking. An explicit read-only request wins.
  if(/\bread[\s-]?only\b/.test(text))return false
  let negatedBooking=false
  const affirmative=text.replace(/\b(?:do\s+not|don['’]?t|never|without)\b[^.!?;\n]*/g,clause=>{
    if(!/\b(?:book(?:ing)?|reserv(?:e|ing|ation)s?|tables?)\b/.test(clause))return clause
    negatedBooking=true;return''
  })
  if(negatedBooking&&!/\b(?:book|reserve)\b/.test(affirmative))return false
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
    timeClarificationNeeded:window.clarify,
    requestedDate:explicitDate(raw),
    nextAvailable:/\bnext\s+available\b|\bearliest\s+available\b|\bfirst\s+available\b/i.test(raw),
    sourceUrl:firstUrl(raw),
  }
}

function host(url:string){try{return new URL(url).hostname.replace(/^www\./,'')}catch{return''}}

export type RestaurantTimeConstraint={version:1;kind:'exact'|'window'|'unrestricted';start:string;end:string}
export function validRestaurantTimeConstraint(value:unknown,start:string,end:string):value is RestaurantTimeConstraint{
  if(!value||typeof value!=='object'||Array.isArray(value))return false
  const c=value as Partial<RestaurantTimeConstraint>,clock=/^(?:[01]\d|2[0-3]):[0-5]\d$/
  if(c.version!==1||c.start!==start||c.end!==end)return false
  return c.kind==='unrestricted'?start===''&&end==='':clock.test(start)&&clock.test(end)&&(c.kind==='exact'?start===end:c.kind==='window'&&start<end)
}
export function reservationTimeConstraint(intent:Pick<RestaurantReservationIntent,'preferredStart'|'preferredEnd'|'timeClarificationNeeded'>):RestaurantTimeConstraint{
  const start=intent.preferredStart,end=intent.preferredEnd
  const value:RestaurantTimeConstraint={version:1,kind:!start&&!end?'unrestricted':start===end?'exact':'window',start,end}
  if(intent.timeClarificationNeeded||!validRestaurantTimeConstraint(value,start,end))throw new Error('restaurant_time_constraint_unverified')
  return value
}
function diningTimeLabel(start:string,end:string){return start&&end?(start===end?`${start} only`:`${start}–${end}`):'next available'}

const GENERIC_RESTAURANT_TOKENS=new Set(['restaurant','restaurants','cafe','café','bistro','bar','noodle','noodles','kitchen','eatery','the','table','indiranagar','koramangala','bengaluru','bangalore'])
// India-first: District (Dineout), EazyDiner, Zomato and the restaurant's own site are where tables
// are booked. A result must name the restaurant; a page that only says "table" is not a match
// (live run 10 Oct ranked a Lithuanian software company first).
const INDIA_BOOKING_HOSTS=/(?:^|\.)(?:district\.in|eazydiner\.com|zomato\.com|dineout\.co\.in|swiggy\.com|magicpin\.in)$/
// 19 Oct live: Toit's own tables live in its ReserveGo widget (widget.reservego.com), which Instinct read for
// real slots, while Gogo opened an EazyDiner listing. A restaurant's first-party booking widget or its own site
// outranks every aggregator; aggregators are only the fallback.
// The live widget host is widget.reservego.co (19 Oct); .com kept for older links.
const FIRST_PARTY_WIDGET_HOSTS=/(?:^|\.)reservego\.co(?:m)?$/
const NON_BOOKING_HOSTS=/instagram|facebook|reddit|tripadvisor|youtube|linkedin|(?:^|\.)x\.com$|twitter|rocketreach|crunchbase|justdial|wikipedia|google\./
export type ReservationLinkKind='widget'|'own_site'|'aggregator'|'other'
function restaurantIdentity(restaurant:string){
  const tokens=restaurant.toLowerCase().split(/[^a-z0-9]+/).filter(x=>x.length>2&&!GENERIC_RESTAURANT_TOKENS.has(x))
  return tokens.length?tokens:restaurant.toLowerCase().split(/[^a-z0-9]+/).filter(x=>x.length>2)
}
export function reservationLinkKind(url:string,restaurant:string):ReservationLinkKind{
  const h=host(url).toLowerCase()
  if(!h)return'other'
  if(FIRST_PARTY_WIDGET_HOSTS.test(h))return'widget'
  if(INDIA_BOOKING_HOSTS.test(h))return'aggregator'
  if(NON_BOOKING_HOSTS.test(h))return'other'
  const compactHost=h.replace(/[^a-z0-9]/g,'')
  return restaurantIdentity(restaurant).some(t=>compactHost.includes(t))?'own_site':'other'
}
export function rankReservationCandidates(results:WebSearchResult[]|null|undefined,restaurant:string){
  const seen=new Set<string>()
  return (results||[])
    .filter(r=>/^https?:\/\//i.test(String(r.url||'')))
    .filter(r=>{const key=String(r.url).replace(/[#?].*$/,'').replace(/\/+$/,'').toLowerCase();if(seen.has(key))return false;seen.add(key);return true})
    .map(r=>({url:String(r.url),title:safe(r.title||restaurant,220),kind:reservationLinkKind(String(r.url),restaurant),score:candidateScore(r,restaurant)}))
    .sort((a,b)=>b.score-a.score)
}
function candidateScore(result:WebSearchResult,restaurant:string){
  const title=String(result.title||'').toLowerCase()
  const snippet=String(result.snippet||'').toLowerCase()
  const url=String(result.url||'').toLowerCase()
  const tokens=restaurant.toLowerCase().split(/[^a-z0-9]+/).filter(x=>x.length>2&&!GENERIC_RESTAURANT_TOKENS.has(x))
  const hits=tokens.filter(t=>title.includes(t)||snippet.includes(t)||url.includes(t)).length
  if(!tokens.length||hits===0)return -100
  if(!resultInPlace(`${title} ${snippet} ${url}`,resolveIndiaPlace(restaurant)))return -100
  let score=hits*4
  const kind=reservationLinkKind(url,restaurant)
  if(kind==='widget')score+=30
  else if(kind==='own_site')score+=22
  else if(kind==='aggregator')score+=10
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

type ReservationProvider={url:string;title:string;source:string;location?:string|null;firstParty:boolean}
async function discoverProvider(intent:RestaurantReservationIntent):Promise<ReservationProvider|null>{
  if(intent.sourceUrl)return{url:intent.sourceUrl,title:intent.restaurant||host(intent.sourceUrl),source:'explicit_url',firstParty:reservationLinkKind(intent.sourceUrl,intent.restaurant)!=='aggregator'}
  if(!intent.restaurant)return null
  const known=KNOWN_RESERVATION_PROVIDERS[intent.restaurant.toLowerCase().replace(/\s+/g,' ').trim()]
  if(known)return{url:known.url,title:intent.restaurant,source:'known_provider_page',location:known.location||null,firstParty:true}
  const place=resolveIndiaPlace(intent.restaurant)
  const city=place.city&&!intent.restaurant.toLowerCase().includes(place.city.toLowerCase())?place.city+' ':''
  // First-party first: the restaurant's own booking widget (ReserveGo) or its own site's Reserve page.
  // The old single query named District and EazyDiner, so aggregators were all it ever found.
  const firstPartyResults=await searchWebResults(`${intent.restaurant} ${city}reservego reserve a table`).catch(()=>[] as WebSearchResult[])
  let ranked=rankReservationCandidates(firstPartyResults,intent.restaurant)
  const firstPartyTop=(r:typeof ranked)=>r[0]&&r[0].score>0&&(r[0].kind==='widget'||r[0].kind==='own_site')
  if(!firstPartyTop(ranked)){
    const fallback=await searchWebResults(`${intent.restaurant} ${city}India book a table District EazyDiner`)
    ranked=rankReservationCandidates([...(firstPartyResults||[]),...(fallback||[])],intent.restaurant)
  }
  const top=ranked[0]
  // A listing's reviews/menu/photos page is not where a table is booked (10 Oct retest opened
  // eazydiner.com/.../toit-indiranagar-330151/reviews). Use the restaurant's main listing page.
  const bookingUrl=(url:string)=>{try{const u=new URL(url);if(INDIA_BOOKING_HOSTS.test(u.hostname.replace(/^www\./,''))){u.pathname=u.pathname.replace(/\/(?:reviews?|menu|photos?|gallery|info|order-online|overview)\/?$/i,'');u.search=''}return u.toString()}catch{return url}}
  // A first-party widget URL is kept exactly: its query can carry the restaurant id.
  return top&&top.score>0?{url:top.kind==='aggregator'?bookingUrl(top.url):top.url,title:top.title,source:'web_search',location:null,firstParty:top.kind==='widget'||top.kind==='own_site'}:null
}

// ---- Live slot read (Instinct-style): read the first-party widget for the requested date/party/time ----

const CLOCK_TOKEN=/\b(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)(?![a-z])|\b([01]?\d|2[0-3]):([0-5]\d)\b(?!\s*(?:a\.?m|p\.?m))/gi
/** Bookable slot clocks (HH:MM) in widget text. Opening-hour ranges, "open/close" times and sold-out slots are not slots. */
export function extractReservationSlots(text:string):string[]{
  const range=/\b\d{1,2}(?:[:.]\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?\s*(?:-|–|—|to)\s*\d{1,2}(?:[:.]\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)|\b\d{1,2}:\d{2}\s*(?:-|–|—|to)\s*\d{1,2}:\d{2}\b/gi
  const raw=String(text||'').replace(/\s+/g,' ').replace(range,' ')
  const out=new Set<string>()
  for(const m of raw.matchAll(CLOCK_TOKEN)){
    const before=raw.slice(Math.max(0,(m.index||0)-24),m.index||0)
    const after=raw.slice((m.index||0)+m[0].length,(m.index||0)+m[0].length+18)
    if(/\b(?:open(?:s|ing)?|clos(?:e|es|ing)|hours?|timings?|until|till|last\s+orders?|happy\s+hours?)\b\s*(?:from|at|by|is|are|:|-)?\s*$/i.test(before))continue
    if(/^\s*[-–:]?\s*(?:sold\s*out|full|unavailable|not\s+available|wait\s*list|booked)\b/i.test(after))continue
    const clock=m[3]?normalizeClock(Number(m[1]),Number(m[2]||0),/p/i.test(m[3])?'pm':'am'):`${String(Number(m[4])).padStart(2,'0')}:${m[5]}`
    if(clock)out.add(clock)
  }
  return [...out].sort()
}

const SHORT_MONTHS=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec']
const LONG_MONTHS=['january','february','march','april','may','june','july','august','september','october','november','december']
const SHORT_DAYS=['sun','mon','tue','wed','thu','fri','sat'],LONG_DAYS=['sunday','monday','tuesday','wednesday','thursday','friday','saturday']
/** True when the page shows the requested dining date, so slots are never reported for another day. */
export function reservationSlotDateEvidence(text:string,date:string){
  const m=String(date).match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if(!m)return false
  const t=String(text||'').toLowerCase(),month=Number(m[2]),day=Number(m[3])
  const mon=`(?:${SHORT_MONTHS[month-1]}|${LONG_MONTHS[month-1]})`
  const dayRe=`0?${day}(?:st|nd|rd|th)?`
  if(t.includes(date))return true
  if(new RegExp(`\\b${dayRe}\\s*,?\\s*${mon}\\b|\\b${mon}\\.?\\s*${dayRe}\\b|\\b0?${day}[/-]0?${month}\\b`,'i').test(t))return true
  // A widget day strip often shows "Tue 20": weekday next to the day number.
  const wd=new Date(`${date}T12:00:00Z`).getUTCDay()
  return new RegExp(`\\b(?:${SHORT_DAYS[wd]}|${LONG_DAYS[wd]})\\b\\.?,?\\s*${dayRe}\\b`,'i').test(t)
}

const minutes=(clock:string)=>{const[h,m]=clock.split(':').map(Number);return h*60+m}
export type ReservationSlotDecision={kind:'available';time:string}|{kind:'alternatives';times:string[]}|{kind:'none'}
export function reservationSlotDecision(slots:string[],start:string,end:string):ReservationSlotDecision{
  if(!slots.length)return{kind:'none'}
  if(!start&&!end)return{kind:'available',time:slots[0]}
  const inBounds=slots.filter(s=>s>=start&&s<=(end||start))
  if(inBounds.length)return{kind:'available',time:inBounds.includes(start)?start:inBounds[0]}
  const target=minutes(start)
  const nearest=[...slots].sort((a,b)=>Math.abs(minutes(a)-target)-Math.abs(minutes(b)-target)||minutes(b)-minutes(a)).slice(0,3).sort()
  return{kind:'alternatives',times:nearest}
}

/** "19:00" -> "7pm", "18:30" -> "6:30pm". */
export function reservationClockLabel(clock:string){
  const m=String(clock).match(/^(\d{2}):(\d{2})$/)
  if(!m)return clock
  const h=Number(m[1]),min=m[2],suffix=h>=12?'pm':'am',h12=h%12===0?12:h%12
  return `${h12}${min==='00'?'':':'+min}${suffix}`
}
function istDay(offset:number,now:Date){
  const local=new Date(now.toLocaleString('en-US',{timeZone:'Asia/Kolkata'}))
  return new Date(Date.UTC(local.getFullYear(),local.getMonth(),local.getDate())+offset*86400_000).toISOString().slice(0,10)
}
function shortDate(date:string){return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB',{day:'numeric',month:'short',timeZone:'UTC'})}
/** "tomorrow", "tonight", or "on Sat 24 Oct", judged in IST. */
export function reservationDayLabel(date:string,time:string,now=new Date()){
  if(date===istDay(0,now))return time>='17:00'?'tonight':'today'
  if(date===istDay(1,now))return'tomorrow'
  return `on ${new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short',timeZone:'UTC'}).replace(/,/g,'')}`
}
function mobileEnding(whatsappId:string|null|undefined){
  const mobile=indianMobileFromWhatsApp(whatsappId)||String(whatsappId||'').replace(/\D/g,'')
  return mobile.length>=4?mobile.slice(-4):''
}
export function reservationAvailableReply(p:{restaurant:string;time:string;date:string;partySize:number;whatsappId?:string|null;email?:string|null;now?:Date}){
  const ending=mobileEnding(p.whatsappId)
  const contact=`${ending?`your WhatsApp number ending ${ending}`:'your WhatsApp number'}${p.email?` and ${p.email}`:''}`
  return `${reservationClockLabel(p.time)} ${reservationDayLabel(p.date,p.time,p.now)} is available for ${p.partySize} at ${p.restaurant}. What name should I book under? I'll use ${contact}.`
}
export function reservationAlternativesReply(p:{restaurant:string;time:string;date:string;partySize:number;times:string[];now?:Date}){
  const labels=p.times.slice(0,3).map(reservationClockLabel)
  const list=labels.length>1?`${labels.slice(0,-1).join(', ')} or ${labels[labels.length-1]}`:labels[0]
  return `${reservationClockLabel(p.time)} ${reservationDayLabel(p.date,p.time,p.now)} isn't available for ${p.partySize} at ${p.restaurant}. Open times: ${list}. Which one should I book?`
}
export function reservationUnreadableReply(p:{restaurant:string;url:string}){
  return `I couldn't read ${p.restaurant}'s live tables right now, so nothing is booked. Book directly here: ${p.url}`
}
/** The submission stopped at a CAPTCHA/OTP Gogo will not solve: nothing is booked, finish on the first-party page. */
export function reservationChallengeReply(p:{restaurant:string;time:string;date:string;partySize:number;url:string;kind:'captcha'|'otp'}){
  const what=p.kind==='otp'?'an OTP':'a CAPTCHA'
  const slot=[p.time?reservationClockLabel(p.time):'',`for ${p.partySize}`,p.date?`on ${shortDate(p.date)}`:''].filter(Boolean).join(' ')
  return `${p.restaurant}'s page needs ${what}, so nothing is booked. This link has ${slot} ready — finish it there and check the final terms: ${p.url}`
}
/** The approved attempt could not complete the form (no CAPTCHA seen): nothing is booked, finish on the first-party page. */
export function reservationUnfinishedReply(p:{restaurant:string;time:string;date:string;partySize:number;url:string}){
  const slot=[p.time?reservationClockLabel(p.time):'',`for ${p.partySize}`,p.date?`on ${shortDate(p.date)}`:''].filter(Boolean).join(' ')
  return `I couldn't finish ${p.restaurant}'s booking form, so nothing is booked. This link has ${slot} — finish it there and check the final terms: ${p.url}`
}

export { guestNameFromReply }
/** Cheap pre-check for routing: a short name reply or a short time pick. */
export function looksLikeReservationGuestReply(text:string){
  const t=String(text||'').trim()
  return Boolean(guestNameFromReply(t))||/^(?:(?:the|at)\s+)?\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)?(?:\s+(?:one|slot|please))?\s*$/i.test(t)
}

async function storedEmail(actor:AgentActor){
  try{
    const{data,error}=await supabaseAdmin.from('users').select('email').eq('telegram_id',actor.legacyTelegramId).maybeSingle()
    const email=String(!error&&data?.email||'').trim()
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)?email:null
  }catch{return null}
}

const SLOT_STEP_MINUTES=30
/**
 * The live-slot question ("What name should I book under?" / "Which one should I book?") is registered in the
 * pending-question registry, the one mechanism that binds a short reply to the question Gogo asked: the reply
 * resumes this step only while `askedText` is Gogo's latest message to the person (lib/bot/pending-question-resolver).
 */
async function registerLiveSlotQuestion(actor:AgentActor,stage:'guest_name'|'choose_time',restaurant:string,askedText:string){
  try{
    await openPendingQuestion({telegramId:actor.legacyTelegramId,kind:'reservation_live_slot',capability:'restaurant_reservation',
      expects:[stage==='guest_name'?'guest_name':'time'],context:{label:`Table at ${restaurant} (${stage==='guest_name'?'guest name':'time'})`,stage},
      ttlMin:SLOT_STEP_MINUTES,exactOnly:true,askedText})
  }catch(err:any){console.error('RESTAURANT_SLOT_QUESTION_OPEN_FAILED:',safe(err?.message||err,120))}
}
async function savePendingSlotStep(p:{actor:AgentActor;text:string;intent:RestaurantReservationIntent;provider:ReservationProvider;timezone:string;stage:'guest_name'|'choose_time';slotTime:string|null;alternatives:string[];slots:string[];evidence:string;askedText:string}){
  const now=new Date(),at=now.toISOString(),tg=String(p.actor.legacyTelegramId)
  // One live slot step per person: an older unanswered one is retired, never answered by a later reply.
  await supabaseAdmin.from('agent_runs').update({status:'completed',error:'restaurant_slot_superseded',summary:'Replaced by a newer reservation request; nothing was booked.',completed_at:at,updated_at:at}).eq('telegram_id',tg).eq('type','restaurant_reservation_slot').eq('status','paused')
  const{error}=await supabaseAdmin.from('agent_runs').insert({
    telegram_id:tg,type:'restaurant_reservation_slot',capability:'browser',status:'paused',
    error:p.stage==='guest_name'?'awaiting_guest_name':'awaiting_slot_choice',
    title:`Reserve ${p.intent.restaurant} · ${p.stage==='guest_name'?'waiting for the guest name':'waiting for a time'}`.slice(0,180),
    summary:'Live slots read from the restaurant booking page. Nothing is booked; the bounded approval comes after the guest name.',
    progress:20,source:'whatsapp',started_at:at,updated_at:at,
    metadata_json:{plan_type:'restaurant_reservation_slot',stage:p.stage,request_text:safe(p.text,1800),restaurant:p.intent.restaurant,party_size:p.intent.partySize,requested_date:p.intent.requestedDate,preferred_start:p.intent.preferredStart||null,preferred_end:p.intent.preferredEnd||null,slot_time:p.slotTime,alternatives:p.alternatives,observed_slots:p.slots,provider:{url:p.provider.url,title:p.provider.title,source:p.provider.source,location:p.provider.location||null,firstParty:p.provider.firstParty},timezone:p.timezone,evidence:safe(p.evidence,2600),asked_text:safe(p.askedText,600),expires_at:new Date(now.getTime()+SLOT_STEP_MINUTES*60_000).toISOString()},
  })
  if(error)throw new Error(`restaurant_slot_step_save_failed:${error.message}`)
  await registerLiveSlotQuestion(p.actor,p.stage,p.intent.restaurant,p.askedText)
}

function slotReadObjective(intent:RestaurantReservationIntent){
  const when=intent.preferredStart&&intent.preferredEnd?(intent.preferredStart===intent.preferredEnd?` around ${intent.preferredStart}`:` between ${intent.preferredStart} and ${intent.preferredEnd}`):''
  return `Read the live table availability at ${intent.restaurant} for ${intent.partySize} guests on ${intent.requestedDate}${when} (Asia/Kolkata). If this is the restaurant's own site, open its Reserve or Book a table link to its booking widget. In the booking widget, choose the date ${intent.requestedDate} and ${intent.partySize} guests (choosing a date or guest count books nothing), then report the selected date and every time slot shown as available for that date. Do not enter a name, phone or email, do not press Reserve, Book or Confirm, do not sign in, submit or pay.`
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

export function restaurantReservationApprovalInput(params:{runId:string;lifeEventId:string;actionId:string;restaurant:string;providerUrl:string;partySize:number|null;preferredStart:string;preferredEnd:string;requestedDate:string;releaseAt:string|null;contextWindows?:Array<{startAt:string;endAt:string|null;location:string|null;source:string;confidence:number}>;diningContext?:ReservationDiningContext;reservationLocation?:string|null;timeConstraint?:unknown;guestName?:string|null;contextGapDisclosed?:boolean}){
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
      ...(params.timeConstraint!==undefined?{timeConstraint:params.timeConstraint}:{}),
      // The guest name is submitted to the provider, so it is bound; older approvals without one keep their hash.
      ...(params.guestName?{guestName:params.guestName}:{}),
      // A live-slot approval whose Calendar/travel gap was disclosed in the ask is bound to that disclosure,
      // so the flag can never be added after approval. Approvals without it keep their hash.
      ...(params.contextGapDisclosed===true?{contextGapDisclosed:true}:{}),
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

// PR 1 of the understand-first router: every clarification records the question it asked, so the
// next short reply ("This Saturday 8pm") resumes THIS reservation instead of being claimed by a
// keyword rule (19 Oct live: it became a reminder titled "This"). expects[0] is the detail asked.
async function askReservationDetail(actor:AgentActor,text:string,intent:RestaurantReservationIntent,asked:PendingDetail,reply:string){
  const missing:PendingDetail[]=[asked]
  if(!intent.restaurant)missing.push('restaurant')
  if(!intent.partySize)missing.push('party')
  if(!intent.requestedDate)missing.push('date')
  if(!intent.preferredStart||intent.timeClarificationNeeded)missing.push('time')
  const what=asked==='time'?'time':asked==='party'?'party size':asked==='restaurant'?'restaurant':'date'
  await openPendingQuestion({
    telegramId:actor.legacyTelegramId,
    kind:'reservation_slot',
    capability:'restaurant_reservation',
    expects:[...new Set(missing)],
    context:{originalText:safe(text,1800),restaurant:intent.restaurant||null,label:`Table${intent.restaurant?` at ${intent.restaurant}`:''} (${what})`},
    ttlMin:30,
    llmResolvable:true,
    // A free-text name can answer only a restaurant question.
    exactOnly:asked!=='restaurant',
    // The question binds a reply only while this exact text is Gogo's latest message to the user.
    askedText:reply,
  })
  return{runId:'',status:'paused' as const,capability:'browser' as const,risk:'low' as const,handledBy:'restaurant-reservation' as const,text:reply}
}

function reservationTimeQuestion(intent:RestaurantReservationIntent,verb:'queued'|'prepared'){
  const place=intent.restaurant?` ${intent.restaurant}`:''
  return `What time should I book${place} for? (e.g. 8 pm) Please give one time with am/pm, or one time window. Nothing was ${verb} or booked.`
}

export async function queueRestaurantReservationResearch(params:{
  actor:AgentActor
  text:string
  messageId?:string|number|null
}){
  const intent=parseRestaurantReservationIntent(params.text)
  if(!intent)return null
  if(intent.timeClarificationNeeded)return askReservationDetail(params.actor,params.text,intent,'time',reservationTimeQuestion(intent,'queued'))
  if(params.text.length>1800)return{runId:'',status:'paused' as const,capability:'browser' as const,risk:'low' as const,handledBy:'restaurant-reservation' as const,text:'Please shorten the reservation request to the restaurant, party, dining date and exact time or time window. I cannot queue a shortened copy that might lose a restriction.'}
  if(!intent.restaurant){
    return askReservationDetail(params.actor,params.text,intent,'restaurant','Which restaurant should I reserve? Give me the restaurant name (and location if there are multiple branches).')
  }
  if(!intent.partySize){
    return askReservationDetail(params.actor,params.text,intent,'party',`How many people should I book at ${intent.restaurant} for?`)
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
      request_schema_version:2,
      request_complete:true,
      request_text:safe(params.text,1800),
      message_id:params.messageId?String(params.messageId):null,
      restaurant:intent.restaurant,
      party_size:intent.partySize,
      preferred_start:intent.preferredStart||null,
      preferred_end:intent.preferredEnd||null,
      requested_date:intent.requestedDate||null,
      next_available:intent.nextAvailable,
      max_booking_fee_paise:0,
      timeConstraint:reservationTimeConstraint(intent),
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
  if(run.status!=='running')throw new Error('restaurant_research_run_not_running')
  const meta:any=run.metadata_json||{}
  if(meta.plan_type!=='restaurant_reservation_research')throw new Error('not_restaurant_research_plan')
  const text=String(meta.request_text||'').trim()
  if(!text)throw new Error('restaurant_research_request_missing')
  const intent=parseRestaurantReservationIntent(text)
  const complete=meta.request_schema_version===2&&meta.request_complete===true&&text.length<=1800&&safe(text,1800)===text&&meta.request_hash===reservationResearchHash(params.actor,text)&&intent&&!intent.timeClarificationNeeded&&
    meta.restaurant===intent.restaurant&&meta.party_size===intent.partySize&&String(meta.preferred_start||'')===intent.preferredStart&&String(meta.preferred_end||'')===intent.preferredEnd&&String(meta.requested_date||'')===intent.requestedDate&&meta.next_available===intent.nextAvailable&&meta.max_booking_fee_paise===0&&validRestaurantTimeConstraint(meta.timeConstraint,intent.preferredStart,intent.preferredEnd)
  if(!complete){
    const {data:paused,error}=await supabaseAdmin.from('agent_runs').update({status:'paused',error:'restaurant_research_request_review_required',summary:'This saved request needs a complete current dining-time review before provider research.',updated_at:new Date().toISOString()}).eq('id',params.runId).eq('telegram_id',tg).eq('status',run.status).select('id').maybeSingle()
    if(error||!paused)throw new Error('restaurant_research_request_review_failed')
    return{runId:params.runId,status:'paused' as const,capability:'browser' as const,risk:'low' as const,handledBy:'restaurant-reservation' as const,text:'This older or changed saved request needs review. Send the complete restaurant, party, dining date and exact time or time window again. No provider research or booking was attempted.'}
  }

  try{
    const result=await tryRunRestaurantReservation({actor:params.actor,surface:'whatsapp',text})
    if(!result)throw new Error('restaurant_research_not_handled')
    const at=new Date().toISOString()
    let recorded:{data:{id:unknown}|null;error:unknown}|null=null
    try{recorded=await supabaseAdmin.from('agent_runs').update({
      status:'completed',
      summary:`Background restaurant research finished with status ${String(result.status||'completed')}.`,
      progress:100,
      error:null,
      completed_at:at,
      updated_at:at,
      metadata_json:{...meta,outcome_status:result.status||null,child_run_id:result.runId||null,finished_at:at},
    }).eq('id',params.runId).eq('telegram_id',tg).eq('type','restaurant_reservation_research').eq('status','running').select('id').maybeSingle()
    }catch{throw new Error('restaurant_research_completion_recording_failed')}
    if(!recorded||recorded.error||String(recorded.data?.id||'')!==params.runId)throw new Error('restaurant_research_completion_recording_failed')
    return result
  }catch(err:any){
    const at=new Date().toISOString()
    let failed:{data:{id:unknown}|null;error:unknown}|null=null
    try{failed=await supabaseAdmin.from('agent_runs').update({
      status:'failed',
      summary:'Background Gogo could not complete reservation research.',
      progress:100,
      error:safe(err?.message||'restaurant_research_failed',500),
      completed_at:at,
      updated_at:at,
    }).eq('id',params.runId).eq('telegram_id',tg).eq('type','restaurant_reservation_research').eq('status','running').select('id').maybeSingle()
    }catch{}
    if(!failed||failed.error||String(failed.data?.id||'')!==params.runId)throw new Error('restaurant_research_failure_recording_failed',{cause:err})
    throw err
  }
}

type DiningFact=NonNullable<ContextPack['reservationTravel']>['facts'][number]
function planningPlace(value:string){
  const place=value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim()
  return ['bangalore','blr'].includes(place)?'bengaluru':['nyc','jfk'].includes(place)?'new york':place
}
function planningSpan(date:string,start:string,end:string,timezone:string){
  if(!/^\d{2}:\d{2}$/.test(start)||!/^\d{2}:\d{2}$/.test(end)||end<start)return null
  try{
    const from=parseLocalDateTime({date,time:start,timezone}).dueAtUtc.getTime(),until=end===start?from+1:parseLocalDateTime({date,time:end,timezone}).dueAtUtc.getTime()
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
  const bounds=`Keep ${intent.partySize} people, ${intent.restaurant}${params.location?` in ${params.location}`:''}, ${intent.preferredStart&&intent.preferredEnd?`${diningTimeLabel(intent.preferredStart,intent.preferredEnd)} (${timezone})`:'your preferred time window'}, and the ₹0 fee/deposit ceiling.`
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
    return `${prefix}\n\nProvisional planning window: ${date} ${diningTimeLabel(intent.preferredStart,intent.preferredEnd)} (${timezone}) for ${intent.partySize} people at ${intent.restaurant} in ${params.location}. The saved itinerary schedules arrival at ${returning.endAt}; actual return is not verified. A fresh linked Calendar and saved-context read found no conflicting recorded interval within this start-time window. Provider availability, full meal duration and preference compatibility are not verified; this is not a booking or a fully checked dining interval. ${bounds}\n\nChoose a dining date before I prepare a new bounded approval; actual provider slot/rules and the complete meal interval still need verification.`
  }
  return noProposal
}

export async function tryRunRestaurantReservation(params:{actor:AgentActor;surface:AgentSurface;text:string}){
  const intent=parseRestaurantReservationIntent(params.text)
  // A short name/time reply to a live-slot question is NOT read here: the pending-question resolver owns it on
  // every surface (WhatsApp, dashboard, agent API) and resumes continueRestaurantReservationGuestReply only while
  // that question is Gogo's latest message. One owner, so a stale step can never claim "Divya" or "7pm".
  if(!intent)return null
  if(intent.timeClarificationNeeded)return askReservationDetail(params.actor,params.text,intent,'time',reservationTimeQuestion(intent,'prepared'))
  const timeConstraint=reservationTimeConstraint(intent)
  if(!intent.restaurant){
    return askReservationDetail(params.actor,params.text,intent,'restaurant','Which restaurant should I reserve? Give me the restaurant name (and location if there are multiple branches).')
  }
  if(!intent.partySize){
    return askReservationDetail(params.actor,params.text,intent,'party',`How many people should I book at ${intent.restaurant} for?`)
  }
  const provider=await discoverProvider(intent)
  if(!provider){
    return{runId:'',status:'paused' as const,capability:'browser' as const,risk:'low' as const,handledBy:'restaurant-reservation' as const,text:`I could not verify an official reservation page for ${intent.restaurant}. Send me the booking link and I will keep the reservation objective intact.`}
  }
  const timezone=await actorTimezone(params.actor)
  // A specific dining date is a live-slot read on the booking widget (Instinct-style); otherwise the
  // page is read for its booking-release rules as before.
  const slotMode=Boolean(intent.requestedDate)
  const paused=(text:string)=>({runId:'',status:'paused' as const,capability:'browser' as const,risk:'low' as const,handledBy:'restaurant-reservation' as const,text})
  // 19 Oct live: a failed read said "I found Toit here: <EazyDiner>" plus a retry invitation. One line, the booking link, nothing promised.
  const unreadable=()=>paused(reservationUnreadableReply({restaurant:intent.restaurant,url:provider.url}))
  if(slotMode){
    // Fast path: read the ReserveGo widget's own public times feed instead of driving the widget in a browser.
    const reservego:any=await import('./reservego').catch(()=>null)
    const widget=typeof reservego?.findReservegoWidget==='function'?await reservego.findReservegoWidget(provider.url).catch(()=>null):null
    const fetchReservegoSlots=reservego?.fetchReservegoSlots
    if(widget&&typeof fetchReservegoSlots==='function'){
      try{
        const feed:{slots:string[];feeSlots:string[]}=await fetchReservegoSlots(widget.outletId,intent.requestedDate)
        const widgetProvider={...provider,url:widget.widgetUrl,firstParty:true}
        const evidence=`ReserveGo times for ${intent.requestedDate}: ${feed.slots.join(', ')||'none'}${feed.feeSlots.length?`; fee shown at ${feed.feeSlots.join(', ')}`:''}`
        const decision=reservationSlotDecision(feed.slots,intent.preferredStart,intent.preferredEnd)
        if(decision.kind==='available'){
          const reply=reservationAvailableReply({restaurant:intent.restaurant,time:decision.time,date:intent.requestedDate,partySize:intent.partySize,whatsappId:params.actor.whatsappId,email:await storedEmail(params.actor)})
          await savePendingSlotStep({actor:params.actor,text:params.text,intent,provider:widgetProvider,timezone,stage:'guest_name',slotTime:decision.time,alternatives:[],slots:feed.slots,evidence,askedText:reply})
          return paused(reply)
        }
        if(decision.kind==='alternatives'){
          const reply=reservationAlternativesReply({restaurant:intent.restaurant,time:intent.preferredStart,date:intent.requestedDate,partySize:intent.partySize,times:decision.times})
          await savePendingSlotStep({actor:params.actor,text:params.text,intent,provider:widgetProvider,timezone,stage:'choose_time',slotTime:null,alternatives:decision.times,slots:feed.slots,evidence,askedText:reply})
          return paused(reply)
        }
        return paused(`${intent.restaurant} has no open tables for ${reservationDayLabel(intent.requestedDate,intent.preferredStart||'19:00').replace(/^on /,'')} on its booking page, so nothing is booked. Want me to check another date? ${widget.widgetUrl}`)
      }catch(error:any){
        console.error('RESERVEGO_FEED_FAILED:',safe(error?.message||error,120))
      }
    }
  }
  // Booking engine (20 Oct live: District 6 on Zomato burned 3 minutes on a phone-login wall and ended "couldn't
  // read"). Apps like District/Zomato/EazyDiner only show tables to a signed-in account, and Gogo never bypasses
  // that sign-in. Not connected yet: ask the person to connect it once, before any browser time is spent.
  // Loaded lazily and guarded like ReserveGo above, so harnesses with inert module stubs keep the old path.
  const bookingEngine:any=await import('./booking-engine').catch(()=>null)
  const signInSite=typeof bookingEngine?.signedInBookingSiteForUrl==='function'?bookingEngine.signedInBookingSiteForUrl(provider.url):null
  const connectFirst=()=>paused(bookingEngine.connectFirstReply({site:signInSite,restaurant:intent.restaurant,date:intent.requestedDate,time:intent.preferredStart,partySize:intent.partySize,providerUrl:provider.url}))
  // The saved sign-in no longer works (expired, signed out, or stuck at the code screen): mark it so the next request
  // asks to reconnect straight away instead of spending minutes reading again. Owner-bound; best-effort.
  const markSignInForReconnect=async()=>{
    try{
      const [{markVaultSessionStatus},{browserSandboxNameFor},{catalogueDomain}]=await Promise.all([import('@/lib/vault/session-store'),import('./secure-browser-bootstrap'),import('@/lib/dashboard/connection-catalogue')])
      await markVaultSessionStatus({telegramId:String(params.actor.legacyTelegramId),domain:catalogueDomain(signInSite),sandboxName:browserSandboxNameFor(params.actor.userId),status:'needs_reauth'})
    }catch(error:any){console.error('BOOKING_SESSION_REAUTH_MARK_FAILED:',safe(error?.message||error,120))}
  }
  if(signInSite&&typeof bookingEngine?.isSiteConnected==='function'){
    const {listSiteConnections}=await import('@/lib/dashboard/site-sessions')
    const connections=await listSiteConnections(String(params.actor.legacyTelegramId)).catch(()=>[] as Array<{siteId:string;status:string}>)
    const connected=bookingEngine.isSiteConnected(connections,signInSite)
    console.log('BOOKING_CONNECTION:',JSON.stringify({site:signInSite.id,connected,rows:connections.filter((c:any)=>c.siteId===signInSite.id).map((c:any)=>({status:c.status,via:c.via||null}))}))
    if(!connected)return connectFirst()
  }
  let inspected:Awaited<ReturnType<typeof runSecureBrowser>>
  try{
    inspected=await runSecureBrowser({
      userId:params.actor.userId,
      url:provider.url,
      mode:'read',
      objective:slotMode?slotReadObjective(intent):`Read only the live reservation state and booking-release rules for ${intent.restaurant}. Determine whether bookings are open, sold out, or scheduled to open later. Capture any explicit next-open date and recurring release weekday/time. Do not sign in, fill personal details, reserve, submit, pay, or change anything.`,
    })
  }catch(error:any){
    if(error?.message==='browser_handoff_in_use')return{runId:'',status:'paused' as const,capability:'browser' as const,risk:'low' as const,handledBy:'restaurant-reservation' as const,text:await (await import('./browser-auth-notice')).browserHandoffInUseReply(params.actor.legacyTelegramId)}
    console.error('RESTAURANT_SLOT_READ_FAILED:',safe(error?.message||error,160))
    // A signed-in booking app that times out is almost always waiting at its sign-in/code screen.
    if(signInSite){await markSignInForReconnect();return connectFirst()}
    return unreadable()
  }
  // A sign-in wall on a signed-in booking app means the saved sign-in ended: ask to connect again, never guess.
  if(inspected.status==='blocked'){
    if(!signInSite)return unreadable()
    await markSignInForReconnect()
    return connectFirst()
  }
  let release=extractReservationRelease(inspected.pageText,timezone)
  if(slotMode&&!release.releaseAt){
    const evidence=`${inspected.summary||''}\n${inspected.pageText||''}`
    // Slots count only when the page shows the requested date: a widget left on today must not answer for tomorrow.
    const slots=reservationSlotDateEvidence(evidence,intent.requestedDate)?extractReservationSlots(evidence):[]
    const decision=reservationSlotDecision(slots,intent.preferredStart,intent.preferredEnd)
    if(decision.kind==='available'){
      const reply=reservationAvailableReply({restaurant:intent.restaurant,time:decision.time,date:intent.requestedDate,partySize:intent.partySize,whatsappId:params.actor.whatsappId,email:await storedEmail(params.actor)})
      await savePendingSlotStep({actor:params.actor,text:params.text,intent,provider,timezone,stage:'guest_name',slotTime:decision.time,alternatives:[],slots,evidence,askedText:reply})
      return paused(reply)
    }
    if(decision.kind==='alternatives'){
      const reply=reservationAlternativesReply({restaurant:intent.restaurant,time:intent.preferredStart,date:intent.requestedDate,partySize:intent.partySize,times:decision.times})
      await savePendingSlotStep({actor:params.actor,text:params.text,intent,provider,timezone,stage:'choose_time',slotTime:null,alternatives:decision.times,slots,evidence,askedText:reply})
      return paused(reply)
    }
    // Sold out with no slots may still publish a release rule (Naru): keep the release research below.
    if(!release.soldOut)return unreadable()
  }
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

  return prepareReservationApproval({actor:params.actor,surface:params.surface,text:params.text,intent,timeConstraint,provider,timezone,release,inspectedText:inspected.pageText,ruleEvidenceUrl,ruleEvidenceText,ruleEvidenceTitle})
}

function liveSlotCalendarOverlaps(intent:RestaurantReservationIntent,snapshot:ReservationDiningContext,timezone:string):Array<{startAt:string;endAt:string}>|null{
  const span=intent.requestedDate?planningSpan(intent.requestedDate,intent.preferredStart,intent.preferredEnd,timezone):null
  if(!span)return null
  return snapshot.calendar.windows.filter(w=>{
    const start=Date.parse(w.startAt),end=Date.parse(w.endAt)
    return Number.isFinite(start)&&Number.isFinite(end)&&end-start<=12*3600_000&&overlapsPlanning(w.startAt,w.endAt,span)
  }).map(w=>({startAt:w.startAt,endAt:w.endAt}))
}
function liveSlotTravelConflict(intent:RestaurantReservationIntent,snapshot:ReservationDiningContext,timezone:string,location:string|null){
  const span=intent.requestedDate?planningSpan(intent.requestedDate,intent.preferredStart,intent.preferredEnd,timezone):null
  const target=planningPlace(location||'')
  return Boolean(span&&snapshot.windows.some(w=>overlapsPlanning(w.startAt,w.endAt,span)&&planningWindowBlocks(w,target)))
}
function busyLabel(windows:Array<{startAt:string;endAt:string}>,timezone:string){
  const fmt=(iso:string)=>new Date(iso).toLocaleTimeString('en-IN',{timeZone:timezone,hour:'numeric',minute:'2-digit',hour12:true}).replace(/\s?([ap])\.?m\.?/i,(_m,a)=>` ${a.toUpperCase()}M`)
  return windows.slice(0,2).map(w=>`${fmt(w.startAt)}–${fmt(w.endAt)}`).join(' and ')
}

type ReservationApprovalContext={actor:AgentActor;surface:AgentSurface;text:string;intent:RestaurantReservationIntent;timeConstraint:RestaurantTimeConstraint;provider:ReservationProvider;timezone:string;release:ReservationRelease;inspectedText:string;ruleEvidenceUrl:string|null;ruleEvidenceText:string;ruleEvidenceTitle:string;guestName?:string|null}
/** Verified provider evidence -> persistent mission + bounded approval. Nothing is armed or submitted here. */
async function prepareReservationApproval(ctx:ReservationApprovalContext){
  const {intent,timeConstraint,provider,timezone,release,ruleEvidenceUrl,ruleEvidenceText,ruleEvidenceTitle}=ctx
  const params={actor:ctx.actor,surface:ctx.surface,text:ctx.text}
  const inspected={pageText:ctx.inspectedText}
  const guestName=ctx.guestName||null
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
  // 19 Oct live: the live-slot flow (exact date and time just read on the restaurant's own page, name given) was
  // stopped here because the owner's multi-account Calendar read is marked incomplete. Instinct books without a
  // Calendar check. For a live slot, an incomplete context is disclosed in the approval ask instead of blocking:
  // the user still has to reply APPROVE, and fee/CAPTCHA/OTP still stop the run. Release-rule missions keep the gate.
  const contextGap=Boolean(guestName&&diningContext.incomplete)
  // Only a Calendar/travel coverage gap can be disclosed and approved; any other gap (date, timezone,
  // release, preferences, malformed data) cannot be armed later, so it is refused before an ask is sent.
  const contextGapDisclosed=contextGap&&onlyDisclosableContextGaps(diningContext)
  if(contextGap&&!contextGapDisclosed)return{runId:'',status:'paused' as const,capability:'browser' as const,risk:'low' as const,handledBy:'restaurant-reservation' as const,
    text:"I found the slot, but couldn't verify the dining date and your saved context well enough to book it. Nothing was booked. Try again in a minute."}
  if(diningContext.incomplete&&!guestName)return{runId:'',status:'paused' as const,capability:'browser' as const,risk:'low' as const,handledBy:'restaurant-reservation' as const,
    text:'I verified the reservation release, but could not verify bounded travel and Calendar context for the possible dining dates. No reservation mission was armed or booking attempted. Retry the context check, or specify a dining date to narrow the Calendar read, before approving an attempt.'}
  // 19 Oct live: the live-slot flow (slot just read, name given) was refused with "overlaps a recorded Calendar busy
  // interval" — the owner's calendar carries a standup instance whose end runs weeks ahead. For a live slot, a
  // multi-day/all-day block (>12h) is not treated as a dinner conflict, and a real short overlap is shown in the
  // approval ask instead of blocking; the user decides with APPROVE/REJECT. Travel conflicts still block.
  const liveSlotBusy=guestName?liveSlotCalendarOverlaps(intent,diningContext,timezone):null
  const conflictReview=contextPack&&!(guestName&&liveSlotBusy!==null&&!liveSlotTravelConflict(intent,diningContext,timezone,provider.location||null))
    ?await reservationConflictReview({actor:params.actor,text:params.text,intent,location:provider.location||null,timezone,releaseAt,pack:contextPack,snapshot:diningContext}):null
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
    preferences_json:{partySize:intent.partySize,preferredStart:intent.preferredStart||null,preferredEnd:intent.preferredEnd||null,requestedDate:intent.requestedDate||null,nextAvailable:intent.nextAvailable,maxBookingFeePaise:0,timeConstraint},
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
    payload_json:{reservationUrl:provider.url,restaurant:intent.restaurant,reservationLocation:provider.location||null,partySize:intent.partySize,preferredStart:intent.preferredStart||null,preferredEnd:intent.preferredEnd||null,requestedDate:intent.requestedDate||null,nextAvailable:intent.nextAvailable,maxBookingFeePaise:0,timeConstraint,releaseAt,releaseRule:release.releaseRule,contextWindows,contextRefs,diningContext,...(guestName?{guestName,slotMission:true}:{}),...(contextGapDisclosed?{contextGapDisclosed:true}:{})},
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
    metadata_json:{plan_type:'restaurant_reservation_release',life_event_id:lifeEventId,life_event_action_id:actionId,restaurant:intent.restaurant,reservation_url:provider.url,release_at:releaseAt,context_windows:contextWindows,context_refs:contextRefs,dining_context:diningContext,constraints:{partySize:intent.partySize,preferredStart:intent.preferredStart||null,preferredEnd:intent.preferredEnd||null,requestedDate:intent.requestedDate||null,nextAvailable:intent.nextAvailable,maxBookingFeePaise:0,timeConstraint,...(guestName?{guestName}:{})}},
  }
  const runWrite=refreshing
    ? supabaseAdmin.from('agent_runs').update(runValues).eq('id',existing!.run!.id).eq('telegram_id',String(params.actor.legacyTelegramId)).eq('error',refreshToken)
    : supabaseAdmin.from('agent_runs').insert(runValues)
  const{data:run,error:runError}=await runWrite.select('id').single()
  if(runError||!run?.id)throw new Error(`restaurant_reservation_run_failed:${runError?.message||'unknown'}`)
  const runId=String(run.id)
  const binding=buildApprovalBinding(restaurantReservationApprovalInput({runId,lifeEventId,actionId,restaurant:intent.restaurant,providerUrl:provider.url,partySize:intent.partySize,preferredStart:intent.preferredStart,preferredEnd:intent.preferredEnd,requestedDate:intent.requestedDate,releaseAt,contextWindows,diningContext,reservationLocation:provider.location||null,timeConstraint,guestName,contextGapDisclosed}))
  const{data:approval,error:approvalError}=await supabaseAdmin.from('agent_approvals').insert({
    telegram_id:String(params.actor.legacyTelegramId),run_id:runId,action_type:'booking',
    title:`Approve timed reservation attempt · ${intent.restaurant}`.slice(0,220),
    description:'This approval is bounded to this restaurant, party size, preferred time window and zero booking fee/deposit. If the provider requires a fee, payment or protected authentication, Gogo must stop and ask you.',
    payload_preview:[
      {label:'Restaurant',value:intent.restaurant},
      {label:'Party',value:String(intent.partySize)},
      ...(guestName?[{label:'Guest name',value:guestName}]:[]),
      {label:'Preferred time',value:diningTimeLabel(intent.preferredStart,intent.preferredEnd)},
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
  const window=diningTimeLabel(intent.preferredStart,intent.preferredEnd)
  const travelNote=contextWindows.length
    ? '\n\nRelevant saved travel windows are attached for the possible dining dates. An inferred or unattributed traveller window requires clarification if it overlaps the dining slot; it is not proof that you are away.'
    : ''
  const calendarNote=diningContext.calendar.connected?`\nCalendar: ${diningContext.calendar.windows.length} busy intervals attached for the covered dates. The full dining interval must avoid them.`:'\nCalendar is not connected, so Calendar conflicts have not been verified.'
  if(guestName){
    // Live-slot mission: the slot was just read on the restaurant's own page. Keep the ask short (Instinct-style).
    const ending=mobileEnding(params.actor.whatsappId)
    return{
      runId,status:'waiting_approval' as const,capability:'browser' as const,risk:'high' as const,handledBy:'restaurant-reservation' as const,
      approvalId:String(approval.id),approvalRequired:true,
      text:`Ready to book ${reservationClockLabel(intent.preferredStart)} ${reservationDayLabel(intent.requestedDate,intent.preferredStart)} for ${intent.partySize} at ${intent.restaurant} under ${guestName}${ending?`, with your WhatsApp number ending ${ending}`:''}.${liveSlotBusy?.length?` Your calendar shows you busy ${busyLabel(liveSlotBusy,timezone)} then — still book it?`:contextGap?" I couldn't fully check your calendar for that evening, so make sure you're free.":''}\nReply APPROVE to book it, or REJECT to stop. I'll stop before any fee, CAPTCHA or OTP.`,
    }
  }
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

/**
 * The reply to a live-slot question: a time pick ("6:30pm") or the guest name ("Divya Rao"). The name step goes
 * through the same bounded approval as every reservation; nothing is submitted here. Returns null when no live
 * slot question is pending for this person, so ordinary routing continues.
 */
export async function continueRestaurantReservationGuestReply(params:{actor:AgentActor;surface:AgentSurface;text:string}){
  const tg=String(params.actor.legacyTelegramId)
  const{data:pending,error}=await supabaseAdmin.from('agent_runs').select('id,status,error,updated_at,metadata_json')
    .eq('telegram_id',tg).eq('type','restaurant_reservation_slot').eq('status','paused')
    .order('updated_at',{ascending:false}).limit(1).maybeSingle()
  if(error||!pending?.id)return null
  const meta:any=pending.metadata_json||{}
  if(meta.plan_type!=='restaurant_reservation_slot'||!(Date.parse(String(meta.expires_at||''))>Date.now()))return null
  const provider=meta.provider&&typeof meta.provider.url==='string'?{url:String(meta.provider.url),title:String(meta.provider.title||meta.restaurant||''),source:String(meta.provider.source||'web_search'),location:meta.provider.location||null,firstParty:meta.provider.firstParty===true}:null
  const parsed=parseRestaurantReservationIntent(String(meta.request_text||''))
  // The saved dining date wins over a re-parse ("tomorrow" must not move if the reply lands after midnight).
  const base=parsed&&/^\d{4}-\d{2}-\d{2}$/.test(String(meta.requested_date||''))?{...parsed,requestedDate:String(meta.requested_date)}:null
  if(!provider||!base||base.restaurant!==meta.restaurant||base.partySize!==meta.party_size)return null
  const paused=(text:string)=>({runId:String(pending.id),status:'paused' as const,capability:'browser' as const,risk:'low' as const,handledBy:'restaurant-reservation' as const,text})

  if(meta.stage==='choose_time'&&pending.error==='awaiting_slot_choice'){
    const raw=String(params.text||'').trim().replace(/^(?:the|at)\s+/i,'').replace(/\s+(?:one|slot|please)$/i,'')
    const alternatives:string[]=Array.isArray(meta.alternatives)?meta.alternatives.map(String):[]
    const said=explicitClock(raw.replace(/(\d)\.(\d{2})/,'$1:$2'))||(/^\d{1,2}(?::\d{2})?$/.test(raw)?alternatives.find(t=>{const[h,m]=raw.split(':');return Number(t.slice(0,2))%12===Number(h)%12&&t.slice(3)===(m||'00')}):'')||''
    if(!said||!alternatives.includes(said))return null
    const{data:moved}=await supabaseAdmin.from('agent_runs').update({error:'awaiting_guest_name',updated_at:new Date().toISOString(),metadata_json:{...meta,stage:'guest_name',slot_time:said}})
      .eq('id',pending.id).eq('telegram_id',tg).eq('status','paused').eq('error','awaiting_slot_choice').select('id').maybeSingle()
    if(!moved)return null
    const reply=reservationAvailableReply({restaurant:base.restaurant,time:said,date:base.requestedDate,partySize:base.partySize!,whatsappId:params.actor.whatsappId,email:await storedEmail(params.actor)})
    // The name question replaces the time question in the registry, so the next reply binds to it.
    await registerLiveSlotQuestion(params.actor,'guest_name',base.restaurant,reply)
    return paused(reply)
  }
  if(meta.stage!=='guest_name'||pending.error!=='awaiting_guest_name'||!/^\d{2}:\d{2}$/.test(String(meta.slot_time||'')))return null
  const guestName=guestNameFromReply(params.text)
  if(!guestName)return null
  // Claim the step so a duplicate delivery cannot create a second approval.
  const claimToken=`restaurant_slot_claim:${createHash('sha256').update(`${pending.id}|${Date.now()}|${Math.random()}`).digest('hex').slice(0,24)}`
  const{data:claimed}=await supabaseAdmin.from('agent_runs').update({status:'running',error:claimToken,updated_at:new Date().toISOString()})
    .eq('id',pending.id).eq('telegram_id',tg).eq('status','paused').eq('error','awaiting_guest_name').select('id').maybeSingle()
  if(!claimed)return null
  const slot=String(meta.slot_time)
  const intent:RestaurantReservationIntent={...base,preferredStart:slot,preferredEnd:slot,timeClarificationNeeded:false,nextAvailable:false}
  const finish=async(status:'completed'|'failed',extra:Record<string,unknown>)=>{
    const at=new Date().toISOString()
    await supabaseAdmin.from('agent_runs').update({status,error:status==='failed'?String(extra.error||'restaurant_slot_step_failed'):null,progress:100,completed_at:at,updated_at:at,metadata_json:{...meta,guest_name:guestName,...extra}})
      .eq('id',pending.id).eq('telegram_id',tg).eq('error',claimToken)
  }
  try{
    const timezone=normalizeTimezone(String(meta.timezone||'Asia/Kolkata'))
    const release:ReservationRelease={soldOut:false,releaseAt:null,releaseDate:null,releaseTime:null,releaseRule:null,openNow:true}
    const result=await prepareReservationApproval({actor:params.actor,surface:params.surface,text:String(meta.request_text),intent,timeConstraint:reservationTimeConstraint(intent),provider,timezone,release,inspectedText:String(meta.evidence||''),ruleEvidenceUrl:null,ruleEvidenceText:'',ruleEvidenceTitle:'',guestName})
    await finish('completed',{child_run_id:result.runId||null,outcome_status:result.status||null})
    return result
  }catch(err:any){
    await finish('failed',{error:safe(err?.message||'restaurant_slot_step_failed',300)})
    throw err
  }
}

/**
 * 19 Oct live (Toit): "Approve 1" on a live-slot approval was refused with "needs verified dining-date
 * context" because one Calendar account could not be read — a gap the ask had already disclosed
 * ("I couldn't fully check your calendar"). A live-slot mission may arm on such a context only when:
 * the disclosure is part of the approval binding, a guest name and an exact approved time exist, the
 * requested date is a future local date, and every gap is a Calendar/travel coverage gap.
 * Release-rule missions never take this path.
 */
export function disclosedLiveSlotContext(p:any){
  if(!p||p.slotMission!==true||!p.guestName||p.contextGapDisclosed!==true)return false
  if(!p.preferredStart||p.preferredStart!==p.preferredEnd)return false
  if(!usableDisclosedGapDiningContext(p.diningContext))return false
  return Boolean(reservationRequestedDateCoverage(String(p.requestedDate||''),p.diningContext.timezone,new Date()))
}

export function liveSlotArmedReply(p:any,now=new Date()){
  const time=String(p.preferredStart||'')
  const day=p.requestedDate?` ${reservationDayLabel(String(p.requestedDate),time,now)}`:''
  return `Approved. Booking ${reservationClockLabel(time)}${day} for ${Number(p.partySize)||''} at ${safe(p.restaurant,120)} under ${safe(p.guestName,60)} now — I'll message you the result. If a CAPTCHA, OTP or fee appears I'll stop and send you the link.`
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
  assertApprovalBinding(restaurantReservationApprovalInput({runId:params.runId,lifeEventId:String(meta.life_event_id),actionId:String(action.id),restaurant:String(p.restaurant||meta.restaurant||''),providerUrl:String(p.reservationUrl||meta.reservation_url||''),partySize:Number(p.partySize)||null,preferredStart:String(p.preferredStart||''),preferredEnd:String(p.preferredEnd||''),requestedDate:String(p.requestedDate||''),releaseAt:String(p.releaseAt||meta.release_at||'')||null,contextWindows:Array.isArray(p.contextWindows)?p.contextWindows:[],diningContext:p.diningContext,reservationLocation:p.reservationLocation||null,timeConstraint:p.timeConstraint,guestName:p.guestName||null,contextGapDisclosed:p.contextGapDisclosed===true}),approval)
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
  if(!validRestaurantTimeConstraint(p.timeConstraint,String(p.preferredStart||''),String(p.preferredEnd||''))||!(usableReservationDiningContext(p.diningContext)||disclosedLiveSlotContext(p))||Date.parse(p.diningContext.until)<=Date.now()){
    const at=new Date().toISOString()
    await transitionRun({status:'paused',error:'restaurant_context_review_required',summary:'This approval lacks current verified dining-date or time authority. Request a refreshed bounded approval; no reservation was armed.',updated_at:at})
    await transitionAction({status:'blocked',updated_at:at})
    const results=await Promise.all([
      supabaseAdmin.from('agent_approvals').update({status:'expired',resolved_at:at,resolution_note:'restaurant_context_review_required'}).eq('id',approval.id).eq('telegram_id',tg).eq('status','approved'),
    ])
    if(results.some(result=>result.error))throw new Error('restaurant_context_review_pause_failed')
    return{runId:params.runId,status:'paused' as const,capability:'browser' as const,risk:'low' as const,handledBy:'restaurant-reservation' as const,text:'This older reservation approval needs verified dining-date context and time authority. Nothing was armed. Request the reservation again to refresh this same mission and review a new bounded approval.'}
  }
  const now=new Date().toISOString()
  if(alreadyArmed)return{runId:params.runId,status:'queued' as const,capability:'browser' as const,risk:'high' as const,handledBy:'restaurant-reservation' as const,text:'This exact reservation is already armed. No new attempt or authority was created.'}
  await transitionRun({status:'queued',summary:'Reservation approval accepted; preparing the scheduled action.',progress:55,updated_at:now})
  await transitionAction({status:'ready',updated_at:now,payload_json:{...p,armedAt:now,approvalId:String(approval.id)}})
  const results=await Promise.all([
    supabaseAdmin.from('life_events').update({lifecycle_state:'planned',next_action_at:action.due_at,updated_at:now}).eq('id',String(meta.life_event_id)).eq('telegram_id',tg),
  ])
  if(results.some(result=>result.error))throw new Error('restaurant_reservation_arm_persistence_failed')
  if(p.slotMission===true&&p.guestName)return{runId:params.runId,status:'queued' as const,capability:'browser' as const,risk:'high' as const,handledBy:'restaurant-reservation' as const,text:liveSlotArmedReply(p)}
  return{runId:params.runId,status:'queued' as const,capability:'browser' as const,risk:'high' as const,handledBy:'restaurant-reservation' as const,text:'Approved and armed. Gogo will attempt only this reservation at the verified release time, inside the approved party/time bounds. If a fee, deposit, login challenge, OTP, CAPTCHA, passkey or payment step appears, I will stop and ask you.'}
}
