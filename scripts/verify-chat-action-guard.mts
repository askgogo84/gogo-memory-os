// 10 Oct live run: the reply "Goverdhan\nGogo" to Gogo's username/name question was not
// recognised, fell into general chat, and general chat then wrote its own approval prompt and
// answered "Approve" with "Gogo is running it in the secure browser now". Nothing was running.
// 1) an unlabelled answer to the pending username/name question is accepted;
// 2) a plain chat reply can never claim an action was started, approved or completed.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const { parseLooseAccountProfile } = await import('../lib/agent/external-account-intent.ts')
const { guardChatActionClaims, claimsUnperformedAction } = await import('../lib/bot/action-claim-guard.ts')

assert.deepEqual(parseLooseAccountProfile('Goverdhan\nGogo'), { username: 'Goverdhan', fullName: 'Gogo' })
assert.deepEqual(parseLooseAccountProfile('Goverdhan Gogo'), { username: 'goverdhan', fullName: 'Goverdhan Gogo' })
assert.deepEqual(parseLooseAccountProfile('goverdhan-md\nGoverdhan M D'), { username: 'goverdhan-md', fullName: 'Goverdhan M D' })
assert.deepEqual(parseLooseAccountProfile('gogo84'), { username: 'gogo84', fullName: null })
for (const t of ['ok', 'thanks', 'Approve', 'hi there', 'what is the weather in Bengaluru today please', 'remind me at 5', 'ok goverdhan', '']) {
  assert.equal(parseLooseAccountProfile(t), null, `not a profile answer: ${JSON.stringify(t)}`)
}

// The exact fabricated replies from the live run are blocked.
const fakes = [
  "Got it boss. Ready to create the Hugging Face account on huggingface.co with:\n• Email: goverdhan@tipplr.in\nGogo will create a strong password and accept Hugging Face's terms. Reply APPROVE to continue or REJECT to stop.",
  'Approved. Gogo is running it in the secure browser now and will message you the result here.',
  "I've created your Hugging Face account.",
  'I have booked the table for 4 at 8 pm.',
  'Done, I signed you up.',
]
for (const f of fakes) {
  const g = guardChatActionClaims(f)
  assert.equal(g.blocked, true, f)
  assert.match(g.text, /^Nothing has been started\./)
}
// Ordinary answers pass through untouched.
for (const ok of ['Bengaluru will be 24°C and cloudy today.', 'You can book a table on the restaurant site.', 'Want me to set a reminder for that?', 'Have you approved the budget yet?']) {
  assert.equal(claimsUnperformedAction(ok), false, ok)
}

// Wiring: the loose reading is used only while the username/name question is pending, the route
// lets such replies reach the account flow, and only plain chat replies are guarded.
const acct = readFileSync('lib/agent/external-account.ts', 'utf8')
assert.match(acct, /parseAccountProfile\(params\.text\)\|\|\(payload\.stage==='profile'\?parseLooseAccountProfile\(params\.text\):null\)/)
const route = readFileSync('app/api/webhooks/whatsapp/route.ts', 'utf8')
assert.match(route, /parseAccountProfile\(text\) \|\| parseLooseAccountProfile\(text\) \|\|/)
const pm = readFileSync('lib/bot/process-message.ts', 'utf8')
assert.match(pm, /if \(finalReply === rawClaude\) \{\s*const guarded = guardChatActionClaims\(finalReply, \{ userText: incomingText \}\)/)
assert.match(pm, /CHAT_ACTION_CLAIM_BLOCKED:/)

console.log('Chat action guard: unlabelled profile replies accepted; fabricated action claims blocked')

// Round 6 (#44): a read-only recap may report past changes; the receipt check stays on for everything else.
{
  const recap = guardChatActionClaims('Your week:\n• Booked Toit for Sat 8 pm\n• 3 reminders were sent', { userText: 'Summarise my week' })
  if (recap.blocked) throw new Error('a week recap must not be replaced by the no-change line')
  const skip = guardChatActionClaims("Skipped today's lunch reminder (2:30 pm)", { userText: 'Skip lunch today' })
  if (!skip.blocked) throw new Error('a chat receipt for an action request is still blocked')
  console.log('✓ recap exemption is narrow')
}

// 22 Oct launch run (R34): an explicit read-only listing of Gogo's own tasks keeps its answer.
{
  const list = "Open travel tasks:\n• Reserve Naru Noodle Bar — saved, no date set\n• Check-in reminder marked done"
  const r34 = guardChatActionClaims(list, { userText: 'List all my open tasks related to travel. Read-only; do not create, update or delete anything.' })
  if (r34.blocked) throw new Error('a read-only task listing must not be replaced by the no-change line')
  const shown = guardChatActionClaims('Removed the water reminder for today.', { userText: 'Show my reminders' })
  if (!shown.blocked) throw new Error('a fabricated receipt to a plain listing request is still blocked')
  for (const ask of ['Show my reminders and delete the water one', 'List my tasks then cancel the Naru one', 'Skip lunch today, read-only is fine']) {
    const g = guardChatActionClaims("Skipped today's lunch reminder (2:30 pm)", { userText: ask })
    if (!g.blocked) throw new Error(`an action request is still guarded: ${ask}`)
  }
  console.log('✓ read-only listing exemption ignores forbidden verbs but keeps real actions guarded')
}
