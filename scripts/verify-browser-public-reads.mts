import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { browserPageAllowlist } from '../lib/agent/browser-page-network'
import { blockedHostsLogLine } from '../lib/agent/browser-blocked-hosts'
import { isLoginUrl } from '../lib/agent/browser-evidence'
import { namesRetailerPriceRead } from '../lib/commerce/comparison-model'
import { indiaShoppingSearch } from '../lib/web-search'

// Replicates the broker's allowed() predicate (managed-browser.ts) to prove the probe-
// required first-party hosts now pass while third parties stay blocked.
const allowed = (hosts: string[], value: string) => {
  try { const u = new URL(value); return ['https:', 'http:', 'wss:', 'ws:'].includes(u.protocol) && !u.username && !u.password && hosts.some(h => h.startsWith('*.') ? u.hostname.endsWith(h.slice(1)) : u.hostname === h) } catch { return false }
}

// --- #1 allowlist: exact first-party hosts the A-vs-B probe proved required ---
{
  const fk = Object.keys(browserPageAllowlist('https://www.flipkart.com/account/login'))
  assert.ok(fk.includes('sonic.fdp.api.flipkart.com'), 'flipkart fraud/collector API allowed')
  assert.ok(fk.includes('1.rome.api.flipkart.com'), 'flipkart API gateway allowed')
  assert.equal(allowed(fk, 'https://sonic.fdp.api.flipkart.com/4/data/collector/business'), true)
  assert.equal(allowed(fk, 'https://1.rome.api.flipkart.com/x'), true)
  assert.equal(allowed(fk, 'https://googleads.g.doubleclick.net/x'), false, 'third-party tracker stays blocked')
  assert.equal(allowed(fk, 'https://evil.example.com/'), false)
  assert.equal(allowed(fk, 'https://notflipkart.com/'), false)

  const cr = Object.keys(browserPageAllowlist('https://www.croma.com/searchB?q=sony'))
  for (const h of ['assets.croma.com', 'media-ik.croma.com', 'api.croma.com']) {
    assert.ok(cr.includes(h), `croma first-party host ${h} allowed`)
    assert.equal(allowed(cr, `https://${h}/x`), true)
  }
  assert.equal(allowed(cr, 'https://assets.adobedtm.com/x'), false, 'croma third-party stays blocked')

  const am = Object.keys(browserPageAllowlist('https://www.amazon.in/'))
  assert.ok(am.includes('m.media-amazon.com') && am.includes('images-na.ssl-images-amazon.com'))

  // No broad wildcard like *.com / *.in anywhere.
  for (const url of ['https://www.flipkart.com/', 'https://www.croma.com/', 'https://www.amazon.in/', 'https://www.swiggy.com/']) {
    for (const h of Object.keys(browserPageAllowlist(url))) {
      assert.doesNotMatch(h, /^\*\.(com|in|net|org|co\.in)$/, `no broad wildcard: ${h}`)
    }
  }
}

// --- #2 blocked-host log shape: hostnames only, never URLs/tokens ---
{
  const line = blockedHostsLogLine({ runId: 'run1', site: 'www.flipkart.com', hosts: { 'sonic.fdp.api.flipkart.com': 8, 'https://leak.example.com/secret?token=abc123': 2 } })
  assert.ok(line.startsWith('BROWSER_BLOCKED_HOSTS '))
  const obj = JSON.parse(line.slice('BROWSER_BLOCKED_HOSTS '.length))
  assert.equal(obj.runId, 'run1')
  assert.equal(obj.site, 'www.flipkart.com')
  assert.equal(obj.hosts['sonic.fdp.api.flipkart.com'], 8)
  assert.equal(obj.hosts['leak.example.com'], 2, 'full URL reduced to hostname')
  assert.ok(!line.includes('token') && !line.includes('/secret') && !line.includes('abc123'), 'no tokens/paths leak')
  assert.equal(JSON.parse(blockedHostsLogLine({ site: 'x.com', hosts: {} }).slice('BROWSER_BLOCKED_HOSTS '.length)).runId, null)
}

// --- #3 public reads never navigate to login ---
{
  for (const u of ['https://www.amazon.in/ap/signin', 'https://www.flipkart.com/account/login', 'https://x.com/login', 'https://x.com/signin', 'https://x.com/accounts/login'])
    assert.equal(isLoginUrl(u), true, `login: ${u}`)
  for (const u of ['https://www.amazon.in/dp/B0XYZ12345', 'https://www.flipkart.com/search?q=iphone', 'https://www.flipkart.com/apple-iphone/p/abc', 'https://www.croma.com/searchB?q=sony'])
    assert.equal(isLoginUrl(u), false, `not login: ${u}`)
}

// --- #5 retailer price routing + negatives ---
{
  for (const t of ['Check the live price of Sony WH-1000XM5 on croma.com', 'price of iPhone 17 Pro 256GB on flipkart', 'what is the cost of the Pixel on amazon', 'is the iPhone in stock on croma.com'])
    assert.equal(namesRetailerPriceRead(t), true, `route: ${t}`)
  for (const t of ["what's the gold price today", 'upgrade price', 'price of bitcoin', 'tell me about the amazon rainforest', 'Find a well-rated veg burger near Rajajinagar on swiggy', "what's the weather in Bengaluru"])
    assert.equal(namesRetailerPriceRead(t), false, `must NOT hijack: ${t}`)
}

// --- #6 India localization for web_search fallback ---
{
  const s = indiaShoppingSearch('price of Sony WH-1000XM5 on Amazon')
  assert.match(s.query, /India/i); assert.match(s.query, /INR/i)
  assert.ok(s.includeDomains.includes('amazon.in') && s.includeDomains.includes('flipkart.com'))
  const n = indiaShoppingSearch('latest cricket score')
  assert.equal(n.query, 'latest cricket score'); assert.equal(n.includeDomains.length, 0)
  const already = indiaShoppingSearch('cheapest iPhone in India')
  assert.ok(already.includeDomains.length > 0)
  assert.doesNotMatch(already.query, /in India in INR/, 'does not double-append India/INR')
}

// --- #7 accurate failure copy (file-content) ---
{
  const sc = readFileSync('lib/agent/secure-computer.ts', 'utf8')
  assert.match(sc, /didn[’']t load in the secure browser/)
  assert.doesNotMatch(sc, /could not load in the cloud browser\. Availability and prices remain unverified; there is no usable sign-in page yet/)
  assert.match(sc, /sign in first — secure reconnect is coming soon/)
  const bc = readFileSync('lib/agent/browser-command.ts', 'utf8')
  assert.doesNotMatch(bc, /did not expose verifiable live availability/)
}

console.log('Browser public-reads fix verification passed')
