// Real Chromium against local pages built like Playo's booking flow (mapped live on 11 Oct):
// venue cards that are plain divs, a Book Now button, Headless UI style listboxes that only take a
// real pointer press, a calendar of plain divs, Add To Cart, and a cart with a pay button.
// Runs the production worker script (BROWSER_SCRIPT) wave by wave. Not in the CI chain: it needs a
// local Chromium. Run: PW_NODE_MODULES=<dir with playwright> npx tsx scripts/verify-browser-widgets.mts
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const pwModules = process.env.PW_NODE_MODULES || ''
if (!pwModules || !existsSync(join(pwModules, 'playwright'))) {
  console.log('SKIP verify-browser-widgets: set PW_NODE_MODULES to a node_modules folder that has playwright')
  process.exit(0)
}
const work = mkdtempSync(join(tmpdir(), 'gogo-widgets-'))
const source = readFileSync('lib/agent/secure-computer.ts', 'utf8') + '\nexport {BROWSER_SCRIPT}'
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const exports: any = {}
const real = await import('../lib/agent/browser-page-readiness.ts')
runInNewContext(code, { exports, process: { env: {} }, Buffer, URL, console, setTimeout, clearTimeout,
  require: (name: string) => name === './browser-page-readiness' ? real
    : name === './secure-browser-bootstrap' ? { BROWSER_PROFILE_DIR: join(work, 'profile'), SANDBOX_WORKDIR: work, browserSandboxNameFor: () => 'x' }
    : name === './persistent-commerce-browser' ? { COMMERCE_CDP_URL: 'http://127.0.0.1:9' }
    : new Proxy({}, { get: () => () => null }) })
const scriptPath = join(work, 'gogo-browser.js')
writeFileSync(scriptPath, exports.BROWSER_SCRIPT)

const page = (name: string) => 'file://' + resolve('scripts/fixtures/booking-widgets', name)
function wave(url: string, actions: any[]) {
  const payload = Buffer.from(JSON.stringify({ url, mode: 'execute', actions, bookingFlow: true, keepAlive: false })).toString('base64')
  const run = spawnSync('node', [scriptPath, payload], { encoding: 'utf8', timeout: 90_000,
    env: { ...process.env, NODE_PATH: pwModules, PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers' } })
  assert.equal(run.status, 0, run.stderr)
  const lines = run.stdout.trim().split('\n')
  return JSON.parse(lines[lines.length - 1])
}
const steps = (out: any) => out.actions.map((a: any) => `${a.kind}:${a.status}${a.failure?.reason ? ':' + a.failure.reason : ''}`)

// 1. A venue card with no link opens by its visible name.
const list = wave(page('list.html'), [{ kind: 'click_text', text: 'Machaxi Milan Sports Centre' }])
assert.deepEqual(steps(list), ['click_text:done'])
assert.match(list.url, /venue\.html\?v=machaxi$/)

// 2. Book Now.
const venue = wave(page('venue.html'), [{ kind: 'click_text', text: 'Book Now' }])
assert.deepEqual(steps(venue), ['click_text:done'])
assert.match(venue.url, /booking\.html$/)

// 3. Sport, date, time and court through pointer-only listboxes and a div calendar, then Add To Cart.
const booking = wave(page('booking.html'), [
  { kind: 'click', selector: '#sport-btn' }, { kind: 'click_text', text: 'Badminton' },
  { kind: 'click', selector: '#date-btn' }, { kind: 'click_text', text: '17' },
  { kind: 'click', selector: '#time-btn' }, { kind: 'click_text', text: '07:00 AM' },
  { kind: 'click', selector: '#court-btn' }, { kind: 'click_text', text: 'Premium Synthetic Court 1' },
  { kind: 'click_text', text: 'Add To Cart' },
])
assert.deepEqual(steps(booking), Array(9).fill(0).map((_, i) => (i % 2 === 0 && i < 8 ? 'click:done' : 'click_text:done')))
assert.match(decodeURIComponent(booking.url), /cart\.html\?d=2026-10-17&t=07:00 AM$/)

// 4. The pay control is never pressed, by text or by selector.
const cart = wave(booking.url, [{ kind: 'click_text', text: 'Proceed to Pay INR 375' }, { kind: 'click', selector: '#pay' }])
assert.deepEqual(steps(cart), ['click_text:skipped:payment_control', 'click:skipped:payment_control'])
assert.match(cart.text, /Proceed to Pay INR 375/)

console.log('Browser widgets: div venue card, Book Now, pointer-only listboxes, div calendar and Add To Cart work in real Chromium; Pay is never pressed')
