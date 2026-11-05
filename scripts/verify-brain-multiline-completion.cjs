// Test ORIGINAL production brain module, not a copied stand-in regex.
// Completely inert: no external provider, database, account, reminders, network or secrets.
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')

const filename = 'lib/agent/brain.ts'
const source = readFileSync(filename, 'utf8')
const js = ts.transpileModule(source, {
  fileName: filename,
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
  },
}).outputText

const stubs = {
  '@anthropic-ai/sdk': { default: class FakeAnthropic { constructor() { throw Error('no provider') } } },
  '@/lib/supabase-admin': { supabaseAdmin: new Proxy({}, { get() { throw Error('no DB access') } }) },
  '@/lib/services/claude': { inventedApprovalGuard: text => text },
  '@/lib/bot/memory-redaction': { redactSecretShapedText: text => text },
  './jobs': { isJobScanNow: () => false, jobScanQuery: () => null },
  './places-search': { placeAsk: () => null, nearbyRewrite: () => null },
}
const brainExports = {}
vm.runInNewContext(js, {
  exports: brainExports, module: { exports: brainExports },
  require(name) {
    if (Object.prototype.hasOwnProperty.call(stubs, name)) return stubs[name]
    throw Error('unexpected import ' + name)
  },
  process: { env: {} },
  console: { log() {}, warn() {}, error() {} },
  Date, Number, String, BigInt, Boolean, Buffer, Object, Set, Map, Promise,
  Math, JSON, RegExp, URL, setTimeout, clearTimeout,
  fetch() { throw Error('no network') },
}, { filename, timeout: 5000 })

assert.equal(typeof brainExports.decisionFromToolUse, 'function', 'original brain function must be loaded')
assert.equal(typeof brainExports.cleanReply, 'function', 'original newline-preserving cleanup must be loaded')
assert.equal(brainExports.cleanReply('Done!\r\nYour reminder is scheduled.'), 'Done!\nYour reminder is scheduled.')
const claimedActions = [
  ['remind me to call Maya at 6pm', 'Done!\nYour reminder is scheduled for 6 pm.'],
  ['set a recurring reminder for my medicine', '✅ Done!\nYour recurring reminder has been added.'],
  ['email the report to Maya', "I've sent\nthat email to Maya."],
  ['save the hotel dates', '✅ Updated\nYour trip dates and hotel stay are saved.'],
  ['add milk to my shopping list', 'Saved!\nYour shopping list now has milk.'],
  ['cancel the reminder at 4 pm', 'Cancelled!\nThat reminder is gone.'],
  ['book the hotel in Mumbai', 'Done!\nThe hotel booking is confirmed.'],
  ['do not book or pay anything', 'Done!\nThe hotel is booked.'],
]
for (const [original, text] of claimedActions) {
  const result = brainExports.decisionFromToolUse(original, 'reply', { text })
  assert.equal(result.kind, 'handle', 'multiline false success must not be emitted: ' + original)
  assert.equal(result.instruction, original, 'the original user request, including negation, must be used')
  assert.equal(result.rewritten, false)
}
const factualAnswers = [
  ['when is my check-out reminder?', 'A reminder is set for 7:30 am.'],
  ['what reminders are due today?', 'Your upcoming reminders:\n1. Call Maya\n2. Stretch'],
  ['tell me about my next flight', 'Your flight departs at 6 pm.\nThe current status is on time.'],
  ['summarise my day', 'Your day:\n- 2 meetings\n- 1 task remaining'],
]
for (const [original, text] of factualAnswers) {
  const result = brainExports.decisionFromToolUse(original, 'reply', { text })
  assert.equal(result.kind, 'reply', 'factual answer must remain a reply: ' + original)
}
assert.equal(brainExports.decisionFromToolUse('email the report', 'reply', { text: 'Done! Your email was sent.' }).kind, 'handle',
  'existing single-line guard still active')
assert.equal(brainExports.decisionFromToolUse('what is happening?', 'reply', { text: '' }).kind, 'skip',
  'empty model reply still fails closed')
assert.equal(brainExports.decisionFromToolUse('what time?', 'ask', { question: 'Which timezone?' }).kind, 'ask',
  'unrelated ask tool unchanged')
console.log('PASS original brain multiline completion claim: 8 unsafe action replies handed to handlers; 4 factual replies retained; single-line/empty/ask controls; inert fixtures only')
