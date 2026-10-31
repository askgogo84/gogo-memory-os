// Inert actual-module regression: watch alerts may not send after owner/consent/recipient changes.
// No live DB, WhatsApp, notification RPC, payments or provider calls.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

type Scenario = {
  run: (owner?: any) => Promise<any>
  setConsent: (allow: boolean) => void
  setPhone: (phone: string) => void
  setRowOwner: (owner: string) => void
  setWatcherActive: (active: boolean) => void
  beforeReady: (hook: () => void) => void
  counts: () => { sends: number; prefs: number; ownerReads: number; ledger: number; lastPhone: string }
}
function scenario(): Scenario {
  let allow = true, phone = 'whatsapp:+12025550101', rowOwner = '123', active = true
  let hook = () => {}, sends = 0, prefs = 0, ownerReads = 0, ledger = 0, lastState = 'suppressed', lastPhone = ''
  const expected = JSON.stringify({ kind: 'fixture-watch' })
  const db = { from(table: string) {
    let ownerFilter: any, idFilter: any
    const q: any = {
      select: () => q,
      eq: (key: string, value: any) => {
        if (key === 'telegram_id') ownerFilter = value
        if (key === 'id') idFilter = value
        return q
      },
      maybeSingle: async () => {
        if (table === 'users') {
          ownerReads++
          return { data: { telegram_id: rowOwner, whatsapp_id: phone }, error: null }
        }
        if (table === 'agent_watchers') {
          assert.equal(idFilter, 'fixture-watcher')
          assert.equal(ownerFilter, '123', 'watcher remains scoped to exact owner')
          return { data: { active, condition_json: { kind: 'fixture-watch' } }, error: null }
        }
        if (table === 'notification_deliveries') return {
          data: { state: lastState, provider_id: lastState === 'provider_accepted' ? 'INERT_SID' : null }, error: null,
        }
        throw Error('Unexpected fixture table: ' + table)
      },
    }
    return q
  } }
  const fakeNotification = async (opts: any) => {
    ledger++
    assert.equal(opts.owner, 123)
    try {
      await opts.prepare('INERT_TOKEN')
      hook()
      if (!await opts.ready()) { lastState = 'suppressed'; return lastState }
      const sid = await opts.send('INERT_TOKEN')
      if (!sid) { lastState = 'outcome_unknown'; return lastState }
      lastState = 'provider_accepted'
      await opts.accepted?.(sid)
      return lastState
    } catch {
      lastState = 'persistence_failed'
      return lastState
    }
  }
  const mocks: Record<string, unknown> = {
    '@/lib/supabase-admin': { supabaseAdmin: db },
    '@/lib/whatsapp': { sendWhatsApp: async (dest: string) => { sends++; lastPhone = dest; return { sid: 'INERT_SID' } } },
    '@/lib/services/cost-guard': { recordCostEvent: async () => {} },
    '@/lib/services/notification-delivery': { deliverNotification: fakeNotification },
    './alert-preferences': { getAlertPreferences: async () => { prefs++; return { topics: { watches: allow, bills: allow, replies: allow } } } },
  }
  const exports: any = {}
  const js = ts.transpileModule(readFileSync('lib/agent/watch-alert-delivery.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  runInNewContext(js, {
    exports, module: { exports }, require: (name: string) => {
      if (!Object.hasOwn(mocks, name)) throw Error('Unexpected import in inert watch alert fixture: ' + name)
      return mocks[name]
    },
    console, Date, JSON, Number, String, Promise, Error,
  })
  return {
    run: (owner: any = '123') => exports.deliverWatchAlert({
      watcherId: 'fixture-watcher', owner, key: 'inert-key', due: '2026-10-27T08:00:00Z',
      message: 'FIXTURE_PRIVATE_MEETING_LINK', condition: JSON.parse(expected), topic: 'watches',
    }),
    setConsent: v => { allow = v },
    setPhone: v => { phone = v },
    setRowOwner: v => { rowOwner = v },
    setWatcherActive: v => { active = v },
    beforeReady: v => { hook = v },
    counts: () => ({ sends, prefs, ownerReads, ledger, lastPhone }),
  }
}

// Reject all ambiguous IDs BEFORE reading owner-private preferences or claiming delivery.
for (const owner of ['00123', '+123', '123 ', '1e2', '0', '-0', '9007199254740993', 9007199254740992, 0, null]) {
  const s = scenario()
  await assert.rejects(() => s.run(owner), /watch_alert_owner_invalid/, 'invalid owner: ' + String(owner))
  assert.equal(s.counts().prefs, 0, 'bad owner must not inspect owner preferences')
  assert.equal(s.counts().ownerReads, 0, 'bad owner must not query private recipient')
  assert.equal(s.counts().ledger, 0, 'bad owner must not claim outbound delivery')
}
console.log('PASS watch alert rejects ambiguous owners before any private read or send')

// A mute performed AFTER notification prepare and BEFORE ready revokes delivery.
{
  const s = scenario()
  s.beforeReady(() => s.setConsent(false))
  const result = await s.run()
  assert.equal(result.state, 'suppressed')
  assert.equal(result.accepted, false)
  assert.equal(s.counts().sends, 0, 'late opt-out must suppress an outbound private watch alert')
  assert.ok(s.counts().prefs >= 2, 'consent must be re-read at the final ready boundary')
}
console.log('PASS watch alert honors newly muted topic at ready')

// A phone/account relink between prepare and ready must not deliver to the old phone.
{
  const s = scenario()
  s.beforeReady(() => s.setPhone('whatsapp:+12025550102'))
  const result = await s.run()
  assert.notEqual(result.state, 'provider_accepted')
  assert.equal(s.counts().sends, 0, 'recipient change must suppress stale private notification')
}
console.log('PASS watch alert rejects stale recipient')

// A DB result returned for the wrong owner is not authority to select its phone.
{
  const s = scenario()
  s.setRowOwner('124')
  const result = await s.run()
  assert.notEqual(result.state, 'provider_accepted')
  assert.equal(s.counts().sends, 0, 'mismatched row may not receive another owner private alert')
}
console.log('PASS watch alert verifies recipient row owner')

// Stopped watches already fail closed; preserve it.
{
  const s = scenario()
  s.beforeReady(() => s.setWatcherActive(false))
  const result = await s.run()
  assert.equal(result.state, 'suppressed')
  assert.equal(s.counts().sends, 0)
}
console.log('PASS stopped watch remains suppressed')

// Safe owner, unchanged consent and phone: one inert accepted result, not proof of delivery.
{
  const s = scenario()
  const result = await s.run()
  assert.equal(result.state, 'provider_accepted')
  assert.equal(result.accepted, true)
  assert.equal(result.providerId, 'INERT_SID')
  assert.equal(s.counts().sends, 1)
  assert.equal(s.counts().lastPhone, 'whatsapp:+12025550101')
  assert.equal(s.counts().ledger, 1)
}
console.log('Watch alert owner and late-consent synthetic regression: all checks passed')
