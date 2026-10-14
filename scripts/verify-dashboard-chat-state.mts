import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
// 14 Oct: the dashboard chat shows a different pose of Gogo for each state, as the earlier design did.
// Run: npx tsx scripts/verify-dashboard-chat-state.mts
function load(file: string, mocks: Record<string, any>) {
  const module = { exports: {} as any }
  runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module, exports: module.exports, console, Object, String, Number, Boolean,
      require(name: string) { if (name in mocks) return mocks[name]; throw new Error(`Unmocked: ${name}`) } })
  return module.exports
}
const { chatGogoState, CHAT_STATE_LABEL } = load('lib/dashboard/gogo-chat-state.ts', {})
const base = { sending: false, typing: false, runTone: 'idle', justReplied: false, watchers: 0 }
const at = (over: Record<string, any>) => chatGogoState({ ...base, ...over })

assert.equal(at({}), 'calm', 'nothing going on is the calm pose')
assert.equal(at({ typing: true }), 'listening', 'typing in the box is listening')
assert.equal(at({ sending: true }), 'thinking', 'a message on its way is thinking')
assert.equal(at({ runTone: 'working' }), 'acting', 'real running work is acting')
assert.equal(at({ runTone: 'waiting' }), 'approval', 'waiting on the person is the approval pose')
assert.equal(at({ justReplied: true }), 'done', 'a fresh answer is done')
assert.equal(at({ watchers: 3 }), 'watching', 'background watches and nothing else is watching')

// What Gogo is doing now beats what is only true in the background.
assert.equal(at({ sending: true, typing: true, runTone: 'waiting', watchers: 2 }), 'thinking')
assert.equal(at({ runTone: 'working', typing: true }), 'acting')
assert.equal(at({ runTone: 'waiting', justReplied: true }), 'approval', 'a pending approval is not hidden by a fresh reply')
assert.equal(at({ typing: true, watchers: 2 }), 'listening', 'typing beats watching')
assert.equal(at({ justReplied: true, watchers: 2 }), 'done', 'a fresh reply beats watching')

// Every pose has a label, and every pose is one the character can draw.
const character = readFileSync('components/gogo/gogo-character.tsx', 'utf8')
const drawable = character.match(/export type GogoState = ([^\n]+)/)![1].match(/'([a-z]+)'/g)!.map(s => s.replace(/'/g, ''))
for (const state of Object.keys(CHAT_STATE_LABEL)) {
  assert.ok(drawable.includes(state), `${state} is not a GogoCharacter state`)
  assert.ok(String(CHAT_STATE_LABEL[state]).length > 0)
}
console.log('verify-dashboard-chat-state: ok')
