// Duet 03: "Which emails am I waiting on replies for?" is answered from Sent mail, email-only.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const gr = await import('../lib/bot/handlers/gmail-read')
const now = Date.parse('2026-10-30T07:00:00Z')
const msg = (from: string, to: string, sent: boolean, at: string, subject = 'Menu update for Toit') => ({ from, to, labelIds: sent ? ['SENT'] : ['INBOX'], internalDate: Date.parse(at), subject })
const rows = gr.awaitingRepliesFrom([
  { subject: 'Menu update for Toit', messages: [msg('Nithin <nithin@tipplr.in>', 'me@x.com', false, '2026-10-25T05:00:00Z'), msg('me@x.com', 'Nithin K L <nithin@tipplr.in>', true, '2026-10-27T05:00:00Z', 'Re: Menu update for Toit')] },
  { subject: 'Dinner', messages: [msg('me@x.com', 'Divya <divya@gmail.com>', true, '2026-10-30T05:00:00Z', 'Dinner')] },
  { subject: 'Invoice', messages: [msg('me@x.com', 'billing@vercel.com', true, '2026-10-20T05:00:00Z', 'Invoice')] },
  { subject: 'Plan', messages: [msg('me@x.com', 'Divya <divya@gmail.com>', true, '2026-10-26T05:00:00Z', 'Plan'), msg('Divya <divya@gmail.com>', 'me@x.com', false, '2026-10-27T05:00:00Z', 'Re: Plan')] },
] as any, 'me@x.com', now)
assert.deepEqual(rows.map(r => r.to), ['Nithin K L'], 'only threads where you wrote last, to a person, over a day ago')
const text = gr.formatAwaitingReplies(rows, now)
assert.match(text, /1\. Nithin K L — “Menu update for Toit” · sent 3 days ago/)
assert.match(text, /remind me if Nithin doesn't reply by Friday/)
assert.match(gr.formatAwaitingReplies([], now), /Nobody owes you a reply/)
assert.match(readFileSync('lib/agent/open-loops.ts', 'utf8'), /gr\.awaitingRepliesReply\(params\.actor\.legacyTelegramId\)/)
console.log('✓ "which emails am I waiting on" reads Sent mail: people who have not replied, oldest first')
