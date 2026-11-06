// P1 original-module regression: no WhatsApp billing link or entitlement claim from
// a similar phone number, an unverified sender owner, or a failed database lookup.
// INERT: fake Supabase and Razorpay; no customer data, secrets, HTTP or provider sends.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const path = 'lib/bot/handlers/plan-checkout.ts'
const source = readFileSync(path, 'utf8')
const transpiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
let cases = 0
let failures = 0

const owner = 10101
const national = '9123456789'
const correctPhone = 'whatsapp:+91' + national
const collidingPhone = 'whatsapp:+1' + national
const ownRow = {
  telegram_id: owner, whatsapp_id: correctPhone, tier: 'free',
  tier_expires_at: null, subscription_status: null,
}
const paidRow = { ...ownRow, tier: 'pro', subscription_status: 'active' }

function sandbox(rows: any[], mode: 'ok' | 'error' | 'throw' = 'ok') {
  let providerCalls = 0
  let reads = 0
  let exactQueries = 0
  const db = {
    from(table: string) {
      assert.equal(table, 'users')
      reads++
      let matched = [...rows]
      const q = {
        select(_fields: string) { return this },
        eq(field: string, value: unknown) {
          assert.equal(field, 'telegram_id', 'billing must select only one exact persisted owner')
          assert.equal(String(value), String(owner))
          exactQueries++
          matched = matched.filter(r => String(r.telegram_id) === String(value))
          return this
        },
        or() { throw Error('Fuzzy OR identity authorization forbidden') },
        ilike() { throw Error('Fuzzy phone lookup forbidden') },
        maybeSingle() {
          if (mode === 'throw') throw Error('db_timeout')
          if (mode === 'error') return Promise.resolve({ data: null, error: { code: 'PGRST116' } })
          return Promise.resolve(matched.length === 1
            ? { data: matched[0], error: null }
            : matched.length === 0
              ? { data: null, error: null }
              : { data: null, error: { code: 'PGRST116', message: 'ambiguous rows' } })
        },
      }
      return q
    },
  }
  const exports: Record<string, any> = {}
  const fakeProvider = async () => {
    providerCalls++
    return { subscriptionId: 'sub-synthetic', shortUrl: 'https://rzp.io/l/synthetic', status: 'created' }
  }
  runInNewContext(transpiled, {
    exports,
    require: (id: string) => {
      if (id === '@/lib/supabase-admin') return { supabaseAdmin: db }
      if (id === '@/lib/services/razorpay-subscriptions') return { createSubscription: fakeProvider }
      throw Error('Unexpected import: ' + id)
    },
    console: { error: () => {} },
    process: { env: { RAZORPAY_TRIAL_DAYS: '7' } },
  }, { timeout: 3000, filename: 'inert-original-plan-checkout.js' })
  return {
    reply: (user: any = { telegramId: owner, whatsappId: correctPhone, name: 'Synthetic' }) =>
      exports.buildPlanCheckoutReply(user, 'plus') as Promise<string>,
    stats: () => ({ providerCalls, reads, exactQueries }),
  }
}

async function check(name: string, fn: () => Promise<void>) {
  try { await fn(); cases++; console.log('PASS', name) }
  catch (e: any) { failures++; console.error('FAIL', name, e?.message || e) }
}
function blocked(text: string) {
  assert.match(text, /couldn't verify/i)
  assert.match(text, /No subscription link was created/i)
}
await check('valid full international number and persisted owner can request checkout', async () => {
  const h = sandbox([ownRow])
  assert.match(await h.reply(), /rzp\.io\/l\/synthetic/)
  assert.deepEqual(h.stats(), { providerCalls: 1, reads: 1, exactQueries: 1 })
})
await check('same last ten digits from a different country never owns this checkout', async () => {
  const h = sandbox([{ ...paidRow, telegram_id: 90001, whatsapp_id: collidingPhone }])
  blocked(await h.reply())
  assert.equal(h.stats().providerCalls, 0)
})
await check('a foreign paid owner cannot make this free owner appear subscribed', async () => {
  const h = sandbox([ownRow, { ...paidRow, telegram_id: 90001, whatsapp_id: collidingPhone }])
  assert.match(await h.reply(), /rzp\.io\/l\/synthetic/)
  assert.equal(h.stats().providerCalls, 1)
})
await check('active paid plan is reported only for the verified owner', async () => {
  const h = sandbox([paidRow])
  assert.match(await h.reply(), /already on an active Gogo plan/i)
  assert.equal(h.stats().providerCalls, 0)
})
await check('expired paid plan is eligible for verified renewal', async () => {
  const h = sandbox([{ ...paidRow, tier_expires_at: '2000-01-01T00:00:00Z' }])
  assert.match(await h.reply(), /rzp\.io\/l\/synthetic/)
  assert.equal(h.stats().providerCalls, 1)
})
await check('stored owner mismatch cannot create a provider subscription', async () => {
  const h = sandbox([{ ...ownRow, telegram_id: 90001 }])
  blocked(await h.reply())
  assert.equal(h.stats().providerCalls, 0)
})
await check('saved phone mismatch fails before provider write', async () => {
  const h = sandbox([{ ...ownRow, whatsapp_id: collidingPhone }])
  blocked(await h.reply())
  assert.equal(h.stats().providerCalls, 0)
})
await check('no persisted owner prevents a Razorpay operation', async () => {
  const h = sandbox([])
  blocked(await h.reply())
  assert.equal(h.stats().providerCalls, 0)
})
await check('DB read error does not become unverified checkout permission', async () => {
  const h = sandbox([ownRow], 'error')
  blocked(await h.reply())
  assert.equal(h.stats().providerCalls, 0)
})
await check('DB transport throw does not become unverified checkout permission', async () => {
  const h = sandbox([ownRow], 'throw')
  blocked(await h.reply())
  assert.equal(h.stats().providerCalls, 0)
})
await check('ambiguous duplicate matching owner rows fail closed', async () => {
  const h = sandbox([ownRow, { ...paidRow }])
  blocked(await h.reply())
  assert.equal(h.stats().providerCalls, 0)
})
await check('ten-digit local-only sender fails before any database read', async () => {
  const h = sandbox([ownRow])
  blocked(await h.reply({ telegramId: owner, whatsappId: national, name: 'Synthetic' }))
  assert.deepEqual(h.stats(), { providerCalls: 0, reads: 0, exactQueries: 0 })
})
await check('unsafe owner numbers cannot bind payment before any database read', async () => {
  const h = sandbox([ownRow])
  blocked(await h.reply({ telegramId: Number.MAX_SAFE_INTEGER + 2, whatsappId: correctPhone, name: 'Synthetic' }))
  assert.deepEqual(h.stats(), { providerCalls: 0, reads: 0, exactQueries: 0 })
})
await check('full international saved WhatsApp variants link only exact owner', async () => {
  const h = sandbox([{ ...ownRow, whatsapp_id: '+91' + national }])
  assert.match(await h.reply(), /rzp\.io\/l\/synthetic/)
  assert.equal(h.stats().providerCalls, 1)
})
await check('invalid stored billing expiry is not treated as safe checkout authorization', async () => {
  const h = sandbox([{ ...ownRow, tier_expires_at: 'not-a-date' }])
  blocked(await h.reply())
  assert.equal(h.stats().providerCalls, 0)
})
await check('source has no suffix, OR or fuzzy phone authorization', async () => {
  assert.match(source, /\.eq\('telegram_id', owner\)/)
  assert.doesNotMatch(source, /\.ilike\(|\.or\(|slice\(-10\)/)
  assert.match(source, /if \(error \|\| !row\) return 'blocked'/)
  assert.match(source, /checkoutStatus === 'blocked'/)
})
console.log('Original-module billing checkout owner isolation:', cases, 'passed', failures, 'failed')
if (failures) process.exitCode = 1
