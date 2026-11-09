// Live exchange quotes for share-price watches. Yahoo Finance's public chart and search endpoints carry NSE (.NS) and
// BSE (.BO) listings. Every value is validated; anything unexpected is treated as "no verified quote", never guessed.

export type StockMatch = { symbol: string; name: string; exchange: 'NSE' | 'BSE' }
export type StockQuote = { symbol: string; price: number; previousClose: number | null; currency: string; asOf: string; marketState: string | null }

const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; AskGogo/1.0)', Accept: 'application/json' }

/** NSE listings first (BSE only when the company has no NSE listing), one entry per company. */
export async function resolveStockSymbols(company: string, fetchImpl: typeof fetch = fetch): Promise<StockMatch[]> {
  const q = String(company || '').trim().slice(0, 80)
  if (!q) return []
  const res = await fetchImpl(`https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0&listsCount=0`,
    { headers: UA, signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error(`stock_search_${res.status}`)
  const data: any = await res.json().catch(() => null)
  const quotes: any[] = Array.isArray(data?.quotes) ? data.quotes : []
  const rows = quotes
    .filter(x => String(x?.quoteType || '').toUpperCase() === 'EQUITY' && /^[A-Z0-9&.\-]{1,24}\.(?:NS|BO)$/.test(String(x?.symbol || '').toUpperCase()))
    .map(x => ({ symbol: String(x.symbol).toUpperCase(), name: String(x.longname || x.shortname || x.symbol).trim().slice(0, 120), exchange: String(x.symbol).toUpperCase().endsWith('.NS') ? 'NSE' as const : 'BSE' as const }))
  const byName = new Map<string, StockMatch>()
  for (const r of rows.sort((a, b) => Number(b.exchange === 'NSE') - Number(a.exchange === 'NSE'))) {
    const key = r.name.toLowerCase().replace(/\b(?:ltd|limited|the)\b|[^a-z0-9]+/g, '')
    if (!byName.has(key)) byName.set(key, r)
  }
  return [...byName.values()].slice(0, 5)
}

export async function fetchStockQuote(symbol: string, fetchImpl: typeof fetch = fetch): Promise<StockQuote | null> {
  const s = String(symbol || '').toUpperCase()
  if (!/^[A-Z0-9&.\-]{1,24}\.(?:NS|BO)$/.test(s)) return null
  const res = await fetchImpl(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?interval=1d&range=5d`,
    { headers: UA, signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error(`stock_quote_${res.status}`)
  const data: any = await res.json().catch(() => null)
  const meta = data?.chart?.result?.[0]?.meta
  const price = Number(meta?.regularMarketPrice)
  const currency = String(meta?.currency || '')
  if (!(price > 0) || currency !== 'INR' || String(meta?.symbol || '').toUpperCase() !== s) return null
  const prev = Number(meta?.chartPreviousClose ?? meta?.previousClose)
  const t = Number(meta?.regularMarketTime)
  const asOf = t > 0 ? new Date(t * 1000).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : 'latest close'
  return { symbol: s, price, previousClose: prev > 0 ? prev : null, currency, asOf, marketState: meta?.marketState ? String(meta.marketState) : null }
}
