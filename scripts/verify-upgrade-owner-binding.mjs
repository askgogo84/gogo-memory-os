// Inert runtime test of the actual async UpgradePage TSX component.
// No network, database, Razorpay, payments, real account or provider operation.
import fs from 'node:fs'
import assert from 'node:assert/strict'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const source = fs.readFileSync('app/upgrade/page.tsx', 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
  },
}).outputText

const plans = Object.fromEntries(['essential', 'plus', 'pro'].map((name) => [
  name,
  { name: 'Synthetic ' + name, positioning: 'Synthetic plan', priceInrMonthly: 499, highlights: ['test-only'] },
]))

function setup(sessionId, row, options = {}) {
  const calls = []
  const jsx = (type, props) => ({ type, props: props || {} })
  const mod = { exports: {} }
  const client = {
    from(table) {
      assert.equal(table, 'users')
      calls.push({ method: 'from', table })
      return {
        select(columns) {
          assert.match(columns, /telegram_id/)
          calls.push({ method: 'select', columns })
          return this
        },
        eq(column, value) {
          assert.equal(column, 'telegram_id')
          assert.equal(typeof value, 'string', 'BIGINT predicate must be exact decimal text')
          calls.push({ method: 'eq', column, value })
          return this
        },
        async single() {
          calls.push({ method: 'single' })
          if (options.throwDb) throw Error('synthetic db unavailable')
          return { data: row, error: options.dbError ? { message: 'synthetic failure' } : null }
        },
      }
    },
  }
  const requireMock = (name) => {
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'fragment' }
    if (name === '@/lib/supabase-admin') return { supabaseAdmin: client }
    if (name === '@/lib/dashboard/session') return { getSession: async () => sessionId == null ? null : { telegramId: sessionId } }
    if (name === '@/lib/product-urls') return { waLink: () => 'https://wa.me/test-only' }
    if (name === '@/lib/pricing/gogo-plans') return { GOGO_INDIA_PLANS: plans }
    throw Error('Unexpected dependency: ' + name)
  }
  runInNewContext(compiled, { exports: mod.exports, module: mod, require: requireMock, console }, { timeout: 2000 })
  return {
    calls,
    async render() {
      return mod.exports.default({ searchParams: Promise.resolve({ plan: 'plus' }) })
    },
  }
}

function links(tree) {
  const out = []
  const visit = (item) => {
    if (Array.isArray(item)) return item.forEach(visit)
    if (!item || typeof item !== 'object') return
    if (item.type === 'a' && typeof item.props?.href === 'string') out.push(item.props.href)
    visit(item.props?.children)
  }
  visit(tree)
  return out
}

async function test(name, sessionId, row, expected) {
  const fixture = setup(sessionId, row, expected || {})
  const all = links(await fixture.render())
  const checkout = all.filter((url) => url.startsWith('/pay?'))
  assert.equal(checkout.length, expected?.allowCheckout ? 1 : 0, name + ' checkout-link gate')
  assert.equal(
    fixture.calls.filter((c) => c.method === 'from').length,
    expected?.readOwner ? 1 : 0,
    name + ' service-role query gate',
  )
  if (expected?.readOwner) {
    assert.equal(fixture.calls.find((c) => c.method === 'eq')?.value, sessionId, name + ' exact owner query')
  }
  if (expected?.allowCheckout) {
    assert.match(checkout[0], /^\/pay\?plan=plus&phone=%2B15550102020$/, name)
  } else {
    assert.ok(!all.some((url) => url.includes('15550102020')), name + ' leaked another owner phone')
  }
}

const phoneRow = (telegram_id) => ({ telegram_id, whatsapp_id: 'whatsapp:+15550102020', phone: null })

for (const owner of [null, '', '0', '-0', '000123', '123junk', ' 123', '+123', '123.0',
  '9223372036854775808', '-9223372036854775809']) {
  await test('invalid/absent session ' + String(owner), owner, phoneRow('123'), { readOwner: false })
}

await test('positive safe owner numeric row', '123', phoneRow(123), { readOwner: true, allowCheckout: true })
await test('negative safe WhatsApp owner numeric row', '-123', phoneRow(-123), { readOwner: true, allowCheckout: true })
await test('safe owner exact decimal string row', '123', phoneRow('123'), { readOwner: true, allowCheckout: true })
await test('large owner with lossless DB string', '9007199254740993', phoneRow('9007199254740993'),
  { readOwner: true, allowCheckout: true })
await test('adjacent BIGINT alias (wrong persisted owner)', '9007199254740993',
  phoneRow('9007199254740992'), { readOwner: true })
await test('DB returned rounded unsafe number', '9007199254740992',
  phoneRow(9007199254740992), { readOwner: true })
await test('DB returned rounded adjacent unsafe number', '9007199254740993',
  phoneRow(Number('9007199254740993')), { readOwner: true })
await test('mismatched safe owner row', '123', phoneRow('124'), { readOwner: true })
await test('missing persisted owner proof', '123',
  { whatsapp_id: 'whatsapp:+15550102020' }, { readOwner: true })
await test('null row', '123', null, { readOwner: true })
await test('DB select error', '123', phoneRow(123), { readOwner: true, dbError: true })
await test('DB throws', '123', phoneRow(123), { readOwner: true, throwDb: true })

console.log('Upgrade owner-bound phone/checkout prefill: actual component inert regression PASS')
