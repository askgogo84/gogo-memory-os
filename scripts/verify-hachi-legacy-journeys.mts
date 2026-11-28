import assert from 'node:assert/strict'
import {existsSync,readFileSync,readdirSync} from 'node:fs'
const cases=[
  [
    "L01",
    "AG01/AG09",
    "Typo/noise and reminder/calendar collisions; preserve task, date, recurrence and ambiguous AM/PM",
    "verify-input-resilience.mts",
    "verify-reminder-dedup.mts",
    "verify-calendar-routing.mts"
  ],
  [
    "L02",
    "AG04/AG11",
    "Train is not rain/weather; exact direction and date, honest partial search; follow-up picks stay on the original result set",
    "verify-dashboard-train-surface.mts",
    "verify-train-device-handoff.mts",
    "verify-flight-followup-owner.mts",
    "verify-acceptance-recall-flight-voice.mts",
    "verify-flight-rows-direct-oct27.mts"
  ],
  [
    "L03",
    "AG05/AG06",
    "Read correct connected calendar and named event; mutation is separately approved and read back",
    "verify-calendar-read-routing.mts",
    "verify-calendar-conflict-and-mutations.mts",
    "verify-calendar-approval-card.mts"
  ],
  [
    "L04",
    "AG07/AG08/AG22",
    "Secondary Gmail scope, revoke/disconnect, exact thread search and no false send",
    "verify-extra-gmail-refresh-consent-nov6.mts",
    "verify-gmail-consent-boundary.mts",
    "verify-gmail-thread-completion-nov22.mts",
    "verify-gmail-send-flow.mts"
  ],
  [
    "L05",
    "AG10/AG16",
    "Watcher identity, cadence, stop, expiry and duplicate suppression; alerts require delivery evidence",
    "verify-r02-watch-dedupe.mts",
    "verify-watcher-dedup.mts",
    "verify-contextual-watch-expiry-nov22.mts",
    "verify-delivery-reliability.cjs"
  ],
  [
    "L06",
    "AG11/AG25",
    "Flight arrival and saved-ticket leg state; no unverified landing or false notification",
    "verify-flight-live-arrival.mts",
    "verify-flight-leg-tracker.mts",
    "verify-flight-leg-exact-owner-fix.mjs",
    "verify-delivery-reliability.cjs"
  ],
  [
    "L07",
    "AG12/AG25",
    "Restaurant search for two people must honor do-not-book; no venue/slot or confirmation invented",
    "verify-restaurant-reservation.mts",
    "verify-restaurant-reservation-preclaim-owner-nov9.mts",
    "verify-booking-closure.mts"
  ],
  [
    "L08",
    "AG13/AG24",
    "Product variant/retailer evidence, partial timeout and continuation; exact cart, no payment without approval",
    "verify-comparison-timeout-recovery.mts",
    "verify-commerce-cart-execution.mts",
    "verify-commerce-task-continuation.mts"
  ],
  [
    "L09",
    "AG14/AG25/AG26",
    "Browser login, Take Control and resume the same mission, no blind retries or cross-owner state",
    "verify-browser-acceptance-oct26.mts",
    "verify-background-browser-resume.mts",
    "verify-browser-login-shell-nov22.mts",
    "verify-autonomous-runtime.mts"
  ],
  [
    "L10",
    "AG02/AG03/AG20/AG22",
    "PAN/passport and secret masking, source ownership, literal saves, forget/unindex and no stale recall",
    "verify-memory-redaction.mts",
    "verify-memory-browser-integrity.mts",
    "verify-memory-forget-retention.mjs",
    "verify-memory-index-forget-race.mjs"
  ],
  [
    "L11",
    "AG15/AG16/AG25",
    "Durable task identity, cancellation, delivery and reconciliation; no 100% progress without evidence",
    "verify-run-cancel.mts",
    "verify-autonomous-runtime.mts",
    "verify-delivery-reliability.cjs"
  ],
  [
    "L12",
    "AG17/AG26",
    "Voice, WhatsApp and desktop continuity; no echo or false provider delivery claim",
    "verify-gogo-voice-nov11.mts",
    "verify-acceptance-recall-flight-voice.mts",
    "verify-delivery-reliability.cjs"
  ],
  [
    "L13",
    "SB01/SB02/SB03/SB04/SB08/SB11/SB23/SB25",
    "SecondBrain explicitly shared records only, no personal source leak; recorded hospitality totals and role isolation",
    "verify-secondbrain-pilot.mts",
    "verify-workspace-pilot-ask-nov23.mts",
    "verify-hachi-durable-review.mts"
  ]
]
const runbook=readFileSync('docs/architecture/hachi-acceptance-20261128.md','utf8')
const registry=readdirSync('scripts/tests.d').filter(x=>x.endsWith('.list')).map(x=>readFileSync('scripts/tests.d/'+x,'utf8')).join('\n')
for(const [id,ids,_,...fixtures] of cases){
  assert.ok(runbook.includes('| '+id+' |'),'missing historical case '+id)
  for(const acceptance of ids.split('/'))assert.ok(runbook.includes('| '+acceptance+' |'),'missing acceptance '+acceptance)
  for(const fixture of fixtures){
    assert.ok(existsSync('scripts/'+fixture),'missing historical regression fixture '+fixture)
    assert.ok(registry.includes('scripts/'+fixture),'historical regression not in full suite '+fixture)
  }
}
for(const prefix of ['AG','SB'])for(let n=1;n<=26;n++)assert.ok(runbook.includes('| '+prefix+String(n).padStart(2,'0')+' |'),'missing acceptance journey')
console.log('HACHI_LEGACY_JOURNEYS_OK: 13 historic failure groups and 52 acceptance journeys mapped; not live acceptance evidence')
