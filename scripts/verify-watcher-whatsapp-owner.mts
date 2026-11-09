// Synthetic, original-function regression. No provider, database, account or send is contacted.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const source = readFileSync('lib/agent/watchers.ts', 'utf8')
const start = source.indexOf('async function sendWhatsAppIfWanted(')
const end = source.indexOf('\nfunction searchFingerprint(', start)
assert.ok(start !== -1 && end > start, 'locate actual production watcher WhatsApp sender')
const original = source.slice(start, end)
const compiled = ts.transpileModule(
  original + '\n;(globalThis as any).__sendWatcherWhatsApp = sendWhatsAppIfWanted;',
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText

type Row = { telegram_id: string | number; whatsapp_id: string | null }
const people = new Map<string, Row>([
  ['42', { telegram_id: '42', whatsapp_id: '+15550000042' }],
  ['-15550000004', { telegram_id: '-15550000004', whatsapp_id: '+15550000004' }],
  ['9007199254740992', { telegram_id: '9007199254740992', whatsapp_id: '+15550000002' }],
  ['9007199254740993', { telegram_id: '9007199254740993', whatsapp_id: '+15550000003' }],
])
type Config = { override?: Row | null; fail?: boolean; sendFails?: boolean }
function harness(config: Config = {}) {
  const queries: Array<{ column: string; owner: unknown; columns: string }> = []
  const sends: Array<{ phone: string; message: string }> = []
  const costs: unknown[] = []
  const supabaseAdmin = {
    from(table: string) {
      assert.equal(table, 'users', 'do not read another account table')
      return {
        select(columns: string) {
          return {
            eq(column: string, owner: unknown) {
              queries.push({ column, owner, columns })
              return {
                async maybeSingle() {
                  return {
                    data: Object.hasOwn(config, 'override') ? config.override : people.get(String(owner)) ?? null,
                    error: config.fail ? { message: 'fixture_owner_lookup_failed' } : null,
                  }
                },
              }
            },
          }
        },
      }
    },
  }
  const scope: any = {
    supabaseAdmin,
    sendWhatsAppMessage: async (phone: string, message: string) => {
      sends.push({ phone, message })
      if (config.sendFails) throw new Error('synthetic_provider_failure')
    },
    recordCostEvent: async (evt: unknown) => { costs.push(evt) },
    console,
  }
  runInNewContext(compiled, scope, { timeout: 2500 })
  const send = scope.__sendWatcherWhatsApp as (owner: unknown, delivery: string, message: string) => Promise<void>
  assert.equal(typeof send, 'function', 'exercise original production function, not reimplementation')
  return { send, queries, sends, costs }
}

const simple = harness()
await simple.send('42', 'both', 'private alert for 42')
assert.deepEqual(simple.queries.map(q => [q.column, q.owner, q.columns]), [['telegram_id', '42', 'telegram_id, whatsapp_id']])
assert.deepEqual(simple.sends, [{ phone: '+15550000042', message: 'private alert for 42' }])
assert.equal(simple.costs.length, 1)
console.log('PASS safe owner: exact lookup, matching echo, one send and cost')

const neg = harness()
await neg.send('-15550000004', 'whatsapp', 'private alert for negative owner')
assert.equal(neg.queries[0]?.owner, '-15550000004')
assert.equal(neg.sends[0]?.phone, '+15550000004')
console.log('PASS negative WhatsApp owner is preserved exactly')

const collided = harness()
await collided.send('9007199254740993', 'whatsapp', 'private high-bit owner alert')
assert.equal(collided.queries[0]?.owner, '9007199254740993', 'must not round to 9007199254740992')
assert.equal(collided.sends[0]?.phone, '+15550000003', 'must not send to adjacent owner')
assert.equal(collided.costs.length, 1)
console.log('PASS 64-bit collision chooses exact intended recipient')

for (const [label, owner] of [
  ['unsafe JS number', 9007199254740993],
  ['exponent identity', '9.007199254740993e15'],
  ['leading zero', '042'],
  ['malformed decimals', '42.0'],
  ['negative zero', '-0'],
  ['out of range positive BIGINT', '9223372036854775808'],
  ['out of range negative BIGINT', '-9223372036854775809'],
  ['empty owner', ''],
  ['injected SQL pattern', '42%'],
] as [string, unknown][]) {
  const h = harness()
  await h.send(owner, 'whatsapp', label)
  assert.equal(h.queries.length, 0, label + ': no owner DB read permitted')
  assert.equal(h.sends.length, 0, label + ': no provider send permitted')
  assert.equal(h.costs.length, 0, label + ': no cost event')
  console.log('PASS invalid owner fails closed: ' + label)
}

const appOnly = harness()
await appOnly.send('42', 'app', 'no WhatsApp for app delivery')
assert.equal(appOnly.queries.length, 0)
assert.equal(appOnly.sends.length, 0)
console.log('PASS app-only delivery does not read or send')

for (const [label, config] of [
  ['different owner echo', { override: { telegram_id: '9007199254740992', whatsapp_id: '+15550000002' } }],
  ['unsafe rounded owner echo', { override: { telegram_id: Number('9007199254740993'), whatsapp_id: '+15550000002' } }],
  ['missing owner echo', { override: { telegram_id: '' as string, whatsapp_id: '+15550000003' } }],
  ['missing phone', { override: { telegram_id: '9007199254740993', whatsapp_id: null } }],
  ['no matching row', { override: null }],
] as [string, Config][]) {
  const h = harness(config)
  await h.send('9007199254740993', 'whatsapp', label)
  assert.equal(h.queries[0]?.owner, '9007199254740993')
  assert.equal(h.sends.length, 0, label + ': must not send')
  assert.equal(h.costs.length, 0, label + ': must not count a send')
  console.log('PASS owner-bound no-send: ' + label)
}

const dbFailure = harness({ fail: true })
await assert.rejects(dbFailure.send('42', 'whatsapp', 'failed lookup'), /watch_alert_owner_lookup_failed/)
assert.equal(dbFailure.sends.length, 0)
assert.equal(dbFailure.costs.length, 0)
console.log('PASS database error fails closed without egress')

const providerFailure = harness({ sendFails: true })
await assert.rejects(providerFailure.send('42', 'whatsapp', 'unknown send'), /synthetic_provider_failure/)
assert.equal(providerFailure.costs.length, 0, 'unknown send cannot book accepted delivery/cost')
console.log('PASS failed/unknown sender call cannot claim cost accounting')
console.log('watcher WhatsApp exact owner: all original-function synthetic regressions passed')
