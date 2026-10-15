import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// 15 Oct WhatsApp pulse: "Reply to HDFC Bank InstaAlerts — Rs.2249.38 debited…" and the same JioFiber survey twice.
// Run: npx tsx scripts/verify-pulse-email-noise.mts
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture'
const { isAutomatedGmailMessage } = await import('../lib/agent/open-loops')
const read = (p: string) => readFileSync(new URL('../' + p, import.meta.url), 'utf8')

assert.equal(isAutomatedGmailMessage({ from: 'HDFC Bank InstaAlerts <alerts@hdfcbank.net>', subject: 'You have done a UPI txn', snippet: 'Dear Customer' }), true, 'bank alert sender')
assert.equal(isAutomatedGmailMessage({ from: 'HDFC Bank <hdfcbank@hdfcbank.com>', subject: 'Debit alert', snippet: 'Rs.2249.38 is debited from your HDFC Bank Debit Card ending 1712 at ANTHROPIC' }), true, 'debit alert text')
assert.equal(isAutomatedGmailMessage({ from: 'Team JioFiber <care@jio.com>', subject: 'Share your experience with JioFiber', snippet: 'Please take a minute' }), true, 'feedback survey')
assert.equal(isAutomatedGmailMessage({ from: 'Bank <x@bank.com>', subject: 'Your OTP', snippet: 'OTP is 123456' }), true, 'OTP mail')
assert.equal(isAutomatedGmailMessage({ from: 'Srini <srini@tipplr.in>', subject: 'Can you send the deck today?', snippet: 'Please share the updated deck before 5' }), false, 'a real person asking stays')
assert.equal(isAutomatedGmailMessage({ from: 'Rishi <rishi@ondc.org>', subject: 'Catalogue feedback needed', snippet: 'Can you review the items list?' }), false, 'a person asking for feedback stays')

const pulse = read('lib/agent/autonomy-pulse.ts')
assert.match(pulse, /const seenLines=new Set<string>\(\)/)
const watch = read('lib/agent/watch-command.ts')
assert.doesNotMatch(watch, /Persistent state now shows/)
assert.match(watch, /other watch\$\{remaining\.length===1\?' is':'es are'\} still running\./)
console.log('verify-pulse-email-noise: ok')
