import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
// 14 Oct: WhatsApp-style *bold* in Gogo's replies showed as literal asterisks on the dashboard
// ("*Bangalore now*"). Real bold on the page; everything else left exactly as written.
// Run: npx tsx scripts/verify-chat-text.mts
const module = { exports: {} as any }
runInNewContext(ts.transpileModule(readFileSync('lib/dashboard/chat-text.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { module, exports: module.exports, String, Number })
const { splitChatText } = module.exports
const plain = (t: string) => JSON.stringify(splitChatText(t).map((p: any) => [p.bold, p.text]))
assert.equal(plain('🌤️ *Bangalore now*\n\nOvercast'), JSON.stringify([[false, '🌤️ '], [true, 'Bangalore now'], [false, '\n\nOvercast']]))
assert.equal(plain('Say *set reminders autonomy to auto* (or *ask*) to turn them back on.'), JSON.stringify([[false, 'Say '], [true, 'set reminders autonomy to auto'], [false, ' (or '], [true, 'ask'], [false, ') to turn them back on.']]))
// Left alone: a bullet, a lone asterisk, maths, an empty pair, a pair spanning lines.
for (const text of ['* item one\n* item two', '3 * 4 = 12', 'Note* this', '**', '* spaced *', 'a *b\nc* d']) {
  assert.equal(plain(text), JSON.stringify([[false, text]]), text)
}
assert.equal(plain(''), JSON.stringify([[false, '']]))
assert.equal(plain(undefined as any), JSON.stringify([[false, '']]))
// The page uses it for Gogo's replies only, and draws bold with weight, never slant.
const ui = readFileSync('components/dashboard/gogo-chat.tsx', 'utf8')
assert.ok(ui.includes('splitChatText') && ui.includes('richText(message.content)'))
assert.ok(ui.indexOf('richText(message.content)') > ui.indexOf("if(message.role==='user')"), 'replies use rich text')
assert.ok(!/<em\b|italic/.test(ui.slice(ui.indexOf('function richText'), ui.indexOf('function richText') + 400)))
// The location control is reachable once a conversation exists (the empty-state card alone left phones with no way in).
assert.ok(ui.includes("loc.status==='ask'&&visible.length>0"), 'the ask banner shows in an ongoing chat')
assert.ok(ui.includes('Use my location'), 'a pill to turn location on after Not now')
console.log('verify-chat-text: ok')
