type WeatherDay = {
  date: string
  maxtemp_c: number
  mintemp_c: number
  avgtemp_c: number
  maxwind_kph: number
  daily_chance_of_rain?: number | string
  condition?: {
    text?: string
  }
}

type WeatherForecastResponse = {
  location?: {
    name?: string
    region?: string
    country?: string
  }
  current?: {
    temp_c?: number
    feelslike_c?: number
    humidity?: number
    wind_kph?: number
    condition?: {
      text?: string
    }
  }
  forecast?: {
    forecastday?: Array<{
      date: string
      day: WeatherDay
    }>
  }
}

export async function fetchWeatherForecast(location: string, days = 2): Promise<WeatherForecastResponse | null> {
  const apiKey = process.env.WEATHERAPI_KEY
  if (!apiKey) {
    console.error('WEATHERAPI_KEY missing')
    return null
  }

  const url =
    `https://api.weatherapi.com/v1/forecast.json?key=${apiKey}` +
    `&q=${encodeURIComponent(location)}` +
    `&days=${days}` +
    `&aqi=no&alerts=no`

  try {
    const res = await fetch(url, { cache: 'no-store' })
    const data = await res.json()

    if (!res.ok) {
      console.error('Weather API failed:', data)
      return null
    }

    return data
  } catch (err) {
    console.error('fetchWeatherForecast failed:', err)
    return null
  }
}

export function formatCurrentWeather(data: WeatherForecastResponse) {
  const location = data.location?.name || 'the selected location'
  const current = data.current || {}

  const pieces: string[] = []
  pieces.push(`*Current weather in ${location}:*`)

  const line1: string[] = []
  if (current.condition?.text) line1.push(current.condition.text)
  if (typeof current.temp_c === 'number') line1.push(`${current.temp_c}°C`)
  if (typeof current.feelslike_c === 'number') line1.push(`feels like ${current.feelslike_c}°C`)
  if (line1.length) pieces.push(line1.join(', '))

  const line2: string[] = []
  if (typeof current.humidity === 'number') line2.push(`Humidity ${current.humidity}%`)
  if (typeof current.wind_kph === 'number') line2.push(`Wind ${current.wind_kph} km/h`)
  if (line2.length) pieces.push(line2.join(' • '))

  return pieces.join('\n')
}

export function formatTomorrowWeather(data: WeatherForecastResponse) {
  const location = data.location?.name || 'the selected location'
  const tomorrow = data.forecast?.forecastday?.[1]?.day

  if (!tomorrow) {
    return `I couldn't fetch tomorrow's weather right now. Please try again in a moment.`
  }

  const pieces: string[] = []
  pieces.push(`*Tomorrow in ${location}:*`)

  const line1: string[] = []
  if (tomorrow.condition?.text) line1.push(tomorrow.condition.text)
  if (typeof tomorrow.avgtemp_c === 'number') line1.push(`avg ${tomorrow.avgtemp_c}°C`)
  if (typeof tomorrow.maxtemp_c === 'number' && typeof tomorrow.mintemp_c === 'number') {
    line1.push(`high ${tomorrow.maxtemp_c}°C / low ${tomorrow.mintemp_c}°C`)
  }
  if (line1.length) pieces.push(line1.join(', '))

  const line2: string[] = []
  if (tomorrow.daily_chance_of_rain !== undefined) line2.push(`Rain chance ${tomorrow.daily_chance_of_rain}%`)
  if (typeof tomorrow.maxwind_kph === 'number') line2.push(`Wind up to ${tomorrow.maxwind_kph} km/h`)
  if (line2.length) pieces.push(line2.join(' • '))

  return pieces.join('\n')
}
