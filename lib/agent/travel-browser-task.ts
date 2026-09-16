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

function normalizeOption(value: any): BrowserFlightOption | null {
  const airline = String(value?.airline || '').trim().slice(0, 120)
  const departure = String(value?.departure || '').trim().slice(0, 120)
  const arrival = String(value?.arrival || '').trim().slice(0, 120)
  const route = String(value?.route || '').trim().slice(0, 180)
  const evidence = String(value?.evidence || '').replace(/\s+/g, ' ').trim().slice(0, 300)
  if (!airline || !departure || !arrival || !evidence) return null
  const stopsRaw = value?.stops
  const stops = Number.isFinite(Number(stopsRaw)) ? Math.max(0, Math.min(5, Number(stopsRaw))) : null
  const fareRaw = Number(String(value?.fareInr ?? '').replace(/[^0-9.]/g, ''))
  const fareInr = Number.isFinite(fareRaw) && fareRaw > 0 ? Math.round(fareRaw) : null
  return { airline, departure, arrival, stops, fareInr, route, evidence }
}

async function extractFlightOptions(pageText: string, context: BrowserFlightContext) {
  const prompt = `Extract only flight options that are explicitly visible in this browser page text. Do not infer or invent anything. Requested route: ${context.routeLabel}. Requested date: ${context.whenLabel}. Return JSON array only. Each item: {"airline":"","departure":"","arrival":"","stops":0,"fareInr":0,"route":"","evidence":"short exact supporting fragment"}. If the page does not contain actual flight rows with airline + departure + arrival, return []. fareInr must be numeric INR only when clearly shown. Page text: ${JSON.stringify(String(pageText || '').slice(0,14000))}`
  try {
    const res = await anthropic.messages.create({
      model:'claude-haiku-4-5', max_tokens:2200, temperature:0,
      messages:[{role:'user',content:prompt}],
    })
    const text = res.content[0]?.type === 'text' ? res.content[0].text : ''
    return parseJsonArray(text).map(normalizeOption).filter(Boolean) as BrowserFlightOption[]
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

  const query = `Flights from ${context.origin.code} to ${context.destination.code} on ${context.startDate}`
  const url = `https://www.google.com/travel/flights?hl=en&curr=INR&q=${encodeURIComponent(query)}`
  const result = await runSecureBrowser({
    userId:params.actor.userId,
    url,
    objective:`Complete this research task in the browser: ${params.objective}. Use the page controls as needed to obtain actual results for ${context.routeLabel} on ${context.startDate}. Do not book, purchase, sign in or submit passenger/payment information.`,
    mode:'read',
  })

  if (result.status === 'blocked') {
    return { status:'blocked' as const, options:[] as BrowserFlightOption[], browser:result, source:'google-flights-browser' as const }
  }
  const options = await extractFlightOptions(result.pageText, context)
  return { status:'completed' as const, options, browser:result, source:'google-flights-browser' as const }
}
