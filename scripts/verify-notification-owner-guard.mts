// Conditional notification owner precision regression. Real shipped module is transpiled;
// all database, provider, and scheduler interfaces are inert test doubles. No network.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const source = readFileSync('lib/services/notification-delivery.ts', 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText

function fixture(owner: unknown) {
  const calls: string[] = []
  const module = { exports: {} as Record<string, any> }
  const deliveryRpc = async (name: string) => { calls.push('rpc:' + name); return true }
  const requireMock = (id: string): unknown => {
    if (id === 'node:crypto') return { randomUUID: () => '00000000-0000-4000-8000-000000000001' }
    if (id === './reminder-delivery') return { deliveryRpc }
    if (id === './delivery-state') return { isDefiniteProviderRejection: () => false }
    if (id === '@/lib/supabase-admin') return {
      supabaseAdmin: { from: () => { throw new Error('INERT_PRIVILEGED_DB_HALT') } },
    }
    throw new Error('Unexpected dependency: ' + id)
  }
  runInNewContext(compiled, {
    module, exports: module.exports, require: requireMock,
    Date, console, process: { env: {} },
    AbortSignal,
  }, { filename: 'lib/services/notification-delivery.ts' })
  assert.equal(typeof module.exports.deliverNotification, 'function', 'actual notification module loaded')
  const options = {
    key: 'synthetic-claim', source: 'briefing' as const, owner: owner as number,
    channel: 'whatsapp' as const, due: '2026-10-27T00:00:00.000Z',
    deadline: Date.now() + 120000,
    prepare: async () => { calls.push('prepare') },
    ready: async () => { calls.push('ready'); return true },
    send: async () => { calls.push('send'); return 'SM-synthetic-receipt' },
    accepted: async () => { calls.push('accepted') },
  }
  return { calls, deliver: module.exports.deliverNotification as (args: typeof options) => Promise<string>, options }
}

async function main() {
  const invalid: Array<[string, unknown]> = [
    ['rounded adjacent BIGINT account 9007199254740993', Number('9007199254740993')],
    ['negative unsafe signed64', -9007199254740992],
    ['string identity', '42'],
    ['zero owner', 0],
    ['fractional owner', 42.5],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['missing owner', undefined],
  ]
  for (const [label, owner] of invalid) {
    const f = fixture(owner)
    const status = await f.deliver(f.options)
    assert.equal(status, 'failed', label + ': ambiguous owner must fail closed')
    assert.equal(f.calls.length, 0, label + ': no private claim, prepare, send or receipt')
  }
  for (const owner of [42, -42]) {
    const f = fixture(owner)
    const status = await f.deliver(f.options)
    assert.equal(status, 'provider_accepted', 'safe signed owner keeps normal accepted path')
    assert.deepEqual(f.calls, [
      'rpc:claim_notification_delivery', 'prepare', 'ready', 'rpc:begin_notification_delivery',
      'send', 'rpc:finish_notification_delivery', 'rpc:reconcile_delivery_receipt', 'accepted',
    ], 'safe owner keeps bounded claim/send/receipt sequence')
  }
  const unknown = fixture(42)
  unknown.options.send = async () => { unknown.calls.push('send'); throw new Error('fixture_timeout_after_possible_send') }
  assert.equal(await unknown.deliver(unknown.options), 'outcome_unknown',
    'unknown outcome must never be represented as success or retried')
  assert.equal(unknown.calls.filter(x => x === 'send').length, 1, 'unknown outcome sent no duplicate')
  assert.equal(unknown.calls.filter(x => x === 'rpc:retry_notification_delivery').length, 0,
    'unknown outcome does not call retry')
  console.log('PASS notification owner guard: signed64/malformed owners fail before side effects; safe owners and no-retry semantics preserved')
}
await main()
