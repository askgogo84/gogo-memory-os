// 20 Nov, owner's screenshots: (1) "Reply waiting: HSBC Mutual Fund is waiting on you" for a marketing mail;
// (2) "Money leaving … ₹35841.29, from Shilpita Banerjee" worded as a renewal when a person was chasing outstanding dues.
// Root cause of (1): the Gmail metadata read dropped Gmail's labels and list headers, so a promotion looked like a person.
import assert from 'node:assert/strict'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture'
const ma = await import('../lib/email/mail-alerts')
const { scoreEmail } = await import('../lib/email/attention')
const now = Date.parse('2026-11-17T15:00:00+05:30')
const raw = (id: string, from: string, subject: string, snippet: string, extra: any = {}) => ({ id, threadId: 't' + id, from, subject, snippet, date: new Date(now - 3_600_000).toUTCString(), ...extra })
const kindOf = (m: any) => ma.alertKindOf(scoreEmail(ma.toAttentionEmail(m)! as any, { now }))

// (1) The marketing mail, as Gmail returns it: promotions label, unread.
const hsbc = raw('h1', 'HSBC Mutual Fund <mail@mail.mf.assetmanagement.hsbc.co.in>', 'Ready to Go from #MidSeMoreTak?', "Emailer Teaser_Investor DVC Emailer_Investor Dear Investor, Every business has a moment when it has earned its place in the market.", { labelIds: ['CATEGORY_PROMOTIONS', 'UNREAD', 'INBOX'] })
assert.equal(kindOf(hsbc), 'newsletter', 'a promotion is a newsletter (off by default), never a reply waiting')
assert.equal(ma.normalizeRules(null).kinds.newsletter, false)
// Even with no label at all, "Dear Investor" is a broadcast.
assert.equal(kindOf({ ...hsbc, labelIds: [] }), null, 'broadcast salutation is not a reply waiting')
// List headers alone are enough.
assert.notEqual(kindOf(raw('h2', 'Asha Rao <asha@fund.example>', 'A question for you?', 'Could you tell us what you think of the new fund?', { listUnsubscribe: '<mailto:unsub@fund.example>' })), 'reply_waiting')
assert.notEqual(kindOf(raw('h3', 'Asha Rao <asha@fund.example>', 'A question for you?', 'Could you tell us what you think of the new fund?', { precedence: 'bulk' })), 'reply_waiting')
// A real person's question still gets through, with or without Gmail's personal label, and "Dear Sir" from a person is not a broadcast.
for (const labelIds of [[], ['INBOX', 'CATEGORY_PERSONAL', 'UNREAD']])
  assert.equal(kindOf(raw('n1', 'Nithin K L <nithin@tipplr.in>', 'Updated catalogue sheet?', 'Could you share the updated catalogue sheet before our call today?', { labelIds })), 'reply_waiting')
assert.equal(kindOf(raw('n2', 'Divya <divya@example.com>', 'Agreement copy', 'Dear Sir, could you please send the signed agreement copy today?')), 'reply_waiting')
console.log('✓ a promotion or broadcast is never a reply waiting; a real question still is')

// (2) The dues follow-up, as received.
const dues = raw('d1', 'Shilpita Banerjee <shilpita.banerjee@wework.co.in>', 'Re: All Access Renewal - Here’s what to expect as your All Access membership renews (November 2026)', 'Hello Goverdhan, Good afternoon! This is a gentle follow-up regarding the outstanding dues of ₹35841.29. We request you to kindly prioritise clearing the payment at the earliest. Please note that if', { labelIds: ['UNREAD', 'IMPORTANT', 'CATEGORY_PERSONAL', 'INBOX'] })
const ds = scoreEmail(ma.toAttentionEmail(dues)! as any, { now })
assert.equal(ma.alertKindOf(ds), 'money_leaving')
const msg = ma.composeAlert('money_leaving', ds, { name: 'Goverdhan', now } as any)
assert.match(msg, /^💳 Money leaving\nGoverdhan, Shilpita Banerjee is following up on \*₹35841\.29\* in outstanding dues: "All Access Renewal/, msg)
assert.doesNotMatch(msg, /renews soon|renews\s+renews|, from Shilpita/, msg)
assert.match(msg, /can't tell whether you've already paid/, msg)
// A dues chase with no amount stays a person asking (a reply), not money.
assert.equal(kindOf(raw('d2', 'Shilpita Banerjee <shilpita.banerjee@wework.co.in>', 'Important: Update on Your AA Pass Payment', 'Hello, just checking in regarding the pending balance for your All access pass. Could you please confirm if the payment has been made?', { labelIds: ['INBOX', 'CATEGORY_PERSONAL'] })), 'reply_waiting')
// A true renewal notice keeps its wording.
const ren = scoreEmail(ma.toAttentionEmail(raw('r1', 'Shilpita Banerjee <shilpita@allaccess.example>', 'All Access Renewal - what to expect as your membership renews (November 2026)', 'Your All Access membership renews on 20 Nov 2026 for ₹35,841.29.'))! as any, { now })
assert.match(ma.composeAlert('money_leaving', ren, { now } as any), /renews on 20 Nov 2026 for \*₹35,841\.29\*, from Shilpita Banerjee/)
console.log('✓ a dues follow-up says what it is, with the amount; a real renewal notice is unchanged')

// Review findings (20 Nov): the dues wording must not depend on the mail being classed as a person,
// a list header must not silence it, and a broadcast salutation must not silence money or deadlines.
{
  const variants: any[] = [{ labelIds: ['INBOX', 'CATEGORY_UPDATES'] }, { listUnsubscribe: 'present' }, { from: 'WeWork Billing <billing@wework.example>' }]
  for (const v of variants) {
    const sc = scoreEmail(ma.toAttentionEmail({ ...dues, labelIds: [], ...v })! as any, { now })
    assert.equal(ma.alertKindOf(sc), 'money_leaving', JSON.stringify(v))
    const m = ma.composeAlert('money_leaving', sc, { now } as any)
    assert.match(m, /is following up on \*₹35841\.29\* in outstanding dues/, m); assert.doesNotMatch(m, /renews soon/, m)
  }
  // The long subject is cut at a word with an ellipsis, not mid-bracket.
  assert.match(msg, /membership renews…"\./, msg)
  // "Kindly confirm once the payment is made" is a dues chase, not a charge to confirm.
  const kc = scoreEmail(ma.toAttentionEmail(raw('d3', 'Asha Rao <asha@landlord.example>', 'Rent for November', 'The outstanding amount of ₹35841.29 is still open. Kindly confirm once the payment is made.'))! as any, { now })
  assert.match(ma.composeAlert('money_leaving', kc, { now } as any), /following up on \*₹35841\.29\* in outstanding dues/)
  // Not dues: a colleague asking whether to release a pending payment; someone promising to pay you.
  assert.equal(kindOf(raw('d4', 'Nithin K L <nithin@tipplr.in>', 'Printer payment', 'The pending payment of ₹12,000 to the printer, should I go ahead and release it today?')), 'reply_waiting')
  assert.notEqual(kindOf(raw('d5', 'Divya <divya@example.com>', 'Your invoice', 'We will clear your invoice and the pending amount of ₹50,000 will reach you by Friday.')), 'money_leaving')
  assert.equal(ma.isDuesChase('Flat 40% off, please shop now'), false)
  // "Dear Customer" does not silence a renewal or a deadline, and a friend quoting one mid-mail is still a person.
  assert.equal(kindOf(raw('b1', 'Asha Rao <asha@gym.example>', 'Your plan', 'Dear Customer, your plan renews on 25 Nov 2026 for ₹12,000.')), 'money_leaving')
  assert.equal(kindOf(raw('b2', 'Asha Rao <asha@fund.example>', 'A question for you?', 'Dear Member, this is a gentle follow-up regarding the outstanding dues of ₹35841.29. Kindly clear the payment.')), 'money_leaving')
  assert.equal(kindOf(raw('b3', 'Divya <divya@example.com>', 'Is this mail real?', 'Hi, hope you are doing well. I wanted your help with something that came in from my bank this morning and has been worrying me since then. It says Dear Customer, your account is blocked. Can you check if it is real?')), 'reply_waiting')
  assert.equal(kindOf(raw('b4', 'Rishi <rishi@ondc.example>', 'Provider sheet', 'Dear Partner, could you please share the pending provider sheet by tomorrow?')), 'reply_waiting')
  // A bulk sending address with no label, no list header and no salutation is still not a reply waiting; mail.com users are people.
  assert.equal(kindOf(raw('s1', 'HSBC Mutual Fund <mail@mail.mf.assetmanagement.hsbc.co.in>', 'Ready to Go?', 'Are you ready to invest?')), null)
  assert.equal(kindOf(raw('s2', 'Divya <divya@mail.com>', 'Goa dates?', 'Can you confirm the Goa dates?')), 'reply_waiting')
}
console.log('✓ dues wording holds in every category; broadcast and bulk-address checks only stop reply-waiting')

// The Gmail read keeps labels and list-header presence (run, not read as text).
{
  const g = await import('../lib/agent/google-workspace-read')
  const f = g.gmailClassifierFields({ labelIds: ['CATEGORY_PROMOTIONS', 'UNREAD'], payload: { headers: [{ name: 'list-unsubscribe', value: '<https://x.example/u?token=SECRETTOKEN>' }, { name: 'Precedence', value: 'bulk' }, { name: 'Auto-Submitted', value: 'auto-generated' }] } })
  assert.deepEqual(f, { labelIds: ['CATEGORY_PROMOTIONS', 'UNREAD'], listUnsubscribe: 'present', listId: null, precedence: 'bulk', autoSubmitted: 'auto-generated' })
  assert.ok(!JSON.stringify(f).includes('SECRETTOKEN'), 'the unsubscribe link itself is not kept')
  assert.deepEqual(g.gmailClassifierFields({}), { labelIds: [], listUnsubscribe: null, listId: null, precedence: null, autoSubmitted: null })
  const a = ma.toAttentionEmail({ id: 'x', from: 'a@b.co', ...f })!
  assert.deepEqual([a.labelIds, a.listUnsubscribe, a.precedence, a.autoSubmitted, a.isUnread], [['CATEGORY_PROMOTIONS', 'UNREAD'], 'present', 'bulk', 'auto-generated', true])
  const src = (await import('node:fs')).readFileSync(new URL('../lib/agent/google-workspace-read.ts', import.meta.url), 'utf8')
  for (const h of ['List-Unsubscribe', 'List-Id', 'Precedence', 'Auto-Submitted']) assert.ok(src.includes(`metadataHeaders=${h}`), h)
}
console.log('✓ the Gmail metadata read keeps labels and list-header presence')
