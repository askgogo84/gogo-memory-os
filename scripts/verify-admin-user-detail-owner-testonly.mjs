// TEST ONLY / EXPECTED SAFETY RED: admin user-detail profile selection must
// preserve the exact owner ID. Executes the actual TSX user-query predicate
// extracted from the unchanged shipped source AST with synthetic rows only.
// No real users, database, providers, network, credentials or production access.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const FILE = 'app/admin/(console)/users/[id]/page.tsx'
const original = readFileSync(FILE, 'utf8')
const source = ts.createSourceFile(FILE, original, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX)
assert.equal(source.parseDiagnostics.length, 0, 'original user-detail TSX must parse')
const detail = source.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === 'UserDetail')
assert.ok(detail?.body, 'the shipped UserDetail server component is required')

const userProfileDecls = []
function walk(n) {
  if (ts.isVariableDeclaration(n) &&
      n.name.getText(source).replace(/\s/g, '') === '{data:user}') userProfileDecls.push(n)
  ts.forEachChild(n, walk)
}
walk(detail.body)
assert.equal(userProfileDecls.length, 1,
  'must examine exactly one shipped user profile lookup, not a rewritten helper')
const profileQuery = userProfileDecls[0].initializer
assert.ok(profileQuery, 'actual user profile query is required')
const ownerFilters = []
function collect(n) {
  if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) &&
      n.expression.name.text === 'eq' && n.arguments.length === 2 &&
      ts.isStringLiteral(n.arguments[0]) && n.arguments[0].text === 'telegram_id') {
    ownerFilters.push(n)
  }
  ts.forEachChild(n, collect)
}
collect(profileQuery)
assert.equal(ownerFilters.length, 1, 'must locate exact owner predicate in actual profile lookup')
assert.match(profileQuery.getText(source), /\.from\(['"]users['"]\)/,
  'the predicate must come from the real users query')
const sourcePredicate = ownerFilters[0].arguments[1].getText(source)
console.log('SHIPPED PROFILE OWNER PREDICATE: ' + sourcePredicate)

const A = '9007199254740992'
const B = '9007199254740993'
assert.equal(Number(A), Number(B), 'the two synthetic BIGINT owners must alias numerically')
const fakeUsers = [
  { telegram_id: '42', name: 'Safe synthetic owner', whatsapp_id: 'whatsapp:+15550000042' },
  { telegram_id: A, name: 'Synthetic A', whatsapp_id: 'whatsapp:+15550000001' },
  { telegram_id: B, name: 'Synthetic B', whatsapp_id: 'whatsapp:+15550000002' },
]
// Evaluate ONLY the AST's original .eq second argument. Supabase's BIGINT
// predicate matching is represented by canonical decimal strings, with no DB.
function lookup(rawId) {
  const tid = decodeURIComponent(rawId)
  const queryValue = runInNewContext('(' + sourcePredicate + ')',
    { tid, Number, String, BigInt }, { timeout: 1000 })
  const row = fakeUsers.find(u => u.telegram_id === String(queryValue)) || null
  return { tid, queryValue, row }
}
let controls = 0
let safetyPassed = 0
let safetyFailed = 0
function control(name, fn) {
  fn()
  controls++
  console.log('PASS CONTROL: ' + name)
}
function safety(name, fn) {
  try {
    fn()
    safetyPassed++
    console.log('PASS SAFETY: ' + name)
  } catch (err) {
    safetyFailed++
    console.error('FAIL SAFETY (expected until corrected): ' + name + ': ' + String(err?.message || err))
  }
}
control('safe small owner selects own profile', () => {
  assert.equal(lookup('42').row?.telegram_id, '42')
})
control('synthetic A selects its own profile', () => {
  assert.equal(lookup(A).row?.telegram_id, A)
})
control('absent identifier does not resolve any synthetic profile', () => {
  assert.equal(lookup('77777').row, null)
})
control('route parameter itself preserves exact BIGINT digits', () => {
  assert.equal(lookup(B).tid, B)
})

safety('P1/P2: requesting B cannot read A profile through number rounding', () => {
  assert.notEqual(lookup(B).row?.telegram_id, A, 'B request matched A private profile')
})
safety('P1/P2: B user detail resolves B or fails closed, never a different owner', () => {
  const resolved = lookup(B).row?.telegram_id
  assert.ok(resolved === B || resolved === undefined, 'cross-owner user profile selected')
})
safety('P1/P2: user-query BIGINT owner wire value retains exact requested digits', () => {
  assert.equal(String(lookup(B).queryValue), B, 'owner filter lost 64-bit decimal precision')
})
safety('P1/P2: two distinct profile links must never resolve the same user', () => {
  assert.notEqual(lookup(A).row?.telegram_id, lookup(B).row?.telegram_id,
    'distinct links aliased to the same synthetic user profile')
})
console.log('RESULT controls=' + controls + ' safety_pass=' + safetyPassed +
  ' safety_fail=' + safetyFailed)
assert.equal(controls, 4)
assert.equal(safetyPassed, 4,
  'all four exact-owner admin user-detail safeguards are release gates')
console.log('SECURITY GREEN: admin profile lookup preserves distinct 64-bit owners')
