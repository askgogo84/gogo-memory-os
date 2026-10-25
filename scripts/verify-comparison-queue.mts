import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { browserPageAllowlist } from '../lib/agent/browser-page-network'
// 16 Oct live: Zepto's search API was blocked by the page allowlist (results page had 101 characters).
assert.ok(Object.keys(browserPageAllowlist('https://www.zepto.com/search?query=amul')).includes('bff-gateway.zepto.com'))
// 16 Oct live: a Blinkit location handoff from one comparison kept the next comparison "still checking".
const pc = readFileSync(new URL('../lib/commerce/price-comparison.ts', import.meta.url), 'utf8')
assert.match(pc, /Boolean\(row\.metadata_json\?\.handoff\?\.takeoverUrl\) && !row\.metadata_json\?\.comparison_parent_id/)
const bc = readFileSync(new URL('../lib/agent/browser-command.ts', import.meta.url), 'utf8')
assert.match(bc, /if\(!meta\.comparison_parent_id\|\|meta\.comparison_parent_id===parentId\)continue/, 'only other comparisons are released')
assert.match(bc, /runMetadata\.comparison_parent_id&&!runMetadata\.handoff\)await releaseOlderComparisonHandoffs/)
// The person's own reads still never release comparison handoffs, and vice versa.
assert.match(bc, /meta\.commerce_parent_id\|\|meta\.comparison_parent_id\|\|meta\.site_session\)continue/)
console.log('verify-comparison-queue: Zepto API allowed, comparisons not held by older store handoffs')

// 16 Oct live: Reliance Digital's page scripts come from cdn.jiostore.online; without it the page was blank.
assert.ok(Object.keys(browserPageAllowlist('https://www.reliancedigital.in/products?q=iphone')).includes('cdn.jiostore.online'))
console.log('verify-comparison-queue: Reliance Digital page CDN allowed')
