// TEST-ONLY / EXPECTED RED on deployed #1072. No provider, DB, cron or production execution.
// Extract and execute the actual jobDone send block with inert fake Twilio functions.
// A transport timeout can happen AFTER the provider accepts a send; a second template
// must never be attempted unless rejection is definitively known.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const path = 'app/api/cron/reminders/route.ts'
const source = readFileSync(path, 'utf8')
const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
let sendBlock = null

function visit(node) {
  if (ts.isIfStatement(node) && node.expression.getText(file).trim() === 'jobDone' &&
      node.thenStatement.getText(file).includes('sendWhatsApp(')) {
    sendBlock = node.thenStatement.getText(file)
  }
  ts.forEachChild(node, visit)
}
visit(file)
assert.ok(sendBlock, 'the REAL jobDone send branch must be located; review the test if refactored')

async function simulate(outcome, mode = 'template') {
  const events = []
  const state = {
    whatsappTo: 'whatsapp:+15555550123',
    text: 'Synthetic sourced research update, not an actual message',
    label: 'Synthetic reminder',
    token: 'synthetic-delivery-token',
    reminder: { id: 'synthetic-reminder-id' },
    process: {
      env: {
        TWILIO_REMINDER_CONTENT_SID: mode === 'template' ? 'mock-content-sid' : undefined,
        TWILIO_REMINDER_BUTTONS_CONTENT_SID: mode === 'buttons' ? 'mock-buttons-sid' : undefined,
      },
    },
    console: { error: () => {} },
    sendWhatsApp: async () => {
      events.push('text-attempt')
      if (outcome === 'timeout_after_accept') {
        events.push('mock-provider-accepted-before-timeout')
        const error = new Error('Synthetic network timeout; upstream may already have accepted') as Error & { code?: string; status?: number }
        error.code = 'ETIMEDOUT'
        throw error
      }
      if (outcome === 'definite_rejection') {
        const error = new Error('Synthetic provider rejection; never accepted') as Error & { code?: number; status?: number }
        error.status = 400
        error.code = 63016
        throw error
      }
      return { sid: 'synthetic-accepted-sid' }
    },
    sendWhatsAppReminderTemplate: async () => {
      events.push('template-attempt')
      return { sid: 'synthetic-template-sid' }
    },
    sendWhatsAppReminderButtons: async () => {
      events.push('buttons-attempt')
      return { sid: 'synthetic-buttons-sid' }
    },
    isDefiniteProviderRejection: error => error?.status === 400,
  }
  // Only the parsed branch is executed; all identifiers in scope are fake.
  const code = '(async () => { let message = null; ' + sendBlock + '; return message })()'
  let error = null
  let message = null
  try {
    message = await vm.runInNewContext(code, state, { filename: 'synthetic-jobDone-send.js', timeout: 2000 })
  } catch (caught) {
    error = caught
  }
  return { events, error, message }
}

function noFallbackEvents(events) {
  return events.filter(event => event === 'template-attempt' || event === 'buttons-attempt')
}

const success = await simulate('success', 'template')
assert.equal(success.error, null, 'one successful text call should not throw')
assert.deepEqual(success.events, ['text-attempt'], 'successful free-text send is exactly one attempt')
assert.equal(success.message?.sid, 'synthetic-accepted-sid')
console.log('PASS safe success control: exactly one provider attempt')

const noTemplate = await simulate('timeout_after_accept', 'none')
assert.ok(noTemplate.error, 'no-template timeout must propagate to existing outcome_unknown handling')
assert.deepEqual(noFallbackEvents(noTemplate.events), [])
console.log('PASS no-template control: uncertain outcome propagates without a second send')

const definite = await simulate('definite_rejection', 'template')
assert.equal(noFallbackEvents(definite.events).length <= 1, true, 'definite rejection permits at most one fallback')
console.log('PASS definite-rejection control: at most one known-safe template alternative')

const unsafeCases = []
for (const kind of ['template', 'buttons']) {
  const uncertain = await simulate('timeout_after_accept', kind)
  const fallbackAttempts = noFallbackEvents(uncertain.events)
  if (fallbackAttempts.length) {
    unsafeCases.push(kind + ':blind-fallback')
    console.error('FAIL P1 ' + kind + ': synthetic provider accepted before timeout, but a fallback was attempted: ' + uncertain.events.join(','))
  } else {
    console.log('PASS ' + kind + ': no second network attempt after ambiguous provider result')
  }
  if (!uncertain.error) {
    unsafeCases.push(kind + ':outcome-swallowed')
    console.error('FAIL P1 ' + kind + ': synthetic ambiguous exception was swallowed instead of reaching outcome_unknown')
  } else {
    console.log('PASS ' + kind + ': unknown outcome propagated')
  }
}
assert.deepEqual(unsafeCases, [], 'P1 ambiguous provider results must produce no fallback and must propagate for outcome_unknown')
console.log('PASS REMINDER_UNKNOWN_FALLBACK_TESTONLY: source-executed inert Twilio scenarios; no live sending')
