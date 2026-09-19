// Verifies the pure waitlist validator. Run: npx tsx scripts/verify-waitlist-validate.mts
// Imports the REAL shipped module so test and prod can't drift. No env, no network.
import { validateWaitlist } from '../lib/waitlist/validate'

const CONSENT_VERSION = '2026-09-19' // must equal the server constant in lib/waitlist/validate.ts

let fails = 0
function check(label: string, cond: boolean) {
  if (!cond) fails++
  console.log(`  ${cond ? '✓' : '✗'}  ${label}`)
}
const base = { country: 'IN', phone: '9876543210', email: 'a@b.co', whatsapp_opt_in: false, source: 'header', company: '' }
const ok = (b: object) => { const r = validateWaitlist(b); return 'row' in r ? r.row : null }
const errs = (b: object) => { const r = validateWaitlist(b); return 'errors' in r ? r.errors : null }

console.log('\nWaitlist validator\n')

check('valid IN → +919876543210', ok(base)?.phone_e164 === '+919876543210')
check('valid AE → +971501234567', ok({ ...base, country: 'AE', phone: '501234567' })?.phone_e164 === '+971501234567')
check('IN starting 5 rejected', !!errs({ ...base, phone: '5876543210' })?.phone)
check('IN 9 digits rejected', !!errs({ ...base, phone: '987654321' })?.phone)
check('AE 8 digits rejected', !!errs({ ...base, country: 'AE', phone: '50123456' })?.phone)
check('AE not starting 5 rejected', !!errs({ ...base, country: 'AE', phone: '401234567' })?.phone)
check('IN with spaces/dashes/+91 prefix normalised', ok({ ...base, phone: '+91 98765-43210' })?.phone_e164 === '+919876543210')
check('IN with leading 0 normalised', ok({ ...base, phone: '09876543210' })?.phone_e164 === '+919876543210')
check('AE with +971 and leading 0 variants', ok({ ...base, country: 'AE', phone: '+971 50 123 4567' })?.phone_e164 === '+971501234567' && ok({ ...base, country: 'AE', phone: '0501234567' })?.phone_e164 === '+971501234567')
check('bad email rejected', !!errs({ ...base, email: 'not-an-email' })?.email)
check('empty email rejected', !!errs({ ...base, email: '  ' })?.email)
check('email >254 chars rejected', !!errs({ ...base, email: 'a'.repeat(250) + '@b.co' })?.email)
check('uppercase + spaced email normalised', ok({ ...base, email: '  Person@Example.COM ' })?.email === 'person@example.com')
check('unknown country rejected', !!errs({ ...base, country: 'US' })?.country)
check('bad source → askgogo.in:unknown', ok({ ...base, source: 'Evil Source!' })?.source === 'askgogo.in:unknown')
check('good source → askgogo.in:hero', ok({ ...base, source: 'hero' })?.source === 'askgogo.in:hero')
check('opt-in only for strict true', ok({ ...base, whatsapp_opt_in: 'true' })?.whatsapp_opt_in === false && ok({ ...base, whatsapp_opt_in: true })?.whatsapp_opt_in === true)
check('consent_version is server constant, client ignored', ok({ ...base, consent_version: '1999-01-01' })?.consent_version === CONSENT_VERSION)
const hp = validateWaitlist({ ...base, company: 'Acme bot', phone: 'garbage' })
check('honeypot filled → ok, no row, even with bad fields', hp.ok === true && hp.honeypot === true)
check('non-object body → errors', validateWaitlist(null).ok === false)
const both = errs({ ...base, phone: '1', email: 'x' })
check('phone and email errors reported together', !!both?.phone && !!both?.email)

console.log(`\n${fails === 0 ? '✅ all cases passed' : `❌ ${fails} case(s) failed`}\n`)
process.exit(fails === 0 ? 0 : 1)
