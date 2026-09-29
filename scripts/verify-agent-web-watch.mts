import assert from 'node:assert/strict'
import { parseFlightIdentifier, parseInboxTriageWatchCommand, parseProductStockWatchCommand, parseWebPageWatchCommand, parseWebWatchCommand } from '../lib/agent/watch-command'
import { assessProductAvailabilityText, inboxActionStep, normalizeProductStockWatcher, normalizeWebPageWatcher, normalizeWebSearchWatcher } from '../lib/agent/watchers'
import {
  assessWebWatchResult,
  canonicalWatcherUrl,
  watcherResultSignature,
  watcherEventKey,
  extractFlightCodes,
  activeEventKeys,
  recordEventKey,
  activeStamped,
  mergeStamped,
  webWatchAlertAllowed,
  WEB_WATCH_MAX_ALERTS_24H,
  WEB_WATCH_MIN_ALERT_INTERVAL_MS,
  EVENT_KEY_REARM_MS,
} from '../lib/agent/watcher-quality'

const cases = [
  {
    text: 'Watch the web for Christopher Ward C63 Sealander availability in New York and tell me when something new appears',
    query: 'Christopher Ward C63 Sealander availability in New York',
  },
  {
    text: 'monitor online for CreditIQ accelerator applications',
    query: 'CreditIQ accelerator applications',
  },
  {
    text: 'watch Qatar startup program online',
    query: 'Qatar startup program',
  },
]

for (const c of cases) {
  const parsed = parseWebWatchCommand(c.text)
  assert.ok(parsed, `should parse: ${c.text}`)
  assert.equal(parsed.query, c.query)
  assert.equal(parsed.cadenceMinutes, 15)
  assert.equal(parsed.delivery, 'both')
}

assert.equal(parseWebWatchCommand('What is on my calendar?'), null)
assert.equal(parseWebWatchCommand('Watch a movie tonight'), null)
assert.equal(parseWebWatchCommand('monitor'), null)


const pageTitleWatch=parseWebPageWatchCommand('Monitor https://example.com and tell me if the page title changes.')
assert.ok(pageTitleWatch)
assert.equal(pageTitleWatch.url,'https://example.com/')
assert.equal(pageTitleWatch.watch,'title')
assert.equal(pageTitleWatch.delivery,'both')
assert.ok(pageTitleWatch.cadenceMinutes>=60)

const pageContentWatch=parseWebPageWatchCommand('Watch https://example.com/news and alert me if the page changes')
assert.ok(pageContentWatch)
assert.equal(pageContentWatch.watch,'content')
assert.equal(parseWebPageWatchCommand('Open https://example.com now'),null)

const normalizedPage=normalizeWebPageWatcher({
  title:'Example page',
  url:'https://example.com/#top',
  watch:'title',
  cadenceMinutes:2,
  delivery:'whatsapp',
})
assert.ok(normalizedPage)
assert.equal(normalizedPage.url,'https://example.com/')
assert.equal(normalizedPage.cadenceMinutes,60)

assert.ok(parseInboxTriageWatchCommand('Quietly read my mail and give me steps to take'))
assert.ok(parseInboxTriageWatchCommand('Watch my inbox and tell me what needs my attention'))
assert.equal(parseInboxTriageWatchCommand('Show me my latest email'), null)
assert.equal(parseInboxTriageWatchCommand('Watch the web for AI news'), null)

const approvalMail=inboxActionStep({
  subject:'Approval required for vendor contract',
  from:'Legal Team <legal@example.com>',
  snippet:'Please review and approve this by Friday.',
})
assert.ok(approvalMail)
assert.match(approvalMail.step,/approve|sign/i)

const promoMail=inboxActionStep({
  subject:'Weekend sale',
  from:'Store <offers@example.com>',
  snippet:'20% discount. Unsubscribe anytime.',
})
assert.equal(promoMail,null)


const productWatch = parseProductStockWatchCommand(
  'Alert me if this size comes up -https://sensesindia.in/products/legacy-polo-sweater-fossil-grey in XL size ..add it to cart and alert me',
)
assert.ok(productWatch, 'product stock watch should parse')
assert.equal(productWatch.productUrl, 'https://sensesindia.in/products/legacy-polo-sweater-fossil-grey')
assert.equal(productWatch.variant, 'XL')
assert.equal(productWatch.addToCart, true)
assert.equal(productWatch.delivery, 'both')
assert.equal(productWatch.cadenceMinutes, 60, 'product stock watches default to hourly polling')

const notifyOnlyProductWatch = parseProductStockWatchCommand(
  'Notify me when https://shop.example.com/products/jacket is back in stock in L size',
)
assert.ok(notifyOnlyProductWatch)
assert.equal(notifyOnlyProductWatch.variant, 'L')
assert.equal(notifyOnlyProductWatch.addToCart, false)

assert.equal(parseProductStockWatchCommand('Is XL available at this store?'), null, 'URL + watch intent are required')
assert.equal(parseProductStockWatchCommand('Alert me about https://example.com/product'), null, 'availability + variant are required')

const normalizedProductWatch = normalizeProductStockWatcher({
  title:'Jacket — XL',
  productUrl:'https://shop.example.com/jacket#size',
  variant:'XL',
  addToCart:true,
  cadenceMinutes:2,
  delivery:'whatsapp',
})
assert.ok(normalizedProductWatch)
assert.equal(normalizedProductWatch.variant, 'XL')
assert.equal(normalizedProductWatch.addToCart, true)
assert.equal(normalizedProductWatch.cadenceMinutes, 15)

assert.equal(
  assessProductAvailabilityText('Size XL Sold out. Notify me when available.', 'XL'),
  'unavailable',
)
assert.equal(
  assessProductAvailabilityText('Size XL Available now. Add to cart', 'XL'),
  'available',
)
assert.equal(
  assessProductAvailabilityText('Choose a colour and size.', 'XL'),
  'unknown',
)

// Production regression: a stale pending flight follow-up must never reinterpret
// an unrelated time phrase such as "at 9:00 AM" as flight number "AT 9".
assert.equal(parseFlightIdentifier('Create a packing list and remind me tomorrow at 9:00 AM'), null)
assert.equal(parseFlightIdentifier('remind me at 8:30 PM to call Mathew'), null)
assert.equal(parseFlightIdentifier('Air India AI 101')?.flightNumber, 'AI 101')
assert.equal(parseFlightIdentifier('IndiGo 6E 203')?.flightNumber, '6E 203')

const normalized = normalizeWebSearchWatcher({
  title:'  Watch watch availability  ',
  query:'  Christopher Ward   New York ',
  triggerKeywords:['stock','Stock','available',''],
  cadenceMinutes:2,
  delivery:'whatsapp',
})
assert.ok(normalized)
assert.equal(normalized.query, 'Christopher Ward New York')
assert.deepEqual(normalized.triggerKeywords, ['stock','available'])
assert.equal(normalized.cadenceMinutes, 15)
assert.equal(normalized.delivery, 'whatsapp')

const maxCadence = normalizeWebSearchWatcher({ title:'x', query:'y', cadenceMinutes:99999 })
assert.equal(maxCadence?.cadenceMinutes, 1440)
assert.equal(normalizeWebSearchWatcher({ title:'x', query:'' }), null)

const genericMuse = assessWebWatchResult({
  query:'AskGogo personal AI agent India',
  title:'Introducing Muse — the world’s first Personal AI Agent',
  snippet:'Meet Muse, your personal AI agent. It does not just answer questions.',
  url:'https://example.com/muse?utm_source=search',
})
assert.equal(genericMuse.eligible, false)
assert.equal(genericMuse.reason, 'low_relevance')

const genericListicle = assessWebWatchResult({
  query:'AskGogo personal AI agent India',
  title:'Best Personal AI Agents in 2026 (Founder Picks)',
  snippet:'A roundup of assistants and autonomous agents for consumers.',
  url:'https://example.net/listicle',
})
assert.equal(genericListicle.eligible, false)

const genuineAskGogo = assessWebWatchResult({
  query:'AskGogo personal AI agent India',
  title:'AskGogo personal AI agent expands in India',
  snippet:'AskGogo launches new personal agent capabilities for users in India.',
  url:'https://news.example.com/askgogo-india',
})
assert.equal(genuineAskGogo.eligible, true)
assert.ok(genuineAskGogo.relevance >= 0.72)

const trackedUrl = canonicalWatcherUrl('https://www.news.example.com/askgogo-india?utm_source=x&fbclid=y')
assert.equal(trackedUrl, 'https://news.example.com/askgogo-india')
const duplicateUrl = assessWebWatchResult({
  query:'AskGogo personal AI agent India',
  title:'AskGogo personal AI agent expands in India',
  snippet:'AskGogo launches new personal agent capabilities for users in India.',
  url:'https://news.example.com/askgogo-india?utm_campaign=again',
  seenUrls:[trackedUrl],
})
assert.equal(duplicateUrl.reason, 'duplicate_url')

const signature = watcherResultSignature(
  'AskGogo personal AI agent expands in India',
  'AskGogo launches new personal agent capabilities for users in India.',
)
const duplicateTopic = assessWebWatchResult({
  query:'AskGogo personal AI agent India',
  title:'AskGogo personal AI agent expands in India',
  snippet:'AskGogo launches new personal agent capabilities for users in India.',
  url:'https://another.example.org/story',
  seenSignatures:[signature],
})
assert.equal(duplicateTopic.reason, 'duplicate_topic')

const keywordMiss = assessWebWatchResult({
  query:'Christopher Ward C63 Sealander New York',
  title:'Christopher Ward C63 Sealander arrives in New York',
  snippet:'The C63 Sealander is being shown at a New York event.',
  url:'https://watches.example.com/c63-new-york',
  triggerKeywords:['in stock'],
})
assert.equal(keywordMiss.reason, 'keyword_miss')

const keywordHit = assessWebWatchResult({
  query:'Christopher Ward C63 Sealander New York',
  title:'Christopher Ward C63 Sealander now in stock in New York',
  snippet:'The watch is available to order.',
  url:'https://watches.example.com/c63-stock',
  triggerKeywords:['in stock'],
})
assert.equal(keywordHit.eligible, true)
assert.deepEqual(keywordHit.matchedKeywords, ['in stock'])

// Production incident: one EY 1 delay alerted twice — "delay" then "delay, delayed" —
// because dedup keyed only on volatile URL/snippet signatures, never on the event.
// Synonym stems must collapse to one key so the SAME disruption cannot re-alert.
assert.equal(watcherEventKey(['delay']), watcherEventKey(['delay', 'delayed']), 'synonym superset must share one event key')
assert.equal(watcherEventKey(['delay'], 'ey1:flight_status'), watcherEventKey(['delayed', 'delay'], 'ey1:flight_status'))
assert.notEqual(watcherEventKey(['delay'], 'ey1'), watcherEventKey(['storm'], 'ey1'), 'different disruptions are distinct events')
assert.equal(watcherEventKey([]), '', 'no keywords → no event key')

const firstDelay = assessWebWatchResult({
  query:'EY 1 flight status',
  title:'Etihad EY 1 flight status',
  snippet:'Flight EY 1 status is running with a delay today.',
  url:'https://flights.example.com/ey1-status',
  triggerKeywords:['delay','cancelled','gate change'],
  occurrence:'ey1:flight_status',
})
assert.equal(firstDelay.eligible, true)
assert.deepEqual(firstDelay.matchedKeywords, ['delay'])
assert.ok(firstDelay.eventKey)

// Same delay, re-retrieved later with a reworded snippet (new URL + new signature +
// superset of synonyms) must NOT alert again — the event key already fired.
const repeatDelay = assessWebWatchResult({
  query:'EY 1 flight status',
  title:'EY 1 flight status delayed — latest',
  snippet:'EY 1 flight status delayed; the earlier delay continues per the airline.',
  url:'https://tracker.example.net/ey1-delayed',
  triggerKeywords:['delay','cancelled','gate change'],
  occurrence:'ey1:flight_status',
  seenEventKeys:[firstDelay.eventKey],
})
assert.equal(repeatDelay.eligible, false, 'repeat of the same disruption must be suppressed')
assert.equal(repeatDelay.reason, 'duplicate_event')

// A genuinely new disruption (cancellation) on the same occurrence still alerts.
const newDisruption = assessWebWatchResult({
  query:'EY 1 flight status',
  title:'EY 1 flight status: cancelled',
  snippet:'Etihad EY 1 flight status: cancelled for today.',
  url:'https://flights.example.com/ey1-cancelled',
  triggerKeywords:['delay','cancelled','gate change'],
  occurrence:'ey1:flight_status',
  seenEventKeys:[firstDelay.eventKey],
})
assert.equal(newDisruption.eligible, true, 'a distinct disruption on the same occurrence still alerts')

// Codex P1: dedup must be scoped to the actual flight occurrence, not the whole
// multi-leg watcher, or a delay on one leg silently suppresses a delay on another.
assert.deepEqual(extractFlightCodes('Etihad EY 1 flight status delayed'), ['ey1'])
assert.deepEqual(extractFlightCodes('6E 203 cancelled today'), ['6e203'])
assert.deepEqual(extractFlightCodes('trip: EY239 then EY1'), ['ey1', 'ey239'])
// Different occurrences (leg EY239 vs leg EY1) with the SAME disruption keyword are
// distinct events and both alert; the same occurrence re-alerts only after re-arm.
assert.notEqual(watcherEventKey(['delay'], 'trip-ny:flight_status:ey239'), watcherEventKey(['delay'], 'trip-ny:flight_status:ey1'))

// Event-key re-arm: an expired key no longer suppresses; a fresh one does.
const t0 = new Date('2026-09-01T00:00:00Z')
const recent = new Date('2026-09-05T00:00:00Z')
const later = new Date('2026-09-20T00:00:00Z') // > 10-day re-arm window after t0
const stored = recordEventKey([], 'k1', t0)
assert.ok(stored[0].startsWith('k1|'))
assert.deepEqual(activeEventKeys(stored, recent), ['k1'], 'a fresh key stays armed')
assert.deepEqual(activeEventKeys(stored, later), [], 'a key past the re-arm window expires')
assert.ok(EVENT_KEY_REARM_MS > 0)
// Legacy undated entries remain armed (back-compat).
assert.deepEqual(activeEventKeys(['legacyKey'], later), ['legacyKey'])

// Codex P1 (round 2): URL/topic dedup must re-arm too, or a recurring event at a STABLE
// URL is suppressed forever even after the event key expires. mergeStamped time-stamps
// seenUrls/seenSignatures; activeStamped drops them past the window.
const urlHist = mergeStamped([], ['https://tracker.example.com/ey1'], t0)
assert.ok(urlHist[0].startsWith('https://tracker.example.com/ey1|'))
assert.deepEqual(activeStamped(urlHist, recent), ['https://tracker.example.com/ey1'], 'a recent URL stays deduped')
assert.deepEqual(activeStamped(urlHist, later), [], 'a stable URL re-arms after the window so a recurring event can alert')
// A URL containing "|" is preserved (only a trailing |<digits> is a timestamp).
const pipeUrl = mergeStamped([], ['https://x.example.com/a|b'], t0)
assert.deepEqual(activeStamped(pipeUrl, recent), ['https://x.example.com/a|b'])
// Re-seeing a URL keeps its ORIGINAL timestamp (does not refresh), so continuous
// presence still expires on schedule.
const refreshed = mergeStamped(urlHist, ['https://tracker.example.com/ey1'], recent)
assert.deepEqual(activeStamped(refreshed, later), [], 're-seeing a URL must not reset its expiry clock')
// Legacy bare URL entries stay deduped (no spam burst) until re-stamped.
assert.deepEqual(activeStamped(['https://legacy.example.com/x'], later), ['https://legacy.example.com/x'])

const now = new Date('2026-09-11T03:00:00Z')
const withinCooldown = webWatchAlertAllowed({
  now,
  lastAlertAt:new Date(now.getTime() - WEB_WATCH_MIN_ALERT_INTERVAL_MS + 60_000).toISOString(),
  alertTimes:[],
})
assert.equal(withinCooldown.allowed, false)
assert.equal(withinCooldown.reason, 'cooldown')

const dailyCap = webWatchAlertAllowed({
  now,
  lastAlertAt:new Date(now.getTime() - WEB_WATCH_MIN_ALERT_INTERVAL_MS - 60_000).toISOString(),
  alertTimes:Array.from({ length:WEB_WATCH_MAX_ALERTS_24H }, (_, index) => new Date(now.getTime() - (index + 7) * 60 * 60_000).toISOString()),
})
assert.equal(dailyCap.allowed, false)
assert.equal(dailyCap.reason, 'daily_cap')

const allowed = webWatchAlertAllowed({
  now,
  lastAlertAt:new Date(now.getTime() - WEB_WATCH_MIN_ALERT_INTERVAL_MS - 60_000).toISOString(),
  alertTimes:[new Date(now.getTime() - 10 * 60 * 60_000).toISOString()],
})
assert.equal(allowed.allowed, true)

console.log('✅ agent web watcher checks passed')
