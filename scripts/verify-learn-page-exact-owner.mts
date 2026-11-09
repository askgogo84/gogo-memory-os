/** Synthetic regression for the REAL Dashboard LearnPage TSX owner predicate.
 * Inert getSession/Supabase/JSX: not actual SQL/RLS, hosted two-owner or production proof.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { exactSessionOwnerId } from '../lib/dashboard/owner-identity.ts'

const source = readFileSync('app/dashboard/(app)/learn/page.tsx', 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
} }).outputText

type Id = string | number | null
type Predicate = { column: string; value: unknown }
const LearnMarker = () => null
const LESSONS = [{ key: 'first-reminder', title: 'First reminder' }]
const jsx = {
  jsx: (type: unknown, props: Record<string, unknown>) => ({ type, props }),
  jsxs: (type: unknown, props: Record<string, unknown>) => ({ type, props }),
  Fragment: 'fragment',
}
function findLearn(t: any): any {
  if (!t || typeof t !== 'object') return null
  if (Array.isArray(t)) {
    for (const child of t) {
      const found = findLearn(child)
      if (found) return found
    }
    return null
  }
  if (t.type === LearnMarker) return t
  return findLearn(t.props?.children)
}
async function render(id: Id) {
  const tables: string[] = []
  const selects: string[] = []
  const predicates: Predicate[] = []
  const fakeDb = {
    from(table: string) {
      tables.push(table)
      assert.equal(table, 'learning_progress', 'private read must remain on learning_progress')
      const query = {
        data: [{ lesson_key: 'first-reminder' }],
        select(columns: string) {
          selects.push(columns)
          return this
        },
        eq(column: string, value: unknown) {
          predicates.push({ column, value })
          return this
        },
      }
      return query
    },
  }
  const imports: Record<string, unknown> = {
    'react/jsx-runtime': jsx,
    '@/components/dashboard/learn-with-gogo': { LearnWithGogo: LearnMarker },
    '@/lib/dashboard/lessons': { GOGO_LESSONS: LESSONS },
    '@/lib/dashboard/session': { getSession: async () => id === null ? null : { telegramId: id } },
    '@/lib/dashboard/owner-identity': { exactSessionOwnerId },
    '@/lib/supabase-admin': { supabaseAdmin: fakeDb },
  }
  const module: any = { exports: {} }
  runInNewContext(compiled, {
    module, exports: module.exports, Promise, Date,
    require(path: string) {
      assert.ok(Object.prototype.hasOwnProperty.call(imports, path), 'unexpected import ' + path)
      return imports[path]
    },
  }, { timeout: 5000, filename: 'learn-page-synthetic.cjs' })
  assert.equal(typeof module.exports.default, 'function')
  const tree = await module.exports.default()
  const marker = findLearn(tree)
  assert.ok(marker, 'real LearnPage must construct LearnWithGogo')
  return { tables, selects, predicates, props: marker.props }
}

assert.equal(Number('9007199254740992'), Number('9007199254740993'),
  'JS Number aliases distinct, valid 64-bit decimal owners')
let valid = 0
for (const id of ['9007199254740992', '9007199254740993', '42', '-123', 42] as const) {
  assert.equal(exactSessionOwnerId(id), String(id), 'synthetic valid session owner')
  const r = await render(id)
  assert.deepEqual(r.tables, ['learning_progress'])
  assert.deepEqual(r.selects, ['lesson_key'])
  assert.equal(r.predicates.length, 2)
  assert.equal(r.predicates[0].column, 'telegram_id')
  assert.equal(r.predicates[0].value, String(id),
    'learning-progress read must bind exact decimal owner STRING, without Number coercion')
  assert.equal(typeof r.predicates[0].value, 'string')
  assert.equal(r.predicates[1].column, 'completed')
  assert.equal(r.predicates[1].value, true)
  assert.deepEqual(Array.from(r.props.completedKeys), ['first-reminder'])
  assert.deepEqual(Array.from(r.props.lessons), LESSONS)
  valid++
}
let invalid = 0
for (const id of [null, '', '0', '00042', '42junk', '42.0',
  '9007199254740993x', '9223372036854775808', '-9223372036854775809',
  '999999999999999999999999999', 9007199254740992, 42.5] as const) {
  assert.equal(exactSessionOwnerId(id), null, 'synthetic invalid owner')
  const r = await render(id)
  assert.deepEqual(r.tables, [], 'invalid owner must perform zero privileged reads')
  assert.deepEqual(r.selects, [])
  assert.deepEqual(r.predicates, [])
  assert.deepEqual(Array.from(r.props.completedKeys), [])
  invalid++
}
console.log('PASS LEARN_PAGE_EXACT_OWNER: real TSX page with inert session, DB and JSX (' +
  valid + ' valid, ' + invalid + ' invalid synthetic sessions)')
