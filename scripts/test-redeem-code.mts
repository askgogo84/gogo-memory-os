// Local, DB-free unit test for the redeem-code pure logic. Runs against the REAL
// shipped normalizeCode (imported), plus replicas of the module-private
// generateCode and the route's clientIp so we can assert their behaviour without
// a live Supabase or a session. Run: npx tsx scripts/test-redeem-code.ts
//
// Dummy Supabase env so importing lib/dashboard/session.ts (which constructs a
// client at module load) doesn't throw. No query is ever issued here.
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://dummy.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'dummy-key'

import { randomBytes } from 'crypto'
// Dynamic import AFTER the env assignment above — a static import is hoisted and
// would construct the Supabase client before the dummy env is set.
const { normalizeCode } = await import('../lib/dashboard/session')

let pass = 0
let fail = 0
function ok(name: string, cond: boolean) {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}`) }
}

// ── 1. normalizeCode: identical on issue and redeem, folds correctly ──────────
console.log('normalizeCode')
ok('strips hyphen: ABCD-EFGH == ABCDEFGH', normalizeCode('ABCD-EFGH') === normalizeCode('ABCDEFGH'))
ok('lowercases', normalizeCode('abcd-efgh') === 'ABCDEFGH')
ok('strips internal + edge whitespace', normalizeCode('  ab cd ef gh  ') === 'ABCDEFGH')
ok('folds I->1', normalizeCode('I') === '1')
ok('folds L->1', normalizeCode('L') === '1')
ok('folds O->0', normalizeCode('O') === '0')
ok('folds lowercase l->1 and o->0', normalizeCode('lo') === '10')
ok('idempotent (normalize twice == once)', normalizeCode(normalizeCode('iLoU-2b')) === normalizeCode('iLoU-2b'))
// The realistic round trip: a user retypes the displayed code with a typo'd O/I.
ok('typo O for 0 still matches a code containing 0', normalizeCode('0ABC-DEFG') === normalizeCode('OABC-DEFG'))

// ── 2. generateCode replica: Crockford alphabet, length, unbiased mapping ──────
console.log('generateCode (replica of module-private logic)')
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
function generateCode(): string {
  const bytes = randomBytes(8)
  let code = ''
  for (let i = 0; i < 8; i++) code += CROCKFORD[bytes[i] % 32]
  return code
}
ok('256 % 32 === 0 (byte % 32 is unbiased)', 256 % 32 === 0)
ok('alphabet excludes I L O U', !/[ILOU]/.test(CROCKFORD))
let allValid = true
let allEight = true
let selfNormalizes = true
for (let i = 0; i < 5000; i++) {
  const c = generateCode()
  if (c.length !== 8) allEight = false
  if (!/^[0-9A-HJKMNP-TV-Z]{8}$/.test(c)) allValid = false
  // A generated code is already uppercase and I/L/O-free, so normalizing the
  // bare code must be a no-op — the issue side hashes normalizeCode(code).
  if (normalizeCode(c) !== c) selfNormalizes = false
}
ok('5000 codes are all length 8', allEight)
ok('5000 codes use only Crockford chars', allValid)
ok('generated code normalizes to itself (issue-side no-op)', selfNormalizes)

// ── 3. clientIp replica: prefers x-real-ip, falls back to LAST xff, never [0] ──
console.log('clientIp (replica of route logic)')
function clientIp(h: Record<string, string>): string {
  const real = h['x-real-ip']?.trim()
  if (real) return real
  const xff = h['x-forwarded-for']
  if (xff) {
    const parts = xff.split(',')
    return parts[parts.length - 1].trim()
  }
  return ''
}
ok('prefers x-real-ip over xff', clientIp({ 'x-real-ip': '9.9.9.9', 'x-forwarded-for': '1.1.1.1, 2.2.2.2' }) === '9.9.9.9')
ok('spoofed leading xff entry is IGNORED (takes last)', clientIp({ 'x-forwarded-for': '6.6.6.6, 203.0.113.7' }) === '203.0.113.7')
ok('single xff value works', clientIp({ 'x-forwarded-for': '203.0.113.7' }) === '203.0.113.7')
ok('attacker cannot pin a bucket via leading xff', clientIp({ 'x-forwarded-for': 'attacker-set, 203.0.113.7' }) !== 'attacker-set')
ok('no headers -> empty (folds to shared bucket, not per-request)', clientIp({}) === '')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
