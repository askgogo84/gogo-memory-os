// AskGogo Events: read one page of a venue's own website, to find the booking address that a search excerpt left out.
// (10 Nov live: search found toit.in/faq but its excerpt did not carry the address that is on the page.)
//
// This fetches a URL that came from a search result, so it is written to be safe to point at anything:
//  - https only, default port only, a normal host name only (no IP addresses, no credentials in the URL);
//  - the name is resolved first and every address must be public (no loopback, private, link-local, carrier-NAT,
//    metadata or other reserved ranges); the connection is then made to exactly that checked address, so the name
//    cannot be re-pointed between the check and the connection;
//  - no cookies, no credentials, a fixed user agent, GET only;
//  - at most two redirects, each to the same site and each checked again;
//  - text pages only, a hard size limit and a hard time limit.
// The caller decides which hosts are worth reading (only a site that already passed the venue-name rules) and applies
// the same address rules to what is read. Page text is data: it only ever goes into the address matcher.
import { lookup as dnsLookup } from 'node:dns/promises'
import { request } from 'node:https'
import { isIP } from 'node:net'

export type PageRead = { url: string; title: string; text: string }
export const PAGE_LIMITS = { bytes: 400_000, ms: 3500, redirects: 2 }

/** True for an address that must never be fetched: anything not plainly public. */
export function isPublicAddress(ip: string): boolean {
  const v = isIP(ip)
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number)
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false
    if (a === 100 && b >= 64 && b <= 127) return false // carrier NAT
    if (a === 169 && b === 254) return false // link-local and cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return false
    if (a === 192 && (b === 168 || b === 0)) return false
    if (a === 198 && (b === 18 || b === 19)) return false
    return true
  }
  if (v === 6) {
    const x = ip.toLowerCase()
    if (x === '::' || x === '::1' || x.startsWith('fe8') || x.startsWith('fe9') || x.startsWith('fea') || x.startsWith('feb') || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('ff')) return false
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(x)
    if (mapped) return isPublicAddress(mapped[1])
    if (x.startsWith('::ffff:') || x.startsWith('64:ff9b:') || x.startsWith('2001:db8:')) return false
    return true
  }
  return false
}

/** A URL this reader will consider at all. */
export function readableUrl(raw: string): URL | null {
  let u: URL
  try { u = new URL(raw) } catch { return null }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return null
  const host = u.hostname.toLowerCase()
  if (isIP(host) || host.startsWith('[') || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) || host.includes('xn--') || host.length > 200) return null
  if (/(?:^|\.)(?:localhost|local|internal|intranet|lan|home|corp|test|invalid|example)$/.test(host)) return null
  return u
}

export type Resolver = (host: string) => Promise<{ address: string; family: number }[]>
export type Getter = (u: URL, pinned: { address: string; family: number }, limits: typeof PAGE_LIMITS) => Promise<{ status: number; location: string | null; type: string; body: string }>

const realResolve: Resolver = host => dnsLookup(host, { all: true, verbatim: true })
const realGet: Getter = (u, pinned, limits) => new Promise((resolve, reject) => {
  const req = request({
    host: u.hostname, servername: u.hostname, port: 443, path: `${u.pathname}${u.search}`, method: 'GET', timeout: limits.ms,
    // Connect to the address that was checked, whatever the name resolves to now.
    lookup: (_h: string, o: any, cb: any) => (o?.all ? cb(null, [{ address: pinned.address, family: pinned.family }]) : cb(null, pinned.address, pinned.family)),
    headers: { 'User-Agent': 'AskGogo-VenueContact/1.0 (+https://askgogo.in)', Accept: 'text/html,text/plain;q=0.8', 'Accept-Encoding': 'identity' },
  }, res => {
    const type = String(res.headers['content-type'] || '').toLowerCase(), status = res.statusCode || 0
    const location = typeof res.headers.location === 'string' ? res.headers.location : null
    if (status >= 300 && status < 400) { res.destroy(); resolve({ status, location, type, body: '' }); return }
    if (status !== 200 || !/^text\/(?:html|plain)\b/.test(type)) { res.destroy(); resolve({ status, location: null, type, body: '' }); return }
    const chunks: Buffer[] = []; let size = 0
    res.on('data', (c: Buffer) => { size += c.length; if (size > limits.bytes) { res.destroy(); resolve({ status, location: null, type, body: Buffer.concat(chunks).toString('utf8') }) } else chunks.push(c) })
    res.on('end', () => resolve({ status, location: null, type, body: Buffer.concat(chunks).toString('utf8') }))
    res.on('error', reject)
  })
  req.on('timeout', () => req.destroy(new Error('timeout')))
  req.on('error', reject)
  req.end()
})

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#64': '@', '#x40': '@', '#46': '.', '#x2e': '.' }
/** Visible text of a page, plus the addresses in its mailto links. No scripts, styles or markup. */
export function pageText(html: string): { title: string; text: string } {
  const src = String(html || '').slice(0, PAGE_LIMITS.bytes)
  const title = (/<title[^>]*>([^<]{0,200})/i.exec(src)?.[1] || '').replace(/\s+/g, ' ').trim()
  const mailto = [...src.matchAll(/href\s*=\s*["']mailto:([^"'?\s>]{3,120})/gi)].map(m => m[1])
  const body = src.replace(/<(script|style|noscript|template|svg|head)\b[\s\S]*?<\/\1\s*>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]{0,2000}>/g, ' ')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => ENTITIES[String(e).toLowerCase()] ?? ' ')
  return { title, text: `${body} ${mailto.map(m => `(email link: ${m})`).join(' ')}`.replace(/\s+/g, ' ').trim() }
}

/** Reads one page. Null for anything refused, failed, too slow or not text. Never throws. `sameSite` says whether a
 *  redirect target still belongs to the site the caller approved. */
export async function readVenuePage(raw: string, sameSite: (host: string) => boolean, deps: { resolve?: Resolver; get?: Getter; limits?: Partial<typeof PAGE_LIMITS> } = {}): Promise<PageRead | null> {
  const limits = { ...PAGE_LIMITS, ...(deps.limits || {}) }, deadline = Date.now() + limits.ms
  try {
    let u = readableUrl(raw)
    for (let hop = 0; u && hop <= limits.redirects; hop++) {
      if (!sameSite(u.hostname.toLowerCase())) return null
      const addrs = await (deps.resolve || realResolve)(u.hostname)
      // Every address the name has must be public: one private address is enough to refuse.
      if (!addrs.length || !addrs.every(a => isPublicAddress(a.address))) return null
      const left = deadline - Date.now()
      if (left < 300) return null
      const res = await (deps.get || realGet)(u, addrs[0], { ...limits, ms: left })
      if (res.status >= 300 && res.status < 400) { u = res.location ? readableUrl(new URL(res.location, u).toString()) : null; continue }
      if (res.status !== 200 || !res.body) return null
      const { title, text } = pageText(res.body)
      return { url: u.toString(), title, text }
    }
    return null
  } catch { return null }
}
