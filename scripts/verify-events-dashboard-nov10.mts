// AskGogo Events dashboard screens (approved mock 10 Nov, screens 3 and 4). The data behind them is tested in
// verify-events-store-rsvp-nov10 against real SQL; this checks the wiring that cannot run without a signed-in session.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
let checks = 0
const ok = (c: unknown, m: string) => { assert.ok(c, m); checks++ }
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const list = read('app/dashboard/(app)/events/page.tsx'), one = read('app/dashboard/(app)/events/[id]/page.tsx')
const route = read('app/api/dashboard/events/[id]/route.ts'), controls = read('components/dashboard/events/event-controls.tsx')
const nav = read('components/dashboard/dashboard-nav.tsx'), layout = read('app/dashboard/(app)/layout.tsx')

for (const [name, src] of [['list', list], ['event', one]] as const) {
  ok(/if \(!owner \|\| !eventsEnabledFor\(owner\)\) notFound\(\)/.test(src), `${name} page: hidden unless the signed-in owner is in GOGO_EVENTS_OWNERS`)
  ok(/String\(session\.telegramId\)/.test(src) && !/Number\(|parseInt\(/.test(src), `${name} page: the owner id stays an exact string`)
  ok(!/supabaseAdmin|from\('gogo_event/.test(src), `${name} page: reads only through the owner-scoped store`)
}
ok(/getEvent\(owner, id\)/.test(one) && /err\.code === 'not_found'\) notFound\(\)/.test(one), "another owner's event id is a 404")
ok(/guestLink\(owner, e\.id, g\.id\)/.test(one) && /g\.source === 'organizer'/.test(one), 'personal links are shown only for guests the organizer added')
ok(!/phone/.test(one.replace(/hasPhone/g, '')), 'no phone number is rendered')
ok(/To move or cancel the event, tell Gogo in chat\. It asks you to confirm first\./.test(one), 'moving and cancelling stay in chat, with its confirmation')

const post = route.slice(route.indexOf('export async function POST'))
ok(post.indexOf('verifySameOrigin(request)') < post.indexOf('getSession()') && post.indexOf('getSession()') < post.indexOf('eventsEnabledFor(owner)'), 'route: same origin, then session, then flag')
ok(/rotateShareLink\(owner, id\)/.test(route) && /disableShareLink\(owner, id\)/.test(route) && /revokeGuest\(owner, id, body\.guestId\)/.test(route), 'route: every action is scoped to the signed-in owner')
ok(!/cancelEvent|updateEvent|setPendingAction|sendWhatsApp|metaSend/.test(route), 'route: cannot cancel, move or message anyone')
eq([...route.matchAll(/^export (?:async function|const) (\w+)/gm)].map(m => m[1]).sort(), ['POST', 'dynamic'], 'route: only POST')
ok(/setAsk\('rotate'\)/.test(controls) && /setAsk\('off'\)/.test(controls) && /setAsk\(true\)/.test(controls), 'each change asks once on the page before it is made')
ok(/That did not work, so nothing was changed/.test(controls), 'a failure says nothing changed')
ok(/EVENTS_ITEM: NavItem = \{ href:'\/dashboard\/events'/.test(nav) && /const more = events \? \[EVENTS_ITEM, \.\.\.base\] : base/.test(nav), 'the Events nav entry appears only when the flag is on')
ok(/events:\(await import\('@\/lib\/events\/core'\)\)\.eventsEnabledFor\(String\(session\.telegramId\)\)/.test(layout), 'the shell reads the flag for the signed-in owner')
ok(!/italic/.test(list + one + controls), 'no italics')
ok(/min-h-\[4[08]px\]/.test(controls) && /min-h-\[48px\]/.test(list), 'tap targets are at least 40 px high')
function eq(a: unknown, b: unknown, m: string) { assert.deepEqual(a, b, m); checks++ }
console.log(`EVENTS_DASHBOARD_OK ${checks} checks`)
