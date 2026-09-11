import assert from 'node:assert/strict'
import { parseWebWatchCommand } from '../lib/agent/watch-command'
import { normalizeWebSearchWatcher } from '../lib/agent/watchers'
import {
  assessWebWatchResult,
  canonicalWatcherUrl,
  watcherResultSignature,
  webWatchAlertAllowed,
  WEB_WATCH_MAX_ALERTS_24H,
  WEB_WATCH_MIN_ALERT_INTERVAL_MS,
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

// Regression for the WhatsApp flood seen on broad AskGogo/Muse monitoring.
// Generic personal-agent listicles must not become "meaningful" merely because a search provider rotated them into the top five.
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
