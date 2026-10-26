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
const ownerLookups: unknown[] = []
const inserts: Record<string, any>[] = []
const notifications: Record<string, any>[] = []
const knownPhones = new Map<string, string>([
  ['123', 'whatsapp:+14155550123'],
  ['-123', 'whatsapp:+14155550124'],
  ['9007199254740992', 'whatsapp:+14155550999'],
])

const fakeDb = {
  from(table: string) {
    let lookup: unknown
    const builder = {
      select(_columns: string) { return builder },
      eq(column: string, value: unknown) {
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
  '@/lib/services/reminder-delivery': { deliveryRpc: async () => dueRows },
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
const runDue = (owner: unknown) => {
  dueRows = [{ id: 'synthetic-followup', owner_id: owner, check_at: new Date(Date.now()-1000).toISOString(),
    whatsapp_id: '+14155550123', contact_name: 'Example contact', context: '' }]
  notifications.length = 0
  return actualFollowups.GET({})
}
for (const unsafe of [
  '9007199254740993', '9007199254740992', 9007199254740992,
  '-9007199254740993', '123suffix', '0123', 0, null,
]) {
  const response = await runDue(unsafe)
  assert.equal(response.status, 503, 'unsafe RPC owner must fail closed')
  assert.deepEqual(response.body.failures, [{ id: 'synthetic-followup', status: 'invalid_owner' }])
  assert.equal(notifications.length, 0, 'no notifier/provider invocation for unsafe owner')
}
const validDue = await runDue('123')
assert.equal(validDue.status, 200)
assert.equal(notifications.length, 1, 'safe owner can still enter existing notifier')
assert.equal(notifications[0].owner, 123)
assert.equal(notifications[0].channel, 'whatsapp')
assert.equal(typeof notifications[0].send, 'function', 'delivery provider remains controlled by notifier')

console.log('followups actual-route two-owner precision / no-send tests passed')
