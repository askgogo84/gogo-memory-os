// Conditional P1: booking-change watches must NEVER resolve a different owner's browser
// through IEEE-754 rounding of a persisted signed64 telegram_id.
// Inert actual-module test: fake Supabase, fake ticket reader, no network/accounts/DB writes.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync('lib/agent/booking-change-worker.ts', 'utf8')
const emitted = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
  },
}).outputText

const accounts: Record<string, string> = {
  '101': 'actor-safe',
  '9007199254740992': 'actor-A',
  '9007199254740993': 'actor-B',
}
const ownerA = '9007199254740992'
const ownerB = '9007199254740993'
assert.equal(Number(ownerA), Number(ownerB), 'unsafe Number conversion aliases two distinct tenants')

type Fixture = {
  result: { checked: number; changed: number; deferred: number; failed: number }
  userLookups: unknown[]
  eventLookups: unknown[]
  browserActors: string[]
  claims: number
}

async function runWatch(inputOwner: unknown): Promise<Fixture> {
  const userLookups: unknown[] = []
  const eventLookups: unknown[] = []
  const browserActors: string[] = []
  let claims = 0
  const expectedOwner = String(inputOwner)
  const row = {
    id: 'watch-fixture', life_event_id: 'event-fixture', telegram_id: inputOwner,
    status: 'ready', payload_json: { resolvedUrl: 'https://provider.invalid/ticket' },
    updated_at: new Date().toISOString(),
  }
  const db = {
    from(table: string) {
      const eqs = new Map<string, unknown>()
      let operation = 'select'
      const query: any = {
        select(_columns: string) { return query },
        update(_changes: unknown) { operation = 'update'; return query },
        eq(field: string, value: unknown) { eqs.set(field, value); return query },
        in(field: string, _values: unknown) { eqs.set(field, 'IN'); return query },
        lte(_field: string, _value: unknown) { return query },
        order(_field: string) { return query },
        limit(_count: number) { return query },
        async maybeSingle() {
          if (table === 'life_event_actions' && operation === 'update') {
            claims++
            return { data: { id: row.id }, error: null }
          }
          if (table === 'life_events') {
            eventLookups.push(eqs.get('telegram_id'))
            if (eqs.get('telegram_id') !== expectedOwner) {
              return { data: null, error: new Error('wrong-event-owner') }
            }
            return { data: {
              id: row.life_event_id, lifecycle_state: 'watching',
              title: 'Fixture booking', start_at: new Date(Date.now() + 86_400_000).toISOString(),
              location: null, metadata_json: {},
            }, error: null }
          }
          if (table === 'users') {
            const owner = eqs.get('telegram_id')
            userLookups.push(owner)
            const actor = typeof owner === 'string' ? accounts[owner] : null
            return { data: actor ? { id: actor } : null, error: null }
          }
          throw new Error('Unexpected fixture query: ' + table)
        },
        then(resolve: (v: any) => void, reject: (e: any) => void) {
          let result: unknown
          if (table === 'life_event_actions' && operation === 'select') {
            result = { data: eqs.get('status') === 'running' ? [] : [row], error: null }
          } else if (table === 'life_event_actions' && operation === 'update') {
            result = { data: null, error: null }
          } else {
            return Promise.reject(new Error('Unexpected read: ' + table)).then(resolve, reject)
          }
          return Promise.resolve(result).then(resolve, reject)
        },
      }
      return query
    },
  }
  const module: { exports: Record<string, any> } = { exports: {} }
  class InertAnthropic {
    messages = { create: async () => { throw new Error('unexpected provider call') } }
    constructor(_options: unknown) {}
  }
  vm.runInNewContext(emitted, {
    module, exports: module.exports,
    require(id: string) {
      if (id === '@anthropic-ai/sdk') return { __esModule: true, default: InertAnthropic }
      if (id === '@/lib/supabase-admin') return { supabaseAdmin: db }
      if (id === './secure-ticket-reader') return {
        readProviderTicketPage: async (input: { userId: string }) => {
          browserActors.push(input.userId)
          return { status: 'blocked' } // simulated result; no browser invoked
        },
      }
      if (id === './push') return { sendAgentPush: async () => { throw new Error('unexpected push') } }
      throw new Error('Unmocked import: ' + id)
    },
    process: { env: { ANTHROPIC_API_KEY: 'inert' } },
    console: { error: () => {}, warn: () => {}, log: () => {} },
    Date, AbortSignal, Promise, URL, Buffer,
  }, { filename: 'booking-change-worker.fixture.cjs' })
  return {
    result: await module.exports.processBookingChangeWatches(1),
    userLookups, eventLookups, browserActors, claims,
  }
}

for (const [owner, actor] of [[ownerA, 'actor-A'], [ownerB, 'actor-B'], ['101', 'actor-safe']] as const) {
  const run = await runWatch(owner)
  assert.equal(run.result.failed, 0, 'valid owner should not error')
  assert.equal(run.result.checked, 1)
  assert.deepEqual(run.userLookups, [owner], 'trusted database owner lookup keeps the exact decimal STRING')
  assert.deepEqual(run.eventLookups, [owner], 'private event read keeps exact owner predicate')
  assert.deepEqual(run.browserActors, [actor], 'inert ticket reader must receive only this tenant actor')
  assert.equal(run.claims, 1)
}

for (const value of [Number(ownerB), 0, '0', '00101', '123junk', '1e3', '+101', '', null, '9223372036854775808']) {
  const run = await runWatch(value)
  assert.deepEqual(run.userLookups, [], 'invalid/rounded owner cannot read user secrets')
  assert.deepEqual(run.eventLookups, [], 'invalid/rounded owner cannot read private booking')
  assert.deepEqual(run.browserActors, [], 'invalid/rounded owner cannot reach browser/Vault')
  assert.equal(run.claims, 0, 'invalid owner cannot claim a watch')
  assert.equal(run.result.failed, 1, 'rejecting invalid identity must be visible as a failed watch')
}
console.log('Booking watch owner precision: 3 valid + 10 rejected, all inert cases PASS')
