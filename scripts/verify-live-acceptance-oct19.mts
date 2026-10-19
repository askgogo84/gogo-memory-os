// Regressions for defects observed in the 19 Oct live acceptance run (app.askgogo.in, 07e8aa9):
// 1) a reply re-answered the previous question (tied conversation timestamps);
// 2) an empty weekly expense read gave no range or total;
// 3) the morning briefing repeated identical open loops and let five carried-over
//    standup instances crowd out today's events.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'

const RealDate = Date
const NOW = '2026-10-19T04:10:00Z' // 09:40 IST, Monday
class FixedDate extends RealDate {
  constructor(...args: any[]) { super(...(args.length ? args as [any] : [NOW])) }
  static now() { return RealDate.parse(NOW) }
}
const noop = new Proxy({}, {get: () => () => null})
function load(file: string, deps: Record<string, any>) {
  const exports: any = {}
  runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true}}).outputText,
    {exports, require: (name: string) => deps[name] || noop, Date: FixedDate, Intl, console: {log() {}, warn() {}, error() {}}, URL, URLSearchParams, process: {env: {}}, Buffer, Response, Request, setTimeout, clearTimeout, AbortSignal, TextDecoder, TextEncoder, Map, Set})
  return exports
}
const failures: string[] = []
async function check(label: string, fn: () => unknown) { try { await fn(); console.log('PASS ' + label) } catch (e: any) { failures.push(label + ': ' + e.message) } }

// --- 1. Conversation history order -------------------------------------------------
// A fake query that honours only the order clauses it is given. Rows that remain tied
// come back in the adversarial order Postgres is free to choose (user before assistant
// in a newest-first scan), which is what reversed the pair in production.
function conversationsDb(rows: Array<{role: string; content: string; created_at: string}>) {
  return {from(table: string) {
    assert.equal(table, 'conversations')
    const orders: Array<{column: string; ascending: boolean}> = []
    let limit = Infinity
    const q: any = {
      select: () => q, eq: () => q,
      order: (column: string, options: {ascending?: boolean} = {}) => { orders.push({column, ascending: options.ascending !== false}); return q },
      limit: (n: number) => { limit = n; return q },
      then: (resolve: any) => {
        const adversarial = (a: any, b: any) => a.role === b.role ? 0 : a.role === 'user' ? -1 : 1
        const sorted = [...rows].sort((a: any, b: any) => {
          for (const o of orders) { const c = String(a[o.column]).localeCompare(String(b[o.column])); if (c) return o.ascending ? c : -c }
          return adversarial(a, b)
        })
        return resolve({data: sorted.slice(0, limit), error: null})
      },
    }
    return q
  }}
}
await check('model history keeps each tied user/assistant pair in question-then-answer order', async () => {
  const at1 = '2026-10-19T04:12:30.000Z', at2 = '2026-10-19T04:12:50.000Z'
  const db = conversationsDb([
    {role: 'user', content: 'How is Same Brain learning from my outcomes?', created_at: at1},
    {role: 'assistant', content: 'Same Brain v2 measured state…', created_at: at1},
    {role: 'user', content: 'Show my goals.', created_at: at2},
    {role: 'assistant', content: 'Your goals…', created_at: at2},
  ])
  const pm = load('lib/bot/process-message.ts', {'@/lib/supabase-admin': {supabaseAdmin: db}})
  assert.equal(typeof pm.getConversationHistory, 'function')
  const history = await pm.getConversationHistory(123)
  assert.deepEqual(history.map((m: any) => m.role), ['user', 'assistant', 'user', 'assistant'])
  assert.equal(history[0].content, 'How is Same Brain learning from my outcomes?')
  assert.equal(history.at(-1).content, 'Your goals…')
})

// --- 2. Empty expense period ---------------------------------------------------------
await check('an empty successful weekly read states its exact IST range and a verified zero total', async () => {
  const route = load('app/api/expenses/route.ts', {
    '@/lib/security/cron-auth': {isInternalServiceAuthorized: () => true},
    'next/server': {NextResponse: {json: (body: any, init: any = {}) => new Response(JSON.stringify(body), {status: init.status || 200})}},
    '@/lib/bot/services/expense-storage': {
      ...load('lib/bot/services/expense-storage.ts', {'@/lib/supabase-admin': {supabaseAdmin: {from: () => { throw Error('storage read is mocked by getPeriodExpenses') }}}}),
      getPeriodExpenses: async () => null,
      saveExpense: async () => { throw Error('read must not write') },
    },
  })
  const exported = Object.keys(route).filter(k => typeof route[k] === 'function')
  assert.ok(route.GET, 'GET handler exported: ' + exported.join(','))
  const url = 'https://fixture.invalid/api/expenses?telegramId=123&period=week'
  const response = await route.GET(Object.assign(new Request(url, {headers: {'x-internal-secret': 'fixture'}}), {nextUrl: new URL(url)}))
  const body = await response.json()
  assert.equal(response.status, 200)
  assert.match(body.reply, /Range: 19\/10\/2026 through 19\/10\/2026 \(Asia\/Kolkata; Monday-start week, through now\)/)
  assert.match(body.reply, /Total: \*₹0\* · 0 transactions/)
  assert.doesNotMatch(body.reply, /unavailable|couldn.t/i)
})
await check('the shared period range is Monday local midnight through now', async () => {
  const storage = load('lib/bot/services/expense-storage.ts', {'@/lib/supabase-admin': {supabaseAdmin: {}}})
  assert.deepEqual({...storage.expensePeriodRange('week')}, {start: '2026-10-18T18:30:00.000Z', end: '2026-10-19T04:10:00.000Z', timezone: 'Asia/Kolkata'})
  assert.equal(storage.expensePeriodRange('month').start, '2026-09-30T18:30:00.000Z')
})

// --- 3. Morning briefing -------------------------------------------------------------
function briefing(events: any[], loops: any[]) {
  const db = {from(table: string) {
    const q: any = {select: () => q, eq: () => q, gte: () => q, lte: () => q, lt: () => q, gt: () => q, in: () => q, is: () => q, order: () => q, limit: () => q,
      single: () => q, maybeSingle: () => q,
      then: (resolve: any) => resolve(
        table === 'users' ? {data: {google_calendar_connected: true, google_refresh_token: 'fixture', briefing_content: 'default'}, error: null}
        : table === 'agent_open_loops' ? {data: loops, error: null}
        : {data: [], error: null})}
    return q
  }}
  return load('lib/bot/handlers/morning-briefing.ts', {
    '@/lib/supabase-admin': {supabaseAdmin: db},
    '@/lib/services/weather': {fetchWeatherForecast: async () => null, formatCurrentWeather: () => ''},
    '@/lib/services/google-calendar-accounts': {getTodayEventsAllAccounts: async () => ({connected: true, events, multi: true, incomplete: false})},
    '@/lib/agent/task-lifecycle': {isRelevantOpenLoop: () => true},
    '@/lib/agent/google-workspace-read': {formatEmailSnippet: (text: string, max: number) => String(text).slice(0, max)},
  })
}
const standup = (day: string) => ({summary: 'Daily Connect-Standup Call', _account: 'work@example.invalid', start: {dateTime: `2026-10-${day}T11:30:00+05:30`}, end: {dateTime: '2026-11-11T11:45:00+05:30'}})
await check('today\'s events lead and carried-over multi-day instances are grouped, not repeated', async () => {
  const events = ['08', '09', '12', '13', '14', '15', '16'].map(standup)
  events.push({summary: 'FnB daily syncup', _account: 'work@example.invalid', start: {dateTime: '2026-10-19T11:30:00+05:30'}, end: {dateTime: '2026-10-19T12:00:00+05:30'}})
  const text = await briefing(events, []).buildMorningBriefing(123, 'Gogo', {})
  const calendar = text.split('📅 *Calendar*')[1].split('\n\n')[0]
  assert.match(calendar, /^\n• 11:30 am — FnB daily syncup \(work@example\.invalid\)/)
  assert.match(calendar, /• Ongoing from an earlier day — Daily Connect-Standup Call \(work@example\.invalid\) \(×7\)/)
  assert.equal((calendar.match(/Daily Connect-Standup Call/g) || []).length, 1)
})
await check('identical saved open loops are shown once with a count', async () => {
  const loops = [{title: 'Block calendar for this booking'}, {title: 'Block calendar for this booking'}, {title: 'Browser · huggingface.co'}, {title: 'Browser · huggingface.co'}, {title: 'Browser · huggingface.co'}, {title: 'Add Jailer 2 to calendar'}]
  const text = await briefing([], loops).buildMorningBriefing(123, 'Gogo', {includeOpenLoops: true})
  const block = text.split('🧩 *Saved open loops*')[1]
  assert.match(block, /• Block calendar for this booking \(×2\)/)
  assert.match(block, /• Browser · huggingface\.co \(×3\)/)
  assert.match(block, /• Add Jailer 2 to calendar(?! \(×)/)
  assert.equal((block.match(/Block calendar for this booking/g) || []).length, 1)
})

if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1 } else console.log('19 Oct live acceptance regressions passed: history order, empty expense range, briefing grouping.')
