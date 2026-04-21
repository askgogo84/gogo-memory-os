function normalize(text: string) {
  return (text || '').replace(/\s+/g, ' ').trim()
}

function extractValue(block: string, pattern: RegExp) {
  const m = block.match(pattern)
  return m?.[1] || null
}

function extractForecastDay(raw: string) {
  const forecastBlockMatch =
    raw.match(/forecastday[\s\S]*?\{[\s\S]*?maxtempc[\s\S]*?mintempc[\s\S]*?\}/i)

  if (!forecastBlockMatch) return ''

  return forecastBlockMatch[0]
}

function extractCurrentBlock(raw: string) {
  const match = raw.match(/\{[\s\S]*?'current':\s*\{[\s\S]*?\}\}/)
  return match ? match[0] : ''
}

export function formatWeatherAnswer(userText: string, searchContext: string) {
  const raw = searchContext || ''
  const lower = userText.toLowerCase()
  const wantsTomorrow = /tmrw|tomorrow/i.test(lower)

  const location =
    extractValue(raw, /'name':\s*'([^']+)'/i) ||
    extractValue(raw, /"name":\s*"([^"]+)"/i) ||
    'the selected location'

  if (wantsTomorrow) {
    const forecastBlock = extractForecastDay(raw)

    if (forecastBlock) {
      const maxTemp =
        extractValue(forecastBlock, /'maxtempc':\s*([\d.]+)/i) ||
        extractValue(forecastBlock, /"maxtempc":\s*([\d.]+)/i)

      const minTemp =
        extractValue(forecastBlock, /'mintempc':\s*([\d.]+)/i) ||
        extractValue(forecastBlock, /"mintempc":\s*([\d.]+)/i)

      const avgTemp =
        extractValue(forecastBlock, /'avgtempc':\s*([\d.]+)/i) ||
        extractValue(forecastBlock, /"avgtempc":\s*([\d.]+)/i)

      const maxWind =
        extractValue(forecastBlock, /'maxwindkph':\s*([\d.]+)/i) ||
        extractValue(forecastBlock, /"maxwindkph":\s*([\d.]+)/i)

      const rainChance =
        extractValue(forecastBlock, /'daily_chance_of_rain':\s*'?(.*?)'?(,|\})/i) ||
        extractValue(forecastBlock, /"daily_chance_of_rain":\s*"?(.*?)"?(,|\})/i)

      const condition =
        extractValue(forecastBlock, /'text':\s*'([^']+)'/i) ||
        extractValue(forecastBlock, /"text":\s*"([^"]+)"/i)

      const pieces: string[] = []
      pieces.push(`*Tomorrow in ${location}:*`)

      const line1: string[] = []
      if (condition) line1.push(condition)
      if (avgTemp) line1.push(`avg ${avgTemp}°C`)
      if (maxTemp && minTemp) line1.push(`high ${maxTemp}°C / low ${minTemp}°C`)
      if (line1.length) pieces.push(line1.join(', '))

      const line2: string[] = []
      if (rainChance && rainChance !== 'null') line2.push(`Rain chance ${rainChance}%`)
      if (maxWind) line2.push(`Wind up to ${maxWind} km/h`)
      if (line2.length) pieces.push(line2.join(' • '))

      return pieces.join('\n')
    }
  }

  const currentBlock = extractCurrentBlock(raw)

  if (currentBlock) {
    const tempC =
      extractValue(currentBlock, /'tempc':\s*([\d.]+)/i) ||
      extractValue(currentBlock, /"tempc":\s*([\d.]+)/i)

    const feelsC =
      extractValue(currentBlock, /'feelslikec':\s*([\d.]+)/i) ||
      extractValue(currentBlock, /"feelslikec":\s*([\d.]+)/i)

    const humidity =
      extractValue(currentBlock, /'humidity':\s*(\d+)/i) ||
      extractValue(currentBlock, /"humidity":\s*(\d+)/i)

    const condition =
      extractValue(currentBlock, /'text':\s*'([^']+)'/i) ||
      extractValue(currentBlock, /"text":\s*"([^"]+)"/i)

    const windKph =
      extractValue(currentBlock, /'windkph':\s*([\d.]+)/i) ||
      extractValue(currentBlock, /"windkph":\s*([\d.]+)/i)

    const pieces: string[] = []
    pieces.push(`*Current weather in ${location}:*`)

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
