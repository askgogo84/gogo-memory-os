// Run-outcome final owner / blocked-account gate (27 Oct 2026).
// Executes the actual TS producer under inert owner rows and an inert delivery orchestrator.
// No database, network, Twilio, customer content, or real notification is touched.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

type State = {
  user: any | null
  blockedAfterPrepare?: boolean
  phoneAfterPrepare?: string
  removeAfterPrepare?: boolean
  optout?: boolean
  foreignUser?: boolean
}
function harness(options: Partial<State> = {}) {
  const state: State = {
    user: { telegram_id: '123', whatsapp_id: 'whatsapp:+15550100123', timezone: 'UTC', access_status: 'active' },
    ...options,
  }
  const rows: Record<string, any[]> = {
    agent_runs: [{
      id: 'run-private-1', telegram_id: '123', type: 'autonomous',
      status: 'completed', title: 'Private research',
      summary: 'Private owner-only comparison', error: null, metadata_json: {},
    }],
  }
  const reads: Array<{ table: string; filters: Array<[string, unknown]> }> = []
  const sends: Array<{ to: string; text: string; token: string }> = []
  const suppressedChecks: Array<{ owner: number; phone: string }> = []
  function from(table: string) {
    const filters: Array<[string, unknown]> = []
    const q: any = {
      select: () => q,
      eq: (col: string, value: unknown) => { filters.push([col, value]); return q },
      maybeSingle: async () => {
        reads.push({ table, filters: [...filters] })
        let available: any[]
        if (table === 'users') {
          available = state.foreignUser
            ? [{ telegram_id: '777', whatsapp_id: 'whatsapp:+15550777777', timezone: 'UTC', access_status: 'active' }]
            : state.user ? [state.user] : []
        } else {
          available = rows[table] || []
        }
        const found = available.find((row: any) =>
          state.foreignUser && table === 'users'
          || filters.every(([key, value]) => String(row[key]) === String(value)),
        )
        return { data: found || null, error: null }
      },
    }
    return q
  }
  const db = { from, rpc: async () => ({ data: true, error: null }) }
  const capture: any = { sends, reads, suppressedChecks }
  const load = ts.transpileModule(
    readFileSync('lib/agent/run-outcome-delivery.ts', 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText
  const exports: Record<string, any> = {}
  const deps: Record<string, any> = {
    '@/lib/supabase-admin': { supabaseAdmin: db },
    '@/lib/services/notification-delivery': {
      deliverNotification: async (p: any) => {
        try {
          await p.prepare('inert-claim')
          if (state.blockedAfterPrepare && state.user) state.user.access_status = 'blocked'
          if (state.phoneAfterPrepare && state.user) state.user.whatsapp_id = state.phoneAfterPrepare
          if (state.removeAfterPrepare) state.user = null
          if (!await p.ready()) return 'suppressed'
          if (!await p.begin('inert-claim')) return 'skipped'
          const id = await p.send('inert-claim')
          return id ? 'provider_accepted' : 'outcome_unknown'
        } catch {
          return 'failed'
        }
      },
    },
    '@/lib/services/delivery-callback': { deliveryCallbackUrl: () => { throw Error('unexpected real callback') } },
    '@/lib/bot/handlers/reminder-optout': {
      isSuppressed: async (owner: number, phone: string) => {
        suppressedChecks.push({ owner, phone })
        return !!state.optout
      },
    },
    './alert-preferences-shared': {
      DEFAULT_ALERT_PREFERENCES: { quietStart: 22, quietEnd: 7 },
      normaliseAlertPreferences: () => ({ quietStart: 22, quietEnd: 7 }),
      isQuietHour: () => false,
    },
  }
  runInNewContext(load, {
    exports, console, Date, Intl, URL, Promise, String, Number, Math, Boolean, Object, Error, JSON,
    require: (name: string) => {
      if (!(name in deps)) throw Error('unexpected dependency: ' + name)
      return deps[name]
    },
  })
  const notify = () => exports.deliverRunOutcomeNotice(
    'run-private-1', '123',
    (run: any) => 'Private: ' + run.summary,
    {
      db,
      send: async (to: string, text: string, token: string) => {
        sends.push({ to, text, token })
        return { sid: 'INERT_ACCEPTED_ID_NOT_DELIVERED' }
      },
      now: () => new Date('2026-10-27T12:00:00Z'),
    },
  )
  return { state, notify, capture }
}
function assertOwnerQuery(h: ReturnType<typeof harness>, minimum: number) {
  const ownerReads = h.capture.reads.filter((read: any) => read.table === 'users')
  assert.ok(ownerReads.length >= minimum, 'owner row must be verified before prepare and again before send')
  for (const read of ownerReads) {
    const match = read.filters.find(([key]: [string, unknown]) => key === 'telegram_id')
    assert.ok(match, 'no unbound owner lookup')
    assert.equal(match![1], '123', 'exact canonical owner string query (never inferred phone)')
  }
}
{
  const h = harness()
  assert.deepEqual(await h.notify(), { status: 'provider_accepted' }, 'acceptance is not verified delivery')
  assert.equal(h.capture.sends.length, 1, 'normal owner should still receive a single notice')
  assert.equal(h.capture.sends[0].to, 'whatsapp:+15550100123')
  assertOwnerQuery(h, 2)
}
{
  const h = harness({ user: { telegram_id: '123', whatsapp_id: 'whatsapp:+15550100123', timezone: 'UTC', access_status: 'blocked' } })
  assert.equal((await h.notify()).status, 'failed', 'blocked owner cannot prepare a private notice')
  assert.equal(h.capture.sends.length, 0)
}
{
  const h = harness({ blockedAfterPrepare: true })
  assert.equal((await h.notify()).status, 'suppressed', 'access revoked between prepare/ready suppresses, not sends')
  assert.equal(h.capture.sends.length, 0)
  assertOwnerQuery(h, 2)
}
{
  // SQL begin_run_outcome_delivery also fences recipient changes. This exercises defense-in-depth
  // in the actual TypeScript producer with a synthetic RPC that deliberately does NOT fence them.
  const h = harness({ phoneAfterPrepare: 'whatsapp:+15550999999' })
  assert.equal((await h.notify()).status, 'suppressed', 'changed recipient cannot use cached private payload')
  assert.equal(h.capture.sends.length, 0)
}
{
  const h = harness({ removeAfterPrepare: true })
  assert.equal((await h.notify()).status, 'suppressed', 'missing owner at final readiness denies notice')
  assert.equal(h.capture.sends.length, 0)
}
{
  const h = harness({ foreignUser: true })
  assert.equal((await h.notify()).status, 'failed', 'unexpected foreign returned owner is never a recipient')
  assert.equal(h.capture.sends.length, 0)
}
{
  const h = harness({ optout: true })
  assert.equal((await h.notify()).status, 'suppressed', 'existing opt-out guard preserved')
  assert.equal(h.capture.sends.length, 0)
  assert.equal(h.capture.suppressedChecks.length, 1)
}
console.log('PASS: run-outcome final owner, blocked/changed recipient, opt-out; actual TS producer under inert DB/ledger/transport')
