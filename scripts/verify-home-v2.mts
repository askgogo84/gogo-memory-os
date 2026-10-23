// Home v2 (approved 23 Oct mock): Needs you now · Gogo is handling · Coming up · Can wait · Done today, the companion
// character registry, and light as the default theme. Run: npx tsx scripts/verify-home-v2.mts
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { buildHomeSections, homeSummary, rankNow } from '../lib/dashboard/home-sections'
import { COMPANIONS, companionFor, DEFAULT_COMPANION } from '../lib/gogo/characters'
import { GOGO_AGENT_STATES } from '../lib/gogo/agent-states'
import { parseTheme } from '../lib/dashboard/theme'
import type { FeedItem } from '../lib/dashboard/task-feed'

const item = (id: string, tag: string, at: string, extra: Partial<FeedItem> = {}): FeedItem =>
  ({ id, tab: 'need', state: 'approval', tag, title: id, sub: '', live: '', href: '#', action: 'Open', at, ...extra })
const now = new Date('2026-10-23T05:00:00Z') // 10:30 IST

// 1. Needs you now: a code or sign-in first, then yes/no, then "not yet"; equal weight → oldest first.
const ranked = rankNow([
  item('notyet', 'You said not yet', '2026-10-22T01:00:00Z'),
  item('yes-new', 'Needs your yes', '2026-10-23T04:00:00Z'),
  item('code', 'Code needed', '2026-10-23T04:30:00Z'),
  item('yes-old', 'Needs your yes', '2026-10-22T09:00:00Z'),
])
assert.deepEqual(ranked.map(i => i.id), ['code', 'yes-old', 'yes-new', 'notyet'])

// 2. Buckets. "Gogo thinks done" and a watch whose date passed can wait; nothing is invented.
const feed = {
  need: [item('yes', 'Needs your yes', '2026-10-23T04:00:00Z'), item('tidy', 'Gogo thinks done', '2026-10-22T04:00:00Z', { confirm: { runId: 'r1', continueHref: '#' } })],
  radar: [item('run', 'Working now', '2026-10-23T04:50:00Z', { tab: 'radar' }), item('w-old', 'Date passed', '', { tab: 'radar' }), item('w', 'Watching', '', { tab: 'radar' })],
  recent: [item('done-today', 'Finished', '2026-10-23T02:00:00Z', { tab: 'recent' }), item('done-yday', 'Finished', '2026-10-22T10:00:00Z', { tab: 'recent' }), item('failed', 'Could not finish', '2026-10-23T03:00:00Z', { tab: 'recent' })],
  recentUnavailable: false, radarCount: 3,
}
const s = buildHomeSections({
  feed, now, tz: 'Asia/Kolkata',
  today: [
    { id: 1, message: 'Call Divya', remind_at: '2026-10-23T09:00:00Z', sent: false },
    { id: 2, message: 'Already sent', remind_at: '2026-10-23T03:00:00Z', sent: true },
    { id: 3, message: 'Cancelled', remind_at: '2026-10-23T10:00:00Z', status: 'cancelled' },
  ],
  upcoming: [{ id: 4, message: 'Renew Netflix', remind_at: '2026-10-25T05:00:00Z', sent: false }],
})
assert.deepEqual(s.now.map(i => i.id), ['yes'])
assert.deepEqual(s.handling.map(i => i.id), ['run', 'w'])
assert.deepEqual(s.canWait.map(i => i.id), ['tidy', 'w-old'])
assert.deepEqual(s.comingUp.map(l => [l.title, l.when]), [['Call Divya', '14:30']])
assert.deepEqual(s.canWaitLater.map(l => [l.title, l.when]), [['Renew Netflix', 'Sun']])
assert.deepEqual(s.doneToday.map(i => i.id), ['done-today'], 'only finished work from today; a failure is never "done"')
assert.equal(homeSummary(s), '1 thing needs you. Gogo is handling 2. Next: Call Divya at 14:30.')
const empty = buildHomeSections({ feed: { need: [], radar: [], recent: [], recentUnavailable: false, radarCount: 0 }, today: [], now })
assert.match(homeSummary(empty), /Your day is clear/)
assert.match(homeSummary(empty, 1), /^1 thing needs you\.$/, 'a service notice is never summarised as a clear day')

// 3. Companion characters: every character draws every action state; unknown choices fall back to Gogo.
for (const c of Object.values(COMPANIONS)) assert.deepEqual([...c.states].sort(), [...GOGO_AGENT_STATES].sort(), `${c.id} draws every state`)
assert.equal(DEFAULT_COMPANION, 'gogo')
assert.equal(companionFor('GOGO').id, 'gogo'); assert.equal(companionFor('retired-character').id, 'gogo'); assert.equal(companionFor(null).id, 'gogo')
function walk(dir: string, out: string[] = []) { for (const n of readdirSync(dir)) { const p = join(dir, n); statSync(p).isDirectory() ? walk(p, out) : p.endsWith('.tsx') && out.push(p) } return out }
for (const f of [...walk('app/dashboard'), ...walk('components/dashboard')])
  assert.doesNotMatch(readFileSync(f, 'utf8'), /<GogoAgent\b/, `${f} draws the character through Companion`)
const companion = readFileSync('components/gogo/companion.tsx', 'utf8')
assert.match(companion, /theme=\{theme \|\| current\}/, 'the character follows the dashboard theme unless told otherwise')

// 4. Home page: sections in order, characters on cards, safe-mode line, no tabs.
const home = readFileSync('app/dashboard/(app)/home/page.tsx', 'utf8')
assert.match(home, /<HomeGogo compact\/>[\s\S]*<HomeAsk compact\/>[\s\S]*Needs you now[\s\S]*Gogo is handling[\s\S]*Coming up today[\s\S]*Can wait[\s\S]*Done today/)
assert.doesNotMatch(home, /FeedTabs/)
assert.match(home, /asks before it books, pays or sends anything/)
assert.match(readFileSync('lib/dashboard/queries.ts', 'utf8'), /export async function getUpcomingReminders[\s\S]*?\.eq\('telegram_id', tgNum\)/, 'upcoming reminders are owner-scoped')

// 5. Light is the default; dark stays a choice.
assert.equal(parseTheme(null), 'light'); assert.equal(parseTheme('dark'), 'dark')
assert.match(readFileSync('app/dashboard/layout.tsx', 'utf8'), /theme-light final-dark[^"]*" data-theme="light"/)
console.log('Home v2: ranked Needs you, five sections, companion registry, light default')

// 23 Oct feedback "home looks completely out of design": back to the approved mock — Gogo beside a left-aligned
// greeting, one Ask bar, compact notice cards (no full email bodies), Gogo-is-handling as one list card.
{
  const h = readFileSync('app/dashboard/(app)/home/page.tsx', 'utf8')
  assert.doesNotMatch(h, /SHORTCUTS|ServiceNoticeCards|text-center/, 'no centred hero, shortcut tiles or full notice bodies')
  assert.match(h, /<section className="flex items-center gap-3 pb-5">\s*<HomeGogo compact\/>/)
  assert.match(h, /line-clamp-1 text-\[13px\] text-\[#9a9a96\]">\{n\.summary\}/, 'notice body clamped to one line')
  assert.match(h, /rounded-\[14px\] border border-\[#222\] bg-\[#121212\]">\{sections\.handling\.slice\(0,6\)\.map/, 'handling is one list card')
  console.log('Home layout: matches the approved 22 Oct mock')
}
