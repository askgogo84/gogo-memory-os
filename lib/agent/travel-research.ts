import { supabaseAdmin } from '@/lib/supabase-admin'
import { searchWebResults, type WebSearchResult } from '@/lib/web-search'
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
}

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

function extractSegment(text: string, marker: 'from' | 'to') {
  const stop = marker === 'from'
    ? '(?=\\s+(?:to|next|this|tomorrow|on|for|under|below|with|return|one-way|round-trip)\\b|$)'
    : '(?=\\s+(?:from|next|this|tomorrow|on|for|under|below|with|return|one-way|round-trip)\\b|$)'
  const re = new RegExp(`\\b${marker}\\s+([a-zA-Z][a-zA-Z .'-]{1,42}?)${stop}`, 'i')
  return text.match(re)?.[1]?.trim()
}

function fmtDate(date: Date) {
  return new Intl.DateTimeFormat('en-GB', { day:'numeric', month:'short', year:'numeric', timeZone:'UTC' }).format(date)
}

function nextWeekRange(now: Date) {
  const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const day = base.getUTCDay() || 7
  const monday = new Date(base)
  monday.setUTCDate(base.getUTCDate() + (8 - day))
  const sunday = new Date(monday)
  sunday.setUTCDate(monday.getUTCDate() + 6)
  return { label:`${fmtDate(monday)} – ${fmtDate(sunday)}`, search:`${fmtDate(monday)} ${fmtDate(sunday)}` }
}

function thisWeekRange(now: Date) {
  const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const day = base.getUTCDay() || 7
  const sunday = new Date(base)
  sunday.setUTCDate(base.getUTCDate() + (7 - day))
  return { label:`${fmtDate(base)} – ${fmtDate(sunday)}`, search:`${fmtDate(base)} ${fmtDate(sunday)}` }
}

function normalizeWhen(text: string, now = new Date()) {
  const t = text.toLowerCase()
  if (/\bnext week\b/.test(t)) return nextWeekRange(now)
  if (/\bthis week\b/.test(t)) return thisWeekRange(now)
  if (/\bnext month\b/.test(t)) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 0))
    return { label:new Intl.DateTimeFormat('en-GB',{month:'long',year:'numeric',timeZone:'UTC'}).format(start), search:`${fmtDate(start)} ${fmtDate(end)}` }
  }
  if (/\btomorrow\b/.test(t)) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))
    return { label:fmtDate(d), search:fmtDate(d) }
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

  if (kind === 'hotel' && !destination) destination = placeFrom(extractSegment(text, 'in') as any)

  const when = normalizeWhen(text, now)
  const routeLabel = origin && destination
    ? `${origin.code || origin.label} → ${destination.code || destination.label}`
    : destination ? destination.label : 'Travel search'
  return { kind, origin, destination, whenLabel:when.label, searchWhen:when.search, routeLabel }
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

function cleanSnippet(value: string) {
  return safe(value, 260)
    .replace(/\b(?:book now|click here|promo code|checkout)\b.*$/i, '')
    .replace(/\s*[|]{1,2}\s*/g, ' · ')
    .trim()
}

export function curateTravelResults(results: WebSearchResult[], context: TravelContext) {
  const seen = new Set<string>()
  return results
    .map(result => ({ result, score:directionScore(result, context) }))
    .filter(x => x.score >= 0)
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
    .map(({result}) => ({
      title:safe(result.title, 150),
      source:sourceLabel(result.url),
      url:result.url,
      snippet:cleanSnippet(result.snippet),
    }))
}

function buildQueries(context: TravelContext, original: string) {
  if (context.kind === 'flight' && context.origin && context.destination) {
    const origin = `${context.origin.label}${context.origin.code ? ` ${context.origin.code}` : ''}`
    const dest = `${context.destination.label}${context.destination.code ? ` ${context.destination.code}` : ''}`
    return [
      `${origin} to ${dest} flights ${context.searchWhen} fares INR IndiGo Air India Akasa Google Flights`,
      `cheap flights ${origin} to ${dest} ${context.searchWhen} one way fare`,
    ]
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

export async function tryRunTravelResearch(params: { actor: AgentActor; surface: AgentSurface; text: string }) {
  if (!isPublicTravelResearchRequest(params.text)) return null

  const context = buildTravelResearchContext(params.text)
  const queries = buildQueries(context, params.text)
  const tg = params.actor.legacyTelegramId
  const now = new Date().toISOString()

  const { data: run, error: runError } = await supabaseAdmin.from('agent_runs').insert({
    telegram_id:String(tg), type:'travel_research', capability:'travel', status:'running',
    title:`Travel research · ${context.routeLabel}`, summary:'Gogo is checking current public travel sources.', progress:20,
    why:'This asks for current public travel options, not a saved ticket.', source:params.surface,
    metadata_json:{ plan_type:'travel_research', input_text:safe(params.text,1800), queries, context }, started_at:now, updated_at:now,
  }).select('id').single()
  if (runError || !run?.id) throw new Error(`travel_research_run_create_failed:${runError?.message || 'unknown'}`)

  const runId = String(run.id)
  const { data: step, error: stepError } = await supabaseAdmin.from('agent_steps').insert({
    telegram_id:String(tg), run_id:runId, ordinal:1, tool_name:'web_search', title:'Search current public travel options', status:'running',
    input_json:{ queries }, output_json:{}, started_at:now,
  }).select('id').single()
  if (stepError || !step?.id) throw new Error(`travel_research_step_create_failed:${stepError?.message || 'unknown'}`)

  await addActivity(tg, runId, 'run_started', `Gogo started current travel research for ${context.routeLabel}.`, { queries })

  try {
    const batches = await Promise.all(queries.map(q => searchWebResults(q)))
    const curated = curateTravelResults(batches.flat(), context)
    const completedAt = new Date().toISOString()
    const output = { context, results:curated }

    await supabaseAdmin.from('agent_steps').update({ status:'completed', output_json:output, completed_at:completedAt }).eq('id', String(step.id))

    const intro = `Current public search · ${context.routeLabel} · ${context.whenLabel}\nI did not use your saved tickets.`
    const text = curated.length
      ? `${intro}\n\n${curated.map((r,i) => `${i + 1}. ${r.source} — ${r.title}\n${r.snippet || 'Open the source to check the current fare and schedule.'}\n${r.url}`).join('\n\n')}\n\nThese are public-web search results, not guaranteed live inventory. Verify the exact date, baggage, cancellation terms and final INR fare before paying.`
      : `${intro}\n\nI couldn't find enough direction-matched public results to show confidently. Try exact travel dates (for example, “BLR to BOM on 16 Sep 2026”) and I’ll search again.`

    await supabaseAdmin.from('agent_runs').update({ status:'completed', summary:safe(text,1800), progress:100, completed_at:completedAt, updated_at:completedAt }).eq('id',runId).eq('telegram_id',String(tg))
    await addActivity(tg,runId,'run_completed',curated.length ? `Found ${curated.length} direction-matched public travel sources.` : 'No direction-matched public travel results found.',{result_count:curated.length,route:context.routeLabel})

    return { runId, status:'completed' as const, capability:'travel' as const, risk:'low' as const, text, handledBy:'travel-research' as const }
  } catch (error:any) {
    const message=safe(error?.message||'travel_research_failed',500);const completedAt=new Date().toISOString()
    await supabaseAdmin.from('agent_steps').update({status:'failed',error:message,completed_at:completedAt}).eq('id',String(step.id)).catch(()=>{})
    await supabaseAdmin.from('agent_runs').update({status:'failed',summary:'Gogo could not complete the current travel search.',error:message,completed_at:completedAt,updated_at:completedAt}).eq('id',runId).eq('telegram_id',String(tg)).catch(()=>{})
    await addActivity(tg,runId,'run_failed','Current travel research failed.',{error:message})
    throw error
  }
}
