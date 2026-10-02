import assert from 'node:assert/strict'
import { resolveBrowserProxy, proxyRequiredHosts, proxyAllowlistHost } from '../lib/agent/browser-proxy'
import { browserPageAllowlist } from '../lib/agent/browser-page-network'

// Residential/mobile egress for datacenter-blocked providers (Blinkit et al. return 403
// to datacenter IPs — proven live). The proxy is env-gated and provider-scoped.

// 1. No config -> no proxy, ever.
assert.equal(resolveBrowserProxy('https://blinkit.com/s/?q=milk', {}), null)
assert.equal(proxyAllowlistHost({}), null)

const env = {
  GOGO_BROWSER_PROXY_URL: 'http://gw.residential.example.com:7000',
  GOGO_BROWSER_PROXY_USERNAME: 'acct-country-in',
  GOGO_BROWSER_PROXY_PASSWORD: 'secret',
} as any

// 2. A blocked q-commerce provider gets the proxy.
const blinkit = resolveBrowserProxy('https://blinkit.com/s/?q=amul%20taaza', env)
assert.ok(blinkit)
assert.equal(blinkit!.server, 'http://gw.residential.example.com:7000')
assert.equal(blinkit!.username, 'acct-country-in')
assert.equal(blinkit!.password, 'secret')
assert.ok(resolveBrowserProxy('https://www.zeptonow.com/', env))
assert.ok(resolveBrowserProxy('https://www.swiggy.com/instamart', env))

// 3. A non-listed provider does NOT spend residential proxy by default.
assert.equal(resolveBrowserProxy('https://www.instagram.com/', env), null)
assert.equal(resolveBrowserProxy('https://example.com/', env), null)

// 4. Opt-in: route ALL egress through the proxy.
assert.ok(resolveBrowserProxy('https://example.com/', { ...env, GOGO_BROWSER_PROXY_ALL: '1' }))

// 5. Custom host list overrides the default set.
assert.equal(resolveBrowserProxy('https://blinkit.com/', { ...env, GOGO_BROWSER_PROXY_HOSTS: 'onlyme.com' }), null)
assert.ok(resolveBrowserProxy('https://shop.onlyme.com/', { ...env, GOGO_BROWSER_PROXY_HOSTS: 'onlyme.com' }))
assert.ok(proxyRequiredHosts({}).includes('blinkit.com'))

// 6. Allowlist host is derived from the proxy URL (with or without scheme).
assert.equal(proxyAllowlistHost(env), 'gw.residential.example.com')
assert.equal(proxyAllowlistHost({ GOGO_BROWSER_PROXY_URL: 'gw2.residential.example.com:9000' } as any), 'gw2.residential.example.com')

console.log('✅ browser residential-proxy egress: env-gated, provider-scoped, credential-free in code')

// Live 2 Oct: Instamart scripts use sibling hosts, not *.www.swiggy.com.
assert.deepEqual(Object.keys(browserPageAllowlist('https://www.swiggy.com/instamart')).sort(),[
  '*.www.swiggy.com','www.swiggy.com','media-assets.swiggy.com',
  'instamart-media-assets.swiggy.com','b67f7794189c.edge.sdk.awswaf.com',
  'b67f7794189c.f957f42c.ap-south-1.token.awswaf.com',
].sort())
assert.deepEqual(Object.keys(browserPageAllowlist('https://www.zepto.com/')).sort(),[
  'www.zepto.com','*.www.zepto.com','277df17f54ea.f4d9c26b.ap-south-1.token.awswaf.com','cdn.zeptonow.com',
].sort())
assert.equal('277df17f54ea.f4d9c26b.ap-south-1.token.awswaf.com' in browserPageAllowlist('https://zepto.com.example.com'),false)
assert.deepEqual(Object.keys(browserPageAllowlist('https://example.com')),['example.com','*.example.com'])
assert.equal('media-assets.swiggy.com' in browserPageAllowlist('https://swiggy.com.example.com'),false)
console.log('PASS: observed Swiggy page dependencies allowed only for the specific provider; unrelated egress unchanged')
