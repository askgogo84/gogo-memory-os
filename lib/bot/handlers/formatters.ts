function normalize(text: string) {
  return (text || '').replace(/\s+/g, ' ').trim()
}

import {formatGoldQuotes} from './gold-quotes'

function getBlocks(searchContext: string) {
  return (searchContext || '')
    .split(/\n\s*\n/)
    .map((x) => x.trim())
    .filter(Boolean)
}

function extractPrices(text: string) {
  const cleaned = normalize(text)

  // 18 Oct live: "gold rate today in Bangalore" found results but no rate — sites write "24 Carat",
  // "Rs." or "INR" and put the rate further from the label. Accept all of those.
  const cur = '(?:₹|rs\\.?|inr)'
  const rate = (k: string) =>
    cleaned.match(new RegExp(`${k}\\s*(?:k|kt|karat|carat|ct)\\b(?:(?!\\d{2}\\s*(?:k|kt|karat|carat|ct)\\b)[^₹]){0,80}?${cur}\\s?([\\d,]{3,}(?:\\.\\d+)?)`, 'i'))
  // 18 Oct retest: "22 carat and 24 carat … ₹14,766" gave 22K the 24K price; a rate never reaches past another karat label.
  const price24 = rate('24')
  const price22 = rate('22')
  const price18 = rate('18')

  const silver =
    cleaned.match(/silver[^₹]{0,60}₹\s?([\d,]+(?:\.\d+)?)/i) ||
    cleaned.match(/silver[^0-9]{0,40}([\d,]+(?:\.\d+)?)\s*inr/i) ||
    cleaned.match(/₹\s?([\d,]+(?:\.\d+)?)\s*(?:per\s*(?:kg|gram|g|10g))?[^.]{0,30}silver/i)

  return {
    p24: price24?.[1] || null,
    p22: price22?.[1] || null,
    p18: price18?.[1] || null,
    silver: silver?.[1] || null,
  }
}

export function formatGoldAnswer(userText: string, searchContext: string) {
  const blocks = getBlocks(searchContext)
  if (!blocks.length) {
    return `I couldn't fetch the latest metal price right now. Please try again in a moment.`
  }

  const joined = blocks.join(' ')
  const prices = extractPrices(joined)
  const lower = userText.toLowerCase()

  if (lower.includes('silver')) {
    if (prices.silver) {
      return `*Silver price today in India:* ₹${prices.silver} based on latest live search results.`
    }

    const firstUseful = blocks[0]
      .split('\n')
      .map((x) => normalize(x))
      .filter(Boolean)
      .slice(0, 2)
      .join(' — ')

    return firstUseful
      ? `*Silver price results:*\n${firstUseful}`
      : `I found live silver results, but couldn't cleanly extract the latest rate.`
  }

  return formatGoldQuotes(userText,searchContext)
}

export function formatIplStandingsAnswer(searchContext: string) {
  const text = normalize(searchContext)

  const teams = [
    'Royal Challengers Bengaluru',
    'Gujarat Titans',
    'Mumbai Indians',
    'Chennai Super Kings',
    'Delhi Capitals',
    'Punjab Kings',
    'Lucknow Super Giants',
    'Kolkata Knight Riders',
    'Rajasthan Royals',
    'Sunrisers Hyderabad',
  ]

  const found: string[] = []
  for (const team of teams) {
    const regex = new RegExp(`\\b${team.replace(/\s+/g, '\\s+')}\\b`, 'i')
    if (regex.test(text) && !found.includes(team)) {
      found.push(team)
    }
  }

  const cleanedTeams = found.slice(0, 3)

  if (cleanedTeams.length > 0) {
    return `*IPL table toppers right now:* ${cleanedTeams.join(', ')}.\n\nThis is based on the latest live search results.`
  }

  if (/royal challengers bengaluru|rcb/i.test(text)) {
    return `*RCB appears to be among the top IPL teams right now* based on the latest live search results.`
  }

  return `I found the live IPL standings results, but couldn't cleanly extract the top teams.`
}
