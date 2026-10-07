import Anthropic from '@anthropic-ai/sdk'
import { runSecureBrowser } from './secure-computer'
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
  route: string
  evidence: string
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
    })
    const text = res.content[0]?.type === 'text' ? res.content[0].text : ''
    return parseJsonArray(text).filter(value => String(value?.route || '').replace(/\s+/g,' ').trim() === context.routeLabel)
      .map(value => normalizeBrowserFlightOption(value, pageText)).filter(Boolean) as BrowserFlightOption[]
  } catch (error:any) {
    console.error('TRAVEL_BROWSER_EXTRACT_FAILED:', error?.message || error)
    return []
  }
}

export async function runLiveFlightBrowserTask(params: {
  actor: AgentActor
  context: BrowserFlightContext
  objective: string
}) {
  const { context } = params
  if (!context.origin?.code || !context.destination?.code || !context.startDate) return null

  const query = `One-way ${context.nonStop ? 'non-stop ' : ''}flights from ${context.origin.code} to ${context.destination.code} on ${context.startDate} for ${context.adults || 1} adult${context.adults === 1 ? '' : 's'} in ${(context.cabin || 'economy').replace(/_/g, ' ')}`
  const url = `https://www.google.com/travel/flights?hl=en&curr=INR&q=${encodeURIComponent(query)}`
  let result: Awaited<ReturnType<typeof runSecureBrowser>>
  try { result = await runSecureBrowser({
    userId:params.actor.userId,
    url,
    objective:`Read actual flight rows for ${query}. User research criteria: ${params.objective}. Verify the selected route, departure date, passengers and cabin using the visible search controls before reporting airline, departure, arrival and INR fare evidence. Do not book, purchase, sign in or submit passenger/payment information.`,
    mode:'read',
  }) } catch (error: any) {
    // Browser verification/timeouts are expected provider failures. The travel
    // orchestrator must still deliver its clearly labelled public-source fallback.
    console.warn('TRAVEL_BROWSER_READ_FAILED:', String(error?.message || 'browser_read_failed').slice(0, 200))
    return {status: 'failed' as const, options: [] as BrowserFlightOption[], browser: null, source: 'google-flights-browser' as const}
  }

  if (result.status === 'blocked') {
    return { status:'blocked' as const, options:[] as BrowserFlightOption[], browser:result, source:'google-flights-browser' as const }
  }
  const options = (await extractFlightOptions(result.pageText, context)).filter(option => !context.nonStop || option.stops === 0)
  return { status:'completed' as const, options, browser:result, source:'google-flights-browser' as const }
}
