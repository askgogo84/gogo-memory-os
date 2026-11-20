// 20 Nov, owner screenshot 11:58: "Connect my mail" → "I can't generate the connect link myself, so please type the exact
// command: connect gmail". Natural connect/reconnect asks must reach the connect handler, not the chat model.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture'
const { isConnectMailAsk, RECONNECT_ADDRESS_RE } = await import('../lib/email/connect-phrases')
const { detectIntent } = await import('../lib/bot/detect-intent')
const { ADD_ACCOUNT_RE, REMOVE_ACCOUNT_RE } = await import('../lib/agent/gmail-accounts')

const yes = ['Connect my mail', 'connect my mail.', 'connect mail', 'Connect my email', 'reconnect my mail', 'Reconnect my work mail', 'please connect my gmail', 'Can you connect my email?', 'link my inbox', 'connect my tipplr mail', 'I want to connect my email', 'connect my mail again', 'Hey Gogo, connect my mail', 'reconnect nithin@example.com', 'connect my e-mail', 'plz connect my mail', 'can u connect my mail', 'Gogo connect my mail', 'connect my mail, please', 're connect my mail', 'connect another mail', 'add my work mail', 'reconnect nithin@example.com please']
for (const t of yes) {
  assert.equal(isConnectMailAsk(t), true, t)
  assert.equal((detectIntent as any)(t).type, 'connect_gmail', `detectIntent: ${t}`)
}
// Not a connect ask: longer sentences, other verbs, reading or sending mail, lists and reminders.
const no = ['mail Divya the deck', 'connect me with Nithin by mail', 'check my mail', 'any important emails?', 'remind me to connect my mail tomorrow', "add 'link my mail to the CRM' to my list", 'connect my mail to the CRM and export contacts', 'draft a mail to Nithin', 'connect my calendar', 'disconnect my mail', 'what is my email', 'connect', 'my mail is not connected, why?', 'x'.repeat(400) + ' connect my mail', 'connect my mail' + ' '.repeat(150) + 'and delete everything', 'set up my inbox', 'add milk and mail to my list', 'add newsletters', 'start replies']
for (const t of no) assert.equal(isConnectMailAsk(t), false, t)
for (const t of ['remind me to connect my mail tomorrow', 'mail Divya the deck', 'check my mail']) assert.notEqual((detectIntent as any)(t).type, 'connect_gmail', t)
console.log('✓ "connect my mail" and its natural variants are connect asks; nearby sentences are not')

// Refreshing one named account goes to the add-account link (the save is an upsert, so picking it again refreshes access).
assert.equal(RECONNECT_ADDRESS_RE.exec('Reconnect nithin@example.com')?.[1], 'nithin@example.com')
for (const t of ['reconnect nithin@example.com', 'connect nithin@example.com', 'reconnect my work mail', 'connect my tipplr mail', 'connect another gmail', 'add my work email']) assert.ok(ADD_ACCOUNT_RE.test(t), t)
for (const t of ['connect another mail', 'add my work mail']) { assert.ok(ADD_ACCOUNT_RE.test(t), t); assert.equal((detectIntent as any)(t).type, 'connect_gmail', t) }
for (const t of ['connect my mail', 'connect gmail', 'reconnect my mail']) assert.ok(!ADD_ACCOUNT_RE.test(t), `${t} shows status, not an add link`)
assert.ok(!REMOVE_ACCOUNT_RE.test('reconnect nithin@example.com'))
assert.match(readFileSync(new URL('../lib/agent/gmail-accounts.ts', import.meta.url), 'utf8'), /upsert\(row, \{ onConflict: 'telegram_id,email' \}\)/, 're-adding an account must refresh it')
console.log('✓ "reconnect <address>" and "reconnect my work mail" hand out the add-account link')

// Both routers use the one definition, and the connected-state reply says how to refresh a broken account.
assert.match(readFileSync(new URL('../lib/feature-intents.ts', import.meta.url), 'utf8'), /function isWorkspaceConnect[\s\S]{0,700}\|\| isConnectMailAsk\(t\)/)
assert.match(readFileSync(new URL('../lib/bot/handlers/gmail-read.ts', import.meta.url), 'utf8'), /If one has stopped working, say "reconnect <address>"/)
console.log('✓ wired into both routers; the connected reply names the reconnect command')

// Review (20 Nov): two model layers run before the routers on WhatsApp. Neither may answer or re-label a connect ask.
{
  const brain = await import('../lib/agent/brain')
  const gate = await import('../lib/agent/semantic-gate')
  for (const t of ['Connect my mail', 'reconnect my work mail', 'reconnect nithin@example.com', 'connect another mail']) {
    assert.equal(brain.isExactCommand(t), true, `brain must stand aside: ${t}`)
    assert.equal(gate.isExactCommand(t), true, `semantic reading must stand aside: ${t}`)
  }
  for (const t of ['check my mail', 'mail Divya the deck', 'what is on my calendar today']) assert.equal(gate.isExactCommand(t), false, t)
  assert.equal(brain.isExactCommand('mail Divya the deck'), false)
  const h = readFileSync(new URL('../lib/bot/handlers/gmail-read.ts', import.meta.url), 'utf8')
  // The settings page shows no reconnect control once connected, so a reconnect ask gets the link itself.
  assert.match(h, /re\[- \]\?connect\\b\|\\bagain\\b\/i\.test\(text\)\?buildGmailConnectUrl\(telegramId\):null/)
  assert.doesNotMatch(h, /reconnect it at app\.askgogo\.in\/dashboard\/settings\/email/)
  assert.match(h, /ADD_ACCOUNT_RE\.test\(text\) \|\| phrases\.ADD_MAIL_RE\.test\(text\) \|\| phrases\.RECONNECT_ADDRESS_RE\.test\(text\)/)
  const { ADD_MAIL_RE } = await import('../lib/email/connect-phrases')
  for (const t of ['kindly add my office inbox', 'add my second email id', 'hey gogo reconnect nithin@example.com']) assert.ok(ADD_MAIL_RE.test(t) || RECONNECT_ADDRESS_RE.test(t), t)
}
console.log('✓ the brain and the semantic reading both stand aside for a connect ask')
