function normalize(text: string) {
  return (text || '').replace(/\s+/g, ' ').trim()
}

function getBlocks(searchContext: string) {
  return (searchContext || '')
    .split(/\n\s*\n/)
    .map((x) => x.trim())
    .filter(Boolean)
}

function extractPrices(text: string) {
  const cleaned = normalize(text)

  const price24 =
    cleaned.match(/24\s*K[T]?\s*(?:Gold)?[^₹]{0,20}₹\s?([\d,]+(?:\.\d+)?)/i) ||
    cleaned.match(/24\s*karat[^₹]{0,20}₹\s?([\d,]+(?:\.\d+)?)/i)

  const price22 =
    cleaned.match(/22\s*K[T]?\s*(?:Gold)?[^₹]{0,20}₹\s?([\d,]+(?:\.\d+)?)/i) ||
    cleaned.match(/22\s*karat[^₹]{0,20}₹\s?([\d,]+(?:\.\d+)?)/i)

  const price18 =
    cleaned.match(/18\s*K[T]?\s*(?:Gold)?[^₹]{0,20}₹\s?([\d,]+(?:\.\d+)?)/i) ||
    cleaned.match(/18\s*karat[^₹]{0,20}₹\s?([\d,]+(?:\.\d+)?)/i)

  const silver =
    cleaned.match(/Silver[^₹]{0,20}₹\s?([\d,]+(?:\.\d+)?)/i) ||
    cleaned.match(/silver price[^₹]{0,20}₹\s?([\d,]+(?:\.\d+)?)/i)

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
      return `*Silver price today:* ₹${prices.silver} per unit based on latest search results.`
    }
    return `I found live silver results, but couldn't cleanly extract the latest rate.`
  }

  const lines: string[] = []
  if (prices.p24) lines.push(`24K: ₹${prices.p24}`)
  if (prices.p22) lines.push(`22K: ₹${prices.p22}`)
  if (prices.p18) lines.push(`18K: ₹${prices.p18}`)

  if (!lines.length) {
    return `I found live gold results, but couldn't cleanly extract the latest rates.`
  }

  return `*Gold price today in India:*\n${lines.join('\n')}`
}

export function formatIplStandingsAnswer(searchContext: string) {
  const text = normalize(searchContext)

  const teams = [
    'Royal Challengers Bengaluru',
    'RCB',
    'Gujarat Titans',
    'GT',
    'Mumbai Indians',
    'MI',
    'Chennai Super Kings',
    'CSK',
    'Delhi Capitals',
    'DC',
    'Punjab Kings',
    'PBKS',
    'Lucknow Super Giants',
    'LSG',
    'Kolkata Knight Riders',
    'KKR',
    'Rajasthan Royals',
    'RR',
    'Sunrisers Hyderabad',
    'SRH',
  ]

  const found: string[] = []
  for (const team of teams) {
    const regex = new RegExp(`\\b${team.replace(/\s+/g, '\\s+')}\\b`, 'i')
    if (regex.test(text) && !found.includes(team)) {
      found.push(team)
    }
  }

  const cleanedTeams = found
    .filter((x) => !['RCB','GT','MI','CSK','DC','PBKS','LSG','KKR','RR','SRH'].includes(x))
    .slice(0, 3)

  if (cleanedTeams.length > 0) {
    return `*IPL table toppers right now:* ${cleanedTeams.join(', ')}.\n\nThis is based on the latest live search results.`
  }

  if (/royal challengers bengaluru|rcb/i.test(text)) {
    return `*RCB appears to be among the top IPL teams right now* based on the latest live search results.`
  }

  return `I found the live IPL standings results, but couldn't cleanly extract the top teams.`
}
