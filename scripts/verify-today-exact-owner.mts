/** Inert, test-first P2 defense-in-depth regression of the REAL Today TSX page.
 * All imported session, DB, provider and UI dependencies are fakes: no real user,
 * network, WhatsApp, calendar, Supabase, external action or customer data.
 * Normal getSession() already enforces stricter owner validation upstream; this
 * directly injects synthetic identities to exercise the page's final read guard.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { exactSessionOwnerId } from '../lib/dashboard/owner-identity.ts'

const source = readFileSync('app/dashboard/(app)/today/page.tsx', 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
} }).outputText

type Call = { name: string; owner: unknown }
type Predicate = { column: string; value: unknown }
const TodayDesktop = () => null

async function render(owner: string | number | null) {
  const dbTables: string[] = []
  const predicates: Predicate[] = []
  const reads: Call[] = []
  const query: any = {
    select(fields: string) { assert.equal(fields, 'whatsapp_id, name, timezone'); return this },
    eq(column: string, value: unknown) { predicates.push({ column, value }); return this },
    async maybeSingle() { return { data: { name: 'Synthetic', timezone: 'Asia/Kolkata' }, error: null } },
  }
  const fakeDb = {
    from(table: string) {
      dbTables.push(table)
      assert.equal(table, 'users', 'Today personal metadata must only read the users table')
      return query
    },
  }
  function record(name: string, ownerId: unknown, value: unknown) {
    reads.push({ name, owner: ownerId })
    return Promise.resolve(value)
  }
  const fakeQueries = {
    getTodayReminders: (id: unknown) => record('getTodayReminders', id, { ok: true, reminders: [] }),
    getLists: (id: unknown) => record('getLists', id, { ok: true, lists: [] }),
    getUsageSummary: (id: unknown) => record('getUsageSummary', id, { ok: false }),
    getTodayCalendar: (id: unknown) => record('getTodayCalendar', id, { ok: true, connected: false, events: [] }),
    getProfile: (id: unknown) => record('getProfile', id, { ok: false }),
    getFriendContacts: (id: unknown) => record('getFriendContacts', id, { ok: true, contacts: [], count: 0 }),
  }
  const jsx = {
    jsx: (type: unknown, props: Record<string, unknown>) => ({ type, props }),
    jsxs: (type: unknown, props: Record<string, unknown>) => ({ type, props }),
    Fragment: 'fragment',
  }
  const dummy = (name: string) => { const fn = () => null; Object.defineProperty(fn, 'name', { value: name }); return fn }
  const imports: Record<string, unknown> = {
    react: { Suspense: dummy('Suspense') },
    '@/lib/dashboard/session': { getSession: async () => owner === null ? null : { telegramId: owner } },
    '@/lib/dashboard/owner-identity': { exactSessionOwnerId },
    '@/lib/supabase-admin': { supabaseAdmin: fakeDb },
    '@/lib/dashboard/queries': fakeQueries,
    '@/lib/dashboard/memory': {
      getDashboardMemory: (id: unknown) => record('getDashboardMemory', id, { ok: true, items: [] }),
    },
    '@/lib/dashboard/thread': { countRecurringSeries: () => 0 },
    '@/components/dashboard/empty-state': { EmptyState: dummy('EmptyState') },
    '@/components/dashboard/whatsapp-chip': { WhatsAppChip: dummy('WhatsAppChip') },
    '@/components/dashboard/reminder-thread': { ReminderThread: dummy('ReminderThread') },
    '@/components/dashboard/today-desktop': { TodayDesktop },
    '@/components/dashboard/card-error': { CardError: dummy('CardError') },
    '@/components/dashboard/icons': {
      CalendarIcon: dummy('CalendarIcon'), ListsIcon: dummy('ListsIcon'), UsageIcon: dummy('UsageIcon'),
    },
    'react/jsx-runtime': jsx,
  }
  const mod: any = { exports: {} }
  runInNewContext(compiled, {
    module: mod, exports: mod.exports, Intl, Date, Promise,
    require(path: string) {
      if (!(path in imports)) throw new Error('Unexpected Today dependency: ' + path)
      return imports[path]
    },
  }, { filename: 'synthetic-today-page.cjs', timeout: 5000 })
  assert.equal(typeof mod.exports.default, 'function')
  const tree = await mod.exports.default()
  const visited = new Set<unknown>()
  let desktopOwner: unknown = undefined
  function findDesktop(node: any): void {
    if (!node || typeof node !== 'object' || visited.has(node)) return
    visited.add(node)
    if (node.type === TodayDesktop) desktopOwner = node.props?.telegramId
    if (Array.isArray(node)) { for (const x of node) findDesktop(x); return }
    if (node.props && typeof node.props === 'object') {
      for (const value of Object.values(node.props)) findDesktop(value)
    }
  }
  findDesktop(tree)
  return { dbTables, predicates, reads, desktopOwner }
}

assert.equal(Number('9007199254740992'), Number('9007199254740993'),
  'The original parseInt is not exact for distinct signed64 owner IDs')
const expectedHelpers = [
  'getTodayReminders', 'getLists', 'getUsageSummary',
  'getDashboardMemory', 'getProfile', 'getFriendContacts',
].sort()
let valid = 0
for (const owner of ['9007199254740992', '9007199254740993', '42', '-123', 42] as const) {
  const result = await render(owner)
  assert.deepEqual(result.dbTables, ['users'])
  assert.equal(result.predicates.length, 1)
  assert.equal(result.predicates[0].column, 'telegram_id')
  assert.equal(result.predicates[0].value, String(owner),
    'The service-role users read must preserve the exact owner decimal STRING')
  assert.equal(typeof result.predicates[0].value, 'string')
  assert.deepEqual(result.reads.map((x) => x.name).sort(), expectedHelpers,
    'Every Today helper should be queried exactly once for the valid owner')
  for (const call of result.reads)
    assert.equal(call.owner, String(owner), call.name + ' must retain the same exact owner')
  assert.equal(result.desktopOwner, String(owner), 'Desktop continuation must retain exact owner')
  valid++
}

let rejected = 0
for (const owner of [null, '', '0', '00042', '42junk', '42.0', '9007199254740993x',
  '9223372036854775808', '-9223372036854775809',
  '999999999999999999999999999', 9007199254740992, 42.5]) {
  const result = await render(owner)
  assert.equal(result.dbTables.length, 0, 'Invalid owner must make zero users-table queries')
  assert.equal(result.predicates.length, 0)
  assert.equal(result.reads.length, 0, 'Invalid owner must make zero other owner-bound data reads')
  assert.equal(result.desktopOwner, null, 'Invalid owner must not be displayed as account identity')
  rejected++
}
console.log('PASS TODAY_EXACT_OWNER: real Today page, fake owner-bound reads and desktop identity (' +
  valid + ' valid, ' + rejected + ' invalid synthetic sessions)')
