/**
 * Synthetic EMAIL SETTINGS owner-boundary test against the REAL TSX page.
 * This does NOT run real getSession, Supabase SQL/RLS, Composio, Gmail, UI, or hosted two-owner checks.
 * No provider requests, account mutations, email sends, verification links or customer records.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { exactDashboardOwnerId } from '../lib/dashboard/session-access.ts'

const source = readFileSync('app/dashboard/(app)/settings/email/page.tsx', 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
} }).outputText
const EmailSetupMarker = () => null
const jsx = {
  jsx: (type: unknown, props: Record<string, unknown>) => ({ type, props }),
  jsxs: (type: unknown, props: Record<string, unknown>) => ({ type, props }),
  Fragment: 'fragment',
}
type Owner = string | number | null
type Predicate = { table: string; column: string; value: unknown }

async function render(owner: Owner) {
  const tables: string[] = []
  const predicates: Predicate[] = []
  const aliasCalls: Array<{ owner: unknown; name: unknown }> = []
  const gmailCalls: unknown[] = []
  const fakeDb = { from(table: string) {
    tables.push(table)
    assert.ok(['users', 'inbound_emails'].includes(table), 'unexpected private table: ' + table)
    return {
      select(_columns: string) { return this },
      eq(column: string, value: unknown) {
        predicates.push({ table, column, value }); return this
      },
      gte(_column: string, _value: unknown) { return this },
      order(_column: string, _options: unknown) { return this },
      async maybeSingle() {
        assert.equal(table, 'users')
        return { data: { name: 'Synthetic', gmail_connected: false, gmail_email: null }, error: null }
      },
      async limit(limit: number) {
        assert.equal(table, 'inbound_emails')
        assert.equal(limit, 1)
        return { data: [{
          snippet: 'Gmail forwarding confirmation code 112233',
          body_text: 'https://mail.google.com/mail/u/0/#settings/fwdandpop',
          received_at: '2026-10-28T00:00:00.000Z',
        }], error: null }
      },
    }
  } }
  const imports: Record<string, unknown> = {
    'react/jsx-runtime': jsx,
    '@/lib/dashboard/session': {
      getSession: async () => owner === null ? null : { telegramId: owner },
    },
    '@/lib/dashboard/session-access': { exactDashboardOwnerId },
    '@/lib/supabase-admin': { supabaseAdmin: fakeDb },
    '@/lib/email/aliases': {
      getOrCreateAlias: async (value: unknown, name: unknown) => {
        aliasCalls.push({ owner: value, name })
        return { alias: 'fixture-x4y5z6', forwarding_confirmed_at: null }
      },
      aliasAddress: (alias: string) => alias + '@in.askgogo.in',
    },
    '@/lib/connectors/composio-gmail': {
      activeGmailAccount: async (value: unknown) => { gmailCalls.push(value); return null },
    },
    '@/components/dashboard/email-setup': { EmailSetup: EmailSetupMarker },
  }
  const mod: any = { exports: {} }
  runInNewContext(compiled, {
    module: mod, exports: mod.exports, Promise, Date,
    require(path: string) {
      assert.ok(Object.prototype.hasOwnProperty.call(imports, path), 'unexpected import ' + path)
      return imports[path]
    },
  }, { timeout: 5000, filename: 'email-settings-page-synthetic.cjs' })
  assert.equal(typeof mod.exports.default, 'function')
  const tree = await mod.exports.default({ searchParams: Promise.resolve({}) })
  return { tree, tables, predicates, aliasCalls, gmailCalls }
}

assert.equal(Number('9007199254740992'), Number('9007199254740993'),
  'distinct 64-bit owner strings must never share numeric private lookup')
let rejected = 0
for (const owner of [
  null, '', '0', '00042', '42junk', '42.0', 'NaN', '42e0',
  '9007199254740992', '9007199254740993', '-9007199254740992',
  '9223372036854775808', '-9223372036854775809',
  9007199254740992, 42.5,
] as const) {
  assert.equal(exactDashboardOwnerId(owner), null, 'synthetic invalid owner')
  const r = await render(owner)
  assert.equal(r.tree, null, 'unsafe session must not construct private email settings UI')
  assert.deepEqual(r.tables, [], 'unsafe session must not query private DB: ' + String(owner))
  assert.deepEqual(r.predicates, [])
  assert.deepEqual(r.aliasCalls, [], 'unsafe session must not create/read forwarding alias')
  assert.deepEqual(r.gmailCalls, [], 'unsafe session must not inspect a Gmail account')
  rejected++
}
let accepted = 0
for (const owner of ['42', '-123', '9007199254740991', '-9007199254740991', 42] as const) {
  const expected = exactDashboardOwnerId(owner)
  assert.ok(expected !== null && Number.isSafeInteger(expected), 'synthetic valid owner')
  const r = await render(owner)
  assert.deepEqual(r.tables, ['users', 'inbound_emails'])
  const ownerPredicates = r.predicates.filter(p => p.column === 'telegram_id')
  assert.equal(ownerPredicates.length, 2, 'both user and confirmation reads require owner binding')
  assert.deepEqual(ownerPredicates.map(p => p.table), ['users', 'inbound_emails'])
  for (const p of ownerPredicates) {
    assert.equal(p.value, expected, 'legacy numeric owner matches exact safe identifier')
    assert.equal(typeof p.value, 'number')
  }
  assert.ok(r.predicates.some(p => p.table === 'inbound_emails' &&
    p.column === 'category' && p.value === 'forwarding_confirmation'))
  assert.equal(r.aliasCalls.length, 1)
  assert.equal(r.aliasCalls[0].owner, expected)
  assert.equal(r.aliasCalls[0].name, 'Synthetic')
  assert.deepEqual(r.gmailCalls, [expected])
  assert.equal(r.tree?.type, EmailSetupMarker, 'real page constructs EmailSetup')
  assert.equal(r.tree.props.address, 'fixture-x4y5z6@in.askgogo.in')
  assert.equal(r.tree.props.confirmationCode, '112233')
  assert.equal(r.tree.props.confirmationLink, 'https://mail.google.com/mail/u/0/#settings/fwdandpop')
  assert.equal(r.tree.props.forwardingOn, false)
  assert.equal(r.tree.props.googleConnected, false)
  accepted++
}
console.log('PASS EMAIL_SETTINGS_OWNER_BOUNDARY: REAL TSX page; inert DB, alias, Composio and JSX (' +
  accepted + ' safe / ' + rejected + ' rejected synthetic sessions)')
