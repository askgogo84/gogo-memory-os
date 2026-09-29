// Residential/mobile egress for the secure browser.
//
// WHY: the secure browser runs in a Vercel Sandbox (datacenter, region bom1). Some
// providers — Blinkit, Zepto, Swiggy Instamart and other consumer q-commerce sites —
// serve HTTP 403 / bot-protection to datacenter IPs, so an automated read from the
// sandbox can never see prices (proven: https://blinkit.com/ returns 403 to a
// datacenter request, while a residential browser loads normally). The supported fix is
// to egress those providers through a residential/mobile proxy. This module resolves the
// proxy config from environment WITHOUT hard-coding any credentials, and gates it to the
// providers that actually need it so residential-proxy cost is not spent on every site.
//
// Activation (set on the Vercel project — nothing here contains secrets):
//   GOGO_BROWSER_PROXY_URL       e.g. "http://gw.example-residential.com:7000"
//   GOGO_BROWSER_PROXY_USERNAME  proxy account username (may encode geo, e.g. "...-country-in")
//   GOGO_BROWSER_PROXY_PASSWORD  proxy account password
//   GOGO_BROWSER_PROXY_HOSTS     optional CSV of host suffixes that MUST use the proxy
//                                (default: the known datacenter-blocked q-commerce hosts)
//   GOGO_BROWSER_PROXY_ALL=1     optional: route ALL browser egress through the proxy
//
// The proxy host itself must also be added to the sandbox network allowlist (see
// secure-computer.ts allowedHosts) so the sandbox firewall permits the tunnel.

export type BrowserProxyConfig = { server: string; username?: string; password?: string }

// Providers observed to block datacenter egress and therefore need residential egress.
const DEFAULT_PROXY_HOSTS = [
  'blinkit.com',
  'zepto.com',
  'zeptonow.com',
  'swiggy.com', // Instamart
]

function hostOf(url: string): string {
  try { return new URL(url).hostname.toLowerCase() } catch { return '' }
}

function hostMatches(host: string, suffix: string): boolean {
  const s = suffix.toLowerCase().trim().replace(/^\*\.?/, '')
  if (!s) return false
  return host === s || host.endsWith(`.${s}`)
}

/** Host suffixes that must egress through the residential proxy. */
export function proxyRequiredHosts(env: Record<string, string | undefined> = process.env): string[] {
  const csv = String(env.GOGO_BROWSER_PROXY_HOSTS || '').trim()
  if (!csv) return DEFAULT_PROXY_HOSTS
  return csv.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
}

/**
 * Resolve the Playwright proxy config for a target URL, or null when no proxy is
 * configured or the target does not require one. Pure and env-injectable for testing.
 */
export function resolveBrowserProxy(targetUrl: string, env: Record<string, string | undefined> = process.env): BrowserProxyConfig | null {
  const server = String(env.GOGO_BROWSER_PROXY_URL || '').trim()
  if (!server) return null
  const host = hostOf(targetUrl)
  if (!host) return null
  const all = String(env.GOGO_BROWSER_PROXY_ALL || '').trim() === '1'
  const required = proxyRequiredHosts(env).some(suffix => hostMatches(host, suffix))
  if (!all && !required) return null
  const username = String(env.GOGO_BROWSER_PROXY_USERNAME || '').trim() || undefined
  const password = String(env.GOGO_BROWSER_PROXY_PASSWORD || '').trim() || undefined
  return { server, ...(username ? { username } : {}), ...(password ? { password } : {}) }
}

/** The proxy hostname to add to the sandbox network allowlist, if a proxy is configured. */
export function proxyAllowlistHost(env: Record<string, string | undefined> = process.env): string | null {
  const server = String(env.GOGO_BROWSER_PROXY_URL || '').trim()
  if (!server) return null
  const h = hostOf(server.includes('://') ? server : `http://${server}`)
  return h || null
}
