// 23 Oct acceptance run: "Email nithin@… saying …" answered "I can't send emails from this chat" with Gmail send
// enabled. Every natural phrasing makes the same reviewable draft; nothing sends without approval.
// Run: npx tsx scripts/verify-email-compose-verbs.mts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-key'
const { parseGmailComposeCommand: p, isGmailReplyCommand } = await import('../lib/agent/gmail-send')
const yes: Array<[string, string, string]> = [
  ['Email nithin@example.invalid saying "Test from Gogo acceptance run, please ignore"', 'nithin@example.invalid', 'Test from Gogo acceptance run, please ignore'],
  ['Send an email to Divya saying I will be late', 'Divya', 'I will be late'],
  ['send Nithin an email saying the POS API is ready', 'Nithin', 'the POS API is ready'],
  ['Mail Divya: running 10 min late', 'Divya', 'running 10 min late'],
  ['Please email Divya telling her the deck is ready', 'Divya', 'the deck is ready'],
  ['Draft an email to Nithin saying hi', 'Nithin', 'hi'],
]
for (const [text, target, said] of yes) {
  const r = p(text)
  assert.ok(r, text); assert.equal(r!.target, target, text); assert.equal(r!.said, said, text); assert.equal(r!.draftOnly, true)
  assert.equal(isGmailReplyCommand(text), true, `${text} reaches the Gmail path on WhatsApp too`)
}
for (const text of ['Email me a summary saying hi', 'Email the report to Divya saying here it is', 'Emails from Nithin saying urgent', 'email Divya', 'Send it', 'Mail order pharmacy near me'])
  assert.equal(p(text), null, `not a compose: ${text}`)
const route = readFileSync('app/api/dashboard/chat/route.ts', 'utf8')
assert.ok(route.includes('(?:(?:draft|write|compose|prepare|send)\\b[^\\n]*?\\b(?:e-?mail|mail)\\b|(?:e-?mail|mail)\\s+\\S)'), 'dashboard gate admits the new phrasings')
const src = readFileSync('lib/agent/gmail-send.ts', 'utf8')
assert.match(src, /Nothing has been sent\. Check the address above, then say \*send it\* when you want me to stage approval\./, 'compose still only drafts')
console.log('Email compose: "email X saying", "send an email to X", "send X an email", "mail X:" all draft for review; nothing sends')
