// Inert regression for the ORIGINAL goal-engine permission reader. No database,
 // user records, credentials, outbound messages, or live background actions.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { evaluateAgentExecutionPolicy } from '../lib/agent/policy.ts'

const source = readFileSync('lib/agent/goal-engine.ts', 'utf8')
const sf = ts.createSourceFile('goal-engine.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const defaults = sf.statements.find(s => ts.isVariableStatement(s) && s.declarationList.declarations.some(d => d.name.getText(sf) === 'DEFAULT_LEVEL'))
const functionNode = sf.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === 'permission')
assert.ok(defaults && functionNode, 'test the deployed original permission() function, not a copy')
const transpiled = ts.transpileModule(
  defaults.getText(sf) + '\n' + functionNode.getText(sf) + '\nglobalThis.permissionUnderTest = permission;',
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
).outputText

type DbResult = { data?: unknown; error?: unknown }
function fixture(result: DbResult | (() => Promise<DbResult> | DbResult)) {
  const queries: Array<[string, string, string?]> = []
  const db = {
    from(table: string) {
      queries.push(['from', table])
      return {
        select(fields: string) { queries.push(['select', fields]); return this },
        eq(field: string, value: string) { queries.push(['eq', field, value]); return this },
        async maybeSingle() { return typeof result === 'function' ? result() : result },
      }
    },
  }
  const scope: Record<string, any> = { supabaseAdmin: db }
  runInNewContext(transpiled, scope, { timeout: 1000 })
  assert.equal(typeof scope.permissionUnderTest, 'function')
  return { permission: scope.permissionUnderTest as (owner: string, capability: string) => Promise<string>, queries }
}
const policy = (permissionLevel: string) => evaluateAgentExecutionPolicy({
  capability: 'reminders', permissionLevel: permissionLevel as any,
  mode: 'execute', risk: 'low', irreversible: false, approvalStatus: null,
})
let passed = 0
async function check(name: string, fn: () => Promise<void> | void) {
  await fn()
  passed++
  console.log('PASS goal-permission: ' + name)
}

await check('an actual missing permission row still uses existing reminders default', async () => {
  const f = fixture({ data: null, error: null })
  const level = await f.permission('7001', 'reminders')
  assert.equal(level, 'auto')
  assert.equal(policy(level).allowed, true, 'intentional fallback for a genuinely missing row')
  assert.deepEqual(f.queries, [
    ['from', 'agent_permissions'], ['select', 'level'], ['eq', 'telegram_id', '7001'], ['eq', 'capability', 'reminders'],
  ])
})
await check('saved off permission remains off and denies background private execute', async () => {
  const f = fixture({ data: { level: 'off' }, error: null })
  const level = await f.permission('7001', 'reminders')
  assert.equal(level, 'off')
  assert.equal(policy(level).allowed, false)
})
await check('saved ask permission requires approval', async () => {
  const level = await fixture({ data: { level: 'ask' }, error: null }).permission('7001', 'reminders')
  assert.equal(policy(level).allowed, false)
})
await check('valid explicit auto retains intended low-risk behavior', async () => {
  assert.equal(await fixture({ data: { level: 'auto' }, error: null }).permission('7001', 'reminders'), 'auto')
})
await check('permission service read failure fails closed instead of assuming auto', async () => {
  const f = fixture({ data: null, error: { code: '42501' } })
  await assert.rejects(() => f.permission('7001', 'reminders'), /goal_permission_lookup_failed/)
})
await check('stale data alongside database error is never treated as a successful read', async () => {
  await assert.rejects(
    () => fixture({ data: { level: 'auto' }, error: { code: 'PGRST001' } }).permission('7001', 'tasks'),
    /goal_permission_lookup_failed/,
  )
})
await check('permission lookup exception cannot enable low-risk private actions', async () => {
  await assert.rejects(
    () => fixture(() => { throw new Error('database unavailable') }).permission('7001', 'lists'),
    /database unavailable/,
  )
})
await check('malformed or null persisted authority fails closed', async () => {
  for (const level of ['aut0', 'owner', null, '', 1]) {
    await assert.rejects(
      () => fixture({ data: { level }, error: null }).permission('7001', 'reminders'),
      /goal_permission_lookup_failed/,
    )
  }
})
await check('64-bit owner lookup preserves exact owner bytes', async () => {
  const f = fixture({ data: { level: 'off' }, error: null })
  assert.equal(await f.permission('9007199254740993', 'tasks'), 'off')
  assert.ok(f.queries.some(x => x[0] === 'eq' && x[1] === 'telegram_id' && x[2] === '9007199254740993'))
})
console.log('PASS: ' + passed + ' original goal-engine permission safety regressions; no live actions')
