import { supabaseAdmin } from '@/lib/supabase-admin'
import { searchWebResults, type WebSearchResult } from '@/lib/web-search'
import { searchCreditIQLiveFlights } from '@/lib/integrations/creditiq-travel'
import { redactSecretShapedText } from '@/lib/bot/memory-redaction'
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
}

const INDIA_CODES = new Set(['BLR','BOM','DEL','HYD','MAA','CCU','PNQ','GOI','GOX'])
const MONTHS: Record<string, number> = {
  jan:0, january:0, feb:1, february:1, mar:2, march:2, apr:3, april:3, may:4,
  jun:5, june:5, jul:6, july:6, aug:7, august:7, sep:8, sept:8, september:8,
  oct:9, october:9, nov:10, november:10, dec:11, december:11,
}

function esc(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function placeFrom(raw: string | undefined): Place | undefined {
  const cleaned = String(raw || '').trim().replace(/[,.!?]+$/g, '').toLowerCase()
  if (!cleaned) return undefined
  if (PLACES[cleaned]) return PLACES[cleaned]
  const label = cleaned.replace(/\b\w/g, c => c.toUpperCase())
  return { label, aliases: [cleaned] }
}

function extractSegment(text: string, marker: 'from' | 'to' | 'in') {
  const stop = marker === 'from'
    ? '(?=\\s+(?:to|next|this|tomorrow|on|for|under|below|with|return|one-way|round-trip)\\b|$)'
    : marker === 'to'
      ? '(?=\\s+(?:from|next|this|tomorrow|on|for|under|below|with|return|one-way|round-trip)\\b|$)'
      : '(?=\\s+(?:next|this|tomorrow|on|for|under|below|with|from|to)\\b|$)'
  const re = new RegExp(`\\b${marker}\\s+([a-zA-Z][a-zA-Z .'-]{1,42}?)${stop}`, 'i')
  return text.match(re)?.[1]?.trim()
}

function fmtDate(date: Date) {
  return new Intl.DateTimeFormat('en-GB', { day:'numeric', month:'short', year:'numeric', timeZone:'UTC' }).format(date)
}

function isoDay(date: Date) {
  return date.toISOString().slice(0, 10)
}

function nextWeekRange(now: Date) {
  const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const day = base.getUTCDay() || 7
  const monday = new Date(base)
  monday.setUTCDate(base.getUTCDate() + (8 - day))
  const sunday = new Date(monday)
  sunday.setUTCDate(monday.getUTCDate() + 6)
  return { label:`${fmtDate(monday)} – ${fmtDate(sunday)}`, search:`${fmtDate(monday)} ${fmtDate(sunday)}`, startDate:isoDay(monday), endDate:isoDay(sunday) }
}

function thisWeekRange(now: Date) {
  const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const day = base.getUTCDay() || 7
  const sunday = new Date(base)
  sunday.setUTCDate(base.getUTCDate() + (7 - day))
  return { label:`${fmtDate(base)} – ${fmtDate(sunday)}`, search:`${fmtDate(base)} ${fmtDate(sunday)}`, startDate:isoDay(base), endDate:isoDay(sunday) }
}

function normalizeWhen(text: string, now = new Date()) {
  const t = text.toLowerCase()
  if (/\bnext week\b/.test(t)) return nextWeekRange(now)
  if (/\bthis week\b/.test(t)) return thisWeekRange(now)
  if (/\bnext month\b/.test(t)) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 0))
    return { label:new Intl.DateTimeFormat('en-GB',{month:'long',year:'numeric',timeZone:'UTC'}).format(start), search:`${fmtDate(start)} ${fmtDate(end)}`, startDate:isoDay(start), endDate:isoDay(end) }
  }
  if (/\btomorrow\b/.test(t)) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))
    return { label:fmtDate(d), search:fmtDate(d), startDate:isoDay(d), endDate:isoDay(d) }
  }
  const dateish = text.match(/\b(?:\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?|\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2})(?:\s*(?:-|–|to)\s*(?:\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?|\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2}))?/i)?.[0]
  if (dateish) return { label:dateish, search:`${dateish} ${now.getUTCFullYear()}` }
  return { label:'dates not specified', search:`${now.getUTCFullYear()}` }
}

export function buildTravelResearchContext(rawText: string, now = new Date()): TravelContext {
  const text = String(rawText || '').trim()
  const t = text.toLowerCase()
  const kind: 'flight' | 'hotel' = /\bhotel|hotels\b/.test(t) && !/\bflight|flights|airfare\b/.test(t) ? 'hotel' : 'flight'
  let origin = placeFrom(extractSegment(text, 'from'))
  let destination = placeFrom(extractSegment(text, 'to'))

  if (kind === 'flight' && (!origin || !destination)) {
    const pair = text.match(/\b([A-Za-z]{3}|[A-Za-z][A-Za-z .'-]{2,28})\s*(?:→|->| to )\s*([A-Za-z]{3}|[A-Za-z][A-Za-z .'-]{2,28}?)(?=\s+(?:next|this|tomorrow|on|for|under|below|with|one-way|round-trip)\b|$)/i)
    origin ||= placeFrom(pair?.[1])
    destination ||= placeFrom(pair?.[2])
  }

  if (kind === 'hotel' && !destination) destination = placeFrom(extractSegment(text, 'in'))

  const when = normalizeWhen(text, now)
  const routeLabel = origin && destination
    ? `${origin.code || origin.label} → ${destination.code || destination.label}`
    : destination ? destination.label : 'Travel search'
  return { kind, origin, destination, whenLabel:when.label, searchWhen:when.search, routeLabel, startDate:when.startDate, endDate:when.endDate }
}

export function isPublicTravelResearchRequest(rawText: string) {
  const text = String(rawText || '').trim()
  const t = text.toLowerCase()
  if (!/\b(flight|flights|airfare|fare|fares|hotel|hotels|travel|trip)\b/.test(t)) return false
  if (/\b(my\s+(flight|ticket|booking|reservation|pnr|boarding pass|itinerary)|saved\s+(flight|ticket|booking)|show\s+my\s+(flight|ticket)|find\s+my\s+(flight|ticket))\b/.test(t)) return false
  return /\b(cheap|cheapest|best\s+(fare|price|deal)|compare|comparison|price|prices|fare|fares|deal|deals|available|availability|options|search|research|look\s+for|find\s+(a|me\s+a)|next\s+week|this\s+week|next\s+month)\b/.test(t)
}

function placeIndex(text: string, place: Place) {
  const lower = text.toLowerCase()
  const indexes = place.aliases.map(a => lower.search(new RegExp(`\\b${esc(a)}\\b`, 'i'))).filter(i => i >= 0)
  return indexes.length ? Math.min(...indexes) : -1
}

function directionScore(result: WebSearchResult, context: TravelContext) {
  if (!context.origin || !context.destination || context.kind !== 'flight') return 1
  const title = String(result.title || '')
  const oi = placeIndex(title, context.origin)
  const di = placeIndex(title, context.destination)
  if (oi >= 0 && di >= 0) return oi < di ? 4 : -5
  const combined = `${result.title} ${result.snippet}`
  const co = placeIndex(combined, context.origin)
  const cd = placeIndex(combined, context.destination)
  if (co >= 0 && cd >= 0) return co < cd ? 2 : -2
  return 0
}

function sourceLabel(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./,'').split('.')[0].replace(/[-_]/g,' ').replace(/\b\w/g,c=>c.toUpperCase())
  } catch { return 'Source' }
}

function domesticIndia(context: TravelContext) {
  return Boolean(context.origin?.code && context.destination?.code && INDIA_CODES.has(context.origin.code) && INDIA_CODES.has(context.destination.code))
}

function parseDateMentions(text: string, context: TravelContext) {
  const out: Date[] = []
  const defaultYear = Number(context.startDate?.slice(0,4) || new Date().getUTCFullYear())
  const add = (year:number, month:number, day:number) => {
    if (year < 2020 || year > 2100 || month < 0 || month > 11 || day < 1 || day > 31) return
    const d = new Date(Date.UTC(year,month,day))
    if (d.getUTCFullYear() === year && d.getUTCMonth() === month && d.getUTCDate() === day) out.push(d)
  }

  const dayMonth = /\b(\d{1,2})\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:[,\s]+(20\d{2}))?/gi
  let m: RegExpExecArray | null
  while ((m = dayMonth.exec(text))) add(Number(m[3] || defaultYear), MONTHS[m[2].toLowerCase()], Number(m[1]))

  const monthDay = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:[,\s]+(20\d{2}))?/gi
  while ((m = monthDay.exec(text))) add(Number(m[3] || defaultYear), MONTHS[m[1].toLowerCase()], Number(m[2]))

  const numeric = /\b(\d{1,2})[\/-](\d{1,2})[\/-](20\d{2})\b/g
  while ((m = numeric.exec(text))) add(Number(m[3]), Number(m[2]) - 1, Number(m[1]))

  const seen = new Set<string>()
  return out.filter(d => {
    const key = isoDay(d)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function dateRelevance(result: WebSearchResult, context: TravelContext): { relevance: DateRelevance; signals: string[] } {
  if (!context.startDate || !context.endDate) return { relevance:'unknown', signals:[] }
  const dates = parseDateMentions(`${result.title} ${result.snippet}`, context)
  if (!dates.length) return { relevance:'unknown', signals:[] }
  const hits = dates.filter(d => {
    const iso = isoDay(d)
    return iso >= context.startDate! && iso <= context.endDate!
  })
  if (!hits.length) return { relevance:'mismatched', signals:dates.map(fmtDate).slice(0,4) }
  return { relevance:'matched', signals:hits.map(fmtDate).slice(0,4) }
}

function extractInrFare(text: string) {
  const m = String(text || '').match(/(?:₹|INR\s*|Rs\.?\s*)([\d,]+(?:\.\d{1,2})?)/i)
  return m ? `₹${m[1]}` : undefined
}

function hasForeignCurrency(text: string) {
  return /(?:US\$|\$|USD\b|UAH\b|AED\b|EUR\b|€|GBP\b|£)\s*[\d,.]*/i.test(text)
}

function stripForeignPrices(text: string) {
  return text.replace(/(?:US\$|\$|USD\s*|UAH\s*|AED\s*|EUR\s*|€|GBP\s*|£)\s*[\d,.]+/gi, '').replace(/\s{2,}/g,' ').trim()
}

function cleanTitle(value: string, context: TravelContext) {
  const title = safe(value, 150)
  return domesticIndia(context) ? stripForeignPrices(title).replace(/\s*[–—-]\s*$/,'').trim() : title
}

function cleanSnippet(value: string, context: TravelContext) {
  let snippet = safe(value, 280)
    .replace(/\b(?:book now|click here|promo code|checkout)\b.*$/i, '')
    .replace(/\s*[|]{1,2}\s*/g, ' · ')
    .trim()
  if (domesticIndia(context)) snippet = stripForeignPrices(snippet)
  return snippet
}

export function curateTravelResults(results: WebSearchResult[], context: TravelContext) {
  const seen = new Set<string>()
  const directional = Boolean(context.kind === 'flight' && context.origin && context.destination)
  return results
    .map(result => {
      const dates = dateRelevance(result, context)
      const score = directionScore(result, context) + (dates.relevance === 'matched' ? 3 : 0)
      return { result, score, dates }
    })
    .filter(x => (directional ? x.score > 0 : x.score >= 0) && x.dates.relevance !== 'mismatched')
    .sort((a,b) => b.score - a.score)
    .filter(({result}) => {
      try {
        const u = new URL(result.url)
        const key = `${u.hostname}${u.pathname}`.replace(/\/$/,'')
        if (seen.has(key)) return false
        seen.add(key)
        return true
      } catch { return false }
    })
    .slice(0, 4)
    .map(({result, dates}) => {
      const combined = `${result.title} ${result.snippet}`
      const inrFare = extractInrFare(combined)
      const foreignCurrencyOnly = domesticIndia(context) && !inrFare && hasForeignCurrency(combined)
      return {
        title:cleanTitle(result.title, context),
        source:sourceLabel(result.url),
        url:result.url,
        snippet:cleanSnippet(result.snippet, context),
        dateRelevance:dates.relevance,
        dateSignals:dates.signals,
        inrFare,
        foreignCurrencyOnly,
      }
    })
}

function humanDateFromIso(iso: string | undefined) {
  if (!iso) return ''
  return fmtDate(new Date(`${iso}T00:00:00Z`))
}

function buildQueries(context: TravelContext, original: string) {
  if (context.kind === 'flight' && context.origin && context.destination) {
    const origin = `${context.origin.label}${context.origin.code ? ` ${context.origin.code}` : ''}`
    const dest = `${context.destination.label}${context.destination.code ? ` ${context.destination.code}` : ''}`
    const dates = [context.startDate, context.endDate].filter(Boolean).map(humanDateFromIso)
    return [
      `${origin} to ${dest} flights ${context.searchWhen} fare INR direct`,
      ...dates.map(date => `${origin} to ${dest} flight ${date} fare INR IndiGo Air India Akasa`),
    ].slice(0,3)
  }
  if (context.kind === 'hotel' && context.destination) {
    return [`hotels in ${context.destination.label} ${context.searchWhen} rates availability`, String(original).trim()]
  }
  return [`${String(original).trim()} ${context.searchWhen} current fares options`]
}

async function addActivity(tg: number, runId: string, eventType: string, message: string, metadata: Record<string, unknown> = {}) {
  const { error } = await supabaseAdmin.from('agent_activity').insert({ telegram_id:String(tg), run_id:runId, event_type:eventType, message:safe(message,900), metadata_json:metadata })
  if (error) console.error('TRAVEL_RESEARCH_ACTIVITY_FAILED:', error.message)
}

function formatLiveFlight(value: any, index: number) {
  const price = Number.isFinite(Number(value.price)) ? `₹${Math.round(Number(value.price)).toLocaleString('en-IN')}` : 'price unavailable'
  const stops = Number.isFinite(Number(value.stops)) ? (Number(value.stops) === 0 ? 'non-stop' : `${Number(value.stops)} stop${Number(value.stops) === 1 ? '' : 's'}`) : ''
  const timing = [value.departure, value.arrival].filter(Boolean).join(' → ')
  const bits = [price, value.airline, timing, stops].filter(Boolean)
  return `${index + 1}. ${bits.join(' · ')}${value.bookingLink ? `\nBooking/provider link: ${value.bookingLink}` : ''}`
}

async function tryCreditIQLive(context: TravelContext) {
  if (context.kind !== 'flight' || !context.origin?.code || !context.destination?.code || !context.startDate) return null
  return searchCreditIQLiveFlights({
    from: context.origin.code,
    to: context.destination.code,
    date: context.startDate,
    dateTo: context.endDate || context.startDate,
    cabin: 'economy',
  })
}

export async function tryRunTravelResearch(params: { actor: AgentActor; surface: AgentSurface; text: string }) {
  if (!isPublicTravelResearchRequest(params.text)) return null

  const context = buildTravelResearchContext(params.text)
  const queries = buildQueries(context, params.text)
  const tg = params.actor.legacyTelegramId
  const now = new Date().toISOString()

  const { data: run, error: runError } = await supabaseAdmin.from('agent_runs').insert({
    telegram_id:String(tg), type:'travel_research', capability:'travel', status:'running',
    title:`Travel research · ${context.routeLabel}`, summary:'Gogo is checking CreditIQ travel intelligence and current travel sources.', progress:20,
    why:'This asks for current travel options, not a saved ticket.', source:params.surface,
    metadata_json:{ plan_type:'travel_research', input_text:safe(params.text,1800), queries, context }, started_at:now, updated_at:now,
  }).select('id').single()
  if (runError || !run?.id) throw new Error(`travel_research_run_create_failed:${runError?.message || 'unknown'}`)

  const runId = String(run.id)
  const { data: step, error: stepError } = await supabaseAdmin.from('agent_steps').insert({
    telegram_id:String(tg), run_id:runId, ordinal:1, tool_name:'travel', title:'Search CreditIQ live travel inventory', status:'running',
    input_json:{ queries, context }, output_json:{}, started_at:now,
  }).select('id').single()
  if (stepError || !step?.id) throw new Error(`travel_research_step_create_failed:${stepError?.message || 'unknown'}`)

  await addActivity(tg, runId, 'run_started', `Gogo started current travel research for ${context.routeLabel}.`, { queries })

  try {
    // CreditIQ is Gogo's specialist live travel/rewards intelligence layer. Prefer
    // structured provider inventory to public search snippets whenever route/date
    // are concrete enough. If CreditIQ has no usable live response, fall back
    // honestly to the existing curated public-web research path.
    const live = await tryCreditIQLive(context)
    if (live?.live && live.flights.length) {
      const completedAt = new Date().toISOString()
      const output = { context, liveInventory:live, source:'creditiq', inventoryType:'live-provider' }
      await supabaseAdmin.from('agent_steps').update({ status:'completed', output_json:output, completed_at:completedAt }).eq('id', String(step.id))

      const top = live.flights.slice(0, 8)
      const text = `CreditIQ live travel · ${context.routeLabel} · ${context.whenLabel}\nProvider: ${live.source} · fetched ${live.fetchedAt}\n\n${top.map(formatLiveFlight).join('\n\n')}\n\nThese are provider-returned travel results through CreditIQ. Fares and availability can still change before checkout, so Gogo must reprice before any approved booking action.`
      await supabaseAdmin.from('agent_runs').update({ status:'completed', summary:safe(text,1800), progress:100, completed_at:completedAt, updated_at:completedAt, metadata_json:{ plan_type:'travel_research', input_text:safe(params.text,1800), queries, context, travelEngine:'creditiq' } }).eq('id',runId).eq('telegram_id',String(tg))
      await addActivity(tg,runId,'run_completed',`CreditIQ returned ${top.length} live travel options.`,{result_count:top.length,route:context.routeLabel,provider:live.source,travel_engine:'creditiq'})
      return { runId, status:'completed' as const, capability:'travel' as const, risk:'low' as const, text, handledBy:'creditiq-travel' as const }
    }

    const batches = await Promise.all(queries.map(q => searchWebResults(q)))
    const curated = curateTravelResults(batches.flat(), context)
    const completedAt = new Date().toISOString()
    const output = { context, results:curated, source:'public-web-fallback', inventoryType:'research' }

    await supabaseAdmin.from('agent_steps').update({ status:'completed', output_json:output, completed_at:completedAt }).eq('id', String(step.id))

    const intro = `Current public search fallback · ${context.routeLabel} · ${context.whenLabel}\nCreditIQ did not return usable live inventory for this request. I did not use your saved tickets.`
    const text = curated.length
      ? `${intro}\n\n${curated.map((r,i) => {
          const dateLine = r.dateRelevance === 'matched'
            ? `Date signal: ${r.dateSignals.join(', ')} · inside your requested window`
            : `Date: route page found · exact requested date not verified`
          const fareLine = r.inrFare
            ? `Public snippet mentions ${r.inrFare} · verify on the source before booking`
            : `INR fare: not verified in the public snippet`
          const detail = r.snippet ? `\n${r.snippet}` : ''
          return `${i + 1}. ${r.source} — ${r.title}\n${dateLine}\n${fareLine}${detail}\nOpen source: ${r.url}`
        }).join('\n\n')}\n\nThese are public-web sources, not guaranteed live inventory. I hide off-date results and do not treat foreign-currency snippets as an INR fare. Verify the exact flight, baggage, cancellation terms and final INR price on the provider page before paying.`
      : `${intro}\n\nI couldn't find a direction- and date-relevant result that I can show confidently. I will not substitute a different week or reverse route.`

    await supabaseAdmin.from('agent_runs').update({ status:'completed', summary:safe(text,1800), progress:100, completed_at:completedAt, updated_at:completedAt }).eq('id',runId).eq('telegram_id',String(tg))
    await addActivity(tg,runId,'run_completed',curated.length ? `Found ${curated.length} curated public travel sources after CreditIQ fallback.` : 'No reliable travel results found.',{result_count:curated.length,route:context.routeLabel,travel_engine:'public-web-fallback'})

    return { runId, status:'completed' as const, capability:'travel' as const, risk:'low' as const, text, handledBy:'travel-research' as const }
  } catch (error:any) {
    const message=safe(error?.message||'travel_research_failed',500);const completedAt=new Date().toISOString()
    await supabaseAdmin.from('agent_steps').update({status:'failed',error:message,completed_at:completedAt}).eq('id',String(step.id)).catch(()=>{})
    await supabaseAdmin.from('agent_runs').update({status:'failed',summary:'Gogo could not complete the current travel search.',error:message,completed_at:completedAt,updated_at:completedAt}).eq('id',runId).eq('telegram_id',String(tg)).catch(()=>{})
    await addActivity(tg,runId,'run_failed','Current travel research failed.',{error:message})
    throw error
  }
}
