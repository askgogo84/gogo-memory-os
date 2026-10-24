// P1 regression: service-role Make authorization may NEVER link by a 9/10-digit suffix.
// Inert tests: no DB, browser, credentials, or production user content.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { authorizedLinkedOwnerIds, canonicalInternationalPhone, exactOwnerDecimalId, phoneRowCandidates } from '../lib/dashboard/owner-link.ts'

let checks = 0
function check(name: string, fn: () => void) {
  fn(); checks++; console.log('PASS ' + name)
}

check('normalization preserves country code across explicit saved variants', () => {
  const full = '14155552671'
  assert.equal(canonicalInternationalPhone('whatsapp:+14155552671'), full)
  assert.equal(canonicalInternationalPhone('+1 (415) 555-2671'), full)
  assert.equal(canonicalInternationalPhone('14155552671'), full)
  assert.equal(canonicalInternationalPhone('whatsapp:+914155552671'), '914155552671')
  assert.equal(canonicalInternationalPhone('4155552671'), null) // no assumed country
  assert.equal(canonicalInternationalPhone('whatsapp:+12345'), null)
  assert.equal(canonicalInternationalPhone('+14155552671; attacker'), null)
  assert.equal(canonicalInternationalPhone(null), null)
})

check('same last TEN digits, different country, never gain document access', () => {
  const ids = authorizedLinkedOwnerIds('1001', 'whatsapp:+14155552671', [
    { telegram_id: 2002, whatsapp_id: 'whatsapp:+914155552671' },
    { telegram_id: 3003, whatsapp_id: '+14155552671' },
    { telegram_id: 4004, whatsapp_id: '14155552671' },
  ])
  assert.deepEqual(ids, ['1001', '3003', '4004'])
  assert.deepEqual(authorizedLinkedOwnerIds('2002', 'whatsapp:+914155552671', [
    { telegram_id: 1001, whatsapp_id: '+14155552671' },
  ]), ['2002'])
})

check('same last NINE digits never synthesize cross-user negative fallback', () => {
  const one = authorizedLinkedOwnerIds('110', '+919123456789', [
    { telegram_id: 220, whatsapp_id: '+918123456789' },
    { telegram_id: null, whatsapp_id: 'whatsapp:+919123456789' },
  ])
  assert.deepEqual(one, ['110'])
  assert.ok(!one.includes('-123456789'))
  assert.deepEqual(authorizedLinkedOwnerIds('220', '+918123456789', [
    { telegram_id: 110, whatsapp_id: '+919123456789' },
  ]), ['220'])
})

check('unverified/null/unparseable IDs never join the authorization list', () => {
  assert.deepEqual(authorizedLinkedOwnerIds('111', '919876543210', [
    { telegram_id: null, whatsapp_id: 'whatsapp:+919876543210' },
    { telegram_id: 'undefined', whatsapp_id: '+919876543210' },
    { telegram_id: 0, whatsapp_id: '+919876543210' },
    { telegram_id: -987654321, whatsapp_id: '+919876543210' },
  ]), ['111', '-987654321']) // only actual persisted ID row, not a generated suffix
  assert.deepEqual(authorizedLinkedOwnerIds('111', '9876543210', [
    { telegram_id: 222, whatsapp_id: 'whatsapp:+919876543210' },
  ]), ['111'])
  assert.deepEqual(authorizedLinkedOwnerIds('111', null, [
    { telegram_id: 222, whatsapp_id: 'whatsapp:+919876543210' },
  ]), ['111'])
})

check('legacy IDs with leading zeros are not guessed from telephone suffixes', () => {
  assert.deepEqual(authorizedLinkedOwnerIds('12', '+919012345678', [
    { telegram_id: null, whatsapp_id: '+919012345678' },
    { telegram_id: -12345678, whatsapp_id: '+918012345678' },
  ]), ['12'])
})

check('database lookup uses full identities, not suffix searches', () => {
  assert.deepEqual(phoneRowCandidates('919876543210'), [
    'whatsapp:+919876543210', '+919876543210', '919876543210', 'whatsapp:919876543210',
  ])
  const source = readFileSync('lib/dashboard/owner-ids.ts', 'utf8')
  assert.match(source, /phoneRowCandidates\(full\)/)
  assert.match(source, /if \(ownerError \|\| !me\) return \[own\]/)
  assert.match(source, /if \(linkError \|\| !Array\.isArray\(rows\)\) return \[own\]/)
  assert.ok(!source.includes('.ilike('), 'suffix wildcard lookup must not authorize')
  assert.ok(!source.includes('slice(-9)'), 'never derive an owner from last nine digits')
  assert.ok(!source.includes('slice(-10)'), 'never derive an owner from last ten digits')
})

check('P1: 64-bit owner ids are exact decimals, never rounded or inferred', () => {
  const a = '9007199254740992'
  const b = '9007199254740993'
  assert.equal(Number(a), Number(b), 'pre-fix Number conversion aliases distinct persisted owner IDs')
  assert.equal(exactOwnerDecimalId(a), a)
  assert.equal(exactOwnerDecimalId(b), b)
  assert.equal(exactOwnerDecimalId(Number(b)), null, 'rounded unsafe JS numbers cannot authorize')
  assert.equal(exactOwnerDecimalId(null), null)
  assert.equal(exactOwnerDecimalId(0), null)
  assert.equal(exactOwnerDecimalId('00012'), null)
  assert.deepEqual(authorizedLinkedOwnerIds('111', '+14155552671', [
    { telegram_id: Number(b), whatsapp_id: '+14155552671' },
    { telegram_id: b, whatsapp_id: '+14155552671' },
    { telegram_id: a, whatsapp_id: '+914155552671' },
  ]), ['111', b], 'unsafe rounded row rejected, exact intended owner remains')
  assert.deepEqual(authorizedLinkedOwnerIds(Number(b), '+14155552671', [
    { telegram_id: 222, whatsapp_id: '+14155552671' },
  ]), [], 'invalid session owner fails completely closed')
  const source = readFileSync('lib/dashboard/owner-ids.ts', 'utf8')
  assert.match(source, /\.eq\('telegram_id', own\)/, 'service role query must bind the precise decimal owner')
  assert.doesNotMatch(source, /Number\(own\)/, 'never coerce large owner IDs into JS Number')
  assert.match(source, /exactOwnerDecimalId\(sessionTelegramId\)/, 'validate ID before owner query')
})

console.log(`Make owner isolation: ${checks} groups passed`)
