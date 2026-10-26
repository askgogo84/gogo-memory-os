// Home v2 (approved 23 Oct mock): Needs you now · Gogo is handling · Coming up · Can wait · Done today, the companion
// character registry, and light as the default theme. Run: npx tsx scripts/verify-home-v2.mts
import assert from 'node:assert/strict'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
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


// Dashboard privileged read owner-isolation: execute the actual queries module with
// inert service-role DB/meter/calendar providers. No network, records or tokens leave this fixture.
{
  const compiled = ts.transpileModule(readFileSync('lib/dashboard/queries.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const queries: any = {}
  type Read = { table: string; eqs: [string, unknown][] }
  const reads: Read[] = []
  const meterOwners: string[] = []
  const calendarAccess: { owner: number; token: string | null }[] = []
  const rowFor = (table: string) => table === 'users'
    ? { name: 'Owner Safe', whatsapp_id: 'whatsapp:+0000004242', created_at: '2026-10-01T00:00:00Z',
        google_calendar_connected: true, google_refresh_token: 'INERT_FIXTURE_TOKEN', gmail_connected: false }
    : table === 'wa_creditiq_links' ? { consumer_user_id: 'fixture-42' } : null
  const supabaseAdmin = {
    from(table: string) {
      const record: Read = { table, eqs: [] }
      reads.push(record)
      const query: any = {
        select: () => query,
        eq: (key: string, value: unknown) => { record.eqs.push([key, value]); return query },
        order: async () => ({
          data: table === 'lists'
            ? [{ id: 7, list_name: 'Owner grocery', items: [{ text: 'Only owner sees' }], updated_at: '2026-10-25T00:00:00Z' }]
            : table === 'friend_contacts' ? [{ name: 'Owner friend' }] : [],
          error: null,
        }),
        maybeSingle: async () => ({ data: rowFor(table), error: null }),
      }
      return query
    },
  }
  runInNewContext(compiled, {
    exports: queries, console, Date, Intl, Number, String, Boolean, Object, Array,
    Promise, URL, URLSearchParams, Math,
    fetch: async () => { throw new Error('fixture must never fetch a provider') },
    require: (name: string) => {
      if (name === '@/lib/supabase-admin') return { supabaseAdmin }
      if (name === '@/lib/ist') return { istDayWindow: () => ({ startUtc: new Date('2026-10-26T00:00:00Z'), endUtc: new Date('2026-10-27T00:00:00Z') }) }
      if (name === '@/lib/data/limits') return { getPlanLimits: () => ({ free: { label: 'Free', priceInr: 0 } }) }
      if (name === '@/lib/services/meter') return {
        getPlan: async (owner: string) => { meterOwners.push(owner); return { plan_code: 'free' } },
        getUsage: async (owner: string) => { meterOwners.push(owner); return { aiToday: 0, docsThisMonth: 0, friendContacts: 0 } },
        getLimits: async () => ({
          ai_actions_per_day: 10, documents_per_month: 10, friend_contacts_max: 10,
          reminders_per_day_fair_use: 10, calendars_max: 1,
        }),
      }
      if (name === '@/lib/services/google-calendar-accounts') return {
        getCalendarAccountAccess: async (owner: number, token: string | null) => {
          calendarAccess.push({ owner, token })
          return [] // no provider/network call, even for valid synthetic owner
        },
        mergeAccountEvents: () => [],
      }
      if (name === '@/lib/calendar-intervals') return { calendarInterval: () => null, calendarBlocksTime: () => false }
      throw new Error('fixture unexpected query import: ' + name)
    },
  })
  for (const bad of ['9007199254740992', '9007199254740993', '4242suffix', '004242', '1e3', '+4242', '4242.0', ' 4242']) {
    const beforeReads = reads.length
    const beforeMeter = meterOwners.length
    const beforeCalendar = calendarAccess.length
    assert.deepEqual(await queries.getLists(bad), { ok: true, lists: [] }, bad + ': no cross-owner list')
    assert.deepEqual(await queries.getFriendContacts(bad), { ok: true, contacts: [], count: 0 }, bad + ': no contacts')
    assert.deepEqual(await queries.getProfile(bad), { ok: false }, bad + ': no private profile/WhatsApp ID')
    assert.deepEqual(await queries.getTodayCalendar(bad), { ok: true, connected: false }, bad + ': no calendar token')
    assert.deepEqual(await queries.getUsageSummary(bad), { ok: false }, bad + ': no metering fallback')
    assert.equal(reads.length, beforeReads, bad + ': zero privileged DB queries')
    assert.equal(meterOwners.length, beforeMeter, bad + ': zero meter queries')
    assert.equal(calendarAccess.length, beforeCalendar, bad + ': zero calendar-account access')
  }
  for (const [valid, expected] of [['4242', 4242], ['-2251799813685248', -2251799813685248]] as const) {
    const before = reads.length
    assert.equal((await queries.getLists(valid)).lists[0].name, 'Owner grocery')
    assert.equal((await queries.getFriendContacts(valid)).contacts[0].name, 'Owner friend')
    assert.equal((await queries.getProfile(valid)).whatsappId, 'whatsapp:+0000004242')
    assert.equal((await queries.getUsageSummary(valid)).ok, true)
    assert.deepEqual(await queries.getTodayCalendar(valid), { ok: true, connected: false })
    assert.ok(reads.length > before)
    for (const read of reads.slice(before)) {
      for (const [column, value] of read.eqs) {
        if (column === 'telegram_id' || column === 'owner_telegram_id') {
          assert.equal(value, expected, valid + ': ' + read.table + ' must use only exact owner')
        }
      }
    }
    assert.equal(calendarAccess.at(-1)?.owner, expected, 'calendar OAuth access uses exact safe owner')
    assert.equal(calendarAccess.at(-1)?.token, 'INERT_FIXTURE_TOKEN')
  }
  console.log('Dashboard owner precision: adjacent signed64, partial-decimal and malformed sessions deny before privileged reads; safe signed owners remain available')
}
