// Inert Home-only contract. No DB, provider, account or browser calls.
// PR-specific CI runs this independently of the frozen npm-test registry.
import assert from 'node:assert/strict'
import { buildHomeSections, homeSummary } from '../lib/dashboard/home-sections'
import type { FeedItem, TaskFeed } from '../lib/dashboard/task-feed'

const now = new Date('2026-10-28T04:00:00Z')
const at = '2026-10-28T03:55:00Z'
const card = (id: string, tag: string, tab: FeedItem['tab'] = 'recent'): FeedItem => ({
  id, tab, state: tag === 'Not sure it happened' ? 'blocked' : 'done',
  tag, title: tag === 'Not sure it happened' ? 'Same synthetic task' : id,
  sub: 'Synthetic fixture: provider outcome requires independent verification',
  live: 'Unverified external effect', href: `/dashboard/activity/${id}`,
  action: 'Details', at,
})
const first = card('run-unknown-101', 'Not sure it happened')
const second = card('run-unknown-102', 'Not sure it happened')
const finished = card('run-finished', 'Finished')
const failed = card('run-failed', 'Could not finish')
const approval: FeedItem = {
  id: 'ap-synthetic', tab: 'need', state: 'approval', tag: 'Needs your yes',
  title: 'Synthetic approval', sub: 'A real approval still takes priority',
  live: 'Waiting for approval', href: '/dashboard/agent?section=approvals',
  action: 'Review', at,
}
const feed: TaskFeed = {
  need: [approval], radar: [], recent: [first, second, finished, failed],
  recentUnavailable: false, radarCount: 0,
}
const sections = buildHomeSections({ feed, today: [], now })
// Two different unverified external effects MUST NOT collapse just because their
// title, description and status match. Never create a retry or claim success.
assert.deepEqual(
  sections.now.map(i => i.id),
  [first.id, second.id, approval.id],
  'unverified runs must appear in Home Needs you before ordinary approvals',
)
for (const raw of [first, second]) {
  const shown = sections.now.find(i => i.id === raw.id)
  assert.ok(shown, 'owner should see each uncertain run')
  assert.equal(shown.tab, 'need', 'Home attention badge should not look like completed Recent')
  assert.equal(shown.state, 'blocked')
  assert.equal(shown.tag, 'Not sure it happened')
  assert.equal(shown.action, 'Review', 'only review; never Retry, Book or Send')
  assert.equal(shown.href, raw.href, 'retain exact existing owner-bound activity detail link')
  assert.match(shown.live, /verify/i)
}
assert.deepEqual(sections.doneToday.map(i => i.id), [finished.id])
assert.ok(!sections.now.some(i => i.id === failed.id), 'ordinary failures are not silently promoted as unverified effects')
assert.equal(homeSummary(sections), '3 things need you.', 'Home must not say Your day is clear with uncertain outcomes')

// If the same run is also in the existing need feed, render only one card
// (but continue showing different independent run IDs with matching text).
const duplicate = buildHomeSections({
  feed: { ...feed, need: [approval, { ...first, tab: 'need' }] },
  today: [], now,
})
assert.equal(duplicate.now.filter(i => i.id === first.id).length, 1)
assert.equal(duplicate.now.filter(i => i.id === second.id).length, 1)
assert.equal(homeSummary(duplicate), '3 things need you.')

const untouched = buildHomeSections({
  feed: { ...feed, need: [], recent: [finished, failed] }, today: [], now,
})
assert.deepEqual(untouched.now, [], 'completed/ordinary failure items must not invent urgent action')
assert.deepEqual(untouched.doneToday.map(i => i.id), [finished.id])
assert.match(homeSummary(untouched), /Your day is clear/)
console.log('PASS Home unknown-outcome review: distinct effects visible, no false clear day, no retry')
