// TEST ONLY / EXPECTED SAFETY RED. Do NOT merge or deploy this diagnostic branch.
// Execute unchanged lib/email/inbound.ts::notify against a fully synthetic transport/DB.
// The test never imports the application module or contacts WhatsApp, email, Supabase,
// Vercel, customers, providers or external networks.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const filename = 'lib/email/inbound.ts'
const source = readFileSync(filename, 'utf8')
const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const original = ast.statements.find(
  node => ts.isFunctionDeclaration(node) && node.name?.text === 'notify'
)
assert.ok(original, 'must find the actual, unchanged inbound notify implementation')
assert.match(source, /const pushed = await notify\(telegramId, /, 'urgent inbound email must use notify')
assert.match(source, /if \(pushed\) await supabaseAdmin\.from\('inbound_emails'\)\.update\(\{ notified_at: at \}\)/,
  'pushed is consumed as a persisted notified_at claim')
const js = ts.transpileModule(original.getText(ast), {
  fileName: filename,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText
assert.match(js, /async function notify\(/, 'transpiled implementation must remain original notify')

function isolatedCase(outcome, hasRecipient = true) {
  const inserted = []
  let deliveryCalls = 0
  let sendCalls = 0
  const fakeDb = {
    from(table) {
      if (table === 'users') {
        return {
          select(columns) {
            assert.equal(columns, 'whatsapp_id')
            return {
              eq(column, owner) {
                assert.equal(column, 'telegram_id')
                assert.equal(owner, 271828)
                return {
                  async maybeSingle() {
                    return { data: hasRecipient ? { whatsapp_id: 'wa_synthetic_only' } : null, error: null }
                  },
                }
              },
            }
          },
        }
      }
      if (table === 'conversations') {
        return {
          insert(record) {
            inserted.push(record)
            return Promise.resolve({ data: null, error: null })
          },
        }
      }
      throw new Error('unexpected table in isolated test: ' + table)
    },
  }
  const sandbox = {
    supabaseAdmin: fakeDb,
    deliverNotification: async request => {
      deliveryCalls++
      assert.equal(request.key, 'email-urgent/271828/synthetic-message')
      assert.equal(request.source, 'watch_alert')
      assert.equal(request.owner, 271828)
      assert.equal(request.channel, 'whatsapp')
      assert.equal(typeof request.send, 'function')
      return outcome
    },
    sendWhatsApp: async () => {
      sendCalls++
      throw new Error('test must NEVER call a real provider or simulate delivery')
    },
    console: { error() {} },
  }
  // There is deliberately no process, require, fetch, network or credential in the VM.
  runInNewContext(js + '\n;globalThis.__subject = notify;', sandbox, { timeout: 2000, filename })
  assert.equal(typeof sandbox.__subject, 'function')
  return {
    inserted,
    async invoke() {
      const pushed = await sandbox.__subject(271828, 'email-urgent/271828/synthetic-message', 'Synthetic, private alert')
      return { pushed, deliveryCalls, sendCalls, history: inserted }
    },
  }
}

let controls = 0
let safetyFailed = 0
let safetyPassed = 0
async function control(name, outcome, hasRecipient, verify) {
  const got = await isolatedCase(outcome, hasRecipient).invoke()
  verify(got)
  controls++
  console.log('CONTROL PASS:', name)
}
async function safety(name, outcome) {
  const got = await isolatedCase(outcome).invoke()
  try {
    // A durable queued, skipped, suppressed or unknown delivery is not a
    // newly completed user notification. Never fabricate a received card.
    assert.equal(got.pushed, false, 'must not claim pushed for ' + outcome)
    assert.equal(got.history.length, 0, 'must not write a sent-looking conversation for ' + outcome)
    assert.equal(got.deliveryCalls, 1, 'must not issue a duplicate delivery attempt')
    assert.equal(got.sendCalls, 0, 'must not invoke a provider from the test')
    safetyPassed++
    console.log('SAFETY PASS:', name)
  } catch (error) {
    safetyFailed++
    console.log('SAFETY RED:', name, '-', error.message)
  }
}

// Benign controls prove the test harness actually exercises the original
// implementation and preserves normal transport-accepted behavior. Provider
// acceptance is NOT recipient-visible verified delivery.
await control('no owner-bound recipient', 'provider_accepted', false, got => {
  assert.equal(got.pushed, false)
  assert.equal(got.deliveryCalls, 0)
  assert.equal(got.history.length, 0)
  assert.equal(got.sendCalls, 0)
})
await control('definite failed transport', 'failed', true, got => {
  assert.equal(got.pushed, false)
  assert.equal(got.deliveryCalls, 1)
  assert.equal(got.history.length, 0)
  assert.equal(got.sendCalls, 0)
})
await control('provider acceptance (NOT delivery)', 'provider_accepted', true, got => {
  assert.equal(got.pushed, true)
  assert.equal(got.deliveryCalls, 1)
  assert.equal(got.history.length, 1)
  assert.equal(got.history[0].telegram_id, 271828)
  assert.equal(got.sendCalls, 0)
})

// All five cases are non-acceptance / no-new-send outcomes. In particular,
// outcome_unknown must never be blindly retried; fixing false presentation must
// leave the durable no-retry ledger intact.
await safety('claimed elsewhere / skipped', 'skipped')
await safety('deadline or owner policy deferred', 'deferred')
await safety('consent or preference suppressed', 'suppressed')
await safety('database receipt persistence failed', 'persistence_failed')
await safety('provider call outcome unknown; NO RETRY', 'outcome_unknown')

console.log(`INBOUND NOTIFICATION SUMMARY: ${controls}/3 positive controls PASS; ${safetyPassed}/5 safety PASS; ${safetyFailed}/5 safety RED`)
if (controls !== 3 || safetyFailed > 0 || safetyPassed !== 5) {
  console.error('EXPECTED SAFETY RED: do not merge/deploy; source owner must fix and make all safety assertions GREEN.')
  process.exitCode = 1
}
