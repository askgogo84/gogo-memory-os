// A persisted takeover URL outlives the temporary sandbox that served it.
// Only the dedicated Vercel Sandbox handoff origin may be contacted from our server.
// Never turn an arbitrary persisted task URL into an SSRF destination.
export function browserHandoffEndpointUrl(takeoverUrl: unknown, endpoint: '/health' | '/shot'): URL | null {
  if (typeof takeoverUrl !== 'string') return null
  let url: URL
  try { url = new URL(takeoverUrl) } catch { return null }
  const tokens = url.searchParams.getAll('token')
  if (url.protocol !== 'https:' || !/^sb-[a-z0-9-]+\.vercel\.run$/i.test(url.hostname)
    || url.port || url.username || url.password
    || tokens.length !== 1 || !tokens[0] || tokens[0].length > 2048) return null
  // Discard all supplied paths, query parameters and fragments; only the original
  // sandbox origin and bearer token are needed for the fixed internal endpoint.
  url.pathname = endpoint
  url.search = ''
  url.searchParams.set('token', tokens[0])
  url.hash = ''
  return url
}

export async function browserHandoffIsLive(takeoverUrl: unknown): Promise<boolean> {
  const url = browserHandoffEndpointUrl(takeoverUrl, '/health')
  if (!url) return false
  try {
    // A permitted sandbox may still redirect: never follow it to an untrusted host.
    const response = await fetch(url, {cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(2500)})
    return response.ok && (await response.json().catch(() => null))?.ready === true
  } catch { return false }
}
