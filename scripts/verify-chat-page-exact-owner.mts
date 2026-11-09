/** Synthetic, test-first P2 boundary check of the REAL dashboard ChatPage TSX.
 * Auth, Supabase, reminders, task feed, providers and UI are replaced by inert
 * fakes. This does NOT establish a reachable session bypass or hosted isolation.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { exactSessionOwnerId } from '../lib/dashboard/owner-identity.ts'

const source = readFileSync('app/dashboard/(app)/chat/page.tsx', 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
} }).outputText

type Id = string | number | null
type Predicate = { table: string; column: string; value: unknown }
type BriefCall = { name: string; owner: unknown }
const ChatMarker = () => null
const SuspenseMarker = () => null
const jsx = {
  jsx: (type: unknown, props: Record<string, unknown>) => ({ type, props }),
  jsxs: (type: unknown, props: Record<string, unknown>) => ({ type, props }),
  Fragment: 'fragment',
}

async function render(id: Id) {
  const tables: string[] = []
  const predicates: Predicate[] = []
  const briefCalls: BriefCall[] = []
  const fakeDb = { from(table: string) {
    tables.push(table)
    assert.ok(['users', 'user_experience_preferences'].includes(table), 'unexpected private table')
    return {
      select(columns: string) {
        assert.equal(columns, table === 'users' ? 'name,timezone' : 'comfort_drink')
        return this
      },
      eq(column: string, value: unknown) {
        predicates.push({ table, column, value })
        return this
      },
      async maybeSingle() {
        return { data: table === 'users' ?
          { name: 'Synthetic Owner', timezone: 'Asia/Kolkata' } :
          { comfort_drink: 'tea' }, error: null }
      },
    }
  }}
  const rec = (name: string, owner: unknown, result: unknown) => {
    briefCalls.push({ name, owner })
    return Promise.resolve(result)
  }
  const imports: Record<string, unknown> = {
    'react': { Suspense: SuspenseMarker },
    'react/jsx-runtime': jsx,
    '@/lib/dashboard/session': { getSession: async () => id === null ? null : { telegramId: id } },
    '@/lib/dashboard/owner-identity': { exactSessionOwnerId },
    '@/lib/supabase-admin': { supabaseAdmin: fakeDb },
    '@/components/dashboard/gogo-chat': { GogoChat: ChatMarker },
    '@/lib/dashboard/chat-suggestions': { firstNameOf: (name: unknown) => String(name ?? '').split(' ')[0] },
    '@/lib/dashboard/queries': {
      getTodayReminders: (id: unknown) => rec('getTodayReminders', id, { ok: true, reminders: [] }),
      getUpcomingReminders: (id: unknown) => rec('getUpcomingReminders', id, []),
    },
    '@/lib/dashboard/task-feed': {
      getTaskFeed: (id: unknown) => rec('getTaskFeed', id, { items: [] }),
      EMPTY_FEED: { items: [] },
    },
    '@/lib/dashboard/home-sections': {
      buildHomeSections: () => ({ now: [], comingUp: [], handling: [] }),
      homeSummary: () => 'Synthetic brief',
    },
    '@/lib/dashboard/service-notices': {
      getServiceNoticesForPage: (id: unknown) => rec('getServiceNoticesForPage', id, { items: [], total: 0 }),
      EMPTY_SERVICE_NOTICES: { items: [], total: 0 },
    },
  }
  const module: any = { exports: {} }
  runInNewContext(compiled, {
    module, exports: module.exports, Date, Promise, Intl,
    require(path: string) {
      assert.ok(Object.prototype.hasOwnProperty.call(imports, path), 'unexpected import: ' + path)
      return imports[path]
    },
  }, { timeout: 5000, filename: 'chat-page-synthetic.cjs' })
  assert.equal(typeof module.exports.default, 'function')
  const tree = await module.exports.default()
  assert.equal(tree?.type, SuspenseMarker, 'real ChatPage returns Suspense')
  const chat = tree?.props?.children
  assert.equal(chat?.type, ChatMarker, 'real ChatPage builds a GogoChat')
  return { tables, predicates, briefCalls, chatProps: chat.props }
}

assert.equal(Number('9007199254740992'), Number('9007199254740993'),
  'JS Number cannot represent adjacent 64-bit owner identifiers exactly')
let valid = 0
for (const id of ['9007199254740992', '9007199254740993', '42', '-123', 42] as const) {
  assert.equal(exactSessionOwnerId(id), String(id), 'synthetic valid owner accepted by shipped helper')
  const r = await render(id)
  assert.deepEqual(r.tables.sort(), ['user_experience_preferences', 'users'])
  assert.equal(r.predicates.length, 2)
  for (const p of r.predicates) {
    assert.equal(p.column, 'telegram_id')
    assert.equal(p.value, String(id), 'private ' + p.table + ' must use exact decimal owner STRING')
    assert.equal(typeof p.value, 'string')
  }
  assert.deepEqual(r.briefCalls.map(c => c.name).sort(),
    ['getServiceNoticesForPage', 'getTaskFeed', 'getTodayReminders', 'getUpcomingReminders'])
  for (const call of r.briefCalls) assert.equal(call.owner, String(id), call.name + ' exact owner')
  assert.equal(r.chatProps.initialDrink, 'tea')
  assert.equal(r.chatProps.userName, 'Synthetic')
  assert.equal(r.chatProps.brief?.summary, 'Synthetic brief')
  valid++
}
let invalid = 0
for (const id of [null, '', '0', '00042', '42junk', '42.0',
  '9007199254740993x', '9223372036854775808', '-9223372036854775809',
  '999999999999999999999999999', 9007199254740992, 42.5] as const) {
  assert.equal(exactSessionOwnerId(id), null)
  const r = await render(id)
  assert.equal(r.tables.length, 0, 'invalid owner must cause zero private DB reads')
  assert.equal(r.predicates.length, 0)
  assert.equal(r.briefCalls.length, 0, 'invalid owner must not fetch brief data')
  assert.equal(r.chatProps.initialDrink, 'coffee')
  assert.equal(r.chatProps.userName, '')
  assert.equal(r.chatProps.brief, null)
  invalid++
}
console.log('PASS CHAT_PAGE_EXACT_OWNER: REAL ChatPage TSX, inert DB+brief providers, ' +
  valid + ' valid / ' + invalid + ' invalid synthetic sessions')
