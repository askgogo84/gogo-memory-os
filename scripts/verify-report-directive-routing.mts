import assert from 'node:assert/strict'
import { parseConnectedProviderReadCommand } from '../lib/agent/browser-command'
import { shouldAttemptNaturalAssetRetrieval } from '../lib/services/asset-natural-retrieval'

// ── Regression: the "Report only verified results" directive class ────────────
// PROVEN production incident (deployed 0e0ea3d3, WhatsApp turn 2026-09-29T06:01:08Z):
// the user's explicit Blinkit browser command ended with the standard directive
// "Report only verified results." The token "report" caused two routers to misread
// the reporting instruction as a provider mutation / asset noun:
//   1. parseConnectedProviderReadCommand declined the turn (its return/refund/rate/
//      report mutation guard fired), so the secure browser never ran and no
//      delivery-area/PIN was requested.
//   2. shouldAttemptNaturalAssetRetrieval's operational-flow escape hatch was
//      satisfied by "report", letting Asset Memory surface an UNRELATED saved
//      document (a Grok Voice Transcribe summary) instead of the requested task.
// These assertions run the ACTUAL production predicates against the exact inputs.

const INCIDENT = "Open Blinkit and check the current price and availability of Amul Taaza toned milk, 1 litre. Ask for my delivery area and PIN code if needed. Do not order. If login is required, let me take control, then resume this same task after I authenticate. Report only verified results."

// 1. The exact failing input must now reach the secure browser as a READ command.
{
  const cmd = parseConnectedProviderReadCommand(INCIDENT)
  assert.ok(cmd, 'exact incident Blinkit prompt must route to the browser, not be declined')
  assert.equal(cmd!.mode, 'read', 'grocery price/availability check is a read, never a mutation')
  assert.match(cmd!.url, /blinkit\.com/, 'must target the Blinkit provider')
}

// 2. Reporting directives on any provider browser read must NOT block routing.
for (const text of [
  'Open Blinkit and check the price of Amul Taaza toned milk 1 litre. Do not order. Only report verified results.',
  'Open Blinkit and check availability of Amul milk. Report only verified information.',
  'Open Zepto and check the price of Amul butter 500g. Report back the results.',
  'Open Instagram and show me the 3 most recent posts in my Saved collection. Do not like, comment, follow, message, post, or change anything. If login is required, let me take control, then resume this same task. Report only verified results.',
]) {
  assert.ok(parseConnectedProviderReadCommand(text), `reporting directive must not block provider read: ${text.slice(0, 48)}...`)
}

// 3. Genuine provider MUTATIONS must still be declined (report an entity / return /
//    refund / rate). The reporting-directive fix must not open a mutation hole.
for (const text of [
  'Open Blinkit and report the seller for this product. Report only verified results.',
  'Open Blinkit and report this listing as spam.',
  'Open Blinkit and return my last order. Report only verified results.',
  'Open Blinkit and refund my order. Report only verified results.',
  'Open Blinkit and rate the product 5 stars.',
]) {
  assert.equal(parseConnectedProviderReadCommand(text), null, `real provider mutation must be declined: ${text.slice(0, 48)}...`)
}

// 4. Asset Memory must not hijack an operational browser turn just because it ends
//    with a reporting directive. "report" is no longer an explicit-asset noun.
assert.equal(
  shouldAttemptNaturalAssetRetrieval('Open Blinkit and check the price and availability of Amul Taaza toned milk. Report only verified results.'),
  false,
  'operational browser prompt + reporting directive must not attempt Asset Memory retrieval',
)

// 5. Genuine named/asset retrieval remains available (no over-correction).
assert.equal(shouldAttemptNaturalAssetRetrieval('Open my flight invoice document'), true)
assert.equal(shouldAttemptNaturalAssetRetrieval('Find my hotel receipt'), true)
assert.equal(shouldAttemptNaturalAssetRetrieval('Show me Jopasu Dashboard & Tyre Polish'), true)

console.log('✅ Report-directive routing regression passed: explicit browser actions with "Report only verified results" reach the secure browser and cannot be hijacked by Asset Memory')
