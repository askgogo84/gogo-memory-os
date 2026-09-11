import assert from 'node:assert/strict'
import fs from 'node:fs'

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')) as { scripts?: Record<string, string> }
const testCommand = pkg.scripts?.test || ''
const prebuild = pkg.scripts?.prebuild || ''
const matrix = fs.readFileSync('docs/autonomous-brain-test-matrix.md', 'utf8')

assert.equal(prebuild, 'npm test', 'production build must run the full autonomous regression suite first')

const requiredGates = [
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
  'Success requires terminal check-in confirmation evidence tied to the final submission',
  'Uncertain execution never auto-retries an irreversible submit.',
  'Cron endpoints are protected by `CRON_SECRET`.',
]

for (const promise of requiredSafetyPromises) {
  assert.ok(matrix.includes(promise), `canonical safety promise missing: ${promise}`)
}

const nextMilestones = [
  'Boarding-pass Gmail executor and attachment lifecycle.',
  'Generic event/reservation calendar executor from Life Events.',
  'DigiYatra / country capability packs.',
  'Secure human takeover UI for browser authentication and uncertain external state.',
  'Purchase/delivery lifecycle executors.',
  'Bills/subscriptions lifecycle executor.',
]

for (const milestone of nextMilestones) {
  assert.ok(matrix.includes(milestone), `pending autonomous milestone disappeared from the test plan: ${milestone}`)
}

console.log(`✅ Autonomous brain matrix covers ${requiredSequences.length} end-to-end sequences and ${requiredGates.length} regression gates`)
