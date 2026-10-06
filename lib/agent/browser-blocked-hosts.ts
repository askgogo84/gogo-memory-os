// One structured log line per run for requests the broker allowlist aborted, so
// self-inflicted starvation (e.g. a provider's own API host missing from the
// allowlist) is visible without a live probe. HOSTNAMES ONLY — never full URLs,
// query strings, tokens, headers or body content.
export function blockedHostsLogLine(params: { runId?: string | null; site: string; hosts: Record<string, number> }): string {
  const hostOnly = (value: string) => {
    const raw = String(value || '')
    // Defence in depth: if a full URL ever leaks in, keep only its hostname.
    try { return new URL(raw).hostname } catch {}
    return raw.split('/')[0].split('?')[0].split('#')[0].trim()
  }
  const hosts: Record<string, number> = {}
  for (const [key, count] of Object.entries(params.hosts || {})) {
    const h = hostOnly(key)
    if (!h) continue
    hosts[h] = (hosts[h] || 0) + (Number(count) || 0)
  }
  return 'BROWSER_BLOCKED_HOSTS ' + JSON.stringify({ runId: params.runId || null, site: hostOnly(params.site), hosts })
}
