// Verifies the belt-and-braces memory redaction that keeps secret-shaped rows out of
// the Claude system prompt. Run: npx tsx scripts/verify-memory-redaction.mts
//
// Imports the REAL shipped filter so test and prod can't drift. Models getMemories'
// post-fetch step: stripSecretShapedMemories over an in-memory row list.
import { isSecretShapedMemory, stripSecretShapedMemories, redactSecretShapedText } from '../lib/bot/memory-redaction'

let fails = 0
function check(label: string, cond: boolean) {
  if (!cond) fails++
  console.log(`  ${cond ? '✓' : '✗'}  ${label}`)
}

console.log('\nMemory redaction — secret-shaped rows excluded from the LLM prompt\n')

// Secret-shaped memories → excluded.
check('labelled password is secret', isSecretShapedMemory('my laptop password is hunter2'))
check('PIN is secret', isSecretShapedMemory('atm pin 4821'))
check('OTP is secret', isSecretShapedMemory('the otp was 903112'))
check('passport is secret', isSecretShapedMemory('passport number Z1234567'))
check('16-digit card (spaced) is secret', isSecretShapedMemory('card 4111 1111 1111 1111'))
check('long digit run is secret', isSecretShapedMemory('account 123456789'))

// Normal memories → retained.
check('plain preference is not secret', !isSecretShapedMemory('I prefer tea over coffee'))
check('short number is not secret', !isSecretShapedMemory('remind me at 9 am, flat 502'))
check('name/fact is not secret', !isSecretShapedMemory('my dog is called Bruno'))

// End-to-end filter over a mixed list: only the normal rows survive, order preserved.
const rows = [
  'I prefer tea over coffee',
  'my gmail password is swordfish',
  'my dog is called Bruno',
  'card 4111 1111 1111 1111',
]
const kept = stripSecretShapedMemories(rows)
check('mixed list keeps exactly the 2 normal rows', kept.length === 2)
check('kept = [tea, Bruno] in order', kept[0] === 'I prefer tea over coffee' && kept[1] === 'my dog is called Bruno')

// Exact production regression: 34398485 was redacted as a sensitive identifier,
// turning the saved comparison into a broken /comparisons/[sensitive URL.
const report = 'https://app.askgogo.in/dashboard/comparisons/34398485-8a78-44ad-80ae-6016efbdf15c'
check('generated comparison UUID link remains clickable', redactSecretShapedText(`Saved comparison: ${report}`) === `Saved comparison: ${report}`)
const activity = report.replace('/comparisons/', '/activity/') + '/browser'
check('same-task browser UUID link retained', redactSecretShapedText(`[Open task](${activity})`) === `[Open task](${activity})`)
const mixedReport = redactSecretShapedText(`123456789\n${report}`)
check('sensitive number beside a report stays hidden', !mixedReport.includes('123456789') && mixedReport.includes('[sensitive detail withheld]') && mixedReport.includes(report))
for (const url of [report.replace('app.askgogo.in','app.askgogo.in.evil.test'),report+'?token=123456789',report+'#123456789',report.replace('/comparisons/','/other/')])
  check('unsupported/secret-bearing URL gets no exemption', redactSecretShapedText(url).includes('[sensitive detail withheld]'))
check('labelled password still redacted', !redactSecretShapedText('password: hunter2').includes('hunter2'))

// 3 Nov (Gogo): phone numbers must be visible so Gogo can call a salon or a restaurant. Shown when written as a phone
// (+country code, or right after a phone word); card, account and Aadhaar shapes stay hidden.
{
  const { isPhoneNumber } = await import('../lib/bot/memory-redaction')
  const shown = (t: string, n: string) => check(`phone visible: ${t}`, redactSecretShapedText(t).includes(n) && !redactSecretShapedText(t).includes('withheld'))
  shown('Rajajinagar, Bengaluru, Tel No : 08023103567 Share On', '08023103567')
  shown('Call us on +91 98450 12345 for bookings', '+91 98450 12345')
  shown('Phone: 080-2310-3567', '080-2310-3567')
  shown('Contact: 9845012345', '9845012345')
  shown('WhatsApp 98450 12345', '98450 12345')
  shown('Reach us at +971 4 123 4567', '+971 4 123 4567')
  check('phone memory is not treated as secret', !isSecretShapedMemory('Naturals salon phone number is 080 2310 3567'))
  check('labelled account number still hidden', !redactSecretShapedText('account number 98450123456').includes('98450123456'))
  check('labelled card number still hidden', !redactSecretShapedText('card number 4111 1111 1111 1111').includes('4111'))
  check('unlabelled long number still hidden', !redactSecretShapedText('ref 4111111111111111 for you').includes('4111111111111111'))
  check('Aadhaar-shaped unlabelled number still hidden', !redactSecretShapedText('my id 2345 6789 0123').includes('2345 6789 0123'))
  check('account memory still secret', isSecretShapedMemory('my account is 98450123456789'))
  check('a phone word far before the number does not count', !redactSecretShapedText('I lost my phone yesterday and the order id was 123456789012 and that is it').includes('123456789012'))
  check('isPhoneNumber rejects 16-digit runs even with a label', !isPhoneNumber('4111111111111111', 'Phone: '))
}

// 4 Nov independent P2 privacy regression (#1254 review): unlabeled 0-prefixed 12-digit
// account-like groups are not Indian STD landlines. Never pass them into freeform LLM memory.
{
  const { isPhoneNumber } = await import('../lib/bot/memory-redaction')
  const accountLike = 'acct 0123 4567 8901' // synthetic identifier, not customer data
  check('unlabelled 12-digit account-like grouping is not a phone',
    !isPhoneNumber('0123 4567 8901', 'acct '))
  check('unlabelled 12-digit account-like grouping redacted in text',
    !redactSecretShapedText(accountLike).includes('0123 4567 8901')
      && redactSecretShapedText(accountLike).includes('[sensitive detail withheld]'))
  check('unlabelled 12-digit account-like grouping excluded from LLM memories',
    isSecretShapedMemory(accountLike))
  check('valid unlabelled 11-digit STD landline stays visible',
    redactSecretShapedText('Envi Salon · 080 4123 4567 · 4.5').includes('080 4123 4567'))
  check('valid unlabelled 11-digit STD landline stays eligible as memory',
    !isSecretShapedMemory('Envi Salon · 080 4123 4567 · 4.5'))
  check('explicitly labelled international mobile remains visible',
    redactSecretShapedText('Call us on +91 98450 12345').includes('+91 98450 12345'))
}

console.log(`\n${fails === 0 ? '✅ all cases passed' : `❌ ${fails} case(s) failed`}\n`)
process.exit(fails === 0 ? 0 : 1)
