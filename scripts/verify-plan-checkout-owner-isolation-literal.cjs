// Literal-original-function, inert regression for checkout's exact owner entitlement boundary.
// No real Supabase, Razorpay, WhatsApp, credentials, or network calls.
'use strict'
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const ts = require('typescript')

const source = readFileSync('lib/bot/handlers/plan-checkout.ts', 'utf8')
const start = source.indexOf('async function hasActiveSubscription(')
assert.ok(start >= 0, 'production status function exists')
const actualFunctions = source.slice(start)
assert.match(actualFunctions, /export async function buildPlanCheckoutReply/, 'production reply function exists')
const transpiled = ts.transpileModule(
  "const PLAN_LABELS = { essential: 'Gogo Essential', plus: 'Gogo Plus', pro: 'Gogo Pro' };\n" + actualFunctions,
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }
).outputText

const ownerFree = {
  telegram_id: 101,
  whatsapp_id: 'whatsapp:+14155550123',
  tier: 'free',
  tier_expires_at: null,
  subscription_status: 'inactive',
}
const foreignPaid = {
  telegram_id: 202,
  whatsapp_id: 'whatsapp:+914155550123', // Same final 10 digits as ownerFree.
  tier: 'pro',
  tier_expires_at: null,
  subscription_status: 'active',
}

function mockScenario({
  rows = [ownerFree, foreignPaid],
  readError = null,
  missingData = false,
  throwRead = false,
} = {}) {
  const queries = []
  const created = []
  const logs = []
  const supabaseAdmin = {
    from(table) {
      assert.equal(table, 'users', 'status lookup must be users-only')
      let ownerId = null
      let oldOr = null
      return {
        select(cols) {
          queries.push(['select', cols])
          return this
        },
        eq(col, id) {
          queries.push(['eq', col, id])
          if (col === 'telegram_id') ownerId = id
          return this
        },
        or(expr) {
          queries.push(['or', expr])
          oldOr = expr
          return this
        },
        limit(n) {
          queries.push(['limit', n])
          if (throwRead) throw new Error('synthetic db unavailable')
          if (missingData) return Promise.resolve({ data: null, error: null })
          let result
          if (oldOr) {
            const m = String(oldOr).match(/telegram_id\.eq\.(-?\d+)/)
            const suffix = String(oldOr).match(/whatsapp_id\.ilike\.\*([^*,]+)\*/)
            result = rows.filter(row =>
              (m && String(row.telegram_id) === m[1]) ||
              (suffix && row.whatsapp_id.includes(suffix[1])))
          } else if (ownerId !== null) {
            result = rows.filter(row => String(row.telegram_id) === String(ownerId))
          } else {
            result = rows
          }
          return Promise.resolve({ data: result.slice(0, n), error: readError })
        },
      }
    },
  }
  const createSubscription = async args => {
    created.push(args)
    return { shortUrl: 'https://synthetic.invalid/mock-setup', planKey: args.planKey }
  }
  const exports = {}
  const fakeProcess = { env: { RAZORPAY_TRIAL_DAYS: '0' } }
  const fakeConsole = { error: (...args) => logs.push(args) }
  const fn = new Function(
    'supabaseAdmin', 'createSubscription', 'exports', 'process', 'console',
    transpiled + '\nreturn exports.buildPlanCheckoutReply'
  )(supabaseAdmin, createSubscription, exports, fakeProcess, fakeConsole)
  assert.equal(typeof fn, 'function', 'executes original exported function')
  return { reply: fn, created, queries, logs }
}

async function check(name, fn) {
  await fn()
  console.log('PASS ' + name)
}

const freeActor = { telegramId: 101, whatsappId: ownerFree.whatsapp_id, name: 'Owner One' }
const paidActor = { telegramId: 202, whatsappId: foreignPaid.whatsapp_id, name: 'Owner Two' }

async function main() {
  await check('cross-country suffix collision never supplies another owners paid entitlement', async () => {
    const h = mockScenario()
    const reply = await h.reply(freeActor, 'plus')
    assert.match(reply, /setup link/i, 'free caller must get its own checkout path')
    assert.equal(h.created.length, 1)
    assert.equal(h.created[0].telegramId, 101)
    assert.ok(h.queries.some(q => q[0] === 'eq' && q[1] === 'telegram_id' && q[2] === 101))
    assert.ok(!h.queries.some(q => q[0] === 'or'), 'no phone suffix OR')
  })
  await check('genuinely paid exact owner remains on the existing plan', async () => {
    const h = mockScenario()
    const reply = await h.reply(paidActor, 'pro')
    assert.match(reply, /already on an active Gogo plan/)
    assert.equal(h.created.length, 0, 'do not make duplicate checkout')
  })
  await check('database read error fails closed without any checkout creation', async () => {
    const h = mockScenario({ readError: { message: 'synthetic database error' } })
    const reply = await h.reply(freeActor, 'essential')
    assert.match(reply, /couldn't verify your current subscription status/i)
    assert.equal(h.created.length, 0)
  })
  await check('unknown null status fails closed rather than assuming no subscription', async () => {
    const h = mockScenario({ missingData: true })
    const reply = await h.reply(freeActor, 'plus')
    assert.match(reply, /couldn't verify/i)
    assert.equal(h.created.length, 0)
  })
  await check('thrown read fails closed without external provider call', async () => {
    const h = mockScenario({ throwRead: true })
    assert.match(await h.reply(freeActor, 'plus'), /couldn't verify/i)
    assert.equal(h.created.length, 0)
  })
  await check('unsafe 64-bit numeric owner and zero owner never reach a private query', async () => {
    for (const telegramId of [0, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN, 1.5]) {
      const h = mockScenario()
      assert.match(await h.reply({ ...freeActor, telegramId }, 'plus'), /couldn't verify/i)
      assert.equal(h.queries.length, 0)
      assert.equal(h.created.length, 0)
    }
  })
  await check('ambiguous duplicated same-owner rows block duplicate checkout', async () => {
    const h = mockScenario({ rows: [ownerFree, { ...ownerFree }] })
    assert.match(await h.reply(freeActor, 'plus'), /couldn't verify/i)
    assert.equal(h.created.length, 0)
  })
  await check('verified zero-owner-row result remains compatible with new checkout', async () => {
    const h = mockScenario({ rows: [] })
    assert.match(await h.reply(freeActor, 'plus'), /setup link/i)
    assert.equal(h.created.length, 1)
  })
  await check('only expired genuine same-owner subscription can proceed', async () => {
    const h = mockScenario({ rows: [{ ...foreignPaid, telegram_id: 101, whatsapp_id: ownerFree.whatsapp_id, tier_expires_at: '2020-01-01T00:00:00Z' }] })
    assert.match(await h.reply(freeActor, 'plus'), /setup link/i)
    assert.equal(h.created.length, 1)
  })
  await check('active owner check does not depend on phone suffix or phone presence', async () => {
    const h = mockScenario()
    assert.match(await h.reply({ ...paidActor, whatsappId: null }, 'plus'), /already on an active Gogo plan/)
    assert.equal(h.created.length, 0)
  })
  console.log('plan-checkout exact-owner original-function regression: all 10 cases passed')
}

main().catch(err => { console.error(err); process.exitCode = 1 })
