function normalize(text: string) {
  return (text || '').replace(/\s+/g, ' ').trim()
}

function extractWeatherApiBlock(searchContext: string) {
  const match = searchContext.match(/\{[\s\S]*?'current':\s*\{[\s\S]*?\}\}/)
  return match ? match[0] : ''
}

function extractValue(block: string, pattern: RegExp) {
  const m = block.match(pattern)
  return m?.[1] || null
}

export function formatWeatherAnswer(userText: string, searchContext: string) {
  const raw = searchContext || ''
  const block = extractWeatherApiBlock(raw)

  if (block) {
    const location =
      extractValue(block, /'name':\s*'([^']+)'/) ||
      extractValue(block, /"name":\s*"([^"]+)"/) ||
      'the selected location'

    const tempC =
      extractValue(block, /'tempc':\s*([\d.]+)/i) ||
      extractValue(block, /"tempc":\s*([\d.]+)/i)

    const feelsC =
      extractValue(block, /'feelslikec':\s*([\d.]+)/i) ||
      extractValue(block, /"feelslikec":\s*([\d.]+)/i)

    const humidity =
      extractValue(block, /'humidity':\s*(\d+)/i) ||
      extractValue(block, /"humidity":\s*(\d+)/i)

    const condition =
      extractValue(block, /'text':\s*'([^']+)'/) ||
      extractValue(block, /"text":\s*"([^"]+)"/)

    const windKph =
      extractValue(block, /'windkph':\s*([\d.]+)/i) ||
      extractValue(block, /"windkph":\s*([\d.]+)/i)

    const pieces: string[] = []

    if (/tmrw|tomorrow/i.test(userText)) {
      pieces.push(`*Weather for ${location}:*`)
    } else {
      pieces.push(`*Current weather in ${location}:*`)
    }

    const line1: string[] = []
    if (condition) line1.push(condition)
    if (tempC) line1.push(`${tempC}°C`)
    if (feelsC) line1.push(`feels like ${feelsC}°C`)
    if (line1.length) pieces.push(line1.join(', '))

    const line2: string[] = []
    if (humidity) line2.push(`Humidity ${humidity}%`)
    if (windKph) line2.push(`Wind ${windKph} km/h`)
    if (line2.length) pieces.push(line2.join(' • '))

    return pieces.join('\n')
  }

  const firstBlock = raw
    .split(/\n\s*\n/)
    .map((x) => normalize(x))
    .filter(Boolean)[0]

  if (firstBlock) {
    return `*Weather update:*\n${firstBlock}`
  }

  return `I couldn't fetch the weather right now. Please try again in a moment.`
}
