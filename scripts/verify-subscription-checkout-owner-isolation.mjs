// Inert actual-route/handler subscription owner-isolation regression.
// No provider, database, webhook, account, network, or payment traffic.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const state = { rows: [], failure: false, reads: [], provider: [] }
function reset(rows = [], failure = false) {
  state.rows = rows
  state.failure = failure
  state.reads = []
  state.provider = []
}
const database = {
  from(table) {
    assert.equal(table, 'users', 'subscription checks may only read users')
    const predicates = []
    let max = 100
    const query = {
      select(fields) { state.reads.push({ kind: 'select', fields }); return query },
      eq(column, value) {
        state.reads.push({ kind: 'eq', column, value })
        predicates.push(row => row[column] === value)
        return query
      },
      in(column, values) {
        assert.ok(Array.isArray(values), 'exact phone forms supplied explicitly')
        state.reads.push({ kind: 'in', column, values: [...values] })
        predicates.push(row => values.includes(row[column]))
        return query
      },
      limit(count) { max = count; return query },
      ilike() { throw new Error('unsafe_suffix_matching_in_checkout') },
      or() { throw new Error('unsafe_cross_owner_OR_in_checkout') },
      then(resolve, reject) {
        const data = state.rows.filter(row => predicates.every(predicate => predicate(row))).slice(0, max)
        const reply = state.failure
          ? { data: null, error: { message: 'synthetic database outage' } }
          : { data, error: null }
        return Promise.resolve(reply).then(resolve, reject)
      },
    }
    return query
  },
}
const subscription = async options => {
  state.provider.push({ ...options })
  return {
    planKey: options.planKey,
    entitlement: 'pro',
    subscriptionId: 'sub_synthetic_no_payment',
    shortUrl: 'https://example.invalid/synthetic-only',
    status: 'created',
  }
}

function actualModule(path, imports) {
  const source = readFileSync(new URL('../' + path, import.meta.url), 'utf8')
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const result = {}
  runInNewContext(code, {
    exports: result,
    require(name) {
      assert.ok(Object.hasOwn(imports, name), 'unexpected imported dependency: ' + name)
      return imports[name]
    },
    process: { env: { RAZORPAY_TRIAL_DAYS: '7' } },
    URL,
    Date,
    console: { error() {}, warn() {}, log() {} },
    fetch() { throw new Error('network forbidden in synthetic verification') },
  }, { filename: path, timeout: 2000 })
  return result
}

const dependencies = {
  '@/lib/supabase-admin': { supabaseAdmin: database },
  '@/lib/services/razorpay-subscriptions': { createSubscription: subscription },
}
const route = actualModule('app/api/subscription/create/route.ts', {
  ...dependencies,
  'next/server': {
    NextResponse: { json(body, init) { return { status: init?.status || 200, body } } },
  },
})
const bot = actualModule('lib/bot/handlers/plan-checkout.ts', dependencies)
assert.equal(typeof route.POST, 'function', 'real compiled POST must run')
assert.equal(typeof bot.buildPlanCheckoutReply, 'function', 'real compiled plan handler must run')

function checkoutRequest(body, origin = 'https://app.askgogo.in') {
  return {
    headers: { get(key) { return key.toLowerCase() === 'origin' ? origin : null } },
    nextUrl: new URL('https://app.askgogo.in/api/subscription/create'),
    json: async () => body,
  }
}
const india = '+914155552671'
const otherCountry = '+14155552671'
const inactive = (phone, telegramId = 101) => ({
  whatsapp_id: phone, telegram_id: telegramId, name: 'Synthetic User',
  subscription_status: 'inactive', tier: 'free', tier_expires_at: null,
})
const active = (phone, telegramId = 202) => ({
  ...inactive(phone, telegramId), subscription_status: 'active',
  tier: 'pro', tier_expires_at: null,
})
let checked = 0
async function check(name, fn) {
  reset()
  await fn()
  checked++
  console.log('PASS subscription owner isolation: ' + name)
}

await check('public checkout cannot inherit unrelated cross-country paid owner', async () => {
  state.rows = [active(otherCountry, 909), inactive('whatsapp:' + india, 101)]
  const response = await route.POST(checkoutRequest({ phone: india, plan: 'plus' }))
  assert.equal(response.status, 200)
  assert.equal(state.provider.length, 1, 'provider is only an inert stub')
  assert.equal(state.provider[0].phone, india)
  assert.equal(state.provider[0].whatsappId, india)
  assert.equal(state.provider[0].telegramId, null, 'public phone is NOT proof of stored owner')
  assert.equal(state.provider[0].name, 'AskGogo User', 'no owner name copied from DB')
  const exactQuery = state.reads.find(call => call.kind === 'in')
  assert.equal(exactQuery.column, 'whatsapp_id')
  assert.ok(exactQuery.values.includes('whatsapp:' + india))
  assert.ok(!exactQuery.values.includes(otherCountry), 'foreign same-last-ten excluded')
  assert.ok(!state.reads.some(call => call.kind === 'eq' && call.column === 'telegram_id'))
})
await check('public exact-phone active subscription blocks duplicate checkout', async () => {
  state.rows = [active('whatsapp:' + india)]
  const reply = await route.POST(checkoutRequest({ phone: india, plan: 'pro' }))
  assert.equal(reply.status, 409)
  assert.equal(reply.body.error, 'already_subscribed')
  assert.equal(state.provider.length, 0)
})
await check('public account-status database outage fails closed without payment provider', async () => {
  state.failure = true
  const reply = await route.POST(checkoutRequest({ phone: india, plan: 'plus' }))
  assert.equal(reply.status, 503)
  assert.equal(reply.body.error, 'checkout_unavailable')
  assert.equal(state.provider.length, 0)
})
await check('public truncated duplicate account lookup fails closed', async () => {
  state.rows = Array.from({ length: 25 }, (_, i) => inactive(india, i + 1))
  const reply = await route.POST(checkoutRequest({ phone: india, plan: 'plus' }))
  assert.equal(reply.status, 503)
  assert.equal(state.provider.length, 0)
})
await check('public invalid origin, plan and phone do not read DB or create mandate', async () => {
  let result = await route.POST(checkoutRequest({ phone: india, plan: 'plus' }, 'https://evil.example'))
  assert.equal(result.status, 403)
  result = await route.POST(checkoutRequest({ phone: india, plan: 'bogus' }))
  assert.equal(result.status, 400)
  result = await route.POST(checkoutRequest({ phone: 'x', plan: 'plus' }))
  assert.equal(result.status, 400)
  assert.equal(state.reads.length, 0)
  assert.equal(state.provider.length, 0)
})
await check('public explicit +65 ten-digit E.164 is not rewritten to India or foreign owner', async () => {
  const singapore = '+6591234567'
  const foreignCollision = '+916591234567'
  state.rows = [active('whatsapp:' + foreignCollision, 909)]
  const response = await route.POST(checkoutRequest({ phone: '+65 9123 4567', plan: 'plus' }))
  assert.equal(response.status, 200)
  assert.equal(state.provider.length, 1)
  assert.equal(state.provider[0].phone, singapore, 'explicit country code must survive')
  assert.equal(state.provider[0].whatsappId, singapore)
  assert.equal(state.provider[0].telegramId, null)
  const exact = state.reads.find(call => call.kind === 'in')
  assert.ok(exact.values.includes('whatsapp:' + singapore))
  assert.ok(!exact.values.includes('whatsapp:' + foreignCollision))
})
await check('public invalid explicit country number fails closed before provider and DB', async () => {
  for (const phone of ['+1234567', 'xyz+6591234567', '+65foo91234567']) {
    const response = await route.POST(checkoutRequest({ phone, plan: 'plus' }))
    assert.equal(response.status, 400, phone)
  }
  assert.equal(state.provider.length, 0)
  assert.equal(state.reads.length, 0)
})
await check('WhatsApp actor is never falsely marked active by a foreign same-last-ten owner', async () => {
  state.rows = [inactive('whatsapp:' + india, -111), active(otherCountry, 909)]
  const message = await bot.buildPlanCheckoutReply({
    telegramId: -111, whatsappId: 'whatsapp:' + india, name: 'Synthetic Caller',
  }, 'plus')
  assert.match(message, /example\.invalid\/synthetic-only/)
  assert.equal(state.provider.length, 1, 'synthetic payment stub only')
  assert.equal(state.provider[0].telegramId, -111, 'trusted inbound actor unchanged')
  assert.ok(state.reads.some(call => call.kind === 'eq' && call.column === 'telegram_id' && call.value === -111))
  assert.ok(state.reads.some(call => call.kind === 'in' && call.values.includes('whatsapp:' + india)))
  assert.ok(!state.reads.some(call => call.kind === 'in' && call.values.includes(otherCountry)))
})
await check('WhatsApp exact-country active cross-channel row prevents duplicate mandate', async () => {
  state.rows = [active(india, 800)]
  const message = await bot.buildPlanCheckoutReply({
    telegramId: -111, whatsappId: 'whatsapp:' + india, name: 'Synthetic Caller',
  }, 'plus')
  assert.match(message, /already on an active Gogo plan/)
  assert.equal(state.provider.length, 0)
})
await check('WhatsApp owner status outage cannot fall through to billing', async () => {
  state.failure = true
  const message = await bot.buildPlanCheckoutReply({
    telegramId: -111, whatsappId: 'whatsapp:' + india, name: 'Synthetic Caller',
  }, 'plus')
  assert.match(message, /couldn't verify your current Gogo plan/)
  assert.equal(state.provider.length, 0)
})
await check('WhatsApp unsafe 64-bit numeric owner cannot alias a second account', async () => {
  const message = await bot.buildPlanCheckoutReply({
    telegramId: Number.MAX_SAFE_INTEGER + 100, whatsappId: 'whatsapp:' + india, name: 'Synthetic Caller',
  }, 'plus')
  assert.match(message, /couldn't verify your current Gogo plan/)
  assert.equal(state.reads.length, 0)
  assert.equal(state.provider.length, 0)
})
await check('WhatsApp +65 ten-digit E.164 is accepted without colliding with Indian owner', async () => {
  const singapore = '+6591234567'
  const foreignCollision = '+916591234567'
  state.rows = [active('whatsapp:' + foreignCollision, 919)]
  const message = await bot.buildPlanCheckoutReply({
    telegramId: -111, whatsappId: 'whatsapp:' + singapore, name: 'Synthetic Caller',
  }, 'plus')
  assert.ok(message.includes('https://example.invalid/synthetic-only'))
  assert.equal(state.provider.length, 1)
  assert.equal(state.provider[0].whatsappId, 'whatsapp:' + singapore)
  const exact = state.reads.find(call => call.kind === 'in')
  assert.ok(exact.values.includes('whatsapp:' + singapore))
  assert.ok(!exact.values.includes('whatsapp:' + foreignCollision))
})
await check('WhatsApp unprefixed short country digits remain ambiguous and deny billing', async () => {
  const message = await bot.buildPlanCheckoutReply({
    telegramId: -111, whatsappId: '6591234567', name: 'Synthetic Caller',
  }, 'plus')
  assert.match(message, /full international WhatsApp number/)
  assert.equal(state.provider.length, 0)
})
await check('WhatsApp local-only ambiguous number cannot create subscription', async () => {
  const message = await bot.buildPlanCheckoutReply({
    telegramId: -111, whatsappId: '4155552671', name: 'Synthetic Caller',
  }, 'plus')
  assert.match(message, /full international WhatsApp number/)
  assert.equal(state.provider.length, 0)
})

console.log('subscription owner isolation: ' + checked + ' actual-module synthetic assertions PASS; zero external calls')
