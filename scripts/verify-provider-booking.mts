// 11 Oct: the person asked for the real booking flow: open the venue, pick the slot, log in with
// their number, ask for the OTP on WhatsApp, continue to the cart, and send a link to pay there.
// This checks the pure rules, the routing words, and the real secure-browser loop with a fake
// sandbox: the number and the OTP reach the worker only as command-scoped variables, never the
// payload or the planner prompt; a missing OTP pauses; payment always stops for the person.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { sanitizeBrowserReadDiagnostics } from '../lib/agent/browser-read-diagnostics'
import { browserFailureSummary } from '../lib/agent/browser-failure-notice'
import { draftObjectiveCovered } from '../lib/agent/draft-coverage'
import * as browserEvidence from '../lib/agent/browser-evidence'
import { detectHumanAuthGate } from '../lib/agent/browser-auth-gate'
import { needsBrowserDeliveryLocation } from '../lib/agent/browser-location-gate'
import { browserPageAllowlist } from '../lib/agent/browser-page-network'
import * as booking from '../lib/agent/provider-booking'
import { evaluateAgentSentinel } from '../lib/agent/sentinel'
import { parseBrowserCommand, browserApprovalBinding } from '../lib/agent/browser-command'
import { redactSecretShapedText } from '../lib/bot/memory-redaction'
import { claimsUnperformedAction } from '../lib/bot/action-claim-guard'
import { appointmentPrepareOptionNumber } from '../lib/agent/appointment-followup-recovery'
import { bareOptionReply, optionNumber, wantsPrepare, wantsFinalApproval, explicitDate, bookingNextStepHint } from '../lib/agent/appointment-followup'

// ── Pure rules ──────────────────────────────────────────────────────────────
assert.equal(booking.otpReply('482913'), '482913')
assert.equal(booking.otpReply(' 482 913 '), '482913')
assert.equal(booking.otpReply('OTP: 4829'), '4829')
assert.equal(booking.otpReply('code is 48291301'), '48291301')
for (const t of ['1', '12', '123', '123456789', 'book 7 am', '9876543210', 'option 1', '']) assert.equal(booking.otpReply(t), null, t)

assert.equal(booking.indianMobileFromWhatsApp('+919876543210'), '9876543210')
assert.equal(booking.indianMobileFromWhatsApp('whatsapp:+91 98765 43210'), '9876543210')
assert.equal(booking.indianMobileFromWhatsApp('9876543210'), '9876543210')
assert.equal(booking.indianMobileFromWhatsApp('+14155550100'), null)
assert.equal(booking.maskMobile('9876543210'), 'ending 3210')

assert.equal(booking.bookingAtPayment({ url: 'https://api.razorpay.com/v1/checkout' }), true)
assert.equal(booking.bookingAtPayment({ text: 'Booking summary\nCourt 2, 7:00 AM\nProceed to Pay ₹600' }), true)
assert.equal(booking.bookingAtPayment({ text: 'Choose payment method\nUPI\nCards' }), true)
assert.equal(booking.bookingAtPayment({ text: 'Badminton courts\n7:00 AM ₹600\n8:00 AM ₹600\nBook now' }), false)

assert.equal(booking.bookingOtpPrompt({ text: 'Login with your mobile number. We will send you a verification code.', forms: [{ inputs: [{ type: 'tel', label: 'Mobile number' }] }] }), false, 'before the number is sent it is not an OTP pause')
assert.equal(booking.bookingOtpPrompt({ text: 'Enter the 6 digit OTP sent to +91 ******3210. Resend OTP' }), true)
assert.equal(booking.bookingOtpPrompt({ text: 'Verify', forms: [{ inputs: [{ name: 'otp' }] }] }), true)

const objective = booking.bookingObjective({ date: '2026-10-17', time: '7:00 AM', timezone: 'Asia/Kolkata', service: 'badminton court', title: 'Smaaash Bengaluru', name: 'Goverdhan', email: 'goverdhan.md@gmail.com', confirmation: 'book the 7 am slot on Saturday' })
assert.match(objective, /choose exactly 2026-10-17 at 7:00 AM/)
assert.match(objective, /use fill_phone for the mobile number field/)
assert.match(objective, /never pay, never enter card, UPI or bank details/)
assert.doesNotMatch(objective, /\d{10}/, 'the mobile number is never in the objective')
assert.equal(evaluateAgentSentinel({ capability: 'browser', mode: 'execute', risk: 'high', irreversible: true, approved: true, instruction: objective, url: 'https://playo.co/venues/x', actionCount: 12 }).allowed, true, 'the booking objective passes the sentinel')

// The approval written when the person confirms must match what execution recomputes from the
// stored run (otherwise APPROVE fails with approval_action_changed).
const stored = { url: 'https://playo.co/venues/smaaash', objective, mode: 'execute' as const, risk: 'high' as const, approvalAction: 'booking' as const, flow: 'provider_booking' as const }
const rebuilt = { ...stored, objective: redactSecretShapedText(String(objective).trim().slice(0, 1800)) }
assert.equal(browserApprovalBinding('run-1', 'step-1', stored).action_hash, browserApprovalBinding('run-1', 'step-1', rebuilt).action_hash)

const otpText = booking.bookingOtpMessage({ host: 'playo.co', mobile: '9876543210', takeoverUrl: 'https://app.askgogo.in/dashboard/activity/r1/browser' })
assert.match(otpText, /Reply here with just the code/)
assert.match(otpText, /ending 3210/)
assert.doesNotMatch(otpText, /9876543210/)
assert.match(otpText, /https:\/\/app\.askgogo\.in\/dashboard\/activity\/r1\/browser/)
const payText = booking.bookingPaymentMessage({ host: 'playo.co', takeoverUrl: 'https://app.askgogo.in/dashboard/activity/r1/browser' })
assert.match(payText, /I stopped before paying/)
assert.match(payText, /I never enter payment details or press Pay/)
assert.doesNotMatch(payText, /\bbooked\b(?! once)/i, 'never claims the booking is done')

// ── Routing words ───────────────────────────────────────────────────────────
for (const [t, n] of [['1', 1], ['Option 1', 1], ['option 2.', 2], ['#3', 3]] as const) {
  assert.equal(bareOptionReply(t), n, t)
  assert.equal(optionNumber(t), n, t)
  assert.equal(wantsPrepare(t), true, t)
  assert.equal(appointmentPrepareOptionNumber(t), n, `recovery opens ${t}`)
}
for (const t of ['482913', 'option 1 is too far', 'I want 2 tickets', '21']) assert.equal(bareOptionReply(t), null, t)
assert.equal(wantsFinalApproval('book the 7 am slot on Saturday'), true)
assert.equal(wantsFinalApproval('Book the 6:30 pm slot tomorrow'), true)
assert.equal(wantsFinalApproval('book a table for 4 at Toit'), false)
const sat = explicitDate('book the 7 am slot on Saturday', 'Asia/Kolkata')
assert.ok(sat && new Date(`${sat}T12:00:00Z`).getUTCDay() === 6, 'Saturday resolves to a Saturday')
assert.equal(explicitDate('I sat down at 5 pm', 'Asia/Kolkata'), null, 'a bare "sat" is not a date')
assert.match(bookingNextStepHint(1), /I inspected option 1 without confirming anything/, 'keeps the phrase the confirm step looks for')
assert.equal(parseBrowserCommand('Read-only. Open https://playo.co/venues/x and list the dates and time slots shown as available for badminton court, with prices if shown. You may click public date or sport tabs to see slots. Do not log in.')?.mode, 'read', 'opening an option is a read')

assert.equal(claimsUnperformedAction("I've opened the Playo page for Smaaash Bengaluru. Here are the slots."), true)
assert.equal(claimsUnperformedAction('I have checked the live slots for Saturday.'), true)
assert.equal(claimsUnperformedAction('Playo lists courts in HSR Layout. Reply 1 to open one.'), false)

// ── Webhook: the OTP is intercepted first and never saved or logged ─────────
const route = readFileSync('app/api/webhooks/whatsapp/route.ts', 'utf8')
const intercept = route.indexOf('const bookingCode = numMedia === 0 ? otpReply(bodyText) : null')
assert.ok(intercept > 0)
assert.ok(intercept < route.indexOf("if ((resolvedUser as any).isNewUser)"), 'before onboarding and every handler')
assert.ok(intercept < route.indexOf('approvalIntent(text)'))
assert.ok(intercept < route.indexOf('processIncomingMessage('))
const block = route.slice(intercept, route.indexOf('// ── Interactive onboarding menu'))
assert.match(block, /saveConversation\(resolvedUser\.telegramId, 'user', '\[booking code sent\]'\)/, 'the conversation keeps a placeholder, not the code')
assert.doesNotMatch(block, /saveConversation\([^)]*bookingCode/)
assert.doesNotMatch(block, /console\.\w+\([^)]*bookingCode/)
assert.match(route, /Body: loggedBody/)
assert.match(route, /body: loggedBody/)
assert.doesNotMatch(route, /body: String\(formData\.get\('Body'\)/, 'the inbound log never prints a raw code')
const worker = readFileSync('lib/agent/approved-browser-worker.ts', 'utf8')
assert.doesNotMatch(worker, /console\.\w+\([^)]*\botp\b/, 'the worker never logs the code')
const internal = readFileSync('app/api/agent/approved-browser/route.ts', 'utf8')
assert.doesNotMatch(internal, /console\.\w+\([^)]*\botp\b/, 'the internal route never logs the code')
const command = readFileSync('lib/agent/browser-command.ts', 'utf8')
assert.match(command, /\.update\(\{status:'running',metadata_json:\{\.\.\.meta,booking_otp:\{\.\.\.meta\.booking_otp,requested_at:null\}\}/, 'a code is used once: the claim clears the request')
assert.match(command, /Date\.now\(\)-requested>10\*60_000/, 'a code is accepted for 10 minutes only')

// ── The real secure-browser loop with a fake sandbox ────────────────────────
function load(file: string, mocks: Record<string, any>, extra = '') {
  mocks = { './browser-read-diagnostics': { sanitizeBrowserReadDiagnostics }, './browser-failure-notice': { browserFailureSummary }, './managed-browser': { managedBrowserEnabled: () => false, ensureManagedBrowser: async () => null }, './browser-page-readiness': { BROWSER_PAGE_READINESS: 'function observeBrowserPage(){return {read:async()=>({state:"ready",httpStatus:200})}}' }, ...mocks }
  const source = readFileSync(new URL(`../lib/agent/${file}`, import.meta.url), 'utf8') + extra
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const exports: any = {}
  runInNewContext(code, { exports, require: (name: string) => mocks[name] || (name === './browser-page-network' ? { browserPageAllowlist } : undefined) || (name === './draft-coverage' ? { draftObjectiveCovered } : undefined) || (name === './browser-evidence' ? browserEvidence : undefined) || (name === './browser-proxy' ? { resolveBrowserProxy: () => null, proxyAllowlistHost: () => null } : {}), process: { env: {} }, Buffer, URL, console, AbortSignal, setTimeout, clearTimeout })
  return exports
}

const venue = { url: 'https://playo.co/venues/smaaash', title: 'Smaaash · Playo', text: 'Badminton\nSat 17 Oct\n7:00 AM ₹600\n8:00 AM ₹600', forms: [], controls: [{ selector: '#slot-7', tag: 'button', label: '7:00 AM' }, { selector: '#proceed', tag: 'button', label: 'Proceed' }] }
const login = { url: 'https://playo.co/login', title: 'Login · Playo', text: 'Login with your mobile number. We will send you a verification code.', forms: [{ action: 'https://playo.co/login', method: 'post', inputs: [{ selector: '#mobile', name: 'mobile', type: 'tel', label: 'Mobile number' }] }], controls: [{ selector: '#get-otp', tag: 'button', label: 'Get OTP' }] }
const otpPage = { url: 'https://playo.co/login', title: 'Verify · Playo', text: 'Enter the 6 digit OTP sent to +91 ******3210\nResend OTP', forms: [{ action: 'https://playo.co/login', method: 'post', inputs: [{ selector: '#otp', name: 'otp', type: 'text', label: 'OTP' }] }], controls: [{ selector: '#verify', tag: 'button', label: 'Verify' }] }
const cart = { url: 'https://playo.co/checkout', title: 'Cart · Playo', text: 'Booking summary\nSmaaash, Court 2\nSat 17 Oct, 7:00 AM\nProceed to Pay ₹600', forms: [], controls: [{ selector: '#pay', tag: 'button', label: 'Proceed to Pay ₹600' }] }

let script: any[] = []
const commands: Array<{ payload: any; env: Record<string, string> }> = []
const prompts: string[] = []
let plans: any[] = []
const computer = load('secure-computer.ts', {
  './planner-provider': { completeAgentPlanPrompt: async (prompt: string) => { prompts.push(prompt); return JSON.stringify(plans.shift() || { approvedOperation: 'booking', actions: [] }) } },
  '@vercel/sandbox': { Sandbox: { getOrCreate: async () => ({ expiresAt: new Date(Date.now() + 1200000), extendTimeout: async () => {}, writeFiles: async () => {}, updateNetworkPolicy: async () => {}, stop: async () => {},
    runCommand: async (cmd: any) => {
      const payload = JSON.parse(Buffer.from(String(cmd.args[3]), 'base64').toString('utf8'))
      commands.push({ payload, env: cmd.env || {} })
      const next = script.shift()
      const actions = (payload.actions || []).map((a: any) => ({ kind: a.kind, detail: a.selector || a.url || '', status: 'done' }))
      return { exitCode: 0, stdout: async () => JSON.stringify({ ...next, actions }) }
    } }) } },
  './secure-browser-redaction': { redactBrowserSensitiveText: (text: string) => text },
  './browser-auth-gate': { detectHumanAuthGate },
  './browser-location-gate': { needsBrowserDeliveryLocation },
  './browser-owner-lock': { acquireBrowserOwnerLock: async () => Object.assign(async () => {}, { reserveHandoff: async () => 'transfer' }) },
  './secure-browser-bootstrap': { browserSandboxNameFor: () => 'owner', ensureBrowserRuntime: async () => {} },
  './trust': { canAuthorizeConsequentialAction: () => true },
  './provider-booking': booking,
  './persistent-commerce-browser': { ensurePersistentCommerceBrowser: async () => {}, COMMERCE_CDP_URL: 'http://127.0.0.1:9222' },
  '@/lib/vault/credential-store': { resolveVaultCredentialForBrowser: async () => null, recordVaultBrowserOutcome: async () => {} },
  '@/lib/vault/signup-credential': {},
  '@/lib/vault/session-store': {},
}, '\nexport {BROWSER_SCRIPT}')

const base = { userId: 'owner', runId: 'run-1', url: 'https://playo.co/venues/smaaash', objective, mode: 'execute', reserveHumanHandoff: true, providerBooking: true, keepAlive: true, keepAliveOwner: 'owner:booking:run-1', sessionTaskId: 'run-1' }

// Run 1: slot → login with the number → OTP sent. Gogo has no code, so it pauses for one.
script = [venue, login, otpPage]
plans = [
  { approvedOperation: 'booking', actions: [{ kind: 'click', selector: '#slot-7' }, { kind: 'click', selector: '#proceed' }, { kind: 'submit', selector: '#proceed' }] },
  { approvedOperation: 'booking', actions: [{ kind: 'fill_phone', selector: '#mobile' }, { kind: 'click', selector: '#get-otp' }] },
]
const first = await computer.runSecureBrowser({ ...base, bookingPhone: '9876543210', bookingOtp: null })
assert.equal(first.status, 'blocked')
assert.equal(first.bookingStage, 'otp')
assert.equal(first.authReason, 'otp')
assert.equal(first.handoffReservation, 'transfer', 'the same browser is kept for the person')
assert.equal(commands[1].payload.bookingFlow, true)
assert.deepEqual(commands[1].payload.actions.map((a: any) => a.kind), ['click', 'click'], 'a booking never submits')
assert.equal(commands[2].env.GOGO_BOOKING_PHONE, '9876543210', 'the number reaches only the command that fills it')
assert.equal(commands[1].env.GOGO_BOOKING_PHONE, undefined)
assert.equal(commands.some(c => JSON.stringify(c.payload).includes('9876543210')), false, 'the number is never in the payload')
assert.equal(prompts.some(p => p.includes('9876543210')), false, 'the number is never in a planner prompt')
assert.match(prompts[0], /PROVIDER BOOKING FLOW/)
assert.match(prompts[0], /Never fill a one-time code/)
assert.match(prompts[0], /never fill card, UPI or bank details/)

// Run 2: the person replied with the code. Gogo types it once and stops at payment.
commands.length = 0; prompts.length = 0
script = [otpPage, cart]
plans = [{ approvedOperation: 'booking', actions: [{ kind: 'fill_otp', selector: '#otp' }, { kind: 'click', selector: '#verify' }] }]
const second = await computer.runSecureBrowser({ ...base, resumePage: true, bookingPhone: '9876543210', bookingOtp: '482913' })
assert.equal(second.status, 'blocked')
assert.equal(second.bookingStage, 'payment')
assert.equal(second.authReason, 'payment_auth')
assert.equal(commands[1].env.GOGO_BOOKING_OTP, '482913', 'the code reaches only the command that types it')
assert.equal(commands[0].env.GOGO_BOOKING_OTP, undefined)
assert.equal(commands.some(c => JSON.stringify(c.payload).includes('482913')), false, 'the code is never in the payload')
assert.equal(prompts.some(p => p.includes('482913')), false, 'the code is never in a planner prompt')
assert.match(prompts[0], /Gogo has it: use \{"kind":"fill_otp"/)

// A wrong code: the OTP page is still there after typing it. Gogo asks again and says so.
commands.length = 0
script = [otpPage, otpPage]
plans = [{ approvedOperation: 'booking', actions: [{ kind: 'fill_otp', selector: '#otp' }, { kind: 'click', selector: '#verify' }] }]
const wrong = await computer.runSecureBrowser({ ...base, resumePage: true, bookingPhone: '9876543210', bookingOtp: '000000' })
assert.equal(wrong.bookingStage, 'otp')
assert.equal(wrong.otpRejected, true)

// Not a booking: fill_phone and fill_otp are dropped, so an ordinary execution never gets them.
commands.length = 0
script = [venue, { ...venue, text: 'Booking confirmed' }]
plans = [{ approvedOperation: 'booking', actions: [{ kind: 'fill_phone', selector: '#mobile' }, { kind: 'submit', selector: '#proceed' }] }]
await computer.runSecureBrowser({ userId: 'owner', url: 'https://playo.co/venues/smaaash', objective: 'Book it', mode: 'execute', reserveHumanHandoff: true }).catch(() => null)
assert.equal(commands.some(c => (c.payload.actions || []).some((a: any) => a.kind === 'fill_phone')), false)
assert.equal(commands.some(c => c.env.GOGO_BOOKING_PHONE !== undefined), false)

// ── The worker script itself ────────────────────────────────────────────────
const src = readFileSync('lib/agent/secure-computer.ts', 'utf8')
const fillHandler = src.slice(src.indexOf("else if(a.kind==='fill_phone'||a.kind==='fill_otp'){"), src.indexOf("else if(a.kind==='search_enter'){"))
assert.match(fillHandler, /if\(payload\.mode!=='execute'\|\|!payload\.bookingFlow\)/, 'only an approved booking fills the number or code')
assert.match(fillHandler, /process\.env\.GOGO_BOOKING_OTP:process\.env\.GOGO_BOOKING_PHONE/)
assert.doesNotMatch(fillHandler, /log\.push\([^)]*bookingValue/, 'the value is never logged')
assert.match(src, /if\(payload\.bookingFlow\)\{[\s\S]{0,400}place order\|buy now[\s\S]{0,200}reason:'payment_control'/, 'the worker never presses Pay in a booking')

// ── Opening an option on WhatsApp runs in the background (11 Oct live run: the 42s webhook
// window expired and the abandoned run kept the browser locked) ────────────────
const recoverySrc = readFileSync('lib/agent/appointment-followup-recovery.ts', 'utf8')
assert.ok(recoverySrc.indexOf("if (params.surface === 'whatsapp')") < recoverySrc.indexOf('const result = await tryRunBrowserCommand('), 'WhatsApp queues before any inline browser run')
assert.match(recoverySrc, /metadata:\{ appointment_selection, appointment_prepared:true \}/, 'the selection is written with the run, never after it')
assert.match(recoverySrc, /I'm opening option \$\{option\} \(\$\{queued\.host\}\)/)
const followSrc = readFileSync('lib/agent/appointment-followup.ts', 'utf8')
assert.match(followSrc, /\^I'm opening option \\d\+ \\\(/, 'the confirm step recognises the opening reply')
assert.match(command, /export async function queueBrowserRead[\s\S]{0,600}command\.mode!=='read'/, 'only reads are queued this way')
assert.match(command, /error:'whatsapp_browser_response_timeout'[\s\S]{0,120}\.eq\('error','background_read_queued'\)/, 'a failed dispatch falls back to the background sweeper')
assert.match(worker, /\.eq\('status', 'paused'\)\.eq\('error', 'background_read_queued'\)/, 'a queued read runs once')
assert.match(internal, /if \(body\?\.read === true\)/)
const research = readFileSync('lib/agent/appointment-research.ts', 'utf8')
assert.match(research, /!SOCIAL_HOST\.test\(host\(result\.url\)\)/, 'social posts are never offered as places to book')
assert.match(booking.bookingObjective({ date: '2026-10-17', time: '7:00 AM', timezone: 'Asia/Kolkata', location: 'HSR Layout, Bengaluru', confirmation: 'x' }), /open one in HSR Layout, Bengaluru that has this slot free/)

// 11 Oct live run: a bare "1" after the places list got a skin-care reply. Skin features are gone,
// and a bare digit is taken by the nutrition menu only when that menu was the last reply.
assert.doesNotMatch(route, /\bskin/i, 'no skin routing is left in the WhatsApp webhook')
assert.match(route, /if \(isNutritionContext\) \{[\s\S]{0,400}return new NextResponse/, 'a nutrition digit ends routing; any other digit carries on')

// 11 Oct 13:55 live run: APPROVE booked from an older read of a different Playo page, and a popup
// made the slot click fail. The approval now gets its own run; clicks get past a covering popup.
assert.match(followSrc, /const booking = await createApprovalBrowserRun\(/, 'the approval runs on a new run, not a reused read')
assert.match(followSrc, /run_id: booking\.runId, action_type: 'booking'/)
assert.match(followSrc, /\.in\('status', \['completed', 'paused', 'failed', 'running', 'queued'\]\)\s*\.order\('started_at', \{ ascending: false \}\)/, 'the newest opened option wins, even while it is still being read')
assert.match(src, /async function clickPastOverlay\(page,selector\)\{[\s\S]{0,500}keyboard\.press\('Escape'\)[\s\S]{0,300}evaluate\(el=>el\.click\(\)\)/)
assert.doesNotMatch(src.slice(src.indexOf("} else if(a.kind==='submit'){"), src.indexOf("} else if(a.kind==='submit'){") + 400), /clickPastOverlay/, 'submit never uses the popup fallback')

// 11 Oct 14:22: the hint after a background read arrived as "ask you for the OTP [sensitive detail
// withheld]" because Gogo's own text went through the secret redactor. It is our text, not user data.
assert.match(command, /notify_suffix:String\(params\.notifySuffix\|\|''\)\.slice\(0,900\)/)
assert.match(redactSecretShapedText(bookingNextStepHint(1)), /withheld/, 'why: the secret redactor mangles this hint, so it must not be applied to it')

console.log('Provider booking: slot → number → WhatsApp OTP → payment handover, with the number and code kept out of payloads, prompts and logs')
