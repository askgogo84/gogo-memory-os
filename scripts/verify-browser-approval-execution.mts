// Browser approval execution — STRUCTURAL, MOCK-FREE CHECKS.
// Approving a secure-browser submit on WhatsApp must not run the browser inside the 60s
// webhook. It queues the run; the autonomous-runs worker claims it once (queued->running),
// executes it with its 300s budget, and reports back. These checks read the production
// source so a regression (inline execution, an unguarded claim, a missing approval check)
// fails CI. Behaviour against a live browser is NOT tested here.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const bridge=readFileSync('lib/agent/whatsapp-bridge.ts','utf8')
const cron=readFileSync('app/api/cron/autonomous-runs/route.ts','utf8')

// 1. Approval acknowledges browser runs without executing them inside the webhook.
const browserBranch=bridge.indexOf("if (planType === 'secure_browser') {")
const dispatch=bridge.indexOf("const result = planType === 'calendar_update'")
assert.ok(browserBranch>0,'the WhatsApp approval path has a secure_browser branch')
assert.ok(browserBranch<dispatch,'the secure_browser branch returns before the inline dispatch')
const branchBody=bridge.slice(browserBranch,dispatch)
assert.match(branchBody,/status:'running'/,'an approved browser run is acknowledged as running')
assert.doesNotMatch(branchBody,/executeApprovedBrowserCommand/,'the webhook never executes the browser inline')

// 2. The worker executes only approved, execute-mode, queued browser runs, claimed once.
const block=cron.indexOf('// ---- approved secure_browser execution ----')
const trainBlock=cron.indexOf('// ---- train_research: background execution ----')
assert.ok(block>0&&block<trainBlock,'the approved-browser worker exists in the autonomous-runs cron')
const worker=cron.slice(block,trainBlock)
assert.match(worker,/\.eq\('type','secure_browser'\)\s*\.eq\('status','queued'\)/,'the worker only reads queued secure-browser runs')
assert.match(worker,/meta\.mode!=='execute'\)continue/,'the worker only executes execute-mode runs')
assert.match(worker,/\.eq\('status','approved'\)/,'the worker requires an approved approval row')
const claim=worker.indexOf(".update({status:'running'")
const execute=worker.indexOf('executeApprovedBrowserCommand({actor,runId:String(run.id)})')
assert.ok(claim>0&&execute>claim,'the worker claims the run (queued->running) before executing it')
assert.match(worker,/\.eq\('status','queued'\)\s*\.select\('id'\)\s*\.maybeSingle\(\)\s*if\(!claimed\?\.id\)continue/,'an unclaimed run is skipped (optimistic lock)')
assert.match(worker,/status:'failed'[\s\S]{0,500}\.eq\('status','running'\)/,'failures are recorded only from the running state and never re-queued')
assert.doesNotMatch(worker,/status:'queued'/,'the worker never re-queues a failed browser run (no automatic re-submit)')
assert.match(cron,/export const maxDuration = 300/,'the cron that runs the worker has the 300s budget')

console.log('Browser approval execution: queued approval, single claim, approval gate, failure containment checks passed (structural)')
