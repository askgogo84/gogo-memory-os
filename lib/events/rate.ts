// AskGogo Events: the per-address rate bucket shared by the RSVP endpoint and the RSVP page's server render.
import { createHash } from 'node:crypto'

type HeaderBag = { get(name: string): string | null }
const sha = (v: string) => createHash('sha256').update(v, 'utf8').digest('hex')

/** The caller's address as the platform reports it. On Vercel x-vercel-forwarded-for and x-real-ip are set by the
 *  platform; the first hop of x-forwarded-for is whatever the client sent, so only its last hop is used as a fallback. */
export function callerAddress(headers: HeaderBag): string {
  const h = (name: string) => (headers.get(name) || '').trim()
  const direct = h('x-vercel-forwarded-for').split(',')[0].trim() || h('x-real-ip')
  if (direct) return direct.slice(0, 64)
  const hops = h('x-forwarded-for').split(',').map(x => x.trim()).filter(Boolean)
  return (hops[hops.length - 1] || 'unknown').slice(0, 64)
}
/** One counter per address and method. There is deliberately no per-link counter: a shared link is used by many
 *  honest guests at once, and a per-link cap would let one person shut everyone else out. The database bounds how
 *  many guests a link can create and how often one reply can change. Buckets are hashes, never the address itself.
 *  The page render counts as a read ('get'), in the same bucket as the endpoint's reads. */
export const rateBucket = (headers: HeaderBag, kind: 'get' | 'post') => `ip${kind === 'get' ? 'g' : 'p'}:${sha(callerAddress(headers)).slice(0, 40)}`
