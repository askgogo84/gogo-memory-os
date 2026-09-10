import { createHmac } from 'node:crypto'

type Cabin = 'economy' | 'premium_economy' | 'business' | 'first'

type CreditIQIdentity = {
  linked: boolean
  pointsAware: boolean
  walletCards: number
  verifiedBalances: number
}

type CreditIQBookingPolicy = {
  mode: string
  requiresRepriceBeforeBooking: boolean
  irreversiblePointsTransferAllowed: boolean
}

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
  identity?: CreditIQIdentity
  bookingPolicy?: CreditIQBookingPolicy
  requiresServiceAuth?: boolean
}

export type CreditIQHotelSearch = {
  live: boolean
  source: string
  coverage: Record<string, unknown> | null
  hotels: any[]
  fetchedAt: string
  identity?: CreditIQIdentity
  bookingPolicy?: CreditIQBookingPolicy
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

function parseIdentity(value: any): CreditIQIdentity | undefined {
  if (!value || typeof value !== 'object') return undefined
  return {
    linked: value.linked === true,
    pointsAware: value.pointsAware === true,
    walletCards: Math.max(0, Number(value.walletCards || 0)),
    verifiedBalances: Math.max(0, Number(value.verifiedBalances || 0)),
  }
}

function parseBookingPolicy(value: any): CreditIQBookingPolicy | undefined {
  if (!value || typeof value !== 'object') return undefined
  return {
    mode: clean(value.mode || 'provider_handoff', 80),
    requiresRepriceBeforeBooking: value.requiresRepriceBeforeBooking !== false,
    irreversiblePointsTransferAllowed: false,
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
      identity: parseIdentity(body?.identity),
      bookingPolicy: parseBookingPolicy(body?.bookingPolicy),
    }
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Signed, read-only hotel + rewards bridge into CreditIQ's existing Booking.com /
 * Skyscanner / Hotelbeds provider orchestration. The linked user id is an opaque
 * CreditIQ identity only; wallet/card data remains inside CreditIQ and comes back
 * as a compact decision summary per property. Exact award-night availability is
 * never inferred from a chain match, and every provider handoff must be repriced.
 */
export async function searchCreditIQLiveHotels(params: {
  destination: string
  checkin: string
  checkout: string
  adults?: number
  rooms?: number
  userLinkId?: string | null
}): Promise<CreditIQHotelSearch | null> {
  const rawBody = JSON.stringify({
    userLinkId: clean(params.userLinkId || '', 200) || null,
    type: 'hotel',
    destination: clean(params.destination, 160),
    checkin: clean(params.checkin, 10),
    checkout: clean(params.checkout, 10),
    adults: Math.max(1, Math.min(9, Number(params.adults || 1))),
    rooms: Math.max(1, Math.min(5, Number(params.rooms || 1))),
    limit: 30,
    preferences: null,
  })
  const headers = signedServiceHeaders(rawBody)
  if (!headers) {
    return { live:false, source:'creditiq', coverage:null, hotels:[], fetchedAt:new Date().toISOString(), requiresServiceAuth:true }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20_000)
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
    if (!body || body?.contract !== 'gogo-creditiq-travel-v1') return null
    const hotels = Array.isArray(body?.hotels) ? body.hotels : Array.isArray(body?.offers) ? body.offers : []
    if (!hotels.length) return null
    const source = clean(body?.inventory?.source || body?.coverage?.provider || body?.source || 'creditiq',80)
    const live = body?.inventory?.live === true
    return {
      live,
      source,
      coverage:body?.inventory?.coverage && typeof body.inventory.coverage === 'object'
        ? body.inventory.coverage
        : body?.coverage && typeof body.coverage === 'object' ? body.coverage : null,
      hotels:hotels.slice(0,50),
      fetchedAt:clean(body?.inventory?.fetchedAt || body?.coverage?.fetched_at || new Date().toISOString(),80),
      identity: parseIdentity(body?.identity),
      bookingPolicy: parseBookingPolicy(body?.bookingPolicy),
    }
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}
