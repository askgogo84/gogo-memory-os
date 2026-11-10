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

const v4Public = (a: number, b: number, c: number): boolean => {
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false
  if (a === 100 && b >= 64 && b <= 127) return false // carrier NAT
  if (a === 169 && b === 254) return false // link-local and cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return false
  if (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99))) return false
  if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false
  if (a === 203 && b === 0 && c === 113) return false
  return true
}
/** The eight 16-bit groups of an IPv6 address in any spelling, or null. */
function v6Groups(ip: string): number[] | null {
  let x = ip.toLowerCase()
  const tail = /^(.*:)(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(x)
  if (tail) { const n = tail.slice(2).map(Number); if (n.some(v => v > 255)) return null; x = `${tail[1]}${((n[0] << 8) | n[1]).toString(16)}:${((n[2] << 8) | n[3]).toString(16)}` }
  const halves = x.split('::')
  if (halves.length > 2) return null
  const part = (h: string) => (h ? h.split(':') : [])
  const head = part(halves[0]), rest = halves.length === 2 ? part(halves[1]) : []
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null
  const all = [...head, ...Array(fill).fill('0'), ...rest]
  if (all.length !== 8 || all.some(g => !/^[0-9a-f]{1,4}$/.test(g))) return null
  return all.map(g => parseInt(g, 16))
}
/** True only for an address that is plainly on the public internet. Anything else must never be fetched.
 *  IPv6: only global unicast (2000::/3), minus the ranges that tunnel or document (Teredo, 6to4, ORCHID, documentation).
 *  An IPv4 address carried inside an IPv6 one (mapped) is judged as that IPv4 address. */
export function isPublicAddress(ip: string): boolean {
  const v = isIP(ip)
  if (v === 4) { const [a, b, c] = ip.split('.').map(Number); return v4Public(a, b, c) }
  if (v !== 6) return false
  const g = v6Groups(ip)
  if (!g) return false
  if (g.slice(0, 5).every(n => n === 0) && g[5] === 0xffff) return v4Public(g[6] >> 8, g[6] & 255, g[7] >> 8)
  if ((g[0] & 0xe000) !== 0x2000) return false // not global unicast: loopback, unspecified, ::/96, NAT64, unique-local, link-local, site-local, multicast, discard
  if (g[0] === 0x2002) return false // 6to4 (carries an IPv4 address)
  if (g[0] === 0x2001 && (g[1] === 0 || g[1] === 0xdb8 || (g[1] & 0xfff0) === 0x10 || (g[1] & 0xfff0) === 0x20)) return false // Teredo, documentation, ORCHID
  if ((g[0] & 0xfff0) === 0x3ff0) return false // documentation
  return true
}

/** A URL this reader will consider at all. */
export function readableUrl(raw: string): URL | null {
  let u: URL
  try { u = new URL(raw) } catch { return null }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return null
  const host = u.hostname.toLowerCase()
  if (isIP(host) || host.startsWith('[') || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) || host.includes('xn--') || host.includes('..') || host.length > 253 || host.split('.').some(l => l.length > 63)) return null
  if (/(?:^|\.)(?:localhost|local|internal|intranet|lan|home|corp|test|invalid|example|arpa|svc|cluster|onion|localdomain)$/.test(host)) return null
  return u
}

export type Resolver = (host: string) => Promise<{ address: string; family: number }[]>
export type Getter = (u: URL, pinned: { address: string; family: number }, limits: typeof PAGE_LIMITS) => Promise<{ status: number; location: string | null; type: string; body: string }>

const realResolve: Resolver = host => dnsLookup(host, { all: true, verbatim: true })
const realGet: Getter = (u, pinned, limits) => new Promise((done, fail) => {
  // A hard deadline for the whole exchange: the socket's own timeout only catches silence, not a slow drip.
  let settled = false
  const resolve = (v: Awaited<ReturnType<Getter>>) => { if (!settled) { settled = true; clearTimeout(deadline); done(v) } }
  const reject = (e: unknown) => { if (!settled) { settled = true; clearTimeout(deadline); fail(e) } }
  let req: ReturnType<typeof request> | undefined
  const deadline = setTimeout(() => { req?.destroy(new Error('deadline')); reject(new Error('deadline')) }, limits.ms)
  req = request({
    // A fresh connection every time: a kept-alive socket would skip the address check below.
    agent: false,
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
/** Cloudflare's email protection writes an address into the page as hex (the first byte is a key, each later byte is a
 *  character XOR that key) and a script in the browser turns it back. This does the same, so an address that a person
 *  sees on the page is seen here too. Null unless the result is shaped like an email address. */
export function decodeCfEmail(hex: string): string | null {
  if (!/^[0-9a-f]{8,512}$/i.test(hex) || hex.length % 2) return null
  const key = parseInt(hex.slice(0, 2), 16)
  let out = ''
  for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key)
  return /^[a-z0-9][a-z0-9._%+-]{0,63}@[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63}){1,4}$/i.test(out) ? out : null
}

export function pageText(html: string): { title: string; text: string } {
  const src = String(html || '').slice(0, PAGE_LIMITS.bytes)
  // Every pattern here is linear on hostile input (no nested or open-ended repeats over "<").
  // Scripts, styles and comments are removed first (an unclosed one removes everything after it), so nothing hidden
  // in them is read: not text, not a title, not an email link.
  const shown = src.replace(/<!--[\s\S]*?(?:-->|$)/g, ' ').replace(/<(script|style|noscript|template|svg)\b[\s\S]*?(?:<\/\1\s*>|$)/gi, ' ')
  const title = (/<title\b[^<>]{0,200}>([^<]{0,200})/i.exec(shown)?.[1] || '').replace(/\s+/g, ' ').trim()
  // An email link's address is put where the link sits, so the words around the link are the words around the address.
  // Protected addresses are put back where they sit: the element carrying data-cfemail (its "[email protected]" text is
  // dropped) and links to /cdn-cgi/l/email-protection#<hex>.
  const unprotected = shown
    .replace(/<(a|span)\b[^<>]{0,600}?data-cfemail\s*=\s*["']([0-9a-f]{8,512})["'][^<>]{0,600}>[^<]{0,60}<\/\1\s*>/gi, (_m, _t, hex) => ` ${decodeCfEmail(hex) || ''} `)
    .replace(/<a\b[^<>]{0,600}?href\s*=\s*["'][^"'<>]{0,200}\/cdn-cgi\/l\/email-protection#([0-9a-f]{8,512})["'][^<>]{0,600}>/gi, (_m, hex) => ` ${decodeCfEmail(hex) || ''} `)
    .replace(/\[email(?:&#160;|&nbsp;|\s)protected\]/gi, ' ')
  const body = unprotected.replace(/<head\b[\s\S]*?(?:<\/head\s*>|$)/i, ' ').replace(/<a\b[^<>]{0,600}?href\s*=\s*["']mailto:([^"'?\s<>]{3,120})[^<>]{0,600}>/gi, ' $1 ').replace(/<[^<>]{0,2000}>/g, ' ')
    .replace(/&(#x?[0-9a-f]{1,6}|[a-z]{2,8});/gi, (_m, e) => ENTITIES[String(e).toLowerCase()] ?? ' ')
  return { title, text: body.replace(/\s+/g, ' ').trim() }
}

/** Reads one page. Null for anything refused, failed, too slow or not text. Never throws. `sameSite` says whether a
 *  redirect target still belongs to the site the caller approved. */
export async function readVenuePage(raw: string, sameSite: (host: string) => boolean, deps: { resolve?: Resolver; get?: Getter; limits?: Partial<typeof PAGE_LIMITS>; /** Why a read gave nothing, or what it got: codes and counts only. */ note?: (n: Record<string, string | number>) => void } = {}): Promise<PageRead | null> {
  const limits = { ...PAGE_LIMITS, ...(deps.limits || {}) }, deadline = Date.now() + limits.ms
  try {
    let u = readableUrl(raw)
    for (let hop = 0; u && hop <= limits.redirects; hop++) {
      if (!sameSite(u.hostname.toLowerCase())) { deps.note?.({ read: 'other_site' }); return null }
      const addrs = await (deps.resolve || realResolve)(u.hostname)
      // Every address the name has must be public: one private address is enough to refuse.
      if (!addrs.length || !addrs.every(a => isPublicAddress(a.address))) { deps.note?.({ read: 'address_refused' }); return null }
      const left = deadline - Date.now()
      if (left < 300) return null
      let timer: ReturnType<typeof setTimeout> | undefined
      const res = await Promise.race([(deps.get || realGet)(u, addrs[0], { ...limits, ms: left }), new Promise<never>((_r, rej) => { timer = setTimeout(() => rej(new Error('deadline')), left + 100) })]).finally(() => { if (timer) clearTimeout(timer) })
      if (res.status >= 300 && res.status < 400) { u = res.location ? readableUrl(new URL(res.location, u).toString()) : null; continue }
      if (res.status !== 200 || !res.body) { deps.note?.({ read: 'not_ok', status: res.status, type: res.type.slice(0, 24) }); return null }
      const { title, text } = pageText(res.body)
      deps.note?.({ read: 'ok', bytes: res.body.length, text: text.length, at_signs: (text.match(/@/g) || []).length, protected: (res.body.match(/data-cfemail|email-protection#/g) || []).length })
      return { url: u.toString(), title, text }
    }
    deps.note?.({ read: 'redirects' })
    return null
  } catch (e: any) { deps.note?.({ read: 'failed', why: String(e?.code || e?.message || 'error').replace(/[^A-Za-z0-9_]/g, '').slice(0, 24) }); return null }
}
