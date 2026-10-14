import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/dashboard/session'
import { parseApproxLocation, locationQuery } from '@/lib/dashboard/approx-location'
import { fetchWeatherForecast } from '@/lib/services/weather'

// Turns a rounded position into a city name for the "approx." tag. Nothing is saved: the position is not
// written to the database or the logs. Weather is already the provider that receives a place when the
// person asks for weather, so no new third party sees the position.
function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get('origin')
  if (!origin) return false
  try { return new URL(origin).host === req.nextUrl.host } catch { return false }
}

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => null) as any
  const location = parseApproxLocation(body)
  if (!location) return NextResponse.json({ error: 'invalid_location' }, { status: 400 })
  const forecast = await fetchWeatherForecast(locationQuery(location), 1).catch(() => null)
  const label = String(forecast?.location?.name || '').trim().slice(0, 80)
  return NextResponse.json({ lat: location.lat, lon: location.lon, label: label || null })
}
