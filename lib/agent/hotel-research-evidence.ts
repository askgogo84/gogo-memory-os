import { redactSecretShapedText } from '../bot/memory-redaction'

type Source = { n: number; title: string; url: string; snippet: string; text: string }

const COUNT = '(?:\\d+|one|two|three|four|five|six|seven|eight|nine|ten)'
const MODIFIER = '(?:best|top|good|nice|budget|cheap|luxury|affordable|boutique|business|airport|recommended|well[- ]rated|family[- ]friendly|[1-5][- ]star)'
const PROPERTY = `(?:(?:best|top)\\s+)?(?:${COUNT}\\s+)?(?:${MODIFIER}\\s+){0,5}hotels?\\b`
const PROPERTY_END = '(?=\\s*(?:$|[.,;:!?])|\\s+(?:near|in|around|for|at|with|under|between|by)\\b)'

export function isHotelDiscoveryResearch(question: string): boolean {
  if (!/\bhotels?\b/i.test(question) || /\b(?:flights?|airfares?|trains?|itinerar(?:y|ies))\b/i.test(question)) return false
  const discovery = new RegExp(`\\b(?:list|find|show|suggest|recommend|compare|choose|pick|give me|search for|looking for|need|want)\\s+(?:me\\s+|the\\s+)?${PROPERTY}${PROPERTY_END}`, 'i')
  const research = new RegExp(`^(?:please\\s+)?(?:(?:do|run)\\s+(?:a\\s+)?)?(?:deep\\s+)?research(?:\\s+only)?\\s*[:,-]?\\s+(?:the\\s+)?${PROPERTY}${PROPERTY_END}`, 'i')
  return discovery.test(question) || research.test(question)
}

// These are display-only public property links, never a transport allowlist.
// A directory/category URL is not evidence for any particular property's price.
function propertyUrl(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null
    const host = url.hostname.replace(/^www\./, '')
    const path = url.pathname
    const decoded = decodeURIComponent(path).normalize('NFKC')
    const separated = decoded.replace(/[_/]/g, ' ')
    if (/%[a-f\d]{2}/i.test(decoded) || redactSecretShapedText(decoded) !== decoded
      || redactSecretShapedText(separated) !== separated) return null
    const property = host === 'makemytrip.com' ? /^\/hotels\/[\w-]+-details-[\w-]+\.html$/i.test(path)
      : host === 'agoda.com' ? /\/[\w-]+\/hotel\/[\w-]+\.html$/i.test(path)
      : host === 'booking.com' ? /^\/hotel\/[\w-]+\/[\w.-]+\.html$/i.test(path)
      : host === 'hotels.com' ? /^\/ho\d+\//i.test(path)
      : host === 'expedia.com' ? /\.h\d+\.Hotel-Information$/i.test(path)
      : host === 'tripadvisor.com' || host === 'tripadvisor.in' ? /^\/Hotel_Review-g\d+-d\d+-Reviews-[\w.-]+\.html$/i.test(path) : false
    if (!property) return null
    url.search = ''; url.hash = ''
    return url.href.length <= 350 ? url.href : null
  } catch { return null }
}

function propertyTitle(value: string, url: string): string | null {
  const raw = value.normalize('NFKC').replace(/\s+/g, ' ').trim()
  if (!raw || redactSecretShapedText(raw) !== raw || /[₹$€£]|\b(?:INR|Rs\.?|USD)\s*\d/i.test(raw)) return null
  if (/\bhotels\b/i.test(raw)) return null
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
  const requested = question.match(new RegExp(`\\b(${COUNT})\\s+(?:${MODIFIER}\\s+){0,5}hotels?\\b`, 'i'))?.[1]?.toLowerCase()
  const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 }
  const parsed = words[requested || ''] || Number(requested)
  const explicit = requested !== undefined && Number.isSafeInteger(parsed) && parsed > 0
  const count = explicit ? parsed : 3
  const limit = Math.min(5, count)
  const seen = new Set<string>()
  const properties: Array<{ source: Source; title: string; url: string }> = []
  for (const source of sources) {
    if (!source || typeof source.title !== 'string' || typeof source.url !== 'string'
      || !Number.isInteger(source.n) || source.n < 1 || source.n > 100) continue
    const url = propertyUrl(source.url)
    const title = url ? propertyTitle(source.title, url) : null
    if (!url || !title) continue
    const key = (title.toLowerCase().match(/[a-z0-9]+/g) || [])
      .filter(word => !['hotel', 'the', 'and', 'a', 'an'].includes(word)).sort().join('|')
    if (seen.has(key)) continue
    seen.add(key); properties.push({ source, title, url })
    if (properties.length === limit) break
  }
  const linkWord = properties.length === 1 ? 'link' : 'links'
  const status = explicit ? properties.length === count ? `${count} public hotel property ${linkWord}`
    : `${properties.length} of ${count} requested hotel property links found`
    : `${properties.length} public hotel property ${linkWord} found (${requested ? 'requested count unsupported' : `up to ${limit} shown`})`
  const text = properties.length
    ? `🔎 ${status}\n\n${properties.map(p => `• ${p.title} [${p.source.n}]`).join('\n')}\n\nRates and availability for your requested dates and guests are unverified. These are source titles, not a verified ranking. No booking was made.\n\nSources:\n${properties.map(p => `[${p.source.n}] ${p.title}\n${p.url}`).join('\n')}`
    : `I couldn't verify property-specific hotel links from these results. Area-directory prices cannot establish a hotel's rate. Rates and availability for your requested dates and guests remain unverified. No booking was made.`
  return { text, sources: properties.map(p => ({ n: p.source.n, title: p.title, url: p.url, snippet: '', text: '' })) }
}
