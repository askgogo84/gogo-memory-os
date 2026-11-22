// Inert, actual-function regression: signed-64-bit owner exactness on mail-alert watcher rules.
// No live Supabase, Gmail, WhatsApp, provider calls, or writes.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync('lib/email/mail-alert-commands.ts', 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const calls: Array<{ kind: 'read' | 'write'; table: string; filters: Array<[string, unknown]> }> = []
const watcher = { id: 'watch-fixture-one', condition_json: { mailAlerts: { kinds: { money_leaving: true } } } }

const db = {
  from(table: string) {
    assert.equal(table, 'agent_watchers', 'rules commands cannot query another table')
    const filters: Array<[string, unknown]> = []
    let payload: unknown
    const q: any = {
      select() { return q },
      eq(column: string, value: unknown) { filters.push([column, value]); return q },
      order() { return q },
      limit() { return q },
      maybeSingle() {
        calls.push({ kind: 'read', table, filters: [...filters] })
        return Promise.resolve({ data: watcher, error: null })
      },
      update(value: unknown) { payload = value; return q },
      then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) {
        assert.ok(payload && typeof payload === 'object', 'only the approved rules payload is written')
        calls.push({ kind: 'write', table, filters: [...filters] })
        return Promise.resolve({ data: null, error: null }).then(resolve, reject)
      },
    }
    return q
  },
}
const mailAlerts = {
  RULES_ASK_RE: /^what do you alert me about\?$/i,
  RULE_COMMAND_RE: /^stop renewals$/i,
  normalizeRules: (saved: any) => ({ ...saved }),
  formatRules: () => 'Fixture rules',
  applyRuleCommand: (text: string, rules: any) =>
    /^stop renewals$/i.test(text)
      ? { changed: 'Money leaving: off.', rules: { ...rules, kinds: { ...rules.kinds, money_leaving: false } } }
      : null,
}
const exportsObj: any = {}
vm.runInNewContext(compiled, {
  exports: exportsObj,
  module: { exports: exportsObj },
  require(name: string) {
    if (name === '@/lib/data/supabase-admin') return { supabaseAdmin: db }
    if (name === './mail-alerts') return mailAlerts
    throw new Error('unexpected external module: ' + name)
  },
  BigInt, Number, String, Date, console,
}, { filename: 'mail-alert-commands.fixture.js' })
const command = exportsObj.tryMailAlertCommand as (owner: string | number, text: string) => Promise<string | null>

const bigOwner = '9223372036854775806'
for (const exact of [bigOwner, '9223372036854775807', '-9223372036854775808', '-9223372036854775807', '-42', '42']) {
  calls.length = 0
  assert.equal(await command(exact, 'what do you alert me about?'), 'Fixture rules')
  assert.equal(calls.length, 1, 'one read for canonical owner ' + exact)
  assert.deepEqual(calls[0].filters, [['telegram_id', exact], ['type', 'email_triage'], ['active', true]])
}
calls.length = 0
assert.equal(await command(42, 'what do you alert me about?'), 'Fixture rules', 'safe legacy number accepted')
assert.deepEqual(calls[0].filters[0], ['telegram_id', '42'], 'legacy number normalized to exact text only')

for (const bad of [
  '9223372036854775808', '-9223372036854775809',
  '9007199254740993abc', '42tail', '0042', '+42', ' 42', '42 ', '4.2', '4e2', '-0', '',
  Number.MAX_SAFE_INTEGER + 1, -(Number.MAX_SAFE_INTEGER + 1), NaN, Infinity,
]) {
  calls.length = 0
  assert.equal(await command(bad, 'what do you alert me about?'), null, 'reject invalid/imprecise owner: ' + String(bad))
  assert.equal(calls.length, 0, 'no privileged read or write for invalid owner: ' + String(bad))
}
calls.length = 0
assert.match((await command(bigOwner, 'stop renewals'))!, /^Money leaving: off\./)
assert.equal(calls.length, 2, 'rules read then one guarded update')
assert.deepEqual(calls[0].filters[0], ['telegram_id', bigOwner])
assert.deepEqual(calls[1].filters, [['id', watcher.id], ['telegram_id', bigOwner]],
  'rule update must retain watcher-id AND exact owner predicates')
assert.equal(calls[1].kind, 'write')

console.log('verify-mail-alert-owner-exact-nov23: passed canonical signed-64-bit read/write, unsafe owner rejection, no external calls')
