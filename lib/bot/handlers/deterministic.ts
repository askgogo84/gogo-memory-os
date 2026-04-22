import { searchWeb } from '@/lib/web-search'
import { formatGoldAnswer, formatIplStandingsAnswer } from './formatters'
import { fetchWeatherForecast, formatCurrentWeather, formatTomorrowWeather } from '@/lib/services/weather'

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

function titleCase(input: string) {
  return input
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

function extractWeatherLocation(userText: string) {
  const raw = (userText || '').trim()

  const patterns = [
    /\bweather\s+in\s+([a-zA-Z\s]+?)(?:\s+tomorrow|\s+tmrw|\s+today|\?|$)/i,
    /\brain\s+in\s+([a-zA-Z\s]+?)(?:\s+tomorrow|\s+tmrw|\s+today|\?|$)/i,
    /\btemperature\s+in\s+([a-zA-Z\s]+?)(?:\s+tomorrow|\s+tmrw|\s+today|\?|$)/i,
    /\bin\s+([a-zA-Z\s]+?)(?:\s+weather|\s+temperature|\s+rain|\s+today|\s+tomorrow|\s+tmrw|\?|$)/i,
  ]

  for (const pattern of patterns) {
    const match = raw.match(pattern)
    if (match?.[1]) {
      const cleaned = match[1]
        .replace(/\b(today|tomorrow|tmrw|now|right now)\b/gi, '')
        .replace(/[^\p{L}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim()

      if (cleaned) return titleCase(cleaned)
    }
  }

  return 'Bangalore'
}

export async function buildDeterministicWeatherReply(userText: string) {
  const location = extractWeatherLocation(userText)
  const forecast = await fetchWeatherForecast(location, 2)

  if (!forecast) {
    return `I couldn't fetch the weather for ${location} right now. Please try again in a moment.`
  }

  if (/tmrw|tomorrow/i.test(userText)) {
    return formatTomorrowWeather(forecast)
  }

  return formatCurrentWeather(forecast)
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
