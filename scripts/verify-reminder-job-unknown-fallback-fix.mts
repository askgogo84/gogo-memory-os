// Safety regression for a DRAFT-only reminder fix. Executes the ORIGINAL cron's
// jobDone provider-send branch with inert calls; no real Twilio, DB or requests.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { isDefiniteProviderRejection } from '../lib/services/delivery-state'

const path = 'app/api/cron/reminders/route.ts'
const source = readFileSync(new URL('../app/api/cron/reminders/route.ts', import.meta.url), 'utf8')
const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
let sendBranch: string | null = null
function visit(node: ts.Node): void {
  if (ts.isIfStatement(node) &&
      node.expression.getText(ast).trim() === 'jobDone' &&
      node.thenStatement.getText(ast).includes('sendWhatsApp(')) {
    assert.equal(sendBranch, null, 'only one jobDone send branch may be covered')
    sendBranch = node.thenStatement.getText(ast)
  }
  ts.forEachChild(node, visit)
}
visit(ast)
assert.ok(sendBranch, 'must execute the exact current jobDone route branch')
assert.match(source, /import\s*\{\s*isDefiniteProviderRejection\s*\}/, 'real route must use central definite rejection policy')
assert.match(source, /status\s*=\s*sendStarted\s*\?\s*'outcome_unknown'/, 'outer claim fence must retain unknown status')
assert.match(source, /retry_reminder_delivery/, 'outer existing claim/retry accounting remains present')

type Outcome = 'success' | 'timeout_after_accept' | 'connection_reset' | 'http408' | 'http500' |
  'definite_400' | 'definite_401' | 'partial_send' | 'generic_error'
type Mode = 'template' | 'buttons' | 'none'
type Result = { events: string[]; error: unknown; message: { sid: string } | null }
async function simulate(outcome: Outcome, mode: Mode, fallbackThrows = false): Promise<Result> {
  const events: string[] = []
  const error = () => {
    const e = new Error('fictional transport failure') as Error & { code?: string | number; status?: number; partialSend?: boolean }
    if (outcome === 'timeout_after_accept') { e.code = 'ETIMEDOUT'; events.push('provider-maybe-accepted') }
    if (outcome === 'connection_reset') e.code = 'ECONNRESET'
    if (outcome === 'http408') e.status = 408
    if (outcome === 'http500') e.status = 500
    if (outcome === 'definite_400') { e.status = 400; e.code = 63016 }
    if (outcome === 'definite_401') e.status = 401
    if (outcome === 'partial_send') { e.status = 400; e.partialSend = true }
    return e
  }
  const context = {
    whatsappTo: 'whatsapp:+15555550987',
    text: 'Fictional completed lookup answer',
    label: 'Fictional reminder',
    token: 'fake-claim-token',
    reminder: { id: 'faked-uuid' },
    process: { env: {
      TWILIO_REMINDER_CONTENT_SID: mode === 'template' ? 'fake-content-sid' : undefined,
      TWILIO_REMINDER_BUTTONS_CONTENT_SID: mode === 'buttons' ? 'fake-buttons-sid' : undefined,
    } },
    console: { error: () => undefined },
    isDefiniteProviderRejection,
    sendWhatsApp: async () => {
      events.push('initial-text-attempt')
      if (outcome !== 'success') throw error()
      return { sid: 'fake-initial-sid' }
    },
    sendWhatsAppReminderTemplate: async () => {
      events.push('fallback-template-attempt')
      if (fallbackThrows) throw error()
      return { sid: 'fake-template-sid' }
    },
    sendWhatsAppReminderButtons: async () => {
      events.push('fallback-buttons-attempt')
      if (fallbackThrows) throw error()
      return { sid: 'fake-buttons-sid' }
    },
  }
  let failure: unknown = null, message: { sid: string } | null = null
  try {
    message = await vm.runInNewContext(
      '(async () => { let message = null; ' + sendBranch + '; return message })()',
      context, { timeout: 2000, filename: 'inert-reminder-jobDone-provider-branch.js' },
    )
  } catch (e) { failure = e }
  return { events, error: failure, message }
}
const attempts = (r: Result) => r.events.filter(e => e.endsWith('-attempt'))

let controls = 0, safety = 0
async function control(name: string, fn: () => Promise<void>) { await fn(); controls++; console.log('PASS control: ' + name) }
async function guard(name: string, fn: () => Promise<void>) { await fn(); safety++; console.log('PASS safety: ' + name) }

await control('accepted free-text is only one provider attempt', async () => {
  const r = await simulate('success', 'template')
  assert.equal(r.error, null)
  assert.equal(r.message?.sid, 'fake-initial-sid')
  assert.deepEqual(attempts(r), ['initial-text-attempt'])
})
await control('definite outside-window 400 permits one template fallback only', async () => {
  const r = await simulate('definite_400', 'template')
  assert.equal(r.error, null)
  assert.equal(r.message?.sid, 'fake-template-sid')
  assert.deepEqual(attempts(r), ['initial-text-attempt', 'fallback-template-attempt'])
})
await control('definite 401 permits one buttons fallback only', async () => {
  const r = await simulate('definite_401', 'buttons')
  assert.equal(r.error, null)
  assert.equal(r.message?.sid, 'fake-buttons-sid')
  assert.deepEqual(attempts(r), ['initial-text-attempt', 'fallback-buttons-attempt'])
})
await control('without configured fallback a definite rejection propagates', async () => {
  const r = await simulate('definite_400', 'none')
  assert.ok(r.error)
  assert.deepEqual(attempts(r), ['initial-text-attempt'])
})
for (const mode of ['template', 'buttons'] as const) {
  await guard('no second attempt after possible accepted then timeout: ' + mode, async () => {
    const r = await simulate('timeout_after_accept', mode)
    assert.ok(r.error, 'unknown result must propagate to outer outcome_unknown')
    assert.ok(r.events.includes('provider-maybe-accepted'))
    assert.deepEqual(attempts(r), ['initial-text-attempt'])
  })
}
for (const outcome of ['connection_reset', 'http408', 'http500', 'partial_send', 'generic_error'] as const) {
  await guard('unknown/partial error cannot trigger fallback: ' + outcome, async () => {
    const r = await simulate(outcome, 'template')
    assert.ok(r.error, 'error cannot be swallowed and misreported provider_accepted')
    assert.deepEqual(attempts(r), ['initial-text-attempt'])
  })
}
await guard('unknown transport without a content SID remains unknown', async () => {
  const r = await simulate('timeout_after_accept', 'none')
  assert.ok(r.error)
  assert.deepEqual(attempts(r), ['initial-text-attempt'])
})
await guard('fallback failure propagates and cannot cascade into a third send', async () => {
  const r = await simulate('definite_400', 'template', true)
  assert.ok(r.error)
  assert.deepEqual(attempts(r), ['initial-text-attempt', 'fallback-template-attempt'])
})
assert.equal(controls, 4)
assert.equal(safety, 9)
console.log('REMINDER_ANSWER_UNKNOWN_FALLBACK: 4 normal controls, 9 mandatory unknown-outcome checks PASS (inert original source)')
