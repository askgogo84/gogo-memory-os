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
  live: boolean
  cashFareVerifiedForCabin: boolean
  awardGuide: any | null
  redemption: any | null
}

export type CreditIQFlightSearch = {
  live: boolean
  source: string
  coverage: Record<string, unknown> | null
  flights: CreditIQFlightResult[]
  fetchedAt: string
  identity?: {
    linked: boolean
    pointsAware: boolean
    walletCards: number
    verifiedBalances: number
  }
  bookingPolicy?: {
    mode: string
    requiresRepriceBeforeBooking: boolean
    irreversiblePointsTransferAllowed: boolean
  }
  requiresServiceAuth?: boolean
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
    'User-Agent': 'AskGogo-Travel-Bridge/2.0',
  }
}

/**
 * Signed CreditIQ flight + rewards decision bridge.
 *
 * CreditIQ owns live provider orchestration, wallet balances, sourced redemption
 * rails and cash-vs-points decisioning. AskGogo sends only an already-linked
 * CreditIQ user id and the travel intent. No CreditIQ cookie/session or card
 * credential crosses the boundary. The response stays read-only and a provider
 * handoff is always repriced before any later approved booking action.
 */
export async function searchCreditIQLiveFlights(params: {
  from: string
  to: string
  date: string
  dateTo?: string
  cabin?: string
  adults?: number
  userLinkId?: string | null
}): Promise<CreditIQFlightSearch | null> {
  const from = clean(params.from, 3).toUpperCase()
  const to = clean(params.to, 3).toUpperCase()
  const date = clean(params.date, 10)
  const dateTo = clean(params.dateTo || params.date, 10)
  const cabin = normalizeCabin(params.cabin)
  if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to) || !/^20\d{2}-\d{2}-\d{2}$/.test(date)) return null

  const rawBody = JSON.stringify({
    userLinkId: clean(params.userLinkId || '', 200) || null,
    type: 'flight',
    origin: from,
    destination: to,
    departDate: date,
    returnDate: dateTo !== date ? dateTo : null,
    cabin,
    adults: Math.max(1, Math.min(9, Number(params.adults || 1))),
    limit: 20,
    preferences: null,
  })
  const headers = signedServiceHeaders(rawBody)
  if (!headers) {
    return {
      live:false,
      source:'creditiq',
      coverage:null,
      flights:[],
      fetchedAt:new Date().toISOString(),
      requiresServiceAuth:true,
    }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20_000)
  try {
    const response = await fetch(`${baseUrl()}/api/internal/gogo/travel/flights`, {
      method: 'POST',
      headers,
      body: rawBody,
      signal: controller.signal,
      cache: 'no-store',
    })
    if (!response.ok) return null
    const body: any = await response.json().catch(() => null)
    if (!body || body?.contract !== 'gogo-creditiq-travel-v1' || !Array.isArray(body.flights)) return null

    const source = clean(body?.inventory?.source || 'creditiq', 80)
    const live = body?.inventory?.live === true
    const flights: CreditIQFlightResult[] = body.flights.slice(0, 30).map((f: any, index: number) => ({
      id: clean(f.id || `${source}-${index}`, 180),
      price: finiteNumber(f.price),
      currency: clean(f.currency || 'INR', 8).toUpperCase() || 'INR',
      airline: clean(f.airline || 'Multiple', 120),
      from: clean(f.from || from, 8).toUpperCase(),
      to: clean(f.to || to, 8).toUpperCase(),
      departure: clean(f.departure || '', 80),
      arrival: clean(f.arrival || '', 80),
      durationSeconds: finiteNumber(f.durationSeconds),
      stops: finiteNumber(f.stops),
      bookingLink: f.bookingLink ? clean(f.bookingLink, 1200) : null,
      provider: clean(f.provider || source, 80),
      cabin,
      live: f.live === true && live,
      cashFareVerifiedForCabin: f.cashFareVerifiedForCabin === true,
      awardGuide: f.awardGuide && typeof f.awardGuide === 'object' ? f.awardGuide : null,
      redemption: f.redemption && typeof f.redemption === 'object' ? f.redemption : null,
    }))

    return {
      live,
      source,
      coverage: body?.inventory?.coverage && typeof body.inventory.coverage === 'object' ? body.inventory.coverage : null,
      flights,
      fetchedAt: clean(body?.inventory?.fetchedAt || new Date().toISOString(), 80),
      identity: body?.identity && typeof body.identity === 'object' ? {
        linked: body.identity.linked === true,
        pointsAware: body.identity.pointsAware === true,
        walletCards: Math.max(0, Number(body.identity.walletCards || 0)),
        verifiedBalances: Math.max(0, Number(body.identity.verifiedBalances || 0)),
      } : undefined,
      bookingPolicy: body?.bookingPolicy && typeof body.bookingPolicy === 'object' ? {
        mode: clean(body.bookingPolicy.mode || 'provider_handoff', 80),
        requiresRepriceBeforeBooking: body.bookingPolicy.requiresRepriceBeforeBooking !== false,
        irreversiblePointsTransferAllowed: false,
      } : undefined,
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
