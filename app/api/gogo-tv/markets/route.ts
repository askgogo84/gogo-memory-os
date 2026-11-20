import { createHash, timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type SymbolRequest = { label: string; symbol: string }
type Quote = { symbol: string; value: number; changePct: number; asOf: string }

const EXCHANGE_LABELS = new Set([
  'NIFTY 50', 'SENSEX', 'BANK NIFTY', 'NASDAQ', 'S&P 500',
  'DOW JONES', 'GOLD', 'USD/INR',
])
const NO_STORE = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }

function json(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: NO_STORE })
}

function sessionAllowed(request: NextRequest): boolean {
  const expectedHex = process.env.GOGO_TV_MARKETS_DEVICE_TOKEN_SHA256?.trim() || ''
  const match = /^Bearer ([A-Za-z0-9_-]{32,128})$/.exec(request.headers.get('authorization') || '')
  if (!/^[a-f0-9]{64}$/i.test(expectedHex) || !match) return false
  const actual = createHash('sha256').update(match[1], 'utf8').digest()
  const expected = Buffer.from(expectedHex, 'hex')
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

function symbolRequests(): SymbolRequest[] {
  const serialized = process.env.GOGO_TV_MARKETS_SYMBOLS || ''
  if (serialized.length > 2000) return []
  let parsed: unknown
  try { parsed = JSON.parse(serialized) } catch { return [] }
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 8) return []
  const seen = new Set<string>()
  const result: SymbolRequest[] = []
  for (const row of parsed) {
    if (!row || typeof row !== 'object') return []
    const label = String((row as any).label || '').trim().toUpperCase()
    const symbol = String((row as any).symbol || '').trim()
    if (!EXCHANGE_LABELS.has(label) || !/^[A-Za-z0-9/^.$&+_:-]{1,32}$/.test(symbol) || seen.has(label)) return []
    result.push({ label, symbol })
    seen.add(label)
  }
  return result
}

type ProviderQuote = {
  symbol?: unknown; close?: unknown; price?: unknown;
  percent_change?: unknown; last_quote_at?: unknown; last_update_at?: unknown;
  status?: unknown; code?: unknown; message?: unknown
}

function normalize(raw: ProviderQuote, requested: SymbolRequest): Quote | null {
  if (!raw || raw.status === 'error' || raw.code) return null
  const price = Number(raw.close ?? raw.price)
  const pct = Number(raw.percent_change)
  if (!Number.isFinite(price) || price <= 0 || price > 1e9 || !Number.isFinite(pct) || Math.abs(pct) > 100) return null
  // Twelve Data's timestamp can denote the bar opening.
  // Require the actual last quote time or withhold this instrument.
  const asOfSec = Number(raw.last_quote_at ?? raw.last_update_at)
  if (!Number.isSafeInteger(asOfSec) || asOfSec <= 0) return null
  const asOfMs = asOfSec * 1000
  const age = Date.now() - asOfMs
  if (age < -5 * 60_000 || age > 24 * 60 * 60_000) return null
  return {
    symbol: requested.label, value: Math.round(price * 10000) / 10000,
    changePct: Math.round(pct * 10000) / 10000,
    asOf: new Date(asOfMs).toISOString(),
  }
}

async function readTwelveData(key: string, request: SymbolRequest): Promise<Quote | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 6000)
  try {
    const url = new URL('https://api.twelvedata.com/quote')
    url.searchParams.set('symbol', request.symbol)
    const response = await fetch(url, {
      headers: { Authorization: 'apikey ' + key, Accept: 'application/json' },
      signal: controller.signal,
      cache: 'no-store',
    })
    if (!response.ok) return null
    const data = await response.json() as ProviderQuote
    return normalize(data, request)
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

export async function GET(request: NextRequest) {
  if (!sessionAllowed(request)) return json({ error: 'unauthorized' }, 401)

  const licence = process.env.GOGO_TV_MARKETS_LICENSE_MODE
  if (licence !== 'personal-display' && licence !== 'commercial-display')
    return json({ error: 'display_license_not_confirmed' }, 503)
  const key = process.env.GOGO_TV_TWELVEDATA_API_KEY || ''
  if (key.length < 12 || key.length > 256) return json({ error: 'provider_not_configured' }, 503)
  const symbols = symbolRequests()
  if (!symbols.length) return json({ error: 'symbol_mapping_not_configured' }, 503)

  // One private TV is expected to poll no faster than 15 minutes.
  const values: Quote[] = []
  for (let offset = 0; offset < symbols.length; offset += 2) {
    const batch = symbols.slice(offset, offset + 2)
    const results = await Promise.all(batch.map(symbol => readTwelveData(key, symbol)))
    values.push(...results.filter((q): q is Quote => q !== null))
  }
  if (!values.length) return json({ error: 'no_fresh_licensed_quotes', quotes: [] }, 503)

  return json({
    licensedForDisplay: true,
    source: 'Twelve Data',
    coverage: String(values.length) + '/' + String(symbols.length),
    quotes: values,
  }, 200)
}
