import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { CONNECTION_CATALOGUE, CONNECTION_CATEGORIES, catalogueDomain, findCatalogueSite } from '../lib/dashboard/connection-catalogue'
import * as catalogue from '../lib/dashboard/connection-catalogue'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
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
// 20 Oct live: Settings sat on "Opening…" for 52s while the secure browser started, and the person gave up. The route
// now creates the task, responds at once and opens the browser after the response; the browser page shows progress.
assert.match(route, /const \{ runId \} = await createSiteSignInRun\(actor, site\.id\)/)
assert.match(route, /after\(\(\) => openSiteSignInBrowser\(actor, runId, site\.id\)/)
assert.doesNotMatch(route, /await startSiteSignIn\(/, 'the sign-in request never waits for the browser')
const browserPage = read('app/dashboard/(app)/activity/[runId]/browser/page.tsx')
assert.match(browserPage, /<SignInOpening siteName=\{signInSite\.name\}\/>/)
assert.ok(browserPage.indexOf('signInSite&&!run.metadata?.handoff') < browserPage.indexOf('if(!browser.hasBrowser)notFound()'), 'a starting sign-in is shown, not a 404')
assert.match(read('components/dashboard/sign-in-opening.tsx'), /router\.refresh\(\), 3000/)
console.log('verify-settings-connections: ok')

// Render the actual Connections UI with inert saved-session/OAuth fixtures.
// A recorded but expired login must not contradict the reauthentication message
// by claiming Connected in the catalogue. No effects, events or providers run.
{
  const require = createRequire(import.meta.url)
  const React = require('react')
  const { renderToStaticMarkup } = require('react-dom/server')
  let providers: Array<{provider:string;label:string;state:string}> = []
  let hook = 0
  const exports: any = {}
  const forbidden = () => { throw new Error('unexpected provider or unrelated component in inert render') }
  const dependencies: Record<string, unknown> = {
    react: { ...React, useState: (initial: unknown) => React.useState(hook++ === 3 ? providers : initial) },
    'react/jsx-runtime': require('react/jsx-runtime'),
    'next/link': { __esModule: true, default: ({href, children, ...rest}: any) => React.createElement('a', {href, ...rest}, children) },
    './theme-toggle': { ThemeToggle: forbidden },
    './sign-out-button': { SignOutButton: forbidden },
    './daily-brief-email': { DailyBriefEmail: forbidden },
    './email-preferences': { EmailPreferences: forbidden },
    '@/lib/dashboard/connection-catalogue': catalogue,
    '@/lib/dashboard/approx-location': { LOCATION_STORAGE_KEY: 'synthetic', parseLocationPreference: forbidden },
    '@/lib/product-urls': { waLink: forbidden },
  }
  const js = ts.transpileModule(view + '\nexports.ConnectionsForTest = Connections', {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  runInNewContext(js, { exports, require: (id: string) => {
    assert.ok(Object.hasOwn(dependencies, id), `unexpected import ${id}`)
    return dependencies[id]
  }, fetch: forbidden, console })
  function render(status?: string, oauth: typeof providers = []) {
    hook = 0; providers = oauth
    return renderToStaticMarkup(React.createElement(exports.ConnectionsForTest, {
      sites: status === undefined ? [] : [{siteId:'amazon',name:'Amazon.in',domain:'amazon.in',status,since:null}],
      google: {gmail:false,calendar:false}, creditiq:false, phone:'',
    })) as string
  }
  function amazonCatalogue(html: string) {
    const shopping = html.split('>Shopping</h2>')[1]
    assert.ok(shopping, 'rendered shopping catalogue exists')
    const start = shopping.indexOf('>Amazon.in</div>')
    const end = shopping.indexOf('>Flipkart</div>', start)
    assert.ok(start >= 0 && end > start, 'actual Amazon catalogue row exists')
    return shopping.slice(start, end)
  }
  assert.match(amazonCatalogue(render('active')), />Connected</)
  for (const status of ['expired','revoked','needs_auth','unknown','']) {
    const html = render(status)
    assert.match(html, /Needs you to sign in again/)
    assert.doesNotMatch(amazonCatalogue(html), />Connected</, `${status || 'missing'} must not claim an active login`)
    assert.match(amazonCatalogue(html), />(?:Connect|Sign in)</, 'existing reconnection control remains available')
  }
  assert.doesNotMatch(amazonCatalogue(render()), />Connected</, 'absent session is not connected')
  const oauth = render('expired', [{provider:'amazon',label:'Amazon.in',state:'authorized'}])
  assert.match(oauth, /Connected through the provider/, 'independent authorized provider remains connected')
  console.log('Settings actual render: active, expired, revoked, unknown, absent and authorized-provider states')
}
