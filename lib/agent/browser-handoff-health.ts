// A persisted takeover URL outlives the temporary sandbox that served it.
// Probe only our own handoff health endpoint; never fetch an arbitrary URL
// stored in task metadata or expose its bearer token in a response.
export async function browserHandoffIsLive(takeoverUrl: unknown): Promise<boolean> {
  if (typeof takeoverUrl !== 'string') return false
  let url: URL
  try { url = new URL(takeoverUrl) } catch { return false }
  if (url.protocol !== 'https:' || !/^sb-[a-z0-9-]+\.vercel\.run$/i.test(url.hostname)
    || url.username || url.password || url.port || !url.searchParams.get('token')) return false
  url.pathname = '/health'
  url.hash = ''
  try {
    // Do not let a sandbox 30x redirect make this server probe an arbitrary destination.
    // A health check is authoritative only for the exact pinned sandbox origin.
    const response = await fetch(url, {cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(2500)})
    return response.status === 200 && (await response.json().catch(() => null))?.ready === true
  } catch { return false }
}
