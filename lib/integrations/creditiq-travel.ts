import { createHmac } from 'node:crypto'

type Cabin = 'economy' | 'premium_economy' | 'business' | 'first'

export type CreditIQFlightResult = {
  id: string
  price: number | null
  currency: string
  airline: string
  from: string
  to: string
  departure: string
  arrival: string
  durationSeconds: number | null
  stops: number | null
  bookingLink: string | null
  provider: string
  cabin: Cabin
}

export type CreditIQFlightSearch = {
  live: boolean
  source: string
  coverage: Record<string, unknown> | null
  flights: CreditIQFlightResult[]
  fetchedAt: string
}

export type CreditIQHotelSearch = {
  live: boolean
  source: string
  coverage: Record<string, unknown> | null
  hotels: any[]
  fetchedAt: string
  requiresServiceAuth?: boolean
}

function baseUrl() {
  return String(process.env.CREDITIQ_TRAVEL_BASE_URL || 'https://creditiq.app').replace(/\/+$/, '')
}

function clean(value: unknown, max = 500) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function normalizeCabin(value: string | undefined): Cabin {
  const v = String(value || 'economy').toLowerCase().replace(/[ -]+/g, '_')
  return ['premium_economy','business','first'].includes(v) ? v as Cabin : 'economy'
}

function finiteNumber(value: unknown): number | null {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function serviceSecret() {
  return String(process.env.CREDITIQ_GOGO_SERVICE_SECRET || '').trim()
}

function signedServiceHeaders(rawBody: string) {
  const secret = serviceSecret()
  if (!secret) return null
  const timestamp = String(Date.now())
  const signature = createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex')
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'X-Gogo-Timestamp': timestamp,
    'X-Gogo-Signature': signature,
    'User-Agent': 'AskGogo-Travel-Bridge/1.0',
  }
}

/**
 * Cash/live flight inventory bridge into the existing CreditIQ provider stack.
 *
 * CreditIQ owns provider orchestration, coverage/freshness labels and booking links.
 * Gogo owns intent, mission orchestration, approvals, memory and follow-up actions.
 *
 * This intentionally degrades to null: AskGogo must fall back honestly rather than
 * turn a CreditIQ outage into a fake "live fare" claim.
 */
export async function searchCreditIQLiveFlights(params: {
  from: string
  to: string
  date: string
  dateTo?: string
  cabin?: string
}): Promise<CreditIQFlightSearch | null> {
  const from = clean(params.from, 3).toUpperCase()
  const to = clean(params.to, 3).toUpperCase()
  const date = clean(params.date, 10)
  const dateTo = clean(params.dateTo || params.date, 10)
  const cabin = normalizeCabin(params.cabin)
  if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to) || !/^20\d{2}-\d{2}-\d{2}$/.test(date)) return null

  const url = new URL(`${baseUrl()}/api/flights/search`)
  url.searchParams.set('from', from)
  url.searchParams.set('to', to)
  url.searchParams.set('date_from', date)
  url.searchParams.set('date_to', dateTo)
  url.searchParams.set('cabin', cabin)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json', 'User-Agent': 'AskGogo-Travel-Bridge/1.0' },
      signal: controller.signal,
      cache: 'no-store',
    })
    if (!response.ok) return null
    const body: any = await response.json().catch(() => null)
    if (!body || !Array.isArray(body.flights) || body.flights.length === 0) return null
    const source = clean(body.source || body.coverage?.provider || 'creditiq', 80)
    const flights: CreditIQFlightResult[] = body.flights.slice(0, 30).map((f: any, index: number) => ({
      id: clean(f.id || `${source}-${index}`, 180),
      price: finiteNumber(f.price ?? f.amount ?? f.totalPrice),
      currency: clean(f.currency || body.providerCurrency || 'INR', 8).toUpperCase() || 'INR',
      airline: clean(f.airline || f.airlines?.[0] || 'Multiple', 120),
      from: clean(f.from || from, 8).toUpperCase(),
      to: clean(f.to || to, 8).toUpperCase(),
      departure: clean(f.departure || f.departureAt || '', 80),
      arrival: clean(f.arrival || f.arrivalAt || '', 80),
      durationSeconds: finiteNumber(f.durationSeconds ?? (Number.isFinite(Number(f.duration)) ? Number(f.duration) * 3600 : null)),
      stops: finiteNumber(f.stops),
      bookingLink: f.bookingLink || f.deep_link || f.deeplink ? clean(f.bookingLink || f.deep_link || f.deeplink, 1200) : null,
      provider: clean(f.provider || source, 80),
      cabin,
    }))

    return {
      live: true,
      source,
      coverage: body.coverage && typeof body.coverage === 'object' ? body.coverage : null,
      flights,
      fetchedAt: clean(body.coverage?.fetched_at || new Date().toISOString(), 80),
    }
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Signed, read-only hotel bridge into CreditIQ's existing Booking.com / Skyscanner /
 * Hotelbeds provider orchestration. The shared secret is server-only; no end-user
 * CreditIQ cookie/session is copied into AskGogo.
 */
export async function searchCreditIQLiveHotels(params: {
  destination: string
  checkin: string
  checkout: string
  adults?: number
  rooms?: number
}): Promise<CreditIQHotelSearch | null> {
  const rawBody = JSON.stringify({
    destination: clean(params.destination, 160),
    checkin: clean(params.checkin, 10),
    checkout: clean(params.checkout, 10),
    adults: Math.max(1, Math.min(9, Number(params.adults || 1))),
    rooms: Math.max(1, Math.min(5, Number(params.rooms || 1))),
    limit: 30,
  })
  const headers = signedServiceHeaders(rawBody)
  if (!headers) {
    return { live:false, source:'creditiq', coverage:null, hotels:[], fetchedAt:new Date().toISOString(), requiresServiceAuth:true }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)
  try {
    const response = await fetch(`${baseUrl()}/api/internal/gogo/travel/hotels`, {
      method: 'POST',
      headers,
      body: rawBody,
      signal: controller.signal,
      cache: 'no-store',
    })
    if (!response.ok) return null
    const body: any = await response.json().catch(() => null)
    const hotels = Array.isArray(body?.hotels) ? body.hotels : Array.isArray(body?.offers) ? body.offers : []
    if (!hotels.length) return null
    return {
      live:true,
      source:clean(body?.coverage?.provider || body?.source || 'creditiq',80),
      coverage:body?.coverage && typeof body.coverage === 'object' ? body.coverage : null,
      hotels:hotels.slice(0,50),
      fetchedAt:clean(body?.coverage?.fetched_at || new Date().toISOString(),80),
    }
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}
