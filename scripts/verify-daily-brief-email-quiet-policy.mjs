// Synthetic ORIGINAL-ROUTE regression for quiet WhatsApp vs expressly opted-in daily EMAIL.
// No external network, credentials, database, customers, or real provider sends.
// Transpile and execute the actual cron GET, not a duplicate policy reimplementation.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const path = 'app/api/cron/daily-briefings/route.ts'
const original = readFileSync(path, 'utf8')
const compiled = ts.transpileModule(original, {
  fileName: path,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText

async function callCron({ proactive = false, emailOptIn = true, whatsappOptIn = true, authorized = true } = {}) {
  const eligible = []
  const policyChecks = []
  let userPages = 0
  let heartbeatCalls = 0
  let receiptReconciliations = 0
  const owner = -101
  const user = {
    telegram_id: owner,
    name: 'Synthetic',
    whatsapp_id: 'whatsapp:+14155552671',
    email: 'synthetic@example.invalid',
    briefing_enabled: whatsappOptIn,
    daily_brief_email_enabled: emailOptIn,
    briefing_time: '00:00',
    weekly_brief: false,
  }

  // A deliberately small fake query builder; all paths are inert and owner-bound.
  const supabaseAdmin = {
    from(table) {
      assert.ok(['delivery_scan_cursors', 'users', 'memories', 'daily_brief_email_log'].includes(table), 'unexpected DB table: ' + table)
      const q = {
        select() { return this },
        eq() { return this },
        gt() { return this },
        or() { return this },
        order() { return this },
        limit() {
          if (table === 'users') return Promise.resolve({ data: userPages++ === 0 ? [user] : [], error: null })
          return Promise.resolve({ data: [], error: null })
        },
        maybeSingle() {
          return Promise.resolve({ data: table === 'users' ? user : null, error: null })
        },
        upsert() {
          assert.equal(table, 'delivery_scan_cursors')
          return Promise.resolve({ error: null })
        },
      }
      return q
    },
  }
  class FakeResponse {
    static json(body, opts = {}) { return { status: opts.status || 200, body } }
  }
  const modules = {
    'next/server': { NextResponse: FakeResponse },
    '@/lib/services/delivery-monitoring': {
      withDeliveryHeartbeat: async (name, fn) => {
        assert.equal(name, 'briefing')
        heartbeatCalls++
        return fn()
      },
    },
    '@/lib/security/cron-auth': { isCronAuthorized: () => authorized },
    '@/lib/channels/proactive-policy': {
      mayVolunteer: kind => {
        assert.equal(kind, 'morning_briefing')
        policyChecks.push(kind)
        return proactive
      },
    },
    '@/lib/whatsapp': { sendWhatsApp: () => { throw Error('unexpected outbound WhatsApp send') } },
    '@/lib/services/notification-delivery': {
      reconcileBriefingEmailReceipts: async () => { receiptReconciliations++; return 0 },
      deliverNotification: async p => {
        assert.equal(String(p.owner), String(owner), 'exact owner must remain bound')
        assert.ok(['email', 'whatsapp'].includes(p.channel))
        await p.prepare('synthetic-token')
        const allowed = await p.ready()
        if (allowed) eligible.push({ channel: p.channel, owner: p.owner, key: p.key })
        return allowed ? 'provider_accepted' : 'suppressed' // SIMULATED acceptance; never invoke p.send or p.accepted
      },
    },
    '@/lib/bot/handlers/reminder-optout': { isSuppressed: async () => false },
    '@/lib/supabase-admin': { supabaseAdmin },
    '@/lib/bot/handlers/morning-briefing': { buildMorningBriefing: async () => 'Synthetic morning briefing' },
    '@/lib/bot/handlers/throwback': { buildThrowbackLine: async () => null },
    '@/lib/email/resend': { sendAskGogoEmail: () => { throw Error('unexpected outbound email send') } },
    '@/lib/email/daily-brief': { renderDailyBriefEmail: () => ({ subject: 'Synthetic brief', html: '<p>synthetic</p>', text: 'synthetic' }) },
    '@/lib/email/daily-brief-unsubscribe': { buildDailyBriefUnsubscribeUrl: () => 'https://example.invalid/unsubscribe' },
  }
  const exports = {}
  const sandbox = {
    exports,
    module: { exports },
    require: name => {
      assert.ok(Object.hasOwn(modules, name), 'unexpected import: ' + name)
      return modules[name]
    },
    process: { env: { RESEND_API_KEY: 'synthetic-placeholder', GOGO_PROACTIVE: proactive ? 'all' : '' } },
    console: { log: () => {}, error: () => {} },
    Date, Intl, Number, String, Math, Error,
  }
  vm.runInNewContext(compiled, sandbox, { filename: path, timeout: 1000 })
  assert.equal(typeof exports.GET, 'function', 'execute the real exported cron route')
  const response = await exports.GET({ headers: { get: () => null } })
  return { response, eligible, policyChecks, heartbeatCalls, receiptReconciliations, userPages }
}

// Regression: the previous early return skipped BOTH channels and email receipt reconciliation.
const quietOptedIn = await callCron({ proactive: false, emailOptIn: true, whatsappOptIn: true })
assert.equal(quietOptedIn.response.status, 200)
assert.deepEqual(quietOptedIn.eligible.map(e => e.channel), ['email'], 'quiet mode must preserve opted-in EMAIL, suppress WhatsApp')
assert.equal(quietOptedIn.response.body.acceptedEmail, 1)
assert.equal(quietOptedIn.response.body.acceptedWhatsapp, 0)
assert.equal(quietOptedIn.heartbeatCalls, 1, 'keep delivery heartbeat')
assert.equal(quietOptedIn.receiptReconciliations, 1, 'email receipt reconciliation still executes')

// Quiet mode is not permission to email users who have NOT opted in.
const quietOptedOut = await callCron({ proactive: false, emailOptIn: false, whatsappOptIn: true })
assert.deepEqual(quietOptedOut.eligible, [])
assert.equal(quietOptedOut.response.body.acceptedEmail, 0)
assert.equal(quietOptedOut.response.body.acceptedWhatsapp, 0)
assert.equal(quietOptedOut.receiptReconciliations, 1)

// Owner's legacy opt-in switch still restores volunteered WhatsApp while preserving email.
const explicitLegacy = await callCron({ proactive: true, emailOptIn: true, whatsappOptIn: true })
assert.deepEqual(explicitLegacy.eligible.map(e => e.channel), ['whatsapp', 'email'])
assert.equal(explicitLegacy.response.body.acceptedWhatsapp, 1)
assert.equal(explicitLegacy.response.body.acceptedEmail, 1)

// Email-only subscriber is eligible independently of WhatsApp enrolment.
const emailOnly = await callCron({ proactive: false, emailOptIn: true, whatsappOptIn: false })
assert.deepEqual(emailOnly.eligible.map(e => e.channel), ['email'])

// Unauthorized cron invocations must be rejected before even reading mail subscribers.
const unauthorized = await callCron({ authorized: false, emailOptIn: true })
assert.equal(unauthorized.response.status, 401)
assert.equal(unauthorized.heartbeatCalls, 0)
assert.equal(unauthorized.receiptReconciliations, 0)
assert.deepEqual(unauthorized.eligible, [])

console.log('PASS original daily-briefing GET: quiet WhatsApp never disables opted-in email or receipt reconciliation; opt-out, auth, and legacy switch retained (all provider actions mocked)')
