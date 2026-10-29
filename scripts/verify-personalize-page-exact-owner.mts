/** Synthetic, test-first owner-binding check against the REAL PersonalizePage TSX.
 * Actual getSession, RLS, Supabase and UI/React components are inert fakes.
 * No hosted owner isolation or reachable auth bypass is established.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { exactSessionOwnerId } from '../lib/dashboard/owner-identity.ts'

const source = readFileSync('app/dashboard/(app)/personalize/page.tsx', 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
} }).outputText
type Id = string | number | null
type Predicate = { table: string; column: string; value: unknown }
type Tree = { type?: unknown; props?: Record<string, any> } | null
const PersonalizeMarker = () => null
const jsx = {
  jsx: (type: unknown, props: Record<string, unknown>) => ({ type, props }),
  jsxs: (type: unknown, props: Record<string, unknown>) => ({ type, props }),
  Fragment: 'fragment',
}
function findPersonalize(t: any): any {
  if (!t || typeof t !== 'object') return null
  if (Array.isArray(t)) {
    for (const child of t) { const found = findPersonalize(child); if (found) return found }
    return null
  }
  if (t.type === PersonalizeMarker) return t
  return findPersonalize(t.props?.children)
}
async function render(id: Id) {
  const tables: string[] = []
  const predicates: Predicate[] = []
  const fakeDb = { from(table: string) {
    tables.push(table)
    assert.equal(table, 'user_experience_preferences', 'do not read other private tables')
    return {
      select(columns: string) {
        assert.equal(columns, 'personality, comfort_drink')
        return this
      },
      eq(column: string, value: unknown) {
        predicates.push({ table, column, value })
        return this
      },
      async maybeSingle() {
        return { data: { personality: 'friendly', comfort_drink: 'tea' }, error: null }
      },
    }
  }}
  const imports: Record<string, unknown> = {
    'react/jsx-runtime': jsx,
    '@/lib/dashboard/session': { getSession: async () => id === null ? null : { telegramId: id } },
    '@/lib/dashboard/owner-identity': { exactSessionOwnerId },
    '@/lib/supabase-admin': { supabaseAdmin: fakeDb },
    '@/components/dashboard/personalize-gogo': { PersonalizeGogo: PersonalizeMarker },
  }
  const module: any = { exports: {} }
  runInNewContext(compiled, {
    module, exports: module.exports, Promise, Date,
    require(path: string) {
      assert.ok(Object.prototype.hasOwnProperty.call(imports, path), 'unexpected import ' + path)
      return imports[path]
    },
  }, { timeout: 5000, filename: 'personalize-page-synthetic.cjs' })
  assert.equal(typeof module.exports.default, 'function')
  const tree: Tree = await module.exports.default()
  const component = findPersonalize(tree)
  assert.ok(component, 'real page must construct PersonalizeGogo')
  return { tables, predicates, props: component.props }
}

assert.equal(Number('9007199254740992'), Number('9007199254740993'),
  'JS Number aliases adjacent valid 64-bit owner strings')
let valid = 0
for (const id of ['9007199254740992', '9007199254740993', '42', '-123', 42] as const) {
  assert.equal(exactSessionOwnerId(id), String(id), 'synthetic valid owner')
  const r = await render(id)
  assert.deepEqual(r.tables, ['user_experience_preferences'])
  assert.equal(r.predicates.length, 1)
  assert.equal(r.predicates[0].column, 'telegram_id')
  assert.equal(r.predicates[0].value, String(id),
    'private preference read must use exact decimal owner STRING')
  assert.equal(typeof r.predicates[0].value, 'string')
  assert.equal(r.props.initialPersonality, 'friendly')
  assert.equal(r.props.initialDrink, 'tea')
  valid++
}
let invalid = 0
for (const id of [null, '', '0', '00042', '42junk', '42.0',
  '9007199254740993x', '9223372036854775808', '-9223372036854775809',
  '999999999999999999999999999', 9007199254740992, 42.5] as const) {
  assert.equal(exactSessionOwnerId(id), null)
  const r = await render(id)
  assert.deepEqual(r.tables, [], 'invalid owner must make zero private reads')
  assert.deepEqual(r.predicates, [])
  assert.equal(r.props.initialPersonality, 'calm_companion')
  assert.equal(r.props.initialDrink, 'coffee')
  invalid++
}
console.log('PASS PERSONALIZE_PAGE_EXACT_OWNER: REAL TSX page, inert session/DB/UI, ' +
  valid + ' valid / ' + invalid + ' invalid synthetic sessions')
