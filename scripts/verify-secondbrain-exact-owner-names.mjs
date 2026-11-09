// Original-source, no-network SecondBrain owner-identity regression.
// Reproduce exact production functions with a sealed service-role DB spy.
// No customer data, provider reads, sends, migrations or workspace writes.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync('lib/workspaces/access.ts', 'utf8')
const file = ts.createSourceFile('access.ts', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS)
function functionSource(name) {
  const declaration = file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name)
  assert.ok(declaration, 'production ' + name + ' must exist')
  return declaration.getText(file)
}
const funcs = ['tg', 'exactWorkspaceNameOwner', 'displayNames']
const extracted = funcs.map(functionSource).join('\n\n')
const compiled = ts.transpileModule(
  extracted + '\nglobalThis.subject = {tg, exactWorkspaceNameOwner, displayNames};',
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
).outputText

let queryCount = 0
let lastQuery = null
let rows = []
let dbError = null
const logs = []
class WorkspaceError extends Error { constructor(code) { super(code); this.code = code } }
const supabaseAdmin = {
  from(table) {
    assert.equal(table, 'users', 'name lookup has no other private data source')
    return {
      select(columns) {
        assert.equal(columns, 'telegram_id,name', 'query only non-sensitive display fields')
        return {
          in(column, values) {
            assert.equal(column, 'telegram_id')
            queryCount++
            lastQuery = Array.from(values)
            return Promise.resolve({ data: rows, error: dbError })
          },
        }
      },
    }
  },
}
const sandbox = vm.createContext({ supabaseAdmin, WorkspaceError, console: { error: (...args) => logs.push(args) } })
vm.runInContext(compiled, sandbox, { timeout: 1000 })
const { tg, exactWorkspaceNameOwner, displayNames } = sandbox.subject
function reset(data = [], error = null) { rows = data; dbError = error; queryCount = 0; lastQuery = null; logs.length = 0 }
let benign = 0, mandatory = 0
function positive(fn) { fn(); benign++ }
function negative(fn) { fn(); mandatory++ }

const a = '9007199254740992'
const b = '9007199254740993'
assert.notEqual(a, b, 'two valid database BIGINT owner identities are distinct')
assert.equal(Number(a), Number(b), 'REPRODUCED: previous map(Number) aliases distinct owners')

positive(() => assert.equal(tg(17), '17'))
positive(() => assert.equal(tg(-17), '-17', 'negative WhatsApp owner is valid'))
positive(() => assert.equal(tg(b), b, 'exact 64-bit decimal string survives'))
positive(() => assert.equal(exactWorkspaceNameOwner('123'), '123'))
positive(() => assert.equal(exactWorkspaceNameOwner('-123'), '-123'))
positive(() => assert.equal(exactWorkspaceNameOwner(123), '123'))

reset([{ telegram_id: a, name: 'Member A' }, { telegram_id: b, name: 'Member B' }])
const bound = await displayNames([a, b, a])
negative(() => assert.deepEqual(lastQuery, [a, b], 'query retains exact distinct BIGINT strings'))
negative(() => assert.equal(bound.get(a), 'Member A'))
negative(() => assert.equal(bound.get(b), 'Member B'))
negative(() => assert.equal(bound.size, 2))
negative(() => assert.equal(queryCount, 1, 'dedupe without owner alias'))

reset([{ telegram_id: Number(a), name: 'Wrong other tenant' }])
const rounded = await displayNames([a])
negative(() => assert.equal(rounded.has(a), false, 'ambiguous numeric API row is never attributed'))

reset([{ telegram_id: '234', name: 'Other account' }])
const foreign = await displayNames(['123'])
negative(() => assert.equal(foreign.size, 0, 'unexpected returned owner is excluded'))

reset([{ telegram_id: -17, name: 'WhatsApp owner' }, { telegram_id: '17', name: 'User 17' }])
const signed = await displayNames(['-17', '17'])
positive(() => assert.equal(signed.get('-17'), 'WhatsApp owner'))
positive(() => assert.equal(signed.get('17'), 'User 17'))

for (const value of [Number(a), Infinity, NaN, 0, -0]) {
  negative(() => assert.throws(() => tg(value), /invalid_session/, 'unsafe numeric owner stops before service-role access'))
}
negative(() => assert.equal(exactWorkspaceNameOwner(Number(a)), null, 'unsafe numeric owner is not a name key'))
negative(() => assert.equal(exactWorkspaceNameOwner(0), null))
negative(() => assert.equal(exactWorkspaceNameOwner('00123'), null))
negative(() => assert.equal(exactWorkspaceNameOwner('+123'), null))
negative(() => assert.equal(exactWorkspaceNameOwner('1e4'), null))

reset()
const bad = await displayNames([Number(a), '00123', '+123', '1e4'])
negative(() => assert.equal(bad.size, 0))
negative(() => assert.equal(queryCount, 0, 'no DB contact for unprovable owner identifiers'))

reset([], { code: 'PGRST', message: 'synthetic DB outage' })
const unavailable = await displayNames(['123'])
negative(() => assert.equal(unavailable.size, 0, 'DB error cannot invent a name'))
negative(() => assert.equal(queryCount, 1))
negative(() => assert.ok(logs.length === 1 && !String(logs[0]).includes('PRIVATE'), 'no private values logged'))

console.log('SecondBrain exact owner identity: ' + benign + ' benign controls + ' + mandatory + ' mandatory fictional isolation checks PASS')
