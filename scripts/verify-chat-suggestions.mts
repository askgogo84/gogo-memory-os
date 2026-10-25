import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
// 14 Oct: Wajo-style chat start: a greeting, tap suggestions that either send or fill the box, voice only where supported.
// Run: npx tsx scripts/verify-chat-suggestions.mts
const module = { exports: {} as any }
runInNewContext(ts.transpileModule(readFileSync('lib/dashboard/chat-suggestions.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
  { module, exports: module.exports, Number, String, Math, require(name: string) { throw new Error(`Unmocked: ${name}`) } })
const { CHAT_SUGGESTIONS, greetingFor, firstNameOf } = module.exports

assert.equal(greetingFor(5), 'Good morning'); assert.equal(greetingFor(11), 'Good morning')
assert.equal(greetingFor(12), 'Good afternoon'); assert.equal(greetingFor(16), 'Good afternoon')
assert.equal(greetingFor(17), 'Good evening'); assert.equal(greetingFor(23), 'Good evening'); assert.equal(greetingFor(2), 'Good evening')
assert.equal(greetingFor(NaN), 'Hello')

assert.equal(firstNameOf('Goverdhan MD'), 'Goverdhan')
assert.equal(firstNameOf('  Priya  '), 'Priya')
assert.equal(firstNameOf('919876543210'), '', 'a phone number is not a name')
assert.equal(firstNameOf('me@example.com'), '', 'an email is not a name')
assert.equal(firstNameOf(null), ''); assert.equal(firstNameOf(undefined), '')

const ids = CHAT_SUGGESTIONS.map((s: any) => s.id)
assert.equal(new Set(ids).size, ids.length, 'suggestion ids are unique')
for (const s of CHAT_SUGGESTIONS) {
  assert.ok(s.title && s.hint && s.prompt, `${s.id} needs a title, hint and prompt`)
  // A suggestion that needs details from the person must not be sent as it is; a complete question must not just sit in the box.
  if (s.send) assert.ok(!/\s$/.test(s.prompt), `${s.id} is sent at once, so it must be a finished sentence`)
  else assert.ok(/\s$/.test(s.prompt), `${s.id} fills the box, so it must end where the person continues typing`)
}
assert.ok(CHAT_SUGGESTIONS.some((s: any) => s.id === 'flight' && !s.send), 'flight needs a route first')
assert.ok(!CHAT_SUGGESTIONS.some((s: any) => /bengal|bangal|blr/i.test(s.prompt)), 'no suggestion hard-codes one person\'s city')

// The component uses them, and voice is feature-detected rather than shown as a dead button.
const chat = readFileSync('components/dashboard/gogo-chat.tsx', 'utf8')
assert.ok(chat.includes('CHAT_SUGGESTIONS') && chat.includes('greetingFor'))
assert.ok(chat.includes('canDictate&&') && chat.includes('webkitSpeechRecognition'), 'mic appears only where the browser supports speech recognition')
assert.ok(chat.includes('aria-label={dictating'), 'mic button is labelled')
console.log('verify-chat-suggestions: ok')
