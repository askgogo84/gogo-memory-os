// P1 containment: a boarding-pass Gmail watch may not round one account into another.
// Execute the REAL transpiled worker with inert database / Gmail / notification dependencies.
// No network, production accounts, database writes, or actual provider actions.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync('lib/agent/life-event-email-worker.ts', 'utf8')
const emitted = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText

const bigA = '9007199254740992'
const bigB = '9007199254740993'
assert.equal(Number(bigA), Number(bigB), 'neighbouring signed64 tenants alias via Number')

const accountActors: Record<string, string> = {
  '101': 'mailbox-A', '102': 'mailbox-B',
  [bigA]: 'mailbox-big-A', [bigB]: 'mailbox-big-B',
}
type Evidence = {
  checked: number
  claimed: number
  failed: number
  privateEventOwners: unknown[]
  userLookupOwners: unknown[]
  gmailActors: string[]
  actionClaims: number
  pushCount: number
}

async function execute(inputOwner: unknown, mismatchedUserOwner?: string): Promise<Evidence> {
  const privateEventOwners: unknown[] = []
  const userLookupOwners: unknown[] = []
  const gmailActors: string[] = []
  let actionClaims = 0
  let pushCount = 0
  const action = {
    id: 'inert-watch', life_event_id: 'inert-flight', telegram_id: inputOwner,
    action_key: 'watch-boarding-pass-email', action_type: 'email_watch',
    status: 'ready', payload_json: { scheduleRevision: 'revision-1', flightNo: '6E614' },
    updated_at: new Date().toISOString(),
  }
  const db = {
    from(table: string) {
      const eqs = new Map<string, unknown>()
      let kind = 'read'
      const query: any = {
        select(_columns: unknown) { return query },
        update(_value: unknown) { kind = 'update'; return query },
        eq(field: string, value: unknown) { eqs.set(field, value); return query },
        in(_field: string, _values: unknown[]) { return query },
        not(_field: string, _operation: string, _value: unknown) { return query },
        lte(_field: string, _value: unknown) { return query },
        order(_field: string, _options?: unknown) { return query },
        limit(_n: number) { return query },
        async maybeSingle() {
          if (table === 'life_event_actions' && kind === 'update') {
            actionClaims++
            return { data: { id: action.id }, error: null }
          }
          if (table === 'life_events') {
            const owner = eqs.get('telegram_id')
            privateEventOwners.push(owner)
            if (owner !== String(inputOwner)) return { data: null, error: null }
            return { data: {
              id: action.life_event_id, telegram_id: inputOwner,
              event_type: 'travel', subtype: 'flight', title: 'Synthetic flight',
              provider: 'IndiGo', confirmation_ref: 'ABC123',
              start_at: new Date(Date.now() + 86400000).toISOString(),
              metadata_json: { ticketScheduleRevision: 'revision-1' },
            }, error: null }
          }
          if (table === 'users') {
            const lookup = eqs.get('telegram_id')
            userLookupOwners.push(lookup)
            const account = accountActors[String(lookup)]
            return { data: account ? {
              id: account, telegram_id: mismatchedUserOwner ?? String(lookup),
              whatsapp_id: null, name: 'Inert', gmail_connected: true,
            } : null, error: null }
          }
          throw new Error('Unexpected private query: ' + table)
        },
        then(resolve: (value: any) => void, reject: (error: unknown) => void) {
          let response: unknown
          if (table === 'life_event_actions' && kind === 'read') {
            response = { data: eqs.get('status') === 'running' ? [] : [action], error: null }
          } else if (table === 'life_event_actions' && kind === 'update') {
            response = { data: null, error: null }
          } else if (table === 'boarding_pass_outbox' && kind === 'read') {
            response = { data: [], error: null }
          } else {
            return Promise.reject(new Error('Unexpected provider/DB request: ' + table)).then(resolve, reject)
          }
          return Promise.resolve(response).then(resolve, reject)
        },
      }
      return query
    },
  }
  const module: { exports: Record<string, any> } = { exports: {} }
  vm.runInNewContext(emitted, {
    module, exports: module.exports, Date, Number, String, Promise, Map, Set, Buffer,
    console: { log: () => {}, warn: () => {}, error: () => {} },
    require(modulePath: string) {
      if (modulePath === '@/lib/supabase-admin') return { supabaseAdmin: db }
      if (modulePath === './google-workspace-read') return {
        searchWorkspaceEmails: async (actor: { userId: string }) => {
          gmailActors.push(actor.userId)
          return { messages: [] }
        },
        readWorkspaceEmailBrief: async () => { throw new Error('Unexpected Gmail attachment read') },
      }
      if (modulePath === './push') return {
        sendAgentPush: async () => { pushCount++; throw new Error('Unexpected push') },
      }
      throw new Error('Unexpected module dependency: ' + modulePath)
    },
  }, { filename: 'life-event-email-worker.inert.cjs' })
  const result = await module.exports.processDueLifeEventEmailWatches(1)
  return {
    checked: result.checked, claimed: result.claimed, failed: result.failed,
    privateEventOwners, userLookupOwners, gmailActors, actionClaims, pushCount,
  }
}

for (const owner of ['101', '102', -101]) {
  const result = await execute(owner)
  assert.equal(result.checked, 1, 'safe owner watch is observed')
  assert.equal(result.claimed, 1, 'safe owner watch is claimed')
  assert.equal(result.failed, owner === -101 ? 1 : 0, 'known safe owners must retain normal operation')
  assert.deepEqual(result.privateEventOwners, [String(owner)], 'event read uses the original owner string')
  assert.deepEqual(result.userLookupOwners, [String(owner)], 'user lookup never coerces owner to Number')
  if (owner !== -101) {
    assert.equal(result.gmailActors.length, 4)
    assert.ok(result.gmailActors.every(a => a === accountActors[String(owner)]))
  }
  assert.equal(result.pushCount, 0, 'no real/synthetic notice without evidence')
}

for (const owner of [bigA, bigB, Number(bigB), 0, '0', '00101', '101junk', '1e2', '+101', '', null, undefined]) {
  const result = await execute(owner)
  assert.equal(result.checked, 1)
  assert.equal(result.claimed, 0, 'unsafe owner cannot claim a watch')
  assert.equal(result.actionClaims, 0, 'unsafe owner must not mutate watch state')
  assert.deepEqual(result.privateEventOwners, [], 'unsafe owner cannot read flight event')
  assert.deepEqual(result.userLookupOwners, [], 'unsafe owner cannot resolve someone else\'s Gmail')
  assert.deepEqual(result.gmailActors, [], 'unsafe owner cannot reach Gmail')
  assert.equal(result.failed, 1, 'unsafe owner must fail visibly, not silently succeed')
}

const mismatch = await execute('101', '102')
assert.deepEqual(mismatch.userLookupOwners, ['101'], 'query remains scoped to requesting owner')
assert.deepEqual(mismatch.gmailActors, [], 'mismatched returned user identity never reaches Gmail')
assert.equal(mismatch.failed, 1, 'mismatch is a visible failed watch')
console.log('Boarding-pass Gmail owner precision: safe owners, 12 malformed/unsafe owners and mismatched user identity PASS (inert actual worker)')
