// A persisted takeover URL outlives the temporary sandbox that served it.
// Probe only our own handoff health endpoint; never fetch an arbitrary URL
// stored in task metadata or expose its bearer token in a response.
export async function browserHandoffIsLive(takeoverUrl: unknown): Promise<boolean> {
  if (typeof takeoverUrl !== 'string') return false
  let url: URL
  try { url = new URL(takeoverUrl) } catch { return false }
  if (url.protocol !== 'https:' || !/^sb-[a-z0-9-]+\.vercel\.run$/i.test(url.hostname)
    || url.username || url.password || !url.searchParams.get('token')) return false
  url.pathname = '/health'
  url.hash = ''
  try {
    const response = await fetch(url, {cache: 'no-store', signal: AbortSignal.timeout(2500)})
    return response.ok && (await response.json().catch(() => null))?.ready === true
  } catch { return false }
}
