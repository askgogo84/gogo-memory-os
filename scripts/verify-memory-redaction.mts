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

console.log(`\n${fails === 0 ? '✅ all cases passed' : `❌ ${fails} case(s) failed`}\n`)
process.exit(fails === 0 ? 0 : 1)
