import assert from 'node:assert/strict'
import fs from 'node:fs'

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')) as { scripts?: Record<string, string> }
const testCommand = pkg.scripts?.test || ''
const prebuild = pkg.scripts?.prebuild || ''
const ci = fs.readFileSync('.github/workflows/ci.yml', 'utf8')
const matrix = fs.readFileSync('docs/autonomous-brain-test-matrix.md', 'utf8')

// Full regressions are a CI/PR safety gate, not a Vercel prebuild hook.
// Keeping npm test out of prebuild restores fast preview deployments while
// still blocking merges through AskGogo CI.
assert.notEqual(prebuild, 'npm test', 'Vercel prebuild must not run the entire regression suite')
assert.match(ci, /run:\s*npm test/, 'AskGogo CI must run the full autonomous regression suite')
assert.match(ci, /run:\s*npm run typecheck/, 'AskGogo CI must run typecheck after regressions')

const requiredGates = [
  'verify-full-feature-legacy-bridge.mts',
  'verify-agent-policy.mts',
  'verify-agent-phase2.mts',
  'verify-agent-compound.mts',
  'verify-agent-watchers.mts',
  'verify-agent-web-watch.mts',
  'verify-cost-guard.mts',
  'verify-agent-travel-calendar.mts',
  'verify-agent-travel-research.mts',
  'verify-agent-general-plan.mts',
  'verify-agent-secure-browser.mts',
  'verify-browser-auth-gate.mts',
  'verify-agent-same-brain.mts',
  'verify-agent-sentinel.mts',
  'verify-agent-goals.mts',
  'verify-agent-whatsapp-bridge.mts',
  'verify-agent-learning.mts',
  'verify-google-workspace-oauth.mts',
  'verify-workspace-meeting-approval.mts',
  'verify-workspace-drive-context.mts',
  'verify-life-event-engine.mts',
  'verify-life-event-integrations.mts',
  'verify-life-event-worker.mts',
  'verify-dashboard-day-chat.mts',
  'verify-dashboard-tasks-source.mts',
  'verify-india-agent-launch.mts',
  'verify-product-readiness.mjs',
]

for (const gate of requiredGates) {
  assert.ok(testCommand.includes(gate), `missing autonomous regression gate from npm test: ${gate}`)
}

const requiredSequences = [
  'Sequence A — Same brain, every surface',
  'Sequence B — Capture → remember → retrieve → act',
  'Sequence C — Low-risk autonomous execution',
  'Sequence D — Plan → approve → execute',
  'Sequence E — Background Gogo: watch → detect → notify',
  'Sequence F — Google Workspace autonomous brain',
  'Sequence G — Secure Computer + Sentinel',
  'Sequence H — Travel intelligence → calendar → lifecycle',
  'Sequence I — Autonomous flight check-in',
  'Sequence J — Proactive daily brain',
  'Sequence K — India launch / production readiness',
  'Sequence L — Documents, identity and expiry',
  'Sequence M — Purchase, delivery and warranty',
  'Sequence N — Bills and subscriptions',
  'Sequence O — People, family and circles',
  'Sequence P — Voice and multilingual India',
  'Sequence Q — Expenses, receipts and splits',
  'Sequence R — Meetings and founder mode',
  'Sequence S — Health/wellness document reminders',
  'Sequence T — Monetisation, metering and integrations',
]

for (const sequence of requiredSequences) {
  assert.ok(matrix.includes(sequence), `canonical autonomous brain matrix lost sequence: ${sequence}`)
}

const requiredSafetyPromises = [
  'Legacy deterministic WhatsApp features win before Muse-style agent fallback.',
  'Never claim a sensitive value was stored if the value was never supplied.',
  'Rejected approvals never execute.',
  'Duplicate URLs/topics do not spam the user.',
  'Draft/preparation mode must not submit, purchase, or commit an irreversible action.',
  'Any new charge or authentication challenge stops execution.',
  'Success requires terminal check-in confirmation evidence tied to the final submission.',
  'Uncertain execution never auto-retries an irreversible submit.',
  'Cron endpoints are protected by `CRON_SECRET`.',
]

for (const promise of requiredSafetyPromises) {
  assert.ok(matrix.includes(promise), `canonical safety promise missing: ${promise}`)
}

const visibleGaps = [
  'Secure human takeover UI for browser authentication and uncertain external state.',
  'Persist/download the actual Gmail boarding-pass attachment bytes',
  'Provider-specific authenticated delivery/order adapters',
  'Provider-specific bill/subscription payment or cancellation executors',
  'DigiYatra / country capability packs.',
  'Dedicated Circles, Expenses/Splits and Health-document schemas + regression gates.',
  'Production Expo push project configuration + physical-device delivery test.',
]

for (const milestone of visibleGaps) {
  assert.ok(matrix.includes(milestone), `remaining autonomous gap disappeared from the test plan: ${milestone}`)
}

console.log(`✅ Autonomous brain matrix covers ${requiredSequences.length} product sequences and ${requiredGates.length} regression gates`)
