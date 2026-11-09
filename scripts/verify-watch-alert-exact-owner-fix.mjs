// Original-source fictional two-owner regression. No real database/provider/network actions.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const deliverySource = readFileSync('lib/services/notification-delivery.ts', 'utf8')
const watchSource = readFileSync('lib/agent/watch-alert-delivery.ts', 'utf8')
let benign = 0, mandatory = 0
function originalTs(source, imports) {
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: 'original.ts', reportDiagnostics: true,
  })
  assert.equal(js.diagnostics?.filter(d => d.category === ts.DiagnosticCategory.Error).length || 0, 0)
  const module = { exports: {} }
  vm.runInNewContext(js.outputText, {
    exports: module.exports, module, Date, BigInt, Number,
    require: id => {
      if (Object.hasOwn(imports, id)) return imports[id]
      throw new Error('Unapproved dependency: ' + id)
    }, console: { error() {}, log() {} },
  }, { timeout: 5000 })
  return module.exports
}
const highA = '9007199254740992', highB = '9007199254740993'
assert.equal(Number(highA), Number(highB), 'fixture must reproduce JavaScript precision collision')
const phones = new Map([[highA, '+15550001001'], [highB, '+15550001002'],
  ['-2251799813685249', '+15550001003'], ['42', '+15550001004']])
const calls = { db: [], rpc: [], prefs: [], sends: [], cost: [] }
let state = null, throwOnSend = false, allMuted = false
function reset() {
  for (const v of Object.values(calls)) v.length = 0
  state = null; throwOnSend = false; allMuted = false
}
const fakeDb = {
  from(table) {
    const filters = []
    const q = {
      select() { return q },
      eq(field, value) { filters.push([field, value]); return q },
      async maybeSingle() {
        calls.db.push({ table, filters: [...filters] })
        const lookup = field => filters.find(([k]) => k === field)?.[1]
        if (table === 'users') {
          const phone = phones.get(lookup('telegram_id'))
          return { data: phone ? { whatsapp_id: phone } : null, error: null }
        }
        if (table === 'agent_watchers') return { data: phones.has(lookup('telegram_id')) &&
          lookup('id') === 'fixture-watch' ? { active: true, condition_json: { source: 'flight' } } : null, error: null }
        if (table === 'notification_deliveries') return {
          data: state ? { state, provider_id: state === 'provider_accepted' ? 'SM-fixture' : null } : null, error: null,
        }
        throw new Error('Unexpected table ' + table)
      },
    }
    return q
  },
}
const delivery = originalTs(deliverySource, {
  'node:crypto': require('node:crypto'),
  './reminder-delivery': { deliveryRpc: async (name, args) => {
    calls.rpc.push({ name, args })
    if (name === 'finish_notification_delivery') { state = args.p_state; return true }
    if (['claim_notification_delivery', 'begin_notification_delivery', 'reconcile_delivery_receipt'].includes(name)) return true
    throw new Error('Unexpected RPC ' + name)
  } },
  './delivery-state': { isDefiniteProviderRejection: () => false },
  '@/lib/supabase-admin': { supabaseAdmin: fakeDb },
})
const watch = originalTs(watchSource, {
  '@/lib/supabase-admin': { supabaseAdmin: fakeDb },
  '@/lib/whatsapp': { sendWhatsApp: async (phone, message, media, token) => {
    calls.sends.push({ phone, message, media, token })
    if (throwOnSend) throw new Error('fictional_network_ack_lost')
    return { sid: 'SM-fixture' }
  } },
  '@/lib/services/cost-guard': { recordCostEvent: async entry => { calls.cost.push(entry) } },
  '@/lib/services/notification-delivery': delivery,
  './alert-preferences': { getAlertPreferences: async owner => {
    calls.prefs.push(owner)
    return { topics: { watches: !allMuted } }
  } },
})
const request = owner => ({
  watcherId: 'fixture-watch', owner, key: 'flight-alert/fixture/landed',
  due: '2026-11-03T00:00:00.000Z', message: 'Fictional flight landed',
  condition: { source: 'flight' }, topic: 'watches',
})
for (const owner of [highA, highB, '-2251799813685249', '42']) {
  reset()
  const result = await watch.deliverWatchAlert(request(owner))
  assert.equal(result.accepted, true)
  assert.equal(result.state, 'provider_accepted')
  assert.equal(calls.sends.length, 1)
  assert.equal(calls.sends[0].phone, phones.get(owner), 'cross-account routing forbidden')
  assert.deepEqual(calls.prefs, [owner])
  for (const [table, column] of [['users', 'telegram_id'], ['agent_watchers', 'telegram_id'],
    ['notification_deliveries', 'owner_id']]) {
    assert.ok(calls.db.some(c => c.table === table && c.filters.some(([k, v]) => k === column && v === owner)),
      table + ' must bind the full owner identifier')
  }
  assert.equal(calls.rpc.find(c => c.name === 'claim_notification_delivery').args.p_owner, owner)
  assert.equal(calls.cost.length, 1)
  benign++
}
reset()
for (const [input, expected] of [[-42, '-42'], [42, '42'], ['-9223372036854775808', '-9223372036854775808'],
  ['9223372036854775807', '9223372036854775807']]) assert.equal(delivery.exactNotificationOwnerId(input), expected)
benign++
reset(); allMuted = true
const muted = await watch.deliverWatchAlert(request('42'))
assert.equal(muted.state, 'app_only')
assert.equal(calls.sends.length, 0); assert.equal(calls.rpc.length, 0)
benign++
for (const bad of [Number(highB), Number(highA), 1.5, 0, '0', '00042', '-0', '+42',
  '42.0', 'invalid', ' 42', '9223372036854775808', '-9223372036854775809']) {
  reset()
  await assert.rejects(() => watch.deliverWatchAlert(request(bad)), /notification_owner_invalid/)
  assert.equal(calls.db.length, 0)
  assert.equal(calls.rpc.length, 0)
  assert.equal(calls.prefs.length, 0)
  assert.equal(calls.sends.length, 0)
  mandatory++
}
for (const bad of [Number(highB), 0, '0001', '9223372036854775808']) {
  reset()
  await assert.rejects(() => delivery.deliverNotification({
    key: 'fixture', source: 'watch_alert', owner: bad, channel: 'whatsapp',
    due: '2026-11-03T00:00:00.000Z', deadline: Date.now() + 60000,
    prepare: async () => { throw Error('must not prepare') },
    ready: async () => true, send: async () => { throw Error('must not send') },
  }), /notification_owner_invalid/)
  assert.equal(calls.rpc.length, 0)
  mandatory++
}
reset(); throwOnSend = true
const unknown = await watch.deliverWatchAlert(request(highA))
assert.equal(unknown.accepted, false)
assert.equal(unknown.state, 'outcome_unknown')
assert.equal(calls.sends.length, 1)
assert.ok(!calls.rpc.some(c => c.name === 'retry_notification_delivery'))
assert.ok(!calls.rpc.some(c => c.name === 'finish_notification_delivery' && c.args.p_state === 'provider_accepted'))
mandatory++
assert.doesNotMatch(watchSource, /Number\(params\.owner\)/)
assert.match(watchSource, /exactNotificationOwnerId\(params\.owner\)/)
assert.match(deliverySource, /const exactOwner = exactNotificationOwnerId\(p\.owner\)/)
mandatory++
console.log(`Watch-alert original-source owner binding: ${benign} benign controls + ${mandatory} mandatory checks PASS`)
