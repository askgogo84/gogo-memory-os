// Capability kill switches (100-user launch gate), 28 Oct.
//   GOGO_BOOKING=off            flight/provider bookings refuse before any approval or browser run
//   GOGO_VOICE_CALLS=off        no call plan is made and no call is placed
//   GOGO_LOGGED_IN_BROWSER=off  nothing that uses the person's signed-in browser / Vault / account site runs;
//                               public reads still work
// Behavioural checks on the shared helper and the approval guard (real modules, in-memory store), plus
// source-level checks that every choke point calls the helper BEFORE its side effect. No network, no DB.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import * as policy from '../lib/agent/policy'
import * as ttl from '../lib/agent/approval-ttl'

const { capabilityPaused, capabilityPausedText, pausedBrowserCapability, CAPABILITY_KILL_SWITCHES } = policy

// ---- 1. The helper: each switch on/off ----------------------------------------------------------------------------
assert.deepEqual(CAPABILITY_KILL_SWITCHES, { booking: 'GOGO_BOOKING', voice_calls: 'GOGO_VOICE_CALLS', logged_in_browser: 'GOGO_LOGGED_IN_BROWSER' })
for (const [name, key] of Object.entries(CAPABILITY_KILL_SWITCHES) as Array<[policy.PausableCapability, string]>) {
  assert.equal(capabilityPaused(name, {}), false, `${key} unset = on`)
  assert.equal(capabilityPaused(name, { [key]: 'on' }), false, `${key}=on = on`)
  assert.equal(capabilityPaused(name, { [key]: '' }), false, `${key} empty = on`)
  assert.equal(capabilityPaused(name, { [key]: 'off' }), true, `${key}=off pauses`)
  assert.equal(capabilityPaused(name, { [key]: ' OFF ' }), true, `${key}= OFF  pauses (trim, case)`)
  for (const v of ['0', 'false', 'paused', 'disabled']) assert.equal(capabilityPaused(name, { [key]: v }), true, `${key}=${v} pauses`)
  // One switch never pauses another capability.
  for (const other of Object.keys(CAPABILITY_KILL_SWITCHES) as policy.PausableCapability[]) {
    if (other !== name) assert.equal(capabilityPaused(other, { [key]: 'off' }), false, `${key}=off leaves ${other} on`)
  }
}
assert.equal(capabilityPaused('booking', null), false, 'no env (bare vm) = on')
assert.equal(capabilityPaused('booking', undefined as any), false)
console.log('PASS helper: each switch on/off, isolated, bare-vm safe')

// ---- 2. Honest replies --------------------------------------------------------------------------------------------
const link = 'https://www.google.com/travel/flights/search?tfs=abc'
assert.match(capabilityPausedText('booking', { searchLink: link }), /^Booking is paused right now/)
assert.ok(capabilityPausedText('booking', { searchLink: link }).includes(`Here is the search link to book yourself: ${link}`))
assert.match(capabilityPausedText('booking'), /nothing was booked\.$/, 'no dangling link text without a link')
assert.match(capabilityPausedText('voice_calls'), /Phone calls are paused.*Nothing was called/)
assert.match(capabilityPausedText('logged_in_browser'), /signed-in accounts are paused.*haven't opened your account or changed anything/)
console.log('PASS paused replies are honest and include the search link when available')

// ---- 3. Browser classification ------------------------------------------------------------------------------------
const BOOK = { GOGO_BOOKING: 'off' }, LOGGED = { GOGO_LOGGED_IN_BROWSER: 'off' }
const booking = { mode: 'execute', flow: 'provider_booking', approvalAction: 'booking' }
assert.equal(pausedBrowserCapability(booking, {}), null, 'all on: booking runs')
assert.equal(pausedBrowserCapability(booking, BOOK), 'booking')
assert.equal(pausedBrowserCapability({ mode: 'execute', approvalAction: 'booking' }, BOOK), 'booking', 'booking approval without flow')
assert.equal(pausedBrowserCapability(booking, LOGGED), 'logged_in_browser', 'bookings use the signed-in browser too')
assert.equal(pausedBrowserCapability(booking, { ...BOOK, ...LOGGED }), 'booking', 'booking reason wins')
// Logged-in shapes
const cart = { mode: 'execute', approvalAction: 'submit_form' }
for (const [label, shape] of [
  ['commerce cart execute', cart],
  ['draft action', { mode: 'draft' }],
  ['external account creation', { mode: 'execute', flow: 'account_creation' }],
  ['saved Vault credential read', { mode: 'read', vaultCredentialId: 'cred-1' }],
  ['account-site read', { mode: 'read', accountSite: true }],
  ['signed-in commerce session', { mode: 'read', commerceSession: true }],
  ['site sign-in session', { mode: 'read', siteSession: true }],
] as const) {
  assert.equal(pausedBrowserCapability(shape as any, LOGGED), 'logged_in_browser', `${label} pauses under GOGO_LOGGED_IN_BROWSER=off`)
  assert.equal(pausedBrowserCapability(shape as any, {}), null, `${label} runs when on`)
  assert.equal(pausedBrowserCapability(shape as any, BOOK), null, `${label} is not a booking`)
}
// Public reads keep working with every switch off.
const ALL = { ...BOOK, ...LOGGED, GOGO_VOICE_CALLS: 'off' }
assert.equal(pausedBrowserCapability({ mode: 'read' }, ALL), null, 'public page read still works')
assert.equal(pausedBrowserCapability({ mode: 'read', flow: null, vaultCredentialId: null, accountSite: false }, ALL), null, 'Google Flights search read still works')
assert.equal(pausedBrowserCapability({ mode: 'read', commerceSession: false }, ALL), null, 'public comparison read still works')
console.log('PASS browser classification: bookings, signed-in actions paused; public reads untouched')

// ---- 4. Approval guard + dashboard route, behavioural -------------------------------------------------------------
type Row = Record<string, any>
let tables: Record<string, Row[]> = {}
function query(table: string) {
  const filters: Array<[string, unknown]> = []
  let patch: Row | null = null, insert: Row | null = null
  const rows = () => (tables[table] ||= []).filter(r => filters.every(([k, v]) => String(r[k]) === String(v)))
  const run = () => {
    if (insert) { (tables[table] ||= []).push({ ...insert }); return { data: insert, error: null } }
    const matched = rows()
    if (patch) { for (const r of matched) Object.assign(r, patch); return { data: matched.map(r => ({ ...r })), error: null } }
    return { data: matched.map(r => ({ ...r })), error: null }
  }
  const q: any = {
    select: () => q, eq: (k: string, v: unknown) => { filters.push([k, v]); return q }, order: () => q, limit: () => q,
    update: (p: Row) => { patch = p; return q }, insert: (r: Row) => { insert = r; return q },
    maybeSingle: () => { const r = run(); return Promise.resolve({ data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: null }) },
    then: (resolve: any, reject: any) => Promise.resolve(run()).then(resolve, reject),
  }
  return q
}
const db = { from: (t: string) => query(t) }
const env: Record<string, string | undefined> = {}
function load(path: string, deps: Record<string, unknown>, withProcess = true) {
  const exports: any = {}
  const context: any = { exports, require: (name: string) => (deps as any)[name], Date, Intl, console, URL, Promise }
  if (withProcess) context.process = { env }
  runInNewContext(ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context)
  return exports
}
const realPolicy = load('lib/agent/policy.ts', {})
const guard = load('lib/agent/approval-guard.ts', { '@/lib/supabase-admin': { supabaseAdmin: db }, './approval-ttl': ttl, './policy': realPolicy })
const session = { telegramId: '123', surface: 'dashboard' }
const { POST } = load('app/api/agent/approvals/[id]/route.ts', {
  'next/server': { NextResponse: { json: (body: unknown, init?: { status?: number }) => ({ body, status: init?.status ?? 200 }) } },
  '@/lib/supabase-admin': { supabaseAdmin: db },
  '@/lib/agent/session': { requireAgentMutationOrigin: () => null, requireAgentSession: async () => session, isAgentSession: () => true },
  '@/lib/agent/approval-guard': guard,
  '@/lib/agent/approval-card': { parseDeferHours: () => 1 },
}, false) // route files load with NO process global, as in the route harnesses
const APPROVAL_ID = '11111111-1111-4111-8111-111111111111'
function seed(meta: Row, actionType = 'booking') {
  tables = {
    agent_approvals: [{ id: APPROVAL_ID, telegram_id: '123', run_id: 'run-1', title: 'Approve flight booking', action_type: actionType, risk_level: 'high', status: 'pending', requested_at: new Date().toISOString(), execution_payload: { plan_type: 'secure_browser', url: meta.url } }],
    agent_runs: [{ id: 'run-1', telegram_id: '123', status: 'waiting_approval', metadata_json: { plan_type: 'secure_browser', mode: 'execute', ...meta } }],
    agent_activity: [],
  }
}
const approve = () => POST({ json: async () => ({ decision: 'approve' }) }, { params: Promise.resolve({ id: APPROVAL_ID }) })
const reject = () => POST({ json: async () => ({ decision: 'reject' }) }, { params: Promise.resolve({ id: APPROVAL_ID }) })

// Booking paused: an APPROVE that arrives for a pending booking does not approve or queue anything.
for (const k of Object.keys(env)) delete env[k]
env.GOGO_BOOKING = 'off'
seed({ flow: 'provider_booking', approval_action: 'booking', url: link })
let res: any = await approve()
assert.equal(res.status, 409)
assert.equal(res.body.error, 'capability_paused')
assert.equal(res.body.capability, 'booking')
assert.ok(res.body.message.includes(link), 'paused approve reply carries the search link')
assert.match(res.body.message, /nothing was done/)
assert.equal(tables.agent_approvals[0].status, 'pending', 'approval not recorded')
assert.equal(tables.agent_runs[0].status, 'waiting_approval', 'run not queued')
assert.equal(tables.agent_activity.length, 0, 'no approval_granted activity')
// REJECT still works while paused.
res = await reject()
assert.equal(res.status, 200)
assert.equal(tables.agent_approvals[0].status, 'rejected')
console.log('PASS dashboard APPROVE while GOGO_BOOKING=off: nothing approved, queued or run; REJECT still works')

// Logged-in browser paused: a cart approval is refused; a booking is refused too (signed-in browser).
delete env.GOGO_BOOKING; env.GOGO_LOGGED_IN_BROWSER = 'off'
seed({ approval_action: 'submit_form', url: 'https://www.amazon.in/dp/X' }, 'submit_form')
res = await approve()
assert.equal(res.status, 409); assert.equal(res.body.capability, 'logged_in_browser')
assert.equal(tables.agent_approvals[0].status, 'pending')
seed({ flow: 'provider_booking', approval_action: 'booking', url: link })
res = await approve()
assert.equal(res.body.capability, 'logged_in_browser')
console.log('PASS dashboard APPROVE while GOGO_LOGGED_IN_BROWSER=off: cart and booking refused')

// Restaurant reservation release is a provider booking.
for (const k of Object.keys(env)) delete env[k]
env.GOGO_BOOKING = 'off'
tables = { agent_runs: [{ id: 'run-2', telegram_id: '123', metadata_json: { plan_type: 'restaurant_reservation_release' } }] }
let g: any = await guard.guardApprovalCapability({ telegramId: 123, row: { id: 'a2', run_id: 'run-2', requested_at: new Date().toISOString() } })
assert.equal(g.paused, true); assert.equal(g.capability, 'booking')

// Switches on: approval passes through and is recorded as before.
for (const k of Object.keys(env)) delete env[k]
seed({ flow: 'provider_booking', approval_action: 'booking', url: link })
res = await approve()
assert.equal(res.status, 200)
assert.equal(tables.agent_approvals[0].status, 'approved')
assert.equal(tables.agent_runs[0].status, 'queued')
// Voice switch alone does not touch browser approvals.
env.GOGO_VOICE_CALLS = 'off'
seed({ flow: 'provider_booking', approval_action: 'booking', url: link })
g = await guard.guardApprovalCapability({ telegramId: 123, row: tables.agent_approvals[0] as any })
assert.equal(g.paused, false)
console.log('PASS approval guard: switches on = unchanged behaviour; restaurant release counts as booking')

// ---- 5. Source-level: every choke point calls the helper before its side effect -----------------------------------
const src = (p: string) => readFileSync(p, 'utf8')
function body(file: string, signature: string) {
  const s = src(file)
  const start = s.indexOf(signature)
  assert.ok(start >= 0, `${file}: ${signature} exists`)
  const next = s.slice(start + signature.length).search(/\n(?:export )?(?:async )?function /)
  return next < 0 ? s.slice(start) : s.slice(start, start + signature.length + next)
}
function before(text: string, guardNeedle: string | RegExp, effectNeedle: string, label: string) {
  const gi = typeof guardNeedle === 'string' ? text.indexOf(guardNeedle) : text.search(guardNeedle)
  const ei = text.indexOf(effectNeedle)
  assert.ok(gi >= 0, `${label}: kill-switch check present`)
  assert.ok(ei >= 0, `${label}: side effect located (${effectNeedle})`)
  assert.ok(gi < ei, `${label}: kill-switch check runs before ${effectNeedle}`)
}
// Booking: flight-booking entry (every branch) and createBookingApproval before the run/approval is created.
const flight = src('lib/agent/flight-booking.ts')
assert.match(flight, /import \{ capabilityPaused, capabilityPausedText \} from '\.\/policy'/)
assert.match(flight, /const bookingPaused = \(\) => capabilityPaused\('booking'\) \|\| capabilityPaused\('logged_in_browser'\)/)
const run = body('lib/agent/flight-booking.ts', 'async function runFlightBooking(')
assert.match(run, /const paused = bookingPaused\(\)/)
before(run, 'if (paused) return bookingPausedReply(await loadLastFlightResult', 'createBookingApproval', 'pending details branch')
assert.match(run, /if \(late\) return paused \? bookingPausedReply\(late\.last\) : await createBookingApproval/)
before(run.slice(run.indexOf('if (!pick) return null')), 'if (paused) return bookingPausedReply', 'savePending', '"book 1" branch')
before(body('lib/agent/flight-booking.ts', 'async function createBookingApproval('), 'if (bookingPaused()) return bookingPausedReply(last)', 'createApprovalBrowserRun', 'createBookingApproval')
assert.match(flight, /googleFlightsTfsUrl\(last\.context\) \|\| last\.searchLink/, 'paused booking reply uses the search link')
// Browser: runBrowserCommand (before run/approval) and executeBrowser (every run, incl. queued approved ones).
const bc = src('lib/agent/browser-command.ts')
assert.match(bc, /import \{ capabilityPausedText, evaluateAgentExecutionPolicy, pausedBrowserCapability/)
before(body('lib/agent/browser-command.ts', 'export async function runBrowserCommand('), 'pausedBrowserCapability(', 'makeRun(', 'runBrowserCommand')
const exec = body('lib/agent/browser-command.ts', 'async function executeBrowser(')
before(exec, 'pausedBrowserCapability(', 'runSecureBrowser(', 'executeBrowser')
before(exec, 'pausedBrowserCapability(', 'releaseBrowserHandoff', 'executeBrowser (before handoff release)')
assert.match(exec, /accountSite:vaultAccountRead/)
assert.match(exec, /siteSession:Boolean\(runMetadata\.site_session\)/)
// executeApprovedBrowserCommand only marks an approval executed on 'completed', so a paused refusal never spends it.
assert.match(body('lib/agent/browser-command.ts', 'export async function executeApprovedBrowserCommand('), /if\(result\.status==='completed'\)await supabaseAdmin\.from\('agent_approvals'\)\.update\(\{status:'executed'/)
// Last line of defence inside the browser runtime.
const sc = body('lib/agent/secure-computer.ts', 'export async function runSecureBrowser(')
before(sc, "throw new Error('capability_paused:booking')", 'tryObscuraBrowserRead(', 'runSecureBrowser booking backstop')
before(sc, "throw new Error('capability_paused:logged_in_browser')", 'resolveVaultCredentialForBrowser', 'runSecureBrowser logged-in backstop')
assert.match(sc, /params=\{\.\.\.params,publicOnly:true,vaultCredentialId:null,phoneLogin:null\}/, 'reads go public-only: no Vault fill, no phone sign-in')
// Commerce cart (product watcher) and account-site sign-in.
const w = src('lib/agent/watchers.ts')
before(w, "capabilityPaused('logged_in_browser')", "objective:`Select product variant/size", 'watcher add-to-cart')
const ss = src('lib/dashboard/site-sessions.ts')
before(body('lib/dashboard/site-sessions.ts', 'export async function createSiteSignInRun('), "capabilityPaused('logged_in_browser')", "from('agent_runs').insert", 'site sign-in run')
before(body('lib/dashboard/site-sessions.ts', 'export async function openSiteSignInBrowser('), "capabilityPaused('logged_in_browser')", 'startProviderBrowserHandoff(', 'site sign-in browser')
assert.ok(ss.includes("import { capabilityPaused } from '@/lib/agent/policy'"))
assert.match(src('app/api/dashboard/connections/route.ts'), /error\?\.message === 'capability_paused'/)
// Voice calls: the gate precedes plan creation and placement (tryVoiceCall is placeCall's only caller).
const voice = body('lib/agent/voice-call.ts', 'export async function tryVoiceCall(')
before(voice, "capabilityPaused('voice_calls')", 'beginApprovedVoiceCall(', 'voice call placement')
before(voice, "capabilityPaused('voice_calls')", 'saveFollowupState(tg, PLAN_STATE, { plan, approvalHash: voicePlanHash', 'voice call plan')
assert.match(voice, /cmd\.kind !== 'decline' && capabilityPaused\('voice_calls'\)/, '"no" still clears a plan while paused')
const placeCallers = src('lib/agent/voice-call.ts').split('placeCall(').length - 1
assert.equal(placeCallers, 2, 'placeCall is defined once and called once (from tryVoiceCall)')
// Approval transitions: WhatsApp bridge and dashboard route ask the guard before approving.
const bridge = body('lib/agent/whatsapp-bridge.ts', 'async function resolveApprovalDecision(')
before(bridge, 'guardApprovalCapability(', ".update({ status, resolved_at: now })", 'WhatsApp APPROVE')
const route = src('app/api/agent/approvals/[id]/route.ts')
before(route, 'guardApprovalCapability(', '.update({ status, resolved_at: resolvedAt })', 'dashboard APPROVE')
assert.ok(!/process\.env/.test(route), 'route reads no process.env directly (bare-vm harness safe)')
console.log('PASS source: every choke point checks its kill switch before the side effect')

console.log('✅ capability kill switches: all checks passed')
