// 22 Oct live: instagram.com stayed on a blank splash / bounced to login in the cloud browser for a public profile.
// Run: npx tsx scripts/verify-instagram-public-read.mts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { browserPageAllowlist } from '../lib/agent/browser-page-network'
import { proxyRequiredHosts, resolveBrowserProxy } from '../lib/agent/browser-proxy'

const allow = browserPageAllowlist('https://www.instagram.com/zomato/')
for (const h of ['www.instagram.com', 'static.cdninstagram.com', '*.cdninstagram.com', '*.fbcdn.net']) assert.ok(h in allow, `allowlist has ${h}`)
assert.ok(!('*.fbcdn.net' in browserPageAllowlist('https://www.zomato.com/')), 'Instagram CDN only for Instagram pages')

// Residential egress applies to Instagram when a proxy is configured, even with a custom host list.
assert.ok(proxyRequiredHosts({ GOGO_BROWSER_PROXY_HOSTS: 'onlyme.com' }).includes('instagram.com'))
assert.ok(resolveBrowserProxy('https://www.instagram.com/zomato/', { GOGO_BROWSER_PROXY_URL: 'http://gw.example.com:7000' }))
assert.equal(resolveBrowserProxy('https://www.instagram.com/zomato/', {}), null, 'no proxy configured → none used')

// Read-only public view: retry a login bounce once, close the popup, never type.
const src = readFileSync('lib/agent/secure-computer.ts', 'utf8')
assert.match(src, /if\(!reuse&&payload\.mode==='read'&&isInstagramUrl\(payload\.url\)\)await instagramPublicRead\(page,payload\.url,navTimeout\);/)
const helper = src.slice(src.indexOf('async function instagramPublicRead'), src.indexOf('(async()=>{', src.indexOf('async function instagramPublicRead')))
assert.doesNotMatch(helper, /\.fill\(|\.type\(|keyboard\.type/, 'never enters anything')
assert.match(helper, /if\(i>0\)break;/, 'retries the bounce only once')
console.log('Instagram public read: CDN hosts allowed, residential egress when configured, one retry, no typing')
