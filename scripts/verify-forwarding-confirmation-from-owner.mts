// Inert original-module regression: never calls a provider, database, or customer account.
import assert from 'node:assert/strict'
import { gmailForwardingConfirmation, parseMail } from '../lib/email/mime'

const subject = '(#482917365) Gmail Forwarding Confirmation - Receive Mail from owner@example.test'
const body = 'Confirmation code: 482917365\nhttps://mail-settings.google.com/mail/vf-fixture'
const expected = {
  code: '482917365',
  forwarder: 'owner@example.test',
  link: 'https://mail-settings.google.com/mail/vf-fixture',
}
const raw = (from: string) => [
  'From: ' + from,
  'To: fixture-k7q2mx@in.askgogo.in',
  'Subject: ' + subject,
  'Content-Type: text/plain; charset=utf-8',
  '',
  body,
].join('\r\n')
const check = (label: string, from: string, accepted: boolean) => {
  const mail = parseMail(raw(from))
  const result = gmailForwardingConfirmation(mail)
  if (accepted) assert.deepEqual(result, expected, label)
  else assert.equal(result, null, label)
  console.log('PASS ' + label)
}

check('bare exact Google mailbox remains supported', 'forwarding-noreply@google.com', true)
check('normal Gmail Team display label remains supported', 'Gmail Team <forwarding-noreply@google.com>', true)
check('case-insensitive true mailbox remains supported', 'Gmail Team <FORWARDING-NOREPLY@GOOGLE.COM>', true)
check('quoted benign display label remains supported', '"Gmail Team" <forwarding-noreply@google.com>', true)

check('P2: exact Gmail mailbox in a quoted display name does not authorize attacker mailbox', '"forwarding-noreply@google.com" <attacker@example.test>', false)
check('P2: bare Google email in display followed by attacker mailbox is rejected', 'forwarding-noreply@google.com <attacker@example.test>', false)
check('P2: encoded-word display name containing Gmail mailbox does not authorize attacker mailbox',
  '=?UTF-8?B?' + Buffer.from('forwarding-noreply@google.com').toString('base64') + '?= <attacker@example.test>', false)
check('P2: attacker mailbox with Google-looking substring is rejected', 'forwarding-noreply@google.com.attacker.test', false)
check('P2: another Google mailbox cannot impersonate the forwarding sender', 'Google <other@google.com>', false)
check('P2: multiple From recipients are not accepted', 'evil@example.test, forwarding-noreply@google.com', false)
check('P2: comma after real Google From is not accepted', 'Google <forwarding-noreply@google.com>, <evil@example.test>', false)
check('P2: mailbox in display before another Google mailbox is rejected', '"attacker@example.test" <forwarding-noreply@google.com>', false)

assert.equal(gmailForwardingConfirmation({
  from: 'forwarding-noreply@google.com\r\nX-Injected: value', subject, text: body,
}), null, 'header injection cannot make a forwarding confirmation')
assert.equal(gmailForwardingConfirmation({
  from: 'Gmail Team <forwarding-noreply@google.com>', subject: 'Your order shipped', text: body,
}), null, 'non-confirmation subject must still fail')
assert.equal(gmailForwardingConfirmation({
  from: 'Gmail Team <forwarding-noreply@google.com>', subject, text: 'No code or link',
}), null, 'missing confirmation evidence must still fail')
console.log('forwarding confirmation sender binding: all inert original-module checks passed')
