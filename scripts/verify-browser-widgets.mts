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
function wave(url: string, actions: any[], extra: Record<string, unknown> = {}) {
  const payload = Buffer.from(JSON.stringify({ url, mode: 'execute', actions, bookingFlow: true, keepAlive: false, ...extra })).toString('base64')
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

// 2b. Picker buttons carry the field name shown beside them; the header Login menu has none.
const observed = wave(page('booking.html'), [])
const ctl = (sel: string) => observed.controls.find((c: any) => c.selector === sel)
assert.equal(ctl('#sport-btn')?.field, 'Sports')
assert.equal(ctl('#sport-btn')?.popup, 'listbox')
assert.equal(ctl('#date-btn')?.field, 'Date')
assert.equal(ctl('#time-btn')?.field, 'Start Time')
assert.equal(ctl('#court-btn')?.field, 'Court')
assert.equal(ctl('#headlessui-menu-button-r4')?.field, undefined)

// 2c. 12 Oct live run: the login box opens at the end of a long page and was cut off. An open
// dialog is read first, so its unlabelled mobile box is observed, and Gogo's own login step fills it
// (never the help form's Mobile*) and presses Send OTP.
const loginOpen = wave(page('venue.html'), [{ kind: 'click', selector: '#headlessui-menu-button-r2' }])
assert.match(loginOpen.text, /^\[Open dialog\] Login \/ Sign Up/)
const mobile = loginOpen.controls.find((c: any) => c.selector === '#m')
assert.ok(mobile && mobile.inDialog, 'the dialog input is among the observed controls')
const step = exports.bookingLoginActions(loginOpen, true)
assert.equal(JSON.stringify(step), JSON.stringify([{ kind: 'fill_phone', selector: '#m' }, { kind: 'click_text', text: 'Send OTP' }]))
const sent = (() => {
  const payload = Buffer.from(JSON.stringify({ url: page('venue.html'), mode: 'execute', bookingFlow: true, keepAlive: false,
    actions: [{ kind: 'click', selector: '#headlessui-menu-button-r2' }, ...step] })).toString('base64')
  const run = spawnSync('node', [scriptPath, payload], { encoding: 'utf8', timeout: 90_000,
    env: { ...process.env, GOGO_BOOKING_PHONE: '9876543210', NODE_PATH: pwModules, PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers' } })
  assert.equal(run.status, 0, run.stderr)
  const lines = run.stdout.trim().split('\n'); return JSON.parse(lines[lines.length - 1])
})()
assert.deepEqual(steps(sent), ['click:done', 'fill_phone:done', 'click_text:done'])
assert.match(sent.text, /Enter the OTP sent to \+91 \*+3210/, 'the code was requested for the number on file')
assert.doesNotMatch(JSON.stringify(sent), /9876543210/, 'the number never comes back in the result')

// 2d. Screenshot fallback (adapted from OrgoAI/bops): a booking wave can return the viewport image,
// and act at a point. The worker keeps every rule: never Pay, nothing added before login, no repeat
// Add to Cart, and the number is typed from the command-scoped variable only.
function waveEnv(url: string, actions: any[], extra: Record<string, unknown>, env: Record<string, string> = {}) {
  const payload = Buffer.from(JSON.stringify({ url, mode: 'execute', actions, bookingFlow: true, keepAlive: false, ...extra })).toString('base64')
  const run = spawnSync('node', [scriptPath, payload], { encoding: 'utf8', timeout: 90_000,
    env: { ...process.env, ...env, NODE_PATH: pwModules, PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers' } })
  assert.equal(run.status, 0, run.stderr)
  const lines = run.stdout.trim().split('\n'); return JSON.parse(lines[lines.length - 1])
}
const shot = waveEnv(page('vision.html'), [], { screenshot: true })
assert.ok(typeof shot.shot === 'string' && shot.shot.length > 2000, 'a viewport image comes back')
assert.ok(shot.viewport && shot.viewport.w > 0 && shot.viewport.h > 0)
const point = waveEnv(page('vision.html'), [{ kind: 'click_at', x: 170, y: 120 }, { kind: 'fill_phone_at', x: 400, y: 315 }], {}, { GOGO_BOOKING_PHONE: '9876543210' })
assert.deepEqual(steps(point), ['click_at:done', 'fill_phone_at:done'])
assert.match(point.text, /typed 10 digits ending 3210/)
assert.doesNotMatch(JSON.stringify(point), /9876543210/, 'the number never comes back')
const pay = waveEnv(page('vision.html'), [{ kind: 'click_at', x: 170, y: 220 }], {})
assert.deepEqual(steps(pay), ['click_at:skipped:payment_control'])
assert.doesNotMatch(pay.text, /PAID/)
const early = waveEnv(page('vision.html'), [{ kind: 'click_at', x: 370, y: 220 }], { loginFirst: true })
assert.deepEqual(steps(early), ['click_at:skipped:login_first'])
const again = waveEnv(page('vision.html'), [{ kind: 'click_at', x: 370, y: 220 }], { advancePressed: ['add to cart'] })
assert.deepEqual(steps(again), ['click_at:skipped:repeat'])
const once = waveEnv(page('vision.html'), [{ kind: 'click_at', x: 370, y: 220 }], {})
assert.deepEqual(steps(once), ['click_at:done'])
assert.equal(once.actions[0].detail, 'Add To Cart', 'what was pressed is recorded so it is never pressed twice')
const noBox = waveEnv(page('vision.html'), [{ kind: 'fill_phone_at', x: 170, y: 220 }], {}, { GOGO_BOOKING_PHONE: '9876543210' })
assert.deepEqual(steps(noBox), ['fill_phone_at:failed:wrong_input_type'], 'the number is only typed into a real input')

// 3. Sport, date, time and court through pointer-only listboxes and a div calendar, then Add To Cart.
const booking = wave(page('booking.html'), [
  { kind: 'click', selector: '#sport-btn' }, { kind: 'click_text', text: 'Badminton' },
  { kind: 'click', selector: '#date-btn' }, { kind: 'click_text', text: '2026-10-17' },
  { kind: 'click', selector: '#time-btn' }, { kind: 'click_text', text: '07:00 AM' },
  { kind: 'click', selector: '#court-btn' }, { kind: 'click_text', text: 'Premium Synthetic Court 1' },
  { kind: 'click_text', text: 'Add To Cart' },
])
assert.deepEqual(steps(booking), Array(9).fill(0).map((_, i) => (i % 2 === 0 && i < 8 ? 'click:done' : 'click_text:done')))
assert.match(decodeURIComponent(booking.url), /cart\.html\?d=2026-10-17&t=07:00 AM$/)

// 3b. A failed step ends the booking wave so the planner observes the page again.
const failed = wave(page('booking.html'), [{ kind: 'click_text', text: 'Shuttle Court 9' }, { kind: 'click', selector: '#sport-btn' }])
assert.deepEqual(steps(failed), ['click_text:failed:action_error'])

// 3c. A short guessed option ("1") must match a whole label, so it never presses "Court 1".
const guessed = wave(page('booking.html'), [{ kind: 'click', selector: '#court-btn' }, { kind: 'click_text', text: '1' }])
assert.deepEqual(steps(guessed), ['click:done', 'click_text:failed:action_error'])
assert.match(guessed.text, /Premium Synthetic Court 1/, 'the open list is observed for the next step')

// 3d. One step: choose sets each picker by its field name and checks it, including the court
// ("first") that only the open list names. Then Add To Cart.
const chosen = wave(page('booking.html') + '?fresh=1', [
  { kind: 'choose', field: 'Sports', value: 'Badminton' },
  { kind: 'choose', field: 'Date', value: '2026-10-18' },
  { kind: 'choose', field: 'Start Time', value: '06:30 AM' },
  { kind: 'choose', field: 'Court', value: 'first' },
  { kind: 'choose', field: 'Court', value: 'first' },
  { kind: 'choose', field: 'Sports', value: 'Badminton' },
])
assert.deepEqual(steps(chosen), Array(6).fill('choose:done'))
const shown = (sel: string) => chosen.controls.find((c: any) => c.selector === sel)?.label
assert.equal(shown('#date-btn'), '2026-10-18')
assert.equal(shown('#time-btn'), '06:30 AM')
assert.equal(shown('#court-btn'), '--Select Court--', 'a multi-select keeps its placeholder')
assert.match(chosen.text, /--Select Court--\s*Premium Synthetic Court 1\s/, 'the chosen court is a chip beside it, and a second choose did not remove it')
assert.doesNotMatch(chosen.text, /Premium Synthetic Court 2/, 'the list was closed after choosing')
const missing = wave(page('booking.html'), [{ kind: 'choose', field: 'Start Time', value: '11:00 PM' }, { kind: 'click_text', text: 'Add To Cart' }])
assert.deepEqual(steps(missing), ['choose:failed:option_missing'], 'an option that is not offered fails and ends the wave')

// 3e. In the live page, Add to cart waits until the pickers show the request (12 Oct 06:10: the
// sport was still Swimming). In a rehearsal the matching case reaches rehearsal_stop.
const target = { bookingTarget: { date: '2026-10-17', time: '7:00 AM', service: 'badminton court' }, rehearsal: true }
const wrongSport = wave(page('booking.html') + '?fresh=1', [{ kind: 'click_text', text: 'Add To Cart' }, { kind: 'click', selector: '#sport-btn' }], target)
assert.deepEqual(steps(wrongSport), ['click_text:skipped:selection_mismatch'])
const ready = wave(page('booking.html') + '?fresh=1', [
  { kind: 'choose', field: 'Sports', value: 'Badminton' }, { kind: 'choose', field: 'Date', value: '2026-10-17' },
  { kind: 'choose', field: 'Start Time', value: '07:00 AM' }, { kind: 'choose', field: 'Court', value: 'first' },
  { kind: 'click', selector: '#add' },
], target)
assert.deepEqual(steps(ready), ['choose:done', 'choose:done', 'choose:done', 'choose:done', 'click:skipped:rehearsal_stop'])

// 4. The pay control is never pressed, by text or by selector.
const cart = wave(booking.url, [{ kind: 'click_text', text: 'Proceed to Pay INR 375' }, { kind: 'click', selector: '#pay' }])
assert.deepEqual(steps(cart), ['click_text:skipped:payment_control', 'click:skipped:payment_control'])
assert.match(cart.text, /Proceed to Pay INR 375/)

// 5. A rehearsal walks the booking page but never changes the cart.
const rehearsal = wave(page('booking.html'), [{ kind: 'click_text', text: 'Add To Cart' }, { kind: 'click', selector: '#add' }], { rehearsal: true })
assert.deepEqual(steps(rehearsal), ['click_text:skipped:rehearsal_stop', 'click:skipped:rehearsal_stop'])
assert.match(rehearsal.url, /booking\.html$/)

console.log('Browser widgets: div venue card, Book Now, pointer-only listboxes, div calendar and Add To Cart work in real Chromium; Pay is never pressed')
