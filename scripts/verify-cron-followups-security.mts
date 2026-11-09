import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { isCronAuthorized } from '../lib/security/cron-auth'

const request=(url:string,authorization?:string)=>new Request(url,{headers:authorization?{authorization}:{}})
assert.equal(isCronAuthorized(request('https://app.askgogo.in/api/cron/test'),{}),false)
assert.equal(isCronAuthorized(request('https://app.askgogo.in/api/cron/test','Bearer secret'),{CRON_SECRET:'secret'}),true)
assert.equal(isCronAuthorized(request('https://app.askgogo.in/api/cron/test?secret=secret'),{CRON_SECRET:'secret'}),true)
assert.equal(isCronAuthorized(request('https://app.askgogo.in/api/cron/test','Bearer wrong'),{CRON_SECRET:'secret'}),false)

for(const path of [
  'app/api/cron/daily-briefings/route.ts',
  'app/api/cron/lifecycle-emails/route.ts',
  'app/api/cron/briefing/route.ts',
]){
  const source=readFileSync(path,'utf8')
  assert.match(source,/isCronAuthorized/)
  assert.doesNotMatch(source,/if \(!expected\) return true/)
}

const followups=readFileSync('app/api/followups/route.ts','utf8')
assert.match(followups,/requireAgentMutationOrigin/)
assert.match(followups,/requireAgentSession/)
assert.match(followups,/ownerWhatsapp/)
assert.match(followups,/isCronAuthorized/)
assert.doesNotMatch(followups,/const \{ phone, contact/)

console.log('cron + followups hardening verification passed')


// P1 actual-route follow-up owner isolation; everything below runs in an inert
// VM with mocked auth, service-role DB, notifier and WhatsApp. No network,
// credentials, real database, provider messages or production account changes.
const ownerRouteModule = { exports: {} as Record<string, any> }
let sessionOwner: unknown = '123'
let dueRows: Record<string, unknown>[] = []
let fakeDueOverride: Record<string, unknown>[] | null = null
const ownerLookups: unknown[] = []
const inserts: Record<string, any>[] = []
const notifications: Record<string, any>[] = []
const heldRows: Record<string, any>[] = []
const holdAttempts: string[] = []
const knownPhones = new Map<string, string>([
  ['123', 'whatsapp:+14155550123'],
  ['-123', 'whatsapp:+14155550124'],
  ['9007199254740992', 'whatsapp:+14155550999'],
])

const fakeDb = {
  from(table: string) {
    let lookup: unknown
    let updatePayload: Record<string, unknown> | null = null
    const filters: Array<[string, unknown]> = []
    const builder: any = {
      select(_columns: string) { return builder },
      eq(column: string, value: unknown) {
        filters.push([column, value])
        if (table === 'users' && column === 'telegram_id') {
          lookup = value
          ownerLookups.push(value)
        }
        return builder
      },
      async maybeSingle() {
        if (table !== 'users') throw new Error('Unexpected private query: ' + table)
        const phone = knownPhones.get(String(lookup))
        return { data: phone ? { whatsapp_id: phone } : null, error: null }
      },
      async insert(value: any) {
        if (table !== 'followups') throw new Error('Unexpected write: ' + table)
        inserts.push(value)
        return { error: null }
      },
      update(value: Record<string, unknown>) {
        if (table !== 'followups') throw new Error('Unexpected table update: ' + table)
        updatePayload = value
        return builder
      },
      then(resolve: (result: unknown) => unknown, reject?: (error: unknown) => unknown) {
        try {
          if (table !== 'followups' || !updatePayload) throw new Error('Unexpected select completion: ' + table)
          if (updatePayload.status !== 'owner_verification_required' ||
              updatePayload.delivery_status !== 'blocked_owner_precision') {
            throw new Error('Quarantine must never mark the message as sent or erase the follow-up')
          }
          // Snapshot hold binds UUID + pending + due time + destination; the id fallback binds UUID + pending.
          if (!filters.some(([key, value]) => key === 'id' && typeof value === 'string') ||
              !filters.some(([key, value]) => key === 'status' && value === 'pending')) {
            throw new Error('Quarantine must bind source UUID and pending state')
          }
          holdAttempts.push(filters.some(([key]) => key === 'check_at') && filters.some(([key]) => key === 'whatsapp_id') ? 'snapshot' : 'id_fallback')
          const target = dueRows.find(row => filters.every(([key, value]) => String(row[key]) === String(value)))
          if (!target) return resolve({ data: [], error: null })
          const originalOwner = target.owner_id
          const originalPhone = target.whatsapp_id
          const originalDue = target.check_at
          Object.assign(target, updatePayload)
          if (target.owner_id !== originalOwner || target.whatsapp_id !== originalPhone || target.check_at !== originalDue) {
            throw new Error('Quarantine changed a protected owner, recipient or schedule')
          }
          heldRows.push({ ...target })
          return resolve({ data: [{ id: target.id }], error: null })
        } catch (error) {
          if (reject) return reject(error)
          throw error
        }
      },
    }
    return builder
  },
}
const fakeModules: Record<string, unknown> = {
  '@/lib/services/delivery-monitoring': { withDeliveryHeartbeat: (_name: string, cb: () => unknown) => cb() },
  'next/server': { NextResponse: { json: (body: any, init?: { status?: number }) => ({ status: init?.status ?? 200, body }) } },
  '@supabase/supabase-js': { createClient: () => fakeDb },
  '@/lib/whatsapp': { sendWhatsAppReminderTemplate: async () => { throw new Error('Real or stub send must never execute') } },
  '@/lib/services/notification-delivery': {
    deliverNotification: async (params: any) => {
      notifications.push(params)
      // Do not invoke prepare/ready/send/accepted; notification transport is inert.
      return 'provider_accepted'
    },
  },
  '@/lib/services/reminder-delivery': { deliveryRpc: async () => (fakeDueOverride || dueRows.filter(row => row.status === 'pending')).slice(0, 50) },
  '@/lib/bot/handlers/reminder-optout': { isSuppressed: async () => false },
  '@/lib/security/cron-auth': { isCronAuthorized: () => true },
  '@/lib/agent/session': {
    requireAgentMutationOrigin: () => null,
    requireAgentSession: async () => ({ telegramId: sessionOwner }),
    isAgentSession: () => true,
  },
}
const compiledFollowups = ts.transpileModule(followups, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText
runInNewContext(compiledFollowups, {
  exports: ownerRouteModule.exports,
  module: ownerRouteModule,
  require: (name: string) => {
    if (!(name in fakeModules)) throw new Error('Unexpected dependency: ' + name)
    return fakeModules[name]
  },
  process: { env: { NEXT_PUBLIC_SUPABASE_URL: 'https://inert.example', SUPABASE_SERVICE_ROLE_KEY: 'inert',
    TWILIO_REMINDER_CONTENT_SID: 'inert' } },
  Date, String, Number, AbortSignal, URL, console,
}, { filename: 'app/api/followups/route.ts', timeout: 3000 })
const actualFollowups = ownerRouteModule.exports
assert.equal(typeof actualFollowups.POST, 'function')
assert.equal(typeof actualFollowups.GET, 'function')
const followupPost = () => actualFollowups.POST({ json: async () => ({
  contact: 'Example contact', context: 'Synthetic case', daysIfNoReply: 2,
}) })

// Actual baseline route would round the adjacent signed64 string to the first
// stored owner, look up their phone, and write their follow-up. Current route
// must deny all unsafe/malformed actors before ANY privileged DB operation.
for (const invalid of [
  '9007199254740993', '9007199254740992', '-9007199254740993',
  9007199254740992, '123suffix', '0123', '+123', ' 123', '-0', '0',
  '', '1.5', null, undefined, 1.5,
]) {
  ownerLookups.length = 0
  inserts.length = 0
  sessionOwner = invalid
  const response = await followupPost()
  assert.equal(response.status, 400, 'fail closed on unsafe session owner ' + String(invalid))
  assert.equal(response.body.error, 'invalid_owner_session')
  assert.equal(ownerLookups.length, 0, 'no service-role user lookup for unsafe owner')
  assert.equal(inserts.length, 0, 'no follow-up write for unsafe owner')
}

for (const safe of ['123', -123]) {
  sessionOwner = safe
  ownerLookups.length = 0
  inserts.length = 0
  const response = await followupPost()
  assert.equal(response.status, 200, 'safe existing owner retains create flow')
  const expected = Number(safe)
  assert.deepEqual(ownerLookups, [expected], 'only exact safe user ID queried')
  assert.equal(inserts.length, 1)
  assert.equal(inserts[0].owner_id, expected)
  assert.equal(inserts[0].whatsapp_id, knownPhones.get(String(expected))?.replace('whatsapp:', ''))
}

// Cron input is the delivery RPC result, which may decode PostgreSQL BIGINT
// as a string or already-imprecise JS number. Neither may reach notifier/send.
// The source RPC is capped to the oldest 50 pending rows: reject-and-skip without
// a durable hold would repeat the same batch forever and starve later safe owners.
const makeDue = (id: string, owner: unknown) => ({
  id, owner_id: owner, check_at: new Date(Date.now() - 1000).toISOString(),
  whatsapp_id: '+14155550123', contact_name: 'Example contact', context: '', status: 'pending',
})
const makeUuid = (n: number) => '00000000-0000-4000-8000-' + n.toString(16).padStart(12, '0')
const runDue = (owner: unknown) => {
  dueRows = [makeDue(makeUuid(1), owner)]
  heldRows.length = 0
  notifications.length = 0
  return actualFollowups.GET({})
}
for (const unsafe of [
  '9007199254740993', '9007199254740992', 9007199254740992,
  '-9007199254740993', '123suffix', '0123', 0, null,
]) {
  const response = await runDue(unsafe)
  assert.equal(response.status, 503, 'unsafe RPC owner must fail closed')
  // Objects created in a separate VM realm require explicit structural
  // normalization rather than strict prototype identity comparison.
  assert.deepEqual(JSON.parse(JSON.stringify(response.body.failures)),
    [{ id: makeUuid(1), status: 'owner_verification_required' }])
  assert.equal(notifications.length, 0, 'no notifier/provider invocation for unsafe owner')
  assert.equal(heldRows.length, 1, 'exact invalid source is durably paused, not resent')
  assert.equal(heldRows[0].owner_id, unsafe, 'retain original owner for a verified restoration')
  assert.equal(heldRows[0].contact_name, 'Example contact', 'retain source follow-up')
  assert.equal(dueRows[0].status, 'owner_verification_required')
}
const validDue = await runDue('123')
assert.equal(validDue.status, 200)
assert.equal(notifications.length, 1, 'safe owner can still enter existing notifier')
assert.equal(notifications[0].owner, 123)
assert.equal(notifications[0].channel, 'whatsapp')
assert.equal(typeof notifications[0].send, 'function', 'delivery provider remains controlled by notifier')
assert.equal(heldRows.length, 0, 'valid owner is never put on hold')

// A saturated 50-row unsafe head MUST advance to the next safe source on the
// following invocation; no live cron, DB, ledger, WhatsApp or account touched.
dueRows = Array.from({length: 50}, (_, i) => makeDue(makeUuid(i+1), '9007199254740993'))
dueRows.push(makeDue(makeUuid(51), '123'))
notifications.length = 0
heldRows.length = 0
ownerLookups.length = 0
const saturated = await actualFollowups.GET({})
assert.equal(saturated.status, 503)
assert.equal(saturated.body.checked, 50, 'RPC uses oldest 50 items')
assert.equal(heldRows.length, 50, 'all unsafe head rows held, not permanently retried in the due batch')
assert.equal(notifications.length, 0, 'no unsafe row reaches provider/notifier')
assert.equal(ownerLookups.length, 0, 'no unsafe row reaches private owner lookup')
assert.equal(dueRows.filter(row => row.status === 'pending').length, 1, 'safe item remains eligible')
const nextCycle = await actualFollowups.GET({})
assert.equal(nextCycle.status, 200, 'next RPC cycle advances past all held rows')
assert.equal(nextCycle.body.checked, 1)
assert.equal(notifications.length, 1, 'only subsequent safe follow-up enters controlled notifier')
assert.equal(notifications[0].owner, 123)

// An invalid/forged source UUID or changed source snapshot must fail closed,
// without a notifier call or uncontrolled DB state change.
dueRows = [makeDue('not-a-uuid', '9007199254740993')]
notifications.length = 0
heldRows.length = 0
const badSource = await actualFollowups.GET({})
assert.equal(badSource.status, 503)
assert.deepEqual(JSON.parse(JSON.stringify(badSource.body.failures)),
  [{ id: 'not-a-uuid', status: 'invalid_owner_hold_failed' }])
assert.equal(heldRows.length, 0)
assert.equal(notifications.length, 0)

// 26 Oct review: a due row edited after the RPC read (snapshot mismatch) is still held by exact UUID, so it
// cannot sit pending forever and starve the 50-row queue.
dueRows = [makeDue(makeUuid(77), '9007199254740993'), makeDue(makeUuid(78), '123')]
const edited = { ...dueRows[0] }
dueRows[0] = { ...dueRows[0], check_at: new Date(Date.parse(String(dueRows[0].check_at)) + 60_000).toISOString() }
fakeDueOverride = [edited, dueRows[1]]
notifications.length = 0
heldRows.length = 0
holdAttempts.length = 0
const mismatch = await actualFollowups.GET({})
fakeDueOverride = null
assert.deepEqual(holdAttempts, ['snapshot', 'id_fallback'], 'snapshot miss falls back to an exact-UUID hold')
assert.equal(dueRows[0].status, 'owner_verification_required', 'edited unsafe row is held, not left pending')
assert.equal(heldRows.length, 1)
assert.equal(notifications.length, 1, 'the safe row in the same batch still proceeds')
assert.ok(JSON.stringify(mismatch.body.failures).includes('owner_verification_required'))

// A legacy unsafe row with no destination still leaves the due set through the exact-UUID hold.
dueRows = [{ ...makeDue(makeUuid(79), '9007199254740993'), whatsapp_id: null }]
heldRows.length = 0
holdAttempts.length = 0
await actualFollowups.GET({})
assert.deepEqual(holdAttempts, ['id_fallback'], 'no snapshot update without destination; UUID hold instead')
assert.equal(dueRows[0].status, 'owner_verification_required')

// Both holds miss (row vanished/changed state): reported as hold failure, nothing sent, nothing else written.
dueRows = [makeDue(makeUuid(80), '9007199254740993')]
fakeDueOverride = [{ ...dueRows[0] }]
dueRows[0] = { ...dueRows[0], status: 'fired' }
notifications.length = 0
heldRows.length = 0
holdAttempts.length = 0
const bothMiss = await actualFollowups.GET({})
fakeDueOverride = null
assert.deepEqual(holdAttempts, ['snapshot', 'id_fallback'])
assert.equal(heldRows.length, 0)
assert.equal(notifications.length, 0)
assert.ok(JSON.stringify(bothMiss.body.failures).includes('invalid_owner_hold_failed'), 'a failed hold is reported, never counted as held')

console.log('followups actual-route two-owner precision, durable hold, bounded queue / no-send tests passed')
