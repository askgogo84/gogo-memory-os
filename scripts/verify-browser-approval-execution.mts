// Browser approval execution — STRUCTURAL CHECKS.
// An approval on WhatsApp must (1) be resolved before any free-form routing, (2) queue the run
// and hand it to the approved-browser route, which runs the browser with a 300s budget, never in
// the 60s webhook, and (3) let the autonomous-runs cron sweep only what is still queued, through
// the same single-claim worker. These checks read production source so a regression fails CI.
// Behaviour against a live browser is NOT tested here (no real accounts in tests).
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const webhook=readFileSync('app/api/webhooks/whatsapp/route.ts','utf8')
const bridge=readFileSync('lib/agent/whatsapp-bridge.ts','utf8')
const worker=readFileSync('lib/agent/approved-browser-worker.ts','utf8')
const route=readFileSync('app/api/agent/approved-browser/route.ts','utf8')
const cron=readFileSync('app/api/cron/autonomous-runs/route.ts','utf8')

// 1. Approve/Reject replies are resolved before watcher, Gmail, external-account, and general routing.
const approvalRoute=webhook.indexOf('if (approvalIntent(text))')
const watcherRoute=webhook.indexOf('// Watcher commands create/read persistent state')
assert.ok(approvalRoute>0,'the webhook resolves approve/reject replies')
assert.ok(approvalRoute<watcherRoute,'approval replies are resolved before watcher and later routing')
assert.match(bridge,/export function approvalIntent\(/,'the approval intent check is shared with the webhook')

// 2. The approval acknowledges the run and triggers execution; the webhook never runs the browser.
const browserBranch=bridge.indexOf("if (planType === 'secure_browser') {")
const dispatch=bridge.indexOf("const result = planType === 'calendar_update'")
assert.ok(browserBranch>0&&browserBranch<dispatch,'the secure_browser branch returns before the inline dispatch')
const branchBody=bridge.slice(browserBranch,dispatch)
assert.match(branchBody,/triggerApprovedBrowserRun\(String\(data\.run_id\)\)/,'an approved browser run is handed to the approved-browser route')
assert.doesNotMatch(branchBody,/executeApprovedBrowserCommand/,'the webhook never executes the browser inline')
assert.match(branchBody,/status:'running'/,'the approval is acknowledged as running')

// 3. The trigger never awaits the browser and falls back to the sweeper if it cannot send.
assert.match(worker,/export async function triggerApprovedBrowserRun/,'the hand-off is a single awaited call')
assert.match(worker,/APPROVED_BROWSER_TRIGGERED/,'a successful hand-off is logged')
assert.match(bridge,/const trigger = await triggerApprovedBrowserRun/,'the approval awaits the hand-off and logs a failed one')
assert.match(worker,/authorization: `Bearer \$\{secret\}`/,'the internal route is protected by CRON_SECRET')
assert.match(worker,/cron sweeper will run/,'a missing secret falls back to the cron sweeper')

// 4. The internal route answers 202 at once, runs the work in after(), and has the 300s budget.
assert.match(route,/export const maxDuration = 300/,'the approved-browser route has the 300s budget')
assert.match(route,/authorized\(request\)/,'the approved-browser route checks the secret')
assert.match(route,/\{ status: 202 \}/,'the approved-browser route answers before the browser runs')
assert.match(route,/after\(async \(\) =>/,'the browser work runs after the response')

// 5. The single worker only runs queued, approved, execute-mode, secure-browser runs, claimed once.
assert.match(worker,/run\.status !== 'queued'/,'the worker only runs queued runs')
assert.match(worker,/meta\.mode !== 'execute'/,'the worker only executes execute-mode runs')
assert.match(worker,/\.eq\(\s*'status'\s*,\s*'approved'\s*\)/,'the worker requires an approved approval row')
const claim=worker.indexOf(".update({ status: 'running'")
const execute=worker.indexOf('executeApprovedBrowserCommand({ actor, runId: String(run.id) })')
assert.ok(claim>0&&execute>claim,'the worker claims the run (queued->running) before executing it')
assert.match(worker,/\.eq\('status', 'queued'\)[\s\S]{0,80}\.select\('id'\)[\s\S]{0,40}\.maybeSingle\(\)[\s\S]{0,40}if \(!claimed\?\.id\) return 'skipped'/,'an unclaimed run is skipped (optimistic lock)')
assert.match(worker,/status: 'failed'[\s\S]{0,500}\.eq\('status', 'running'\)/,'failures are recorded only from the running state')
assert.doesNotMatch(worker,/status: 'queued'/,'the worker never re-queues a failed browser run')

// 6. The cron is only a sweeper over queued runs, through the same worker.
assert.match(cron,/import \{ runApprovedBrowserRun \} from '@\/lib\/agent\/approved-browser-worker'/,'the cron uses the shared worker')
assert.match(cron,/\.eq\('type','secure_browser'\)\s*\.eq\('status','queued'\)/,'the cron sweeps only queued secure-browser runs')
assert.match(cron,/await runApprovedBrowserRun\(String\(run\.id\)\)/,'the cron executes through the shared claim')
assert.match(cron,/export const maxDuration = 300/,'the cron has the 300s budget')

// 7. An existing provider account is reported as blocked (never as a created account).
const secure=readFileSync('lib/agent/secure-computer.ts','utf8')
const duplicateLine=secure.split('\n').find(line=>line.includes('const duplicateAccount='))
assert.ok(duplicateLine,'the account-creation branch detects an existing account')
const duplicatePattern=new Function(`return ${duplicateLine.trim().replace(/^const duplicateAccount=/,'').replace(/;$/,'')}`)() as RegExp
for(const text of [
  'The email address is already registered.',
  'This email is already in use.',
  'An account already exists for this email.',
  'Email already exists. Try logging in.',
  'You already have an account. Log in instead.',
]) assert.ok(duplicatePattern.test(text),`duplicate account wording is detected: ${text}`)
for(const text of [
  'Your account has been created successfully.',
  'Enter your email address to sign in.',
  'Use your email address to create an account.',
]) assert.ok(!duplicatePattern.test(text),`normal signup wording is not treated as a duplicate: ${text}`)
assert.match(secure,/accountExists\?'blocked':'completed'/,'an existing account is returned as blocked, not completed')

// 8. A provider human check (security_check) pauses for the user through the existing takeover.
// Gogo never solves it, and it is never handed off after a submit or other consequential action.
assert.match(secure,/function humanVerificationCheck\(page:any,actionLog:any\[\]\)/,'the provider human check has its own recogniser')
assert.match(secure,/if\(actionLog\.some\(action=>\(action\.kind==='submit'\|\|action\.consequential===true\)&&action\.status!=='skipped'\)\)return null/,'a check after a submit or consequential action is never handed off')
assert.match(secure,/blockReason:'human_auth_required',authReason:'captcha'/,'a provider human check pauses as human_auth_required, so the takeover link is issued')
assert.match(secure,/handoffReservation:await releaseOwnerLock\.reserveHandoff\(\)/,'the takeover is reserved before the run pauses')
assert.doesNotMatch(secure,/capsolver|2captcha|anticaptcha|solveCaptcha/i,'no CAPTCHA-solving service is wired in')

console.log('Browser approval execution: approval routing, handoff, single claim, failure containment checks passed (structural)')
