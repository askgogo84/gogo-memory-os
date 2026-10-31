// TEST ONLY — independently execute the unchanged Adaptive Trust suggestion function.
// No real database, approvals, owner data, model/provider or network calls.
// This diagnostic intentionally fails the safety cases against current main.
// DO NOT MERGE OR DEPLOY while mandatory assertions remain RED.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const ts = require('typescript')

const source = fs.readFileSync('lib/agent/adaptive-trust.ts', 'utf8')
const reminderSource = fs.readFileSync('lib/agent/reminder-update.ts', 'utf8')
const calendarSource = fs.readFileSync('lib/agent/calendar-update.ts', 'utf8')
assert.match(source, /if\(status==='executed'\)/, 'original evaluator must be used')
assert.match(reminderSource, /status:unchanged\?'failed':'executed'/, 'reminder unknown-outcome admission precondition')
assert.match(calendarSource, /status:rejected\?'failed':'executed'/, 'Calendar unknown-outcome admission precondition')
const parsed = ts.createSourceFile('adaptive-trust.ts', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS)
const names = new Set(['DEFAULT_LEVEL', 'CAPABILITIES', 'capabilityFromActionType', 'currentPermissions', 'buildAdaptiveTrustSuggestions'])
const definitions = parsed.statements.filter(node => {
  if (ts.isFunctionDeclaration(node)) return names.has(node.name?.text)
  if (ts.isVariableStatement(node)) return node.declarationList.declarations.some(d => ts.isIdentifier(d.name) && names.has(d.name.text))
  return false
})
assert.equal(definitions.length, names.size, 'must execute all original Adaptive Trust dependencies')
const extracted = definitions.map(node => node.getText(parsed).replace(/^\s*export\s+/, '')).join('\n')
const js = ts.transpileModule(extracted + '\nglobalThis.__buildTrust=buildAdaptiveTrustSuggestions;', {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText

const actor = { legacyTelegramId: 101 }
function fixture(statuses, { risk = 'low', permission = 'ask', extraRejected = false } = {}) {
  const rows = statuses.map((status, i) => ({
    id: 'approval-' + i,
    run_id: 'run-' + i,
    action_type: 'reminder_change',
    status: 'executed',
    risk_level: risk,
    requested_at: '2026-10-30T12:00:00Z',
    execution_payload: { capability: 'reminders' },
  }))
  if (extraRejected) rows.push({
    id: 'approval-rejected', run_id: 'run-rejected', action_type: 'reminder_change',
    status: 'rejected', risk_level: 'low', requested_at: '2026-10-30T12:00:00Z',
    execution_payload: { capability: 'reminders' },
  })
  const runs = statuses.flatMap((status, i) => status === 'absent' ? [] : [{
    id: 'run-' + i, capability: 'reminders', status,
    // In a corrected implementation, verified_success requires real evidence.
    outcome: status === 'completed' ? 'verified_success' : 'unknown',
    verification: status === 'completed' ? { kind: 'synthetic_provider_readback', verified: true } : null,
  }])
  const reads = []
  const db = {
    from(table) {
      if (table === 'agent_approvals') return {
        select(columns) {
          reads.push({ table, columns })
          return {
            eq(key, value) {
              assert.equal(key, 'telegram_id')
              assert.equal(value, '101')
              return this
            },
            gte() { return this },
            order() { return this },
            range(from, to) { return Promise.resolve({ data: rows.slice(from, to + 1), error: null }) },
          }
        },
      }
      if (table === 'agent_runs') return {
        select(columns) {
          reads.push({ table, columns })
          return {
            in(key, ids) {
              assert.equal(key, 'id')
              return Promise.resolve({ data: runs.filter(r => ids.includes(r.id)), error: null })
            },
          }
        },
      }
      if (table === 'agent_permissions') return {
        select(columns) {
          reads.push({ table, columns })
          return {
            eq(key, value) {
              assert.equal(key, 'telegram_id')
              assert.equal(value, '101')
              return Promise.resolve({ data: [{ capability: 'reminders', level: permission }], error: null })
            },
          }
        },
      }
      throw new Error('Unexpected synthetic table: ' + table)
    },
  }
  const sandbox = { supabaseAdmin: db, Date, console }
  sandbox.globalThis = sandbox
  vm.createContext(sandbox)
  vm.runInContext(js, sandbox, { timeout: 2000, filename: 'original-adaptive-trust.transpiled.js' })
  assert.equal(typeof sandbox.__buildTrust, 'function')
  return { evaluate: () => sandbox.__buildTrust(actor), reads }
}
let pass = 0, fail = 0
async function check(kind, label, fn) {
  try { await fn(); pass++; console.log('PASS ' + kind + ': ' + label) }
  catch (error) { fail++; console.error('FAIL ' + kind + ': ' + label + ' — ' + String(error?.message || error)) }
}

await check('CONTROL', 'no history makes no suggestion', async () => {
  const f = fixture([])
  const r = await f.evaluate()
  assert.equal(r.suggestions.length, 0)
  assert.equal(r.patterns.length, 0)
})
await check('CONTROL', 'five synthetically verified completed low-risk runs qualify for suggestion', async () => {
  const f = fixture(Array(5).fill('completed'))
  const r = await f.evaluate()
  assert.equal(r.suggestions.length, 1)
  assert.equal(r.suggestions[0][0], 'reminders')
  assert.equal(r.suggestions[0][1].lowRiskSuccess, 5)
  assert.equal(f.reads.some(x => x.table === 'agent_approvals'), true)
})
await check('CONTROL', 'three verified medium-risk runs are only learning patterns', async () => {
  const r = await fixture(Array(3).fill('completed'), { risk: 'medium' }).evaluate()
  assert.equal(r.suggestions.length, 0)
  assert.equal(r.patterns.length, 1)
})
await check('CONTROL', 'explicit rejected approval blocks clean-history recommendations', async () => {
  const r = await fixture(Array(5).fill('completed'), { extraRejected: true }).evaluate()
  assert.equal(r.suggestions.length, 0)
  assert.equal(r.patterns.length, 0)
})
await check('CONTROL', 'explicit capability OFF is respected', async () => {
  const r = await fixture(Array(5).fill('completed'), { permission: 'off' }).evaluate()
  assert.equal(r.suggestions.length, 0)
  assert.equal(r.patterns.length, 0)
})

await check('SAFETY', 'five unknown-outcome runs cannot be counted as five verified successes', async () => {
  const r = await fixture(Array(5).fill('outcome_unknown')).evaluate()
  assert.equal(r.suggestions.length, 0, 'unknown provider outcome is not verified_success')
})
await check('SAFETY', 'five failed runs cannot count as successful trust history', async () => {
  const r = await fixture(Array(5).fill('failed')).evaluate()
  assert.equal(r.suggestions.length, 0, 'executed approval does not override failed run')
})
await check('SAFETY', 'orphan approvals without existing runs cannot count as verified', async () => {
  const r = await fixture(Array(5).fill('absent')).evaluate()
  assert.equal(r.suggestions.length, 0, 'missing run cannot demonstrate execution')
})
await check('SAFETY', 'four verified and one unknown run must not reach five-success recommendation', async () => {
  const r = await fixture(['completed', 'completed', 'completed', 'completed', 'outcome_unknown']).evaluate()
  assert.equal(r.suggestions.length, 0, 'unknown cannot be the fifth successful execution')
})
await check('SAFETY', 'three unknown medium-risk runs must not become learned success patterns', async () => {
  const r = await fixture(Array(3).fill('outcome_unknown'), { risk: 'medium' }).evaluate()
  assert.equal(r.patterns.length, 0, 'unknown medium-risk outcomes are not successful patterns')
})
await check('SAFETY', 'five in-progress runs cannot be classified as successfully executed', async () => {
  const r = await fixture(Array(5).fill('running')).evaluate()
  assert.equal(r.suggestions.length, 0, 'uncompleted run is not verified success')
})
console.log('RESULT: ' + pass + ' PASS; ' + fail + ' FAIL (5 positive controls, 6 mandatory verification assertions)')
if (fail) process.exitCode = 1
