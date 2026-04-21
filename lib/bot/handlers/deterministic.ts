import { searchWeb } from '@/lib/web-search'
import { buildDirectWebAnswer } from './web-answer'
import { formatGoldAnswer, formatIplStandingsAnswer } from './formatters'
import { formatWeatherAnswer } from './weather-format'

function normalize(text: string) {
  return (text || '').toLowerCase().trim()
}

export function isWeatherQuery(text: string) {
  const t = normalize(text)
  return t.includes('weather') || t.includes('temperature') || t.includes('rain')
}

export function isGoldQuery(text: string) {
  const t = normalize(text)
  return (
    t.includes('gold price') ||
    t.includes('gold rate') ||
    t.includes('silver price') ||
    t.includes('silver rate')
  )
}

export function isIplStandingsQuery(text: string) {
  const t = normalize(text)
  return (
    t.includes('ipl table') ||
    t.includes('points table') ||
    t.includes('table toppers') ||
    t.includes('ipl standings') ||
    t.includes('ipl topper')
  )
}

export async function buildDeterministicWeatherReply(userText: string) {
  const query = /tmrw|tomorrow/i.test(userText) ? 'weather forecast tomorrow Bangalore' : (userText.toLowerCase().includes('bangalore') ? 'weather Bangalore' : userText)

  const context = await searchWeb(query)

  if (!context.trim()) {
    return `I couldn't fetch the weather right now. Please try again in a moment.`
  }

  return formatWeatherAnswer(userText, context)
}

export async function buildDeterministicGoldReply(userText: string) {
  const t = normalize(userText)
  const query = t.includes('silver')
    ? 'silver price today in india'
    : 'gold price today in india'

  const context = await searchWeb(query)

  if (!context.trim()) {
    return `I couldn't fetch the latest metal price right now. Please try again in a moment.`
  }

  return formatGoldAnswer(userText, context)
}

export async function buildDeterministicIplStandingsReply(userText: string) {
  const query = 'IPL 2026 points table standings top teams'
  const context = await searchWeb(query)

  if (!context.trim()) {
    return `I couldn't fetch the live IPL table right now. Please try again in a moment.`
  }

  return formatIplStandingsAnswer(context)
}

