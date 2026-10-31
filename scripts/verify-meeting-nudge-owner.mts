// Synthetic, actual-module meeting reminder privacy/consent checks.
// This fixture never opens Supabase, Calendar, WhatsApp or provider network connections.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const realSource = readFileSync('lib/agent/meeting-nudge.ts', 'utf8')
const compiled = ts.transpileModule(realSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText

const now = new Date('2026-10-27T01:00:00.000Z')
const due = '2026-10-27T01:05:00.000Z'
const wa42 = 'whatsapp:+15550000042'
const wa43 = 'whatsapp:+15550000043'
type Scenario = {
  owner?: unknown
  returnedOwner?: unknown
  revokeCalendarBeforeReady?: boolean
  changeRecipientBeforeReady?: boolean
  revokeAccessBeforeReady?: boolean
  failProvider?: boolean
}
function actualModuleScenario(s: Scenario = {}) {
  const owner = Object.prototype.hasOwnProperty.call(s, 'owner') ? s.owner : '42'
  const loop = {
    id: 'synthetic-loop-1', telegram_id: owner, source_id: 'synthetic-calendar-event',
    title: 'Confidential synthetic meeting', due_at: due,
    evidence_json: { meetingName: 'Private fixture meeting', startsAt: due, meetLink: 'https://meet.google.com/abc-defg-hij' },
  }
  const queries: Array<{ table: string; operation: string; predicates: Array<[string, unknown]> }> = []
  const sends: Array<{ to: string; message: string; token: unknown }> = []
  let preferencesReads = 0
  let userReads = 0
  let attempts = 0
  const db = {
    from(table: string) {
      const predicates: Array<[string, unknown]> = []
      const q: any = {
        select() { return q },
        eq(key: string, value: unknown) { predicates.push([key, value]); return q },
        gt() { return q }, lte() { return q }, order() { return q }, limit() { return q },
        async maybeSingle() {
          const op = 'maybeSingle'
          queries.push({ table, operation: op, predicates: [...predicates] })
          if (table === 'users') {
            userReads++
            return { data: {
              telegram_id: s.returnedOwner ?? '42',
              whatsapp_id: s.changeRecipientBeforeReady && userReads > 1 ? wa43 : wa42,
              timezone: 'Asia/Kolkata',
              access_status: s.revokeAccessBeforeReady && userReads > 1 ? 'blocked' : 'active',
            }, error: null }
          }
          if (table === 'agent_open_loops') return {
            data: { status: 'active', due_at: due, telegram_id: owner }, error: null,
          }
          throw new Error('unexpected query: ' + table)
        },
        then(resolve: any, reject: any) {
          queries.push({ table, operation: 'list', predicates: [...predicates] })
          if (table !== 'agent_open_loops') throw new Error('unexpected list read: ' + table)
          return Promise.resolve({ data: [loop], error: null }).then(resolve, reject)
        },
      }
      return q
    },
  }
  const prefs = (enabled: boolean) => ({ topics: { calendar: enabled } })
  const deps: Record<string, any> = {
    '@/lib/supabase-admin': { supabaseAdmin: db },
    '@/lib/whatsapp': { sendWhatsApp: async (to: string, message: string, _media: unknown, token: unknown) => {
      attempts++
      sends.push({ to, message, token })
      if (s.failProvider) throw new Error('inert unknown provider outcome')
      return { sid: 'synthetic-accepted-only' }
    } },
    '@/lib/services/notification-delivery': { deliverNotification: async ({ ready, send }: any) => {
      if (!(await ready())) return 'deferred'
      await send('inert-idempotency-token')
      return 'provider_accepted'
    } },
    '@/lib/services/cost-guard': { recordCostEvent: async () => {} },
    './alert-preferences': {
      getAlertPreferences: async () => {
        preferencesReads++
        return prefs(!(s.revokeCalendarBeforeReady && preferencesReads > 1))
      },
      isQuietHour: () => false,
    },
    './meeting-prep': { safeMeetLink: (v: unknown) => typeof v === 'string' ? v : null },
  }
  const exportsObj: any = {}
  runInNewContext(compiled, {
    exports: exportsObj, require: (name: string) => {
      if (!Object.prototype.hasOwnProperty.call(deps, name)) throw Error('unmocked import: ' + name)
      return deps[name]
    },
    console, Date, Intl, Number, String, Promise, Set, Math, process: { env: {} },
  }, { filename: 'inert-actual-meeting-nudge.js', timeout: 15000 })
  return {
    run: () => exportsObj.processMeetingNudges(now, 10) as Promise<any>,
    queries, sends, reads: () => ({ preferencesReads, userReads, attempts }),
  }
}

// Malformed persisted identity must not be coerced to another user's numeric owner.
for (const invalid of ['0042', '42.0', ' 42', '+42', '0', '9007199254740992', '9007199254740993', 9007199254740993, null]) {
  const f = actualModuleScenario({ owner: invalid })
  const result = await f.run()
  assert.equal(result.checked, 1)
  assert.equal(f.sends.length, 0, 'untrusted owner must not deliver: ' + String(invalid))
  assert.deepEqual(f.queries.map(q => q.table), ['agent_open_loops'],
    'invalid owner must be rejected before privileged users and consent lookups: ' + String(invalid))
}

// Even when a query appears owner-scoped, an unexpected returned user row cannot authorize a private Meet link.
{
  const f = actualModuleScenario({ returnedOwner: '43' })
  await f.run()
  assert.equal(f.sends.length, 0, 'returned foreign owner must not receive another owner meeting')
}
// A calendar-topic opt-out in the gap between the first read and delivery must prevent a send.
{
  const f = actualModuleScenario({ revokeCalendarBeforeReady: true })
  await f.run()
  assert.equal(f.sends.length, 0, 'calendar opt-out immediately before final ready must block delivery')
  assert.ok(f.reads().preferencesReads >= 2, 'calendar preference must be rechecked at final ready')
}
// Likewise do not deliver to an account whose verified phone or access status changed before ready.
for (const scenario of [{ changeRecipientBeforeReady: true }, { revokeAccessBeforeReady: true }]) {
  const f = actualModuleScenario(scenario)
  await f.run()
  assert.equal(f.sends.length, 0, 'recipient/access policy change must fail closed before sending')
  assert.ok(f.reads().userReads >= 2, 'final readiness must revalidate the recipient owner')
}
// Existing owner consent path remains functional: one accepted-only send, the same ledger behavior.
{
  const f = actualModuleScenario()
  const result = await f.run()
  assert.equal(result.checked, 1)
  assert.equal(result.sent, 1, 'existing provider-accepted accounting remains')
  assert.equal(f.sends.length, 1, 'one send attempt through notification ledger')
  assert.equal(f.sends[0].to, wa42)
  assert.match(f.sends[0].message, /Private fixture meeting/)
  assert.ok(f.queries.filter(q => q.table === 'users').every(q =>
    q.predicates.some(([field, value]) => field === 'telegram_id' && value === '42')),
    'all users reads bind exact canonical decimal owner, not a Number-coerced identity')
}
// Unknown transport outcome must not be blindly retried by this worker.
{
  const f = actualModuleScenario({ failProvider: true })
  const result = await f.run()
  assert.equal(result.sent, 0)
  assert.equal(f.reads().attempts, 1, 'only the ledger may reconcile unknown send outcomes')
}

console.log('✅ Meeting nudge isolation: real worker under inert owner/consent mocks; opt-out and unknown-outcome boundaries')
