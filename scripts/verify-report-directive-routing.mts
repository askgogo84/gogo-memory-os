import assert from 'node:assert/strict'
import { parseConnectedProviderReadCommand } from '../lib/agent/browser-command'
import { shouldAttemptNaturalAssetRetrieval } from '../lib/services/asset-natural-retrieval'
import { hasLeadingReportMutation, stripReportingDirectives } from '../lib/services/reporting-directive'

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
  // Codex P2 (round 1): the report-mutation target set is open-ended — do NOT
  // enumerate it. Any clause-leading "report <entity>" that is not a reporting
  // directive must decline.
  'Open Instagram and report this story as spam.',
  'Open Instagram and report this reel.',
  'Open Instagram and report this message.',
  'Open Instagram and report this account. Report only verified results.',
  // Codex P2 (round 2): "report <result-noun> as spam" is still a mutation even
  // though the noun is whitelisted — "as spam" is unambiguous.
  'Open Facebook and report the status as spam.',
  'Open Facebook and report the post as inappropriate.',
  // Codex P2 (round 3): the "for <reason>" flag syntax is equally a mutation.
  'Open Facebook and report the status for harassment.',
  'Open Instagram and report this account for abuse.',
]) {
  assert.equal(parseConnectedProviderReadCommand(text), null, `real provider mutation must be declined: ${text.slice(0, 48)}...`)
}

// 3b. Codex P2 (round 2): determiners this/my/our must stay valid in directives, so
//     ordinary reads with those directives still reach the browser.
for (const text of [
  'Open Blinkit and check availability of Amul milk. Report this information only.',
  'Open Blinkit and check the price of Amul milk. Report my results.',
  'Open Blinkit and check the price of Amul milk. Report our findings.',
]) {
  assert.ok(parseConnectedProviderReadCommand(text), `directive with determiner must not block read: ${text.slice(0, 48)}...`)
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

// 5b. Codex P2 (round 2/3): a genuine saved "report" with an operational-word title
//     must remain retrievable — the reporting-directive strip is clause-leading only,
//     so a "report" NOUN followed by a result noun in a title is left intact.
assert.equal(shouldAttemptNaturalAssetRetrieval('Find my hotel report'), true)
assert.equal(shouldAttemptNaturalAssetRetrieval('Show me my flight delay report'), true)
assert.equal(shouldAttemptNaturalAssetRetrieval('Find my hotel report summary'), true)
assert.equal(shouldAttemptNaturalAssetRetrieval('Open my flight incident report status'), true)

// 6. Codex P2 (rounds 4–5) — helper-level invariants for the PURE/WEAK result split.
//    (a) The abuse guard is clause-leading: "report" as a content NOUN is not a flag.
assert.equal(hasLeadingReportMutation('Open LinkedIn and find the report for harassment prevention'), false)
assert.equal(hasLeadingReportMutation('find the incident report for abuse training'), false)
//    (b) leading-verb flag actions are mutations (as/for reason, non-pure objects).
assert.equal(hasLeadingReportMutation('report the status for harassment'), true)
assert.equal(hasLeadingReportMutation('and report this post as spam'), true)
assert.equal(hasLeadingReportMutation('report the post as inappropriate'), true)
//    (c) demonstrative + WEAK result noun is a provider object, not a directive.
assert.equal(hasLeadingReportMutation('report this status'), true)
assert.equal(hasLeadingReportMutation('report that price'), true)
//    (d) demonstrative + PURE result noun is a benign directive (round 2).
assert.equal(hasLeadingReportMutation('report this information only'), false)
assert.equal(hasLeadingReportMutation('report my results'), false)
//    (e) an abuse word used as a PURPOSE after a PURE result is benign (round 5).
assert.equal(hasLeadingReportMutation('report only verified results for harassment prevention'), false)
//    (f) leading-adverb directives are stripped; report-as-noun titles are not.
assert.doesNotMatch(stripReportingDirectives('check availability. Only report verified results.'), /\breport\b/i)
assert.doesNotMatch(stripReportingDirectives('Just report the findings'), /\breport\b/i)
assert.match(stripReportingDirectives('Find my hotel report summary'), /\breport\b/i)
//    (g) so an operational read ending with that directive does not hijack Asset Memory.
assert.equal(
  shouldAttemptNaturalAssetRetrieval('Open the flight booking page and check availability. Only report verified results.'),
  false,
)

console.log('✅ Report-directive routing regression passed: explicit browser actions with "Report only verified results" reach the secure browser and cannot be hijacked by Asset Memory')
