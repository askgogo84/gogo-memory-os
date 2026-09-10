import { supabaseAdmin } from '@/lib/supabase-admin'
import { buildTravelResearchContext } from './travel-research'

const MONTHS: Record<string, number> = {
  jan:0,january:0,feb:1,february:1,mar:2,march:2,apr:3,april:3,may:4,jun:5,june:5,
  jul:6,july:6,aug:7,august:7,sep:8,sept:8,september:8,oct:9,october:9,nov:10,november:10,dec:11,december:11,
}

function isoDay(date: Date) { return date.toISOString().slice(0,10) }

function parseDates(text: string, defaultYear: number) {
  const out: Date[] = []
  const add = (year:number, month:number, day:number) => {
    const d = new Date(Date.UTC(year,month,day))
    if (d.getUTCFullYear() === year && d.getUTCMonth() === month && d.getUTCDate() === day) out.push(d)
  }
  let m: RegExpExecArray | null
  const dayMonth = /\b(\d{1,2})\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:[,\s]+(20\d{2}))?/gi
  while ((m = dayMonth.exec(text))) add(Number(m[3] || defaultYear), MONTHS[m[2].toLowerCase()], Number(m[1]))
  const monthDay = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:[,\s]+(20\d{2}))?/gi
  while ((m = monthDay.exec(text))) add(Number(m[3] || defaultYear), MONTHS[m[1].toLowerCase()], Number(m[2]))
  const numeric = /\b(\d{1,2})[\/-](\d{1,2})[\/-](20\d{2})\b/g
  while ((m = numeric.exec(text))) add(Number(m[3]), Number(m[2]) - 1, Number(m[1]))
  return [...new Map(out.map(d => [isoDay(d), d])).values()]
}

function stripInrPrices(text: string) {
  return text
    .replace(/(?:₹|INR\s*|Rs\.?\s*)[\d,]+(?:\.\d{1,2})?/gi, 'fare not verified')
    .replace(/\bfare not verified\s*(?:\+|from|onwards)?/gi, 'fare not verified')
    .replace(/\s{2,}/g, ' ')
}

export function sanitizeTravelResearchText(raw: string, requestText: string, now = new Date()) {
  const context = buildTravelResearchContext(requestText, now)
  if (!context.startDate || !context.endDate) return raw

  const blocks = String(raw || '').split(/\n\n+/)
  const intro = blocks.filter(b => !/^\d+\./.test(b.trim()) && !/^These are public-web/.test(b.trim()))[0] || ''
  const disclaimer = blocks.find(b => /^These are public-web/.test(b.trim())) || ''
  const defaultYear = Number(context.startDate.slice(0,4))

  const kept = blocks
    .filter(b => /^\d+\./.test(b.trim()))
    .map(block => {
      const dates = parseDates(block, defaultYear)
      const hasDates = dates.length > 0
      const inWindow = dates.filter(d => {
        const iso = isoDay(d)
        return iso >= context.startDate! && iso <= context.endDate!
      })
      // Any explicit off-window date makes the whole search snippet unreliable for this request.
      if (hasDates && inWindow.length !== dates.length) return null

      let cleaned = block
      if (!hasDates) {
        cleaned = stripInrPrices(cleaned)
        cleaned = cleaned.replace(/Public snippet mentions[^\n]*/i, 'INR fare: not verified for your requested dates')
        cleaned = cleaned.replace(/INR fare:[^\n]*/i, 'INR fare: not verified for your requested dates')
      }
      return cleaned
    })
    .filter(Boolean) as string[]

  const renumbered = kept.map((block, index) => block.replace(/^\d+\./, `${index + 1}.`))
  if (!renumbered.length) {
    return `${intro}\n\nI could not find a public-web result whose explicit dates stay entirely inside ${context.whenLabel}. I will not show a fare from another week. Try an exact date such as “BLR to BOM on 16 Sep 2026”.`
  }
  return [intro, ...renumbered, disclaimer].filter(Boolean).join('\n\n')
}

export async function hardenTravelResearchResult<T extends { runId?: string; text?: string }>(result: T, requestText: string) {
  if (!result?.text) return result
  const text = sanitizeTravelResearchText(result.text, requestText)
  if (result.runId && text !== result.text) {
    await supabaseAdmin.from('agent_runs').update({ summary: text.slice(0,1800), updated_at:new Date().toISOString() }).eq('id', result.runId)
  }
  return { ...result, text }
}
