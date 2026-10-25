import { redactSecretShapedText } from '../bot/memory-redaction'

type Source = { n: number; title: string; url: string; snippet: string; text: string }

export function isHotelDiscoveryResearch(question: string): boolean {
  return /\bhotels?\b/i.test(question)
    && /\b(?:near|in|around|stay|stays|nights?|airport|accommodation|check[ -]?(?:in|out))\b/i.test(question)
    && !/\b(?:hotels?\s+(?:industry|stocks?|shares?|architecture|history)|(?:industry|stocks?|shares?|architecture|history)\s+(?:of\s+)?hotels?)\b/i.test(question)
}

// These are display-only public property links, never a transport allowlist.
// A directory/category URL is not evidence for any particular property's price.
function propertyUrl(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null
    const host = url.hostname.replace(/^www\./, '')
    const path = url.pathname
    const property = host === 'makemytrip.com' ? /^\/hotels\/[\w-]+-details-[\w-]+\.html$/i.test(path)
      : host === 'agoda.com' ? /\/[\w-]+\/hotel\/[\w-]+\.html$/i.test(path)
      : host === 'booking.com' ? /^\/hotel\/[\w-]+\/[\w.-]+\.html$/i.test(path)
      : host === 'hotels.com' ? /^\/ho\d+\//i.test(path)
      : host === 'expedia.com' ? /\.h\d+\.Hotel-Information$/i.test(path)
      : host === 'tripadvisor.com' || host === 'tripadvisor.in' ? /^\/Hotel_Review-/i.test(path) : false
    if (!property) return null
    url.search = ''; url.hash = ''
    return url.href.length <= 350 ? url.href : null
  } catch { return null }
}

function propertyTitle(value: string, url: string): string | null {
  const raw = value.normalize('NFKC').replace(/\s+/g, ' ').trim()
  if (!raw || redactSecretShapedText(raw) !== raw || /[₹$€£]|\b(?:INR|Rs\.?|USD)\s*\d/i.test(raw)) return null
  if (/^(?:(?:best|top|cheap|budget|luxury|all)\s+)?hotels\b/i.test(raw)) return null
  const title = raw.split(/\s+[|–—-]\s+|,\s+|\s+\b(?:book|near|in)\b\s+/i)[0]
    .replace(/[\[\]<>*_`]/g, '').trim().slice(0, 100)
  const words = title.toLowerCase().match(/[a-z0-9]+/g) || []
  const identity = words.filter(word => !['hotel', 'the', 'and', 'a', 'an'].includes(word))
  const slug = new URL(url).pathname.toLowerCase().replace(/[^a-z0-9]/g, '')
  let offset = 0
  if (!identity.length || identity.join('').length < 4 || !identity.every(word => {
    const found = slug.indexOf(word, offset)
    if (found < 0) return false
    offset = found + word.length; return true
  })) return null
  return title
}

/** Conservative source catalogue: no model-generated property rates or ranking. */
export function hotelResearchEvidence(question: string, sources: Source[]) {
  const requested = question.match(/\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\s+hotels?\b/i)?.[1]?.toLowerCase()
  const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 }
  const count = Math.max(1, Number(requested) || words[requested || ''] || 3)
  const limit = Math.min(5, count)
  const seen = new Set<string>()
  const properties: Array<{ source: Source; title: string; url: string }> = []
  for (const source of sources) {
    if (!source || typeof source.title !== 'string' || typeof source.url !== 'string'
      || !Number.isInteger(source.n) || source.n < 1 || source.n > 100) continue
    const url = propertyUrl(source.url)
    const title = url ? propertyTitle(source.title, url) : null
    if (!url || !title) continue
    const key = title.toLowerCase().replace(/[^a-z0-9]/g, '')
    if (seen.has(key)) continue
    seen.add(key); properties.push({ source, title, url })
    if (properties.length === limit) break
  }
  const status = properties.length === count ? `${count} public hotel property links`
    : `${properties.length} of ${count} requested hotel property links found`
  const text = properties.length
    ? `🔎 ${status}\n\n${properties.map(p => `• ${p.title} [${p.source.n}]`).join('\n')}\n\nRates and availability for your requested dates and guests are unverified. These are source titles, not a verified ranking. No booking was made.\n\nSources:\n${properties.map(p => `[${p.source.n}] ${p.title}\n${p.url}`).join('\n')}`
    : `I couldn't verify property-specific hotel links from these results. Area-directory prices cannot establish a hotel's rate. Rates and availability for your requested dates and guests remain unverified. No booking was made.`
  return { text, sources: properties.map(p => ({ n: p.source.n, title: p.title, url: p.url, snippet: '', text: '' })) }
}
