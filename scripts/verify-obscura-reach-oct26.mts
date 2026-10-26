// 26 Oct production (8cccffa7): Obscura was enabled for flipkart.com but never ran, because comparison store reads use a
// kept-alive commerce session (ineligible), and it emits no logs. Hotels: every Serper listing lacked a usable cid, so all
// were omitted, and the stay note repeated "no booking was made".
// Offline. Run: npx --yes tsx scripts/verify-obscura-reach-oct26.mts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://synthetic.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'synthetic'
process.env.OPENAI_API_KEY ||= 'synthetic'

// ── 1. Comparison child reads try Obscura first, under strict conditions (source wiring) ──
const cmd = readFileSync(new URL('../lib/agent/browser-command.ts', import.meta.url), 'utf8')
const gate = cmd.match(/const comparisonObscuraAllowed=([\s\S]*?)\n\s*const comparisonReadDeadline/)?.[1] || ''
assert.ok(gate, 'comparison Obscura gate exists')
for (const need of [
  "process.env.GOGO_OBSCURA_PUBLIC_READ==='1'", "params.mode==='read'", 'Boolean(runMetadata.comparison_parent_id)', '!resumePage',
  '!runMetadata.handoff', '!params.command.vaultCredentialId', '!params.bookingOtp', '!params.loginCode',
  '!reconciledResult', '!accountCreation', '!providerBooking', '!publicResult',
]) assert.ok(gate.includes(need), `gate requires ${need}`)
assert.doesNotMatch(gate, /commerce_parent_id/, 'single-store commerce (checkout-capable) reads are not routed to Obscura')
assert.match(cmd, /reconciledResult\|\|publicResult\|\|comparisonResult\|\|await runSecureBrowser\(/, 'Chromium stays the fallback')
assert.match(cmd, /fallbackReadDeadline=publicReadDeadline\|\|comparisonReadDeadline/, 'Obscura and the fallback share one read budget')
assert.match(cmd, /readDeadline:fallbackReadDeadline/)
// Review: a resumed read deletes runMetadata.handoff before this point, so the gate must also check resumePage
// (computed before the delete) or a Take Control → Resume would be read statelessly without the person's changes.
assert.ok(cmd.indexOf('const resumePage=') < cmd.indexOf('delete runMetadata.handoff'), 'resumePage is computed before the handoff is released')
assert.match(cmd, /if\(comparisonResult\)comparisonResult\.summary=`\$\{comparisonResult\.summary\} \(Listed price; your delivery PIN was not applied on this read\.\)`/, 'Obscura evidence never implies the PIN was applied')

// ── 2. tryObscuraBrowserRead reports each outcome, with no page content or identifiers ──
const sc = await import('../lib/agent/secure-computer')
const logs: string[] = []
const realLog = console.log
console.log = (...a: any[]) => { logs.push(a.map(String).join(' ')) }
try {
  process.env.GOGO_OBSCURA_PUBLIC_READ = '1'
  process.env.GOGO_OBSCURA_PILOT_HOSTS = 'www.flipkart.com'
  // Not a pilot host → silent (every ordinary read passes through here).
  assert.equal(await sc.tryObscuraBrowserRead({ userId: 'u-secret', url: 'https://www.amazon.in/dp/X?q=secret', objective: 'price secret', mode: 'read' } as any), null)
  // Pilot host but a kept-alive fallback → silent (it follows an attempt already logged).
  assert.equal(await sc.tryObscuraBrowserRead({ userId: 'u', url: 'https://www.flipkart.com/p/1', objective: 'o', mode: 'read', keepAlive: true } as any), null)
  // Pilot host turned away for a Vault login → ineligible, logged.
  assert.equal(await sc.tryObscuraBrowserRead({ userId: 'u-secret', url: 'https://www.flipkart.com/account?q=secret', objective: 'price secret', mode: 'read', vaultCredentialId: 'v' } as any), null)
  // Too little budget → no_budget, logged.
  assert.equal(await sc.tryObscuraBrowserRead({ userId: 'u-secret', url: 'https://www.flipkart.com/p/1', objective: 'o', mode: 'read' } as any, Date.now() + 10_000), null)
  // Flag off → silent.
  process.env.GOGO_OBSCURA_PUBLIC_READ = '0'
  assert.equal(await sc.tryObscuraBrowserRead({ userId: 'u', url: 'https://www.flipkart.com/p/1', objective: 'o', mode: 'read' } as any), null)
} finally { console.log = realLog }
const lines = logs.filter(l => l.startsWith('OBSCURA_READ:'))
assert.equal(lines.length, 2, 'one line per attempt while enabled; none when off')
const parsed = lines.map(l => JSON.parse(l.slice('OBSCURA_READ:'.length)))
assert.deepEqual(parsed.map(p => [p.host, p.outcome]), [['www.flipkart.com', 'ineligible'], ['www.flipkart.com', 'no_budget']])
for (const p of parsed) assert.deepEqual(Object.keys(p).sort(), ['host', 'ms', 'outcome'])
assert.ok(!lines.join('').match(/secret|\/dp\/|account|u-secret/), 'no path, query, objective or user id in logs')
const src = readFileSync(new URL('../lib/agent/secure-computer.ts', import.meta.url), 'utf8')
for (const o of ["'gated'", "'unverified'", "'used'", "'no_candidate'"]) assert.ok(src.includes(o), `outcome ${o} reported`)
assert.match(src, /failure='no_candidate:'\+\(\/\^\(\?:obscura_\[a-z_\]\{3,40\}\|browser_read_deadline\)\$\/\.test\(m\)\?m:'error'\)/, 'only known error codes reach the log')
assert.match(src, /withinReadBudget\(readDeadline-90_000,\(\)=>assessReadOutcome/, 'the assessor also leaves the fallback 90s')

// ── 3. Places: a provider place id is an exact Maps source ──
const places = await import('../lib/agent/places-search')
const PID = 'ChIJ2xUGxbLJ5zsRm0GPvA1yvQ8'
assert.equal(places.placeSourceUrl({ placeId: PID }), `https://www.google.com/maps/place/?q=place_id:${PID}`)
assert.equal(places.placeSourceUrl({ cid: '1234567890123', placeId: PID }), 'https://maps.google.com/?cid=1234567890123', 'cid still preferred')
for (const bad of ['', 'short', 'https://evil.example/x', 'ChIJ<script>alert(1)</script>xx', 42 as any]) assert.equal(places.placeSourceUrl({ placeId: bad }), undefined, `rejects ${bad}`)
process.env.SERPER_API_KEY = 'synthetic'
const fakeFetch = (rows: any[]) => (async () => new Response(JSON.stringify({ places: rows }), { status: 200 })) as any
const HOTEL = 'Find hotels near Mumbai Airport for 12–16 November for 2 adults. Research only; do not book.'
const warns: string[] = []
const realWarn = console.warn
console.warn = (...a: any[]) => { warns.push(a.map(String).join(' ')) }
let listed = '', none = ''
try {
  listed = String(await places.answerPlaces(HOTEL, fakeFetch([
    { title: 'Roswyn Hotel', address: 'Sahar Rd, Andheri East, Mumbai Airport', rating: 4.3, ratingCount: 1200, category: 'Hotel', placeId: PID },
    { title: 'Hotel Unlinked', address: 'Andheri East, Mumbai Airport', rating: 4.9, category: 'Hotel', phoneNumber: '+91 99999 00000' },
  ])))
  none = String(await places.answerPlaces(HOTEL, fakeFetch([{ title: 'Only Unlinked', address: 'Mumbai Airport', category: 'Hotel' }])))
} finally { console.warn = realWarn }
assert.match(listed, /Roswyn Hotel/)
assert.ok(listed.includes(`https://www.google.com/maps/place/?q=place_id:${PID}`))
assert.doesNotMatch(listed, /Hotel Unlinked/, 'unlinked listings are still never recommended')
assert.match(listed, /1 listing omitted/)
assert.equal((none.match(/[Nn]o booking was made/g) || []).length, 1, 'all-omitted stay answer says it once')
const w = warns.filter(l => l.startsWith('PLACES_UNLINKED:')).map(l => JSON.parse(l.slice('PLACES_UNLINKED:'.length)))
assert.equal(w.length, 2)
assert.deepEqual(w[0], { count: 1, of: 2, fields: ['address', 'category', 'phoneNumber', 'rating', 'title'] }, 'field names only')
assert.ok(!warns.join('').includes('99999'), 'no values logged')

// ── 4. "Hand control back to me" after a plain public read opens Take Control ──
const bc = await import('../lib/agent/browser-command')
for (const t of [
  'Open https://www.croma.com/x/p/1 read-only and hand control back to me so I can set my delivery pincode myself. Do not add to cart or order.',
  'Open the page and give control back to me', 'read the page then pass the browser control to me',
  'Open it and hand it back to me', 'open flipkart so I can take over the page', 'Open this page; I want to take control of the browser',
  'open it and let me take over from here',
]) assert.equal(bc.wantsBrowserHandBack(t), true, t)
for (const t of [
  'Open https://en.wikipedia.org/wiki/X read-only and tell me the title',
  "Open the page but don't hand control back to me", 'Do not give control to me, just read it',
  'what is the price shown? control panel settings', 'Take control of my reminders',
  "Check the price; I'll take over the purchase myself later", 'read it so I can take control of my budget', 'open flipkart so I can take over',
]) assert.equal(bc.wantsBrowserHandBack(t), false, t)
const cmd2 = readFileSync(new URL('../lib/agent/browser-command.ts', import.meta.url), 'utf8')
const hbGate = cmd2.match(/if\(params\.mode==='read'&&!persistentCommerce&&!persistentAccountSession&&!params\.command\.vaultCredentialId&&!resumedFromHandoff\s*&&!reconciledResult&&runMetadata\.browser_safe_to_retry!==false&&wantsBrowserHandBack\(params\.command\.objective\)\)\{/)
assert.ok(hbGate, 'hand-back only for fresh plain public reads: no commerce, comparison, Vault, booking, sign-up, resumed or unknown-outcome run')
// Review: Resume re-runs the same objective after deleting the handoff; the flag is captured before that delete.
assert.ok(cmd2.indexOf('const resumedFromHandoff=') < cmd2.indexOf('delete runMetadata.handoff'), 'resume state captured before the handoff is released')
assert.match(cmd2, /const resumedFromHandoff=Boolean\(runMetadata\.handoff\)\|\|runMetadata\.handback===true/)
// Review: a newer read never cancels a handed-back page the person may be driving.
const rel = cmd2.slice(cmd2.indexOf('async function releaseOlderReadHandoffs'), cmd2.indexOf('async function releaseClosedReadHandoffs'))
assert.match(rel, /if\(meta\.handback&&await \(await import\('\.\/browser-handoff-health'\)\)\.browserHandoffIsLive\(handoff\?\.takeoverUrl\)\.catch\(\(\)=>false\)\)continue/)
const hbBlock = cmd2.slice(cmd2.indexOf(hbGate![0]), cmd2.indexOf("return {runId:params.runId,status:'completed' as const,capability:'browser' as const,risk:params.command.risk,text:`${result.summary}"))
assert.match(hbBlock, /startProviderBrowserHandoff\(\{userId:browserOwner,url:sourceUrl\|\|params\.command\.url,sessionTaskId:params\.runId\}\)/, 'no keepAlive, same owner, page that was read')
assert.match(hbBlock, /\.eq\('status','completed'\)/, 'only a still-completed run is reopened')
assert.match(hbBlock, /handoff,handback:true\}/, 'the run is marked as handed back')
assert.match(hbBlock, /cancelProviderBrowserHandoff/, 'a failed save releases the browser')
assert.match(hbBlock, /tap Take control/)
assert.match(hbBlock, /won't add to cart, order or submit anything/)
assert.match(hbBlock, /couldn't open a browser for you to take control/, 'failure is said plainly, read result kept')

console.log('Obscura reach: comparison reads try Obscura first with logged outcomes; hotels accept place ids as Maps sources')

// ── 5. Hotels: production Serper rows carry only title, coordinates and ratings (26 Oct 13:20 log) ──
{
  const places5 = await import('../lib/agent/places-search')
  assert.equal(places5.placeSourceUrl({ lat: 19.0974, lng: 72.8747 }), 'https://www.google.com/maps/search/?api=1&query=19.0974%2C72.8747')
  assert.equal(places5.placeSourceUrl({ placeId: 'ChIJ2xUGxbLJ5zsRm0GPvA1yvQ8', lat: 19.1, lng: 72.8 }), 'https://www.google.com/maps/place/?q=place_id:ChIJ2xUGxbLJ5zsRm0GPvA1yvQ8', 'exact ids still preferred')
  for (const [lat, lng] of [[0, 0], [91, 72], [19, 181], [NaN, 72], ['19.1; drop', '72'], [undefined, 72]] as any[])
    assert.equal(places5.placeSourceUrl({ lat, lng }), undefined, `rejects ${lat},${lng}`)
  process.env.SERPER_API_KEY = 'synthetic'
  const ff = (rows: any[]) => (async () => new Response(JSON.stringify({ places: rows }), { status: 200 })) as any
  const rows = [
    { title: 'Hotel Sahar Palace', latitude: 19.0989, longitude: 72.8697, rating: 4.1, ratingCount: 820, position: 1 },
    { title: 'Airport Lodge', latitude: '19.1012', longitude: '72.8721', rating: 3.9, ratingCount: 410, position: 2 },
    { title: 'No Coords Inn', rating: 4.8, ratingCount: 50, position: 3 },
  ]
  const warn5: string[] = []; const rw = console.warn; console.warn = (...a: any[]) => { warn5.push(a.join(' ')) }
  let out = ''
  try { out = String(await places5.answerPlaces('Find hotels near Mumbai Airport for 12–16 November for 2 adults. Show source links. Research only; do not book.', ff(rows))) } finally { console.warn = rw }
  assert.match(out, /Hotel Sahar Palace/)
  assert.ok(out.includes('https://www.google.com/maps/search/?api=1&query=19.0989%2C72.8697'))
  assert.ok(out.includes('https://www.google.com/maps/search/?api=1&query=19.1012%2C72.8721'), 'numeric strings accepted')
  assert.doesNotMatch(out, /No Coords Inn/, 'a listing with no source is still never recommended')
  assert.match(out, /1 listing omitted/)
  assert.doesNotMatch(out, /\n\n\n|\nundefined|\n ·/, 'no blank or "undefined" address line')
  assert.match(out, /didn't supply addresses here, so check each location on its Maps link/)
  assert.doesNotMatch(out, /Few results were inside/, 'no area claim without addresses')
  assert.equal((out.match(/[Nn]o booking was made/g) || []).length, 1)
  assert.match(out, /Room rates and availability for your dates are not verified here/)
  assert.equal(warn5.filter(l => l.startsWith('PLACES_UNLINKED:')).length, 1, 'only the coordinate-less row is unlinked')
}
console.log('Hotels: provider coordinates are an exact Maps source; no invented addresses or area claims')
