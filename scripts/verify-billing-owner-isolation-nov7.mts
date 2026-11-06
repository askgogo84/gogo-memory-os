// Synthetic billing-owner regressions. No Supabase access, Razorpay requests,
// checkout, actual account mutation, WhatsApp message or real user data.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  billingOwnerClaim, billingPhoneVariants, canonicalBillingPhone,
  exactBillingOwnerId, resolveBillingOwner, type BillingOwnerRow,
} from '../lib/services/billing-owner-identity.ts'

let checks = 0
async function check(name: string, task: () => Promise<void> | void) {
  await task()
  console.log('PASS billing-owner: ' + name)
  checks++
}

const domestic = '4155552671'
const ownerUS = '14155552671'
const otherCountry = '914155552671' // identical last ten digits; different owner

await check('complete international phone only; never domestic or fuzzy suffix', () => {
  assert.equal(canonicalBillingPhone('whatsapp:+14155552671'), ownerUS)
  assert.equal(canonicalBillingPhone('+1' + domestic), ownerUS)
  assert.equal(canonicalBillingPhone('+' + otherCountry), otherCountry)
  for (const unsafe of [domestic, 'whatsapp:' + domestic, '', '127.0.0.1', '+14155552671 OR true', '++14155552671']) {
    assert.equal(canonicalBillingPhone(unsafe), null)
  }
  assert.deepEqual(billingPhoneVariants(ownerUS), [
    'whatsapp:+' + ownerUS, '+' + ownerUS, 'whatsapp:' + ownerUS, ownerUS,
  ])
  assert.ok(!billingPhoneVariants(ownerUS).some(v => v.includes('%') || v.endsWith(domestic) && v.length === 10))
})

await check('owner BIGINT decimals preserved; unsafe JS numbers and tampering denied', () => {
  assert.equal(exactBillingOwnerId('9007199254740992'), '9007199254740992')
  assert.equal(exactBillingOwnerId('9007199254740993'), '9007199254740993')
  for (const unsafe of [9007199254740993, 1.2, '123,telegram_id.eq.7', '0', null, '', '-0']) {
    assert.equal(exactBillingOwnerId(unsafe), null)
  }
})

const owner: BillingOwnerRow = {
  telegram_id: '9007199254740993', whatsapp_id: 'whatsapp:+' + ownerUS, id: 'user-A',
}
const foreign: BillingOwnerRow = {
  telegram_id: '777', whatsapp_id: 'whatsapp:+' + otherCountry, id: 'user-B',
}

await check('first-authority lookup is exact owner; independent IDs must agree', async () => {
  const q = billingOwnerClaim({ phone: '+' + ownerUS, whatsappId: 'whatsapp:+' + ownerUS, telegramId: '9007199254740993' })
  assert.equal(q?.lookup.field, 'telegram_id')
  assert.equal((q?.lookup as {value:string})?.value, '9007199254740993')
  assert.equal(await resolveBillingOwner({ telegramId: '9007199254740993', phone: '+' + ownerUS }, async () => [owner]), '9007199254740993')
  assert.equal(await resolveBillingOwner({ telegramId: '9007199254740992', phone: '+' + ownerUS }, async () => [owner]), null)
  assert.equal(await resolveBillingOwner({ telegramId: '9007199254740993', phone: '+' + otherCountry }, async () => [owner]), null)
  assert.equal(await resolveBillingOwner({ telegramId: '9007199254740993', userId: 'user-B' }, async () => [owner]), null)
})

await check('cross-country last-ten collision cannot select the wrong billing owner', async () => {
  const match = async (query: ReturnType<typeof billingOwnerClaim>) => {
    assert.ok(query)
    assert.equal(query.lookup.field, 'whatsapp_id')
    const values = (query.lookup as {values:string[]}).values
    return [owner, foreign].filter(row => values.includes(String(row.whatsapp_id)))
  }
  assert.equal(await resolveBillingOwner({ phone: '+' + ownerUS }, match), owner.telegram_id)
  assert.equal(await resolveBillingOwner({ phone: '+' + otherCountry }, match), foreign.telegram_id)
  assert.equal(await resolveBillingOwner({ phone: domestic }, match), null)
})

await check('ambiguous rows, absent rows, lookup errors and malformed ownership fail closed', async () => {
  const who = { phone: '+' + ownerUS }
  assert.equal(await resolveBillingOwner(who, async () => [owner, { ...owner, telegram_id: '1234' }]), null)
  assert.equal(await resolveBillingOwner(who, async () => []), null)
  assert.equal(await resolveBillingOwner(who, async () => { throw new Error('db_unavailable') }), null)
  assert.equal(await resolveBillingOwner(who, async () => [{ ...owner, telegram_id: 9007199254740993 }]), null)
  assert.equal(await resolveBillingOwner(who, async () => [{ ...owner, whatsapp_id: 'whatsapp:+' + otherCountry }]), null)
  assert.equal(await resolveBillingOwner(who, async () => [null as any]), null)
})

await check('conflicting or injected billing metadata fails before service-role lookup', async () => {
  for (const input of [
    { phone: '+' + ownerUS, whatsappId: '+' + otherCountry },
    { telegramId: '7,foo', phone: '+' + ownerUS },
    { userId: 'a)or(user_id.eq.7', phone: '+' + ownerUS },
    { phone: domestic },
    {},
  ]) {
    let calls = 0
    assert.equal(await resolveBillingOwner(input, async () => { calls++; return [owner] }), null)
    assert.equal(calls, 0)
  }
})

await check('subscription reconciliation matches a single recorded subscription only', async () => {
  const single = { ...owner, razorpay_subscription_id: 'sub_Legacy0001' }
  assert.equal(await resolveBillingOwner({ subscriptionId: 'sub_Legacy0001' }, async q => {
    assert.equal(q.lookup.field, 'razorpay_subscription_id')
    return [single]
  }), '9007199254740993')
})

await check('original checkout and webhook enforce exact owner and confirmed single-row updates', () => {
  const checkout = readFileSync('app/api/subscription/create/route.ts', 'utf8')
  const webhook = readFileSync('app/api/payments/webhook/route.ts', 'utf8')
  assert.match(checkout, /\.in\('whatsapp_id', billingPhoneVariants\(phoneDigits\)\)/)
  assert.match(checkout, /ambiguous_billing_owner/)
  assert.match(checkout, /owner_lookup_unavailable/)
  assert.match(checkout, /telegramId: ownerId/)
  assert.doesNotMatch(checkout, /\.ilike\('whatsapp_id'/)
  assert.match(webhook, /resolveBillingOwner\(input, async claim =>/)
  assert.match(webhook, /\.eq\('telegram_id', ownerId\)\.select\('telegram_id'\)/)
  assert.match(webhook, /data\.length !== 1/)
  assert.match(webhook, /if \(!result\) return NextResponse\.json\(\{ ok: true, event, ignored: 'owner_unverified' \}\)/)
  assert.doesNotMatch(webhook, /last10|buildMatchClauses|\.or\(orClauses|\.ilike\(\*/)
})

console.log('PASS: ' + checks + ' inert billing owner-scope regressions; no real provider or account actions')
