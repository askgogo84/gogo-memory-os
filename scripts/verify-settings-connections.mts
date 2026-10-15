import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { CONNECTION_CATALOGUE, CONNECTION_CATEGORIES, catalogueDomain, findCatalogueSite } from '../lib/dashboard/connection-catalogue'
// Settings and Connections from the approved 15 Oct mock. Run: npx tsx scripts/verify-settings-connections.mts
const read = (p: string) => readFileSync(new URL('../' + p, import.meta.url), 'utf8')

// The catalogue: India-first, every category filled, ids unique, real https sites.
assert.ok(CONNECTION_CATALOGUE.length >= 55, `catalogue has ${CONNECTION_CATALOGUE.length} sites`)
assert.equal(new Set(CONNECTION_CATALOGUE.map(s => s.id)).size, CONNECTION_CATALOGUE.length, 'ids are unique')
for (const c of CONNECTION_CATEGORIES) assert.ok(CONNECTION_CATALOGUE.some(s => s.category === c.id), `${c.id} has sites`)
for (const site of CONNECTION_CATALOGUE) {
  assert.equal(new URL(site.url).protocol, 'https:', site.id)
  assert.ok(catalogueDomain(site) && !catalogueDomain(site).startsWith('www.'), site.id)
}
for (const name of ['Amazon.in', 'Flipkart', 'Myntra', 'Blinkit', 'Zepto', 'Swiggy', 'Zomato', 'MakeMyTrip', 'IRCTC', 'IndiGo', 'Uber', 'Ola', 'BookMyShow', 'District', 'PVR INOX', 'Playo', 'Practo', 'Urban Company'])
  assert.ok(CONNECTION_CATALOGUE.some(s => s.name === name), `${name} is listed`)
assert.equal(catalogueDomain(findCatalogueSite('amazon')!), 'amazon.in')
assert.equal(catalogueDomain(findCatalogueSite('bookmyshow')!), 'bookmyshow.com')
assert.equal(findCatalogueSite('nope'), null)
assert.ok(CONNECTION_CATALOGUE.filter(s => s.category === 'work').every(s => s.kind === 'soon'), 'work apps have no connection yet and say so')

// Sign-in keeps the session, never the password: the person signs in in their own secure browser.
const store = read('lib/dashboard/site-sessions.ts')
assert.match(store, /startProviderBrowserHandoff\(\{ userId: actor\.userId, url: site\.url, sessionTaskId: runId \}\)/)
assert.match(store, /authMethod: 'human_handoff'/)
assert.doesNotMatch(store, /password\s*:/i, 'no password is ever stored')
assert.match(store, /status: 'revoked'/)
const route = read('app/api/dashboard/connections/route.ts')
assert.match(route, /requireAgentMutationOrigin\(request\)/)
assert.match(route, /site\.kind === 'soon'\) return NextResponse\.json\(\{ error: 'not_available_yet' \}, \{ status: 409 \}\)/)

// The page: eight sections, phone-first picker, live permissions, spending pause, honest payment state.
const view = read('components/dashboard/settings-view.tsx')
for (const label of ['General', 'Connections', 'Permissions', 'Payments and spending', 'Addresses', 'Notifications', 'Voice and keyboard', 'Invites'])
  assert.ok(view.includes(`'${label}'`), `section ${label}`)
assert.match(view, /savePermission\('payments', next \? 'off' : 'ask'\)/)
assert.match(view, /Not available yet: we are waiting on Razorpay/)
assert.match(view, /fetch\('\/api\/agent\/permissions', \{ method: 'PUT'/)
assert.doesNotMatch(view, /\bitalic\b/)
const nav = read('components/dashboard/dashboard-nav.tsx')
assert.match(nav, /href:'\/dashboard\/settings', label:'Settings'/)
assert.match(view, /Opening \$\{site\.name\} in your secure browser\. This can take up to a minute/)
// 15 Oct live: Amazon sign-in failed with browser_handoff_in_use, held by the earlier Myntra sign-in that was confirmed
// without closing its browser. Confirming now closes it, a busy browser retries once after closing old sign-ins, and the
// page says plainly when another task holds the browser.
assert.match(store, /if \(error\?\.message === 'browser_handoff_in_use' && await releaseEarlierSignIns\(actor, runId\)\)/)
assert.match(store, /await releaseEarlierSignIns\(actor, null, site\.id\)/)
assert.match(store, /cancelProviderBrowserHandoff\(actor\.userId, handoff\)/)
assert.match(store, /throw new Error\(error\?\.message === 'browser_handoff_in_use' \? 'browser_busy'/)
assert.match(view, /Your secure browser is busy with another task that is waiting for you/)
console.log('verify-settings-connections: ok')
